// ============================================================================
// telemetryPerfCube.ts — the ONE cross-tab this pipeline keeps (JOS-372).
// ============================================================================
//
// WHY A SECOND TABLE AT ALL, when the rule has been "one narrow counter table for everything".
// `usage_daily` is (day, cohort, metric, dim, n) — ONE dimension per row — so it can answer "how
// many session reports saw a stall over 500 ms" and it structurally CANNOT answer "is that rate
// higher on fullscreen installs, or on 8 GB boxes, or when a meter is locked". Those
// are the questions the field reports about ~1 s EverQuest freezes actually pose, and a cross-tab
// is the only shape that answers one. So: ONE small cube, five closed dims wide, and still no raw
// event store and still nothing per-install beyond the `analytics_install` row that already
// exists.
//
// EVERY DIM IS A CLOSED ENUM OR A BUCKET INDEX, which is what keeps this inside the bright line
// (AGENTS.md): there is no field here a character, a zone, a path or a line of log could reach,
// and the widest row this can ever produce is a seven-tuple of vocabulary declared in this file.
//
// PURE, like `./telemetryRollup.ts` next door and for the same reason: it imports the contract's
// types and nothing else, so it bundles into the ingest Lambda and compiles under both of the
// repo's tsconfigs. It is a SEPARATE file because that one sits at the repo's 400-code-line
// ceiling — the `telemetryRollupLive.ts` split, one ticket later.
//
// A NOTE ON WHAT THIS IS NOT. `src/main/triage/machineClass.ts` renders the EIGHT `setupSnapshot`
// readings as a labelled mix for the Analytics tab — cores, memory, GPU, compositing, safe mode,
// displays, scale, EQ window mode, each as its own distribution. That is a different thing from
// the CLASS below, which collapses three of those readings into one low-cardinality axis so a
// stall rate can be sliced by it. Neither is a copy of the other and neither belongs in the
// other's file: one is a renderer of eight distributions, this is a storage key.

import { TELEMETRY_EQ_WINDOW_MODES } from './telemetry'
import type { EvSetupSnapshot, TelemetryEqWindowMode, TelemetryEvent } from './telemetry'

/**
 * THE MACHINE CLASS — at most eight values, and the collapse is the whole design decision.
 *
 * The raw axes the ticket names are cores × memory × GPU, i.e. 3 × 3 × 3 = 27 combinations. 27
 * classes crossed with the four other dims is a cube nobody can read and a cardinality budget
 * nobody can defend, so the three axes are folded twice:
 *
 *   * CORES AND MEMORY BECOME ONE TIER, AND THE WEAKER AXIS DECIDES IT. A 16-thread box with
 *     8 GB of RAM behaves like a small machine under a game, a browser and this app — it pages,
 *     which is the leading candidate for a whole-system stall. Taking the minimum of the two says
 *     that, and taking an average would hide exactly the machines this cube exists to find.
 *   * THE GPU AXIS IS INTEGRATED-VS-DISCRETE. `intel` is integrated, `nvidia`/`amd` are discrete
 *     (this app cannot tell an RTX from a ten-year-old GT and does not want to), and everything
 *     else is unknown.
 *
 * `unknown` IS A CLASS, NOT A MISSING VALUE. A client that predates the machine-class fields, or
 * a machine that would not answer, lands here rather than being guessed into `low` — the same
 * refusal `foldMachineClass` makes when it skips an absent field instead of folding a zero.
 * Reading a rate for `unknown` is reading a rate for "boxes we could not class", which is a real
 * population and is worth seeing rather than smearing across the other six.
 */
export const PERF_MACHINE_CLASSES = [
  'low-igpu',
  'low-dgpu',
  'mid-igpu',
  'mid-dgpu',
  'high-igpu',
  'high-dgpu',
  'unknown'
] as const
export type PerfMachineClass = (typeof PERF_MACHINE_CLASSES)[number]

