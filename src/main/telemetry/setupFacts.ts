// ============================================================================
// telemetry/setupFacts.ts — the setup snapshot, as a pure function of what was measured (JOS-364).
// ============================================================================
//
// THE ARITHMETIC HALF OF THE PRODUCER, split from `./setupSnapshot.ts` for one reason: everything
// in this file can be TESTED, and nothing in it can be tested if it imports `electron`. The
// gathering half asks the app, the OS, the screen and the store what they are; this half turns
// those raw answers into the closed enums and bucket indices the wire schema allows, and it
// imports nothing but the contract.
//
// THAT SPLIT IS ALSO THE PRIVACY BOUNDARY, drawn where a reader can see it. Every value that
// leaves here is a bucket index, a boolean, or a member of a list declared in
// `shared/telemetry.ts`. A vendor id becomes one of four words; a driver string is never asked
// for; the `eqclient.ini` parse returns one of three words and retains nothing else from the
// file it read. There is no path in this module through which a string from the machine could
// reach the ring.
//
// WHY EACH FIELD EXISTS, once, here — they are the dimensions the live-stall numbers get sliced
// by, not eight more facts for their own sake:
//
//   cpuCountBucket / totalMemBucket  — "the app freezes EverQuest for about a second" is a
//     different report from a 4-thread laptop than from a 16-thread desktop, and today we cannot
//     tell those two reporters apart.
//   gpuVendor / gpuCompositing       — whether we are drawing on the GPU at all, and whose. A
//     driver that has fallen back to software compositing draws every overlay show on the CPU.
//   safeMode                         — OUR OWN switch for the same thing, so a machine that
//     turned it on is not read as a machine whose driver failed.
//   displayCountBucket / primaryScaleBucket — overlay work is done in device pixels; a 4K display
//     at 150% is 2.25× the pixels of a 100% one, and multi-monitor is where window-manager stalls
//     live.
//   eqWindowMode                     — the discriminator the whole ticket turns on: how the game
//     presents itself is the other half of every z-order stall over it. `fullscreen` is the
//     game's own Fullscreen setting being on, which on the current client is a BORDERLESS
//     fullscreen window rather than an exclusive display mode (JOS-375).

import {
  ALERT_COUNT_EDGES,
  CHAR_COUNT_EDGES,
  CPU_COUNT_EDGES,
  DISPLAY_COUNT_EDGES,
  LOG_SIZE_BYTES_EDGES,
  MAX_COUNT,
  PRIMARY_SCALE_EDGES,
  TOTAL_MEM_GB_EDGES,
  bucketOf,
  type EvSetupSnapshot,
  type TelemetryEqWindowMode,
  type TelemetryGpuCompositing,
  type TelemetryGpuVendor,
  type TelemetryOverlayKind,
  type TelemetryUpdateChannel,
  type TelemetryVoiceEngine
} from '../../shared/telemetry'

/**
 * WHAT THE MACHINE ACTUALLY ANSWERED — raw, before any of it is allowed near the wire.
 *
 * Every machine-class member is optional and `undefined` means THE QUESTION WAS NOT ANSWERED,
 * which is a different fact from a zero and is carried through as such: `buildSetupSnapshot`
 * omits the field rather than bucketing a value nobody measured.
 */
export interface SetupFacts {
  /** Character logs the app can see. */
  charCount: number
  /** Size on disk of the log being tailed; 0 when there is no log (bucket 0 either way — see
   *  the note in `buildSetupSnapshot`). */
  logBytes: number
  alertCount: number
  overlaysEnabled: readonly TelemetryOverlayKind[]
  cursorRing: boolean
  autoHide: boolean
  voiceEngine: TelemetryVoiceEngine
  soundPackCount: number
  updateChannel: TelemetryUpdateChannel
  /** `os.cpus().length`. */
  cpuCount?: number
  /** `os.totalmem()`, in bytes. */
  totalMemBytes?: number
  /** The PCI vendor id off `app.getGPUInfo('basic')`, as Chromium reports it (a number, or a
   *  `'0x10de'`-style string depending on platform and Electron version — both are read). */
  gpuVendorId?: number | string
  /** `app.getGPUFeatureStatus().gpu_compositing`, verbatim. */
  gpuCompositingStatus?: string
  /** Graphics safe mode is on for this launch. */
  safeMode?: boolean
  displayCount?: number
  /** `screen.getPrimaryDisplay().scaleFactor` — 1, 1.25, 1.5, … */
  primaryScaleFactor?: number
  /** The whole text of the install's `eqclient.ini`, or null/undefined when there is none. It is
   *  parsed for ONE key here and never retained. */
  eqClientIni?: string | null
}