/**
 * THE TIER CUTS, EXPRESSED IN BUCKET INDICES, because that is all the server ever receives — the
 * client sends `cpuCountBucket` / `totalMemBucket`, never a core count or a byte figure.
 *
 * `CPU_COUNT_EDGES` = [2, 4, 6, 8, 12, 16, 24] ⇒ bucket 0 `<2`, 1 `2-3`, 2 `4-5`, 3 `6-7`,
 * 4 `8-11`, 5 `12-15`, 6 `16-23`, 7 `≥24`.
 * `TOTAL_MEM_GB_EDGES` = [4, 8, 12, 16, 24, 32, 64] ⇒ 0 `<4`, 1 `4-7`, 2 `8-11`, 3 `12-15`,
 * 4 `16-23`, 5 `24-31`, 6 `32-63`, 7 `≥64`.
 *
 * THE LADDER DECIDES THE EXACT CUT, NOT THE PROSE. The brief said cores `≤4 | 6-8 | >8` and
 * memory `≤8 | 12-16 | >16`; `8-11` and `16-23` are each ONE bucket and cannot be split, so the
 * cuts land at the nearest edge the storage actually has: cores `<6` / `6-11` / `≥12`, memory
 * `<12 GB` / `12-23 GB` / `≥24 GB`. Inventing a finer cut would mean claiming a precision the
 * wire deliberately threw away.
 */
const CPU_MID_BUCKET = 3
const CPU_HIGH_BUCKET = 5
const MEM_MID_BUCKET = 3
const MEM_HIGH_BUCKET = 5

/** 0 low · 1 mid · 2 high, from a bucket index and its two cut points. */
function tierOf(bucket: number, mid: number, high: number): number {
  if (bucket >= high) return 2
  return bucket >= mid ? 1 : 0
}

const TIER_NAMES = ['low', 'mid', 'high'] as const

/**
 * ONE setupSnapshot → its machine class. TOTAL: anything it cannot class is `unknown`, including
 * a client that sends none of the three fields (they are all optional on the wire — the
 * additive-field rule) and a machine whose GPU vendor came back `other`.
 */
export function machineClassOf(ev: Pick<EvSetupSnapshot, 'cpuCountBucket' | 'totalMemBucket' | 'gpuVendor'>): PerfMachineClass {
  const gpu = gpuKindOf(ev.gpuVendor)
  const { cpuCountBucket: cpu, totalMemBucket: mem } = ev
  if (gpu === null || cpu === undefined || mem === undefined) return 'unknown'
  if (!Number.isInteger(cpu) || !Number.isInteger(mem)) return 'unknown'
  // The WEAKER axis is the tier: a machine is as fast as the thing it runs out of first.
  const tier = Math.min(
    tierOf(cpu, CPU_MID_BUCKET, CPU_HIGH_BUCKET),
    tierOf(mem, MEM_MID_BUCKET, MEM_HIGH_BUCKET)
  )
  return `${TIER_NAMES[tier]}-${gpu}` as PerfMachineClass
}

/** `igpu` / `dgpu`, or null for a vendor this cube will not pretend to know. */
function gpuKindOf(vendor: string | undefined): 'igpu' | 'dgpu' | null {
  if (vendor === 'intel') return 'igpu'
  return vendor === 'nvidia' || vendor === 'amd' ? 'dgpu' : null
}

/**
 * THE TWO DIMS AN INSTALL CARRIES BETWEEN BATCHES.
 *
 * A `setupSnapshot` is sent once per launch, but a session reports a stall reading every ten
 * minutes for hours — so most batches carrying a `live` rider carry no snapshot at all. Those two
 * enums therefore also live on `analytics_install` (two nullable columns, added by an `ALTER`),
 * written whenever a snapshot arrives and read back by the ingest path as the fallback. That is
 * the ENTIRE per-install footprint this ticket adds: two closed enums on a row that already
 * exists.
 */
export interface PerfInstallDims {
  machineClass: PerfMachineClass
  windowMode: TelemetryEqWindowMode
}

/** What an install nobody has ever heard a snapshot from looks like. */
export const UNKNOWN_PERF_DIMS: PerfInstallDims = { machineClass: 'unknown', windowMode: 'unknown' }

/** TOTAL, and it fails toward `unknown` on purpose — a NULL column, a value from a future schema
 *  and junk all read as "we could not class this box", which is a true statement about all three. */