/** The three vendor ids worth naming. Anything else that answers is `other`; nothing answering
 *  at all is `unknown`, which is honest rather than a fourth vendor. */
const GPU_VENDOR_IDS: Readonly<Record<number, TelemetryGpuVendor>> = {
  0x10de: 'nvidia',
  0x1002: 'amd',
  0x8086: 'intel'
}

/**
 * A PCI vendor id → one of five words.
 *
 * BOTH SPELLINGS ARE ACCEPTED because Chromium has used both: `getGPUInfo('basic')` answers with
 * a number on some platforms and a `'0x10de'` string on others, and a producer that understood
 * only one of them would report `other` for a whole platform's worth of NVIDIA machines — a wrong
 * answer that looks exactly like a right one in a bar chart.
 */
export function gpuVendorOf(raw: unknown): TelemetryGpuVendor {
  const id =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().startsWith('0x') ? raw.trim() : `0x${raw.trim()}`)
        : Number.NaN
  if (!Number.isFinite(id) || id <= 0) return 'unknown'
  return GPU_VENDOR_IDS[id] ?? 'other'
}

/**
 * `gpu_compositing`'s raw status → one of four words.
 *
 * CHROMIUM'S VOCABULARY IS NEITHER CLOSED NOR STABLE (`enabled`, `enabled_readback`,
 * `disabled_software`, `disabled_off`, `disabled_off_ok`, `unavailable_software`,
 * `unavailable_off`, …), which is the whole reason it is folded here instead of forwarded: a raw
 * status on the wire would be free text with extra steps, and a member added by a Chromium bump
 * would 400 the batch it rode in on.
 *
 * The fold keeps the ONE distinction the stall question needs — are we compositing on the GPU
 * (`hardware`), on the CPU (`software`), or not at all (`off`) — and anything unrecognized is
 * `unknown` rather than guessed into the nearest neighbour.
 */
export function gpuCompositingOf(raw: unknown): TelemetryGpuCompositing {
  if (typeof raw !== 'string') return 'unknown'
  const status = raw.trim().toLowerCase()
  if (status === 'enabled') return 'hardware'
  if (status === 'disabled_software' || status === 'enabled_readback') return 'software'
  if (status.startsWith('unavailable') || status.startsWith('disabled_off')) return 'off'
  return 'unknown'
}

/** `WindowedMode=TRUE`, case-insensitively, with whatever spacing an INI file has picked up over
 *  twenty-five years. Only the FIRST match is read: an INI with the key twice is a file that has
 *  been hand-edited, and the game reads the first one too.
 *
 *  The `[ \t]*=` is load-bearing, not decoration: this client family also writes
 *  `WindowedModeXOffset` / `WindowedModeYOffset`, which are window POSITION, not mode, and a
 *  prefix match on them would report a windowing decision from a pair of pixel coordinates. */
const WINDOWED_MODE_RE = /^[ \t]*WindowedMode[ \t]*=[ \t]*(\S+)/im

/** `Fullscreen=1`, the OTHER spelling — see `eqWindowModeOf` for which client writes which. The
 *  same anchored `=` keeps `FullscreenBitsPerPixel` and `FullscreenRefreshRate` out. */
const FULLSCREEN_RE = /^[ \t]*Fullscreen[ \t]*=[ \t]*(\S+)/im

/**
 * `eqclient.ini` → one of three words, and NOTHING ELSE FROM THE FILE.
 *
 * The file is EverQuest's own settings, not ours: it holds resolution, gamma, sound devices, UI
 * skin names and more. This function looks at two keys and returns an enum member, so there is no
 * shape in which any other line of it could reach the wire even by mistake.
 *
 * TWO KEY FAMILIES, BECAUSE TWO CLIENTS (JOS-374). The Titanium-era clients this field was first
 * written for spell the mode `WindowedMode=TRUE|FALSE`. The live EverQuest Legends client does
 * not write that key AT ALL — it writes `Fullscreen=1|0` alongside `WindowedWidth`/`WindowedHeight`
 * and `FullscreenBitsPerPixel`, and its only `WindowedMode*` keys are the `XOffset`/`YOffset`
 * position pair. Reading only the first spelling made the field dark for every player on the
 * current client, which is how this was found: a live setup snapshot said `unknown` with the game
 * installed and running.
 *
 * `WindowedMode` WINS WHEN BOTH ARE PRESENT. A client that writes the explicit mode key is
 * telling us the mode; `Fullscreen=` is the fallback reading, not a second vote.
 *
 * `fullscreen` IS THE GAME'S SETTING, NOT A DISPLAY MODE (JOS-375). Both spellings answer one
 * question — is the game's own Fullscreen option on — and on the current client that option
 * produces a BORDERLESS FULLSCREEN WINDOW, which an always-on-top overlay shares without any
 * display-mode switch. This member used to be called `exclusive`, and that was a claim about
 * DirectX-era exclusive mode that neither key can support: the file says which setting is on and
 * says nothing about how the client implements it. The reading is unchanged; only the honest
 * name is.
 *
 * GARBAGE IS `unknown`, NOT A GUESS. `WindowedMode=` with nothing after it, or with a value the
 * game itself would not understand, is a file we cannot read rather than evidence of a mode —
 * and a wrong answer here would misattribute exactly the stalls this field exists to explain.
 */
export function eqWindowModeOf(ini: string | null | undefined): TelemetryEqWindowMode {
  if (typeof ini !== 'string' || ini === '') return 'unknown'
  const windowedMode = WINDOWED_MODE_RE.exec(ini)?.[1]?.trim().toLowerCase()
  if (windowedMode === 'true') return 'windowed'
  if (windowedMode === 'false') return 'fullscreen'
  const fullscreen = FULLSCREEN_RE.exec(ini)?.[1]?.trim().toLowerCase()
  if (fullscreen === '1') return 'fullscreen'
  if (fullscreen === '0') return 'windowed'
  return 'unknown'
}

/**
 * Bytes → whole gibibytes, ROUNDED rather than truncated, and that is the only interesting line
 * in this function. `os.totalmem()` reports what the OS can address, which on a 16 GB machine is
 * 15.9 GiB after the firmware and the integrated GPU have taken their share — truncating would
 * file it under 12-15 and report a fleet of machines nobody sells. The ladder's edges are the
 * numbers people BUY, so the fold has to land on those.
 */
function memGb(bytes: number): number {
  return Math.floor(bytes / 1_073_741_824 + 0.5)
}

/**
 * THE EVENT, from the facts. Total: no throw, no I/O, no clock.
 *
 * `logSizeBucket` is 0 both for a small log and for no log at all, and that is stated rather than
 * fixed: the field is REQUIRED by a contract that predates this producer, bucket 0 is the honest
 * floor of the ladder, and an install with no log is already visible as `charCountBucket` 0.
 *
 * Every machine-class field is omitted when its fact is absent. That is what makes the optional
 * fields mean "not measured" on the wire instead of "measured as the bottom bucket".
 */
export function buildSetupSnapshot(f: SetupFacts): EvSetupSnapshot {
  const ev: EvSetupSnapshot = {
    t: 'setupSnapshot',
    charCountBucket: bucketOf(f.charCount, CHAR_COUNT_EDGES),
    logSizeBucket: bucketOf(f.logBytes, LOG_SIZE_BYTES_EDGES),
    alertCountBucket: bucketOf(f.alertCount, ALERT_COUNT_EDGES),
    // A SET, deduped and in the schema's own order — `overlaysEnabled` is membership and nothing
    // else, so two installs with the same windows open produce a byte-identical field. The
    // validator re-does this; doing it here too means the value we buffer is the value it accepts.
    overlaysEnabled: [...new Set(f.overlaysEnabled)],
    cursorRing: f.cursorRing,
    autoHide: f.autoHide,
    voiceEngine: f.voiceEngine,
    soundPackCount: Math.max(0, Math.min(MAX_COUNT, Math.trunc(f.soundPackCount))),
    updateChannel: f.updateChannel
  }
  if (f.cpuCount !== undefined) ev.cpuCountBucket = bucketOf(f.cpuCount, CPU_COUNT_EDGES)
  if (f.totalMemBytes !== undefined) {
    ev.totalMemBucket = bucketOf(memGb(f.totalMemBytes), TOTAL_MEM_GB_EDGES)
  }
  if (f.gpuVendorId !== undefined) ev.gpuVendor = gpuVendorOf(f.gpuVendorId)
  if (f.gpuCompositingStatus !== undefined) {
    ev.gpuCompositing = gpuCompositingOf(f.gpuCompositingStatus)
  }
  if (f.safeMode !== undefined) ev.safeMode = f.safeMode
  if (f.displayCount !== undefined) {
    ev.displayCountBucket = bucketOf(f.displayCount, DISPLAY_COUNT_EDGES)
  }
  if (f.primaryScaleFactor !== undefined) {
    ev.primaryScaleBucket = bucketOf(
      Math.round(f.primaryScaleFactor * 100),
      PRIMARY_SCALE_EDGES
    )
  }
  if (f.eqClientIni !== undefined) ev.eqWindowMode = eqWindowModeOf(f.eqClientIni)
  return ev
}