export function perfDimsOf(machineClass: unknown, windowMode: unknown): PerfInstallDims {
  const classes: readonly string[] = PERF_MACHINE_CLASSES
  const modes: readonly string[] = TELEMETRY_EQ_WINDOW_MODES
  return {
    machineClass:
      typeof machineClass === 'string' && classes.includes(machineClass)
        ? (machineClass as PerfMachineClass)
        : 'unknown',
    windowMode:
      typeof windowMode === 'string' && modes.includes(windowMode)
        ? (windowMode as TelemetryEqWindowMode)
        : 'unknown'
  }
}

/** The dims THIS batch states, from its own `setupSnapshot` — null when it carries none. The
 *  same-batch snapshot always wins over the stored row: it is the newer fact, and a machine that
 *  just changed its EQ window mode says so in the launch that noticed. */
export function perfDimsFromEvents(events: readonly { ev: TelemetryEvent }[]): PerfInstallDims | null {
  for (const { ev } of events) {
    if (ev.t !== 'setupSnapshot') continue
    return { machineClass: machineClassOf(ev), windowMode: ev.eqWindowMode ?? 'unknown' }
  }
  return null
}

/**
 * ONE ROW OF `perf_daily`. Every field is a dim of the PRIMARY KEY except `n`; the day and the
 * cohort are the statement's shared parameters, exactly as they are for `usage_daily`.
 */
export interface PerfCubeRow {
  windowMode: string
  machineClass: string
  /** `on` / `off` — was ANY overlay locked (click-through, so the process-wide WH_MOUSE_LL hook
   *  is armed) at report time. `-` when the report carried no `state` rider to ask. */
  locked: string
  /** The report's WORST probe tick, as an index into `LIVE_STALL_MS_EDGES`. */
  stallBucket: string
  /** The report's worst tail READ, same ladder. `-` when it tailed nothing (no `tail` rider) —
   *  a real and common state, and a different fact from "its reads were fast". */
  tailBucket: string
  n: number
}

/** `dim` is NOT NULL in the schema; this is what "this report could not say" looks like. It is
 *  `DIM_NONE`'s value, restated rather than imported so this file keeps its one-import contract. */
const NOT_STATED = '-'

/**
 * ONE BATCH → its cube rows, folded on (windowMode, machineClass, locked, stall, tail).
 *
 * ONE INCREMENT PER SESSION REPORT THAT CARRIED A `live` RIDER, which is deliberately the SAME
 * population as `liveStallP95`'s histogram total — so "42% of reports in this slice were over
 * 500 ms" and the Live section's fleet-wide figures are rates over the same denominator and can
 * be read against each other. That includes a `sessionEnd` as well as a `sessionHeartbeat`: both
 * carry the identical rider for the interval since the last report, and dropping the last
 * interval of every clean exit would quietly bias the cube toward sessions that were killed.
 *
 * Deterministic order (the key's own sort), like `foldFunnels` and `foldErrors`, so the handler's
 * multi-row UPSERT is reproducible and this file stays testable without a database.
 */
export function foldPerfCube(
  events: readonly { ev: TelemetryEvent }[],
  dims: PerfInstallDims
): PerfCubeRow[] {
  const bag = new Map<string, PerfCubeRow>()
  for (const { ev } of events) {
    if (ev.t !== 'sessionHeartbeat' && ev.t !== 'sessionEnd') continue
    if (ev.live === undefined) continue
    const row: PerfCubeRow = {
      windowMode: dims.windowMode,
      machineClass: dims.machineClass,
      locked: ev.state === undefined ? NOT_STATED : ev.state.overlaysLocked > 0 ? 'on' : 'off',
      stallBucket: String(ev.live.maxBucket),
      tailBucket: ev.tail === undefined ? NOT_STATED : String(ev.tail.maxBucket),
      n: 1
    }
    const key = [row.windowMode, row.machineClass, row.locked, row.stallBucket, row.tailBucket].join(' ')
    const held = bag.get(key)
    if (held) held.n += 1
    else bag.set(key, row)
  }
  return [...bag.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)
}
