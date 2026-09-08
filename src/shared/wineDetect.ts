// shared/wineDetect.ts — AM I A WINDOWS PROCESS THAT IS NOT ON WINDOWS? (JOS-31)
//
// WHY THIS EXISTS. The app has shipped two graphics-compatibility switches since JOS-40, and a
// user who cannot see the app cannot find them. The long-standing report is blank windows under
// Wine; the new one (01KZGQZJ2HMZGRY28A7CVRG4QT, v0.7.0) is sharper and names the mechanism — the
// celebration toast becomes a STUCK BLACK BOX after a level-up and stays until the app is
// restarted. That is the JOS-40 family exactly: a transparent, frameless, always-on-top window is
// the one window shape whose correctness rests entirely on the compositor doing per-pixel alpha,
// and Wine's is a translation layer over somebody else's. So the app stops waiting to be asked and
// compensates when it finds itself inside a Wine prefix.
//
// WHAT THE PREFIX IS COMPENSATED WITH CHANGED IN JOS-352; THE DETECTION DID NOT. The conclusion
// this module drew — turn safe mode on — was itself the one graphics path Wine cannot do (safe
// mode pins ANGLE to D3D11 WARP), so it now recommends the OPPOSITE and pays for the hardware path
// with two Chromium flags instead. The signals below, and the false-positive standard they are
// held to, are untouched: `WINE_GRAPHICS_AUTO` and `WINE_CHROMIUM_FLAGS` are the policy, and
// everything above them is the evidence for the question "is this Wine", which never changed.
//
// THE WHOLE DESIGN IS "CONSERVATIVE OR NOTHING". A false negative costs a Wine user the automatic
// fallback — they still have both switches, the env var and a support reply. A false positive
// costs EVERY Windows user hardware acceleration and their see-through overlays, for a problem
// they do not have. Those are not comparable, so every signal below has to be something that
// cannot exist on a real Windows machine by accident, and the module reports WHICH ONE fired so a
// wrong answer is diagnosable rather than mysterious.
//
// WHAT WAS AVAILABLE, AND WHY THESE TWO
//
//   ntdll's `wine_get_version` export — Wine's own documented answer to "am I running under
//     Wine", and unreachable from here: it needs GetProcAddress, i.e. a native addon or FFI. This
//     app ships no native module and adding one to decide a background colour would be absurd. It
//     stays the gold standard we are approximating.
//   the registry — REAL, refused on cost, AND THE COST HAS SINCE CHANGED. `HKCU\Software\Wine\Debug`
//     and `HKLM\Software\Wine\LicenseInformation` are both in wine.inf's base install, so they are
//     in every stock prefix. The refusal was that Node had no registry API, so reading one meant
//     spawning `reg.exe` — a blocking child process on the startup path of every launch on every
//     machine, to answer a question that is 'no' for almost all of them, and the answer is needed
//     SYNCHRONOUSLY at module scope before Electron is ready (safe mode is a before-`ready` flag).
//     THAT PREMISE EXPIRED WITH JOS-184: `native-reg` is in the tree now and log/discovery.ts reads
//     HKLM in-process in well under a millisecond, so this signal is available for the price of a
//     probe in main/wine.ts (this module stays pure and is fed by it). It is not here because the
//     two signals below already answer every prefix anyone has reported, not because it cannot be
//     done — it is the next rung if one ever defeats them, alongside the DOS-stub magic below.
//     (The `SOFTWARE\Wine\Wine\Config` key every blog post names has not existed since Wine 0.9.)
//   the "Wine builtin DLL" DOS-stub magic at offset 0x40 of any system32 module — REAL, and not
//     needed. Wine's own `read_file` in setupapi/fakedll.c requires that ASCII marker, so it is as
//     definitive as detection gets without FFI, and it would answer even in a prefix where the
//     wine tools had been deleted AND the environment scrubbed. It is not here because it buys
//     nothing over the two signals below against any prefix that actually exists, and it would
//     cost the pure probe a second capability (open/read at an offset) to harden a case nobody has
//     reported. If a prefix is ever found that defeats both signals below, this is the next rung
//     and it is written down so nobody has to find it again.
//   Wine's own binaries in the system directory — CHOSEN. Wine builds a prefix by laying its own
//     tools into `C:\windows\system32`: `loader/wine.inf.in`'s `[FakeDlls]` section ends with the
//     wildcard `11,,*` (dirid 11 = system32), and setupapi's `install_fake_dll` WriteFile()s each
//     builtin module in whole — they are real PE files on disk, not zero-byte placeholders, which
//     is what makes `existsSync` a valid question. Windows has never shipped a system32 executable
//     whose name begins with "wine". It is a fact about the SYSTEM rather than about who launched
//     us, so no inherited shell environment can fake it, and it costs microseconds and no child
//     process.
//   the environment variables WINE'S NTDLL INJECTS ITSELF — CHOSEN, and the one signal that
//     survives a prefix somebody has stripped. `add_dynamic_environment()` (dlls/ntdll/unix/env.c)
//     runs from BOTH `build_initial_params()` and `init_startup_info()`, i.e. for every Win32
//     process Wine hosts, and unconditionally appends `WINEHOMEDIR`, `WINECONFIGDIR`,
//     `WINELOADER`, `WINEDLLDIR0`, `WINEUSERNAME` and friends. Wine's own Windows-side code reads
//     them back (`wineboot.c` does `_wgetenv(L"WINECONFIGDIR")`), so they are load-bearing rather
//     than incidental.
//
// AND THE VARIABLES THAT LOOK PERFECT AND ARE NOT — the trap this list was written to avoid.
// `WINEPREFIX`, `WINEDEBUG`, `WINEARCH`, `WINEDLLOVERRIDES` and `WINESERVER` are set by the USER or
// the LAUNCHER, never by Wine itself: Lutris and Proton set some of them (Proton actively DELETES
// `WINEARCH`), plain `wine app.exe` sets none, and — the disqualifying half — a developer who
// cross-builds for Wine can perfectly well have them exported in a shell profile ON REAL WINDOWS.
// That is the false positive this module may not have, so none of them are consulted. `WINEARCH`
// and friends buy nothing anyway: the injected set above is present whenever they are.
// `WINELOADERNOEXEC` is worse than unreliable, it is IMPOSSIBLE — `__wine_main()` in
// dlls/ntdll/unix/loader.c calls `unsetenv("WINELOADERNOEXEC")` before `init_environment()` builds
// the Win32 environment at all, so it can never reach `process.env`.
//
// It is a PURE module with an INJECTED probe — no `node:fs`, no `process` — for the same reason
// graphicsPrefs.ts is zero-import: it is read from the composition root's module scope, and it has
// to be testable from an env fixture on a machine that is not the one it describes. Every rule
// here is pinned by tests/wineDetect.test.mts. src/main/wine.ts is the ten lines that hand it a
// real filesystem.
//
// WHAT NOBODY HERE COULD VERIFY, stated plainly because the acceptance criteria asked for it: this
// repo's CI and every machine that has run this code are real Windows, where the correct answer is
// `false` — which is the half that is tested exhaustively. That a stock Wine prefix trips these
// signals rests on Wine's documented layout, not on an observation made here, and the reporter is
// the verification path.

import type { GraphicsAuto } from './graphicsPrefs'

/** What the detector is allowed to look at. Injected so the module is pure, and so a test can
 *  describe a machine it is not running on. */
export interface WineProbe {
  /** `process.platform`. Wine hosts a WINDOWS build, so anything but 'win32' is not Wine. */
  platform: string
  /** The process environment, as `process.env` gives it. */
  env: Record<string, string | undefined>
  /** Does this absolute Windows path exist? (`fs.existsSync`, in production.) */
  fileExists: (path: string) => boolean
}

export interface WineDetection {
  /** Is this process running inside a Wine (or Proton) prefix? */
  wine: boolean
  /**
   * Which signals said so, in a stable order — `file:<name>` for a Wine binary found in the
   * system directory, `env:<NAME>` for a set Wine environment variable. Empty when `wine` is
   * false. It exists so a wrong answer can be read off a user's errors.log and argued with,
   * instead of being a mood the app was in.
   */
  signals: readonly string[]
}

/**
 * Wine's own tools, as laid into the prefix's `system32` by wine.inf's `[FakeDlls]` wildcard.
 * Windows ships no executable THERE whose name starts with "wine" — the closest thing is the
 * `winevt` DIRECTORY (event logging), which is neither one of these names nor a file.
 *
 * SYSTEM32 ONLY, and that is not laziness: `[FakeDllsWow64]` explicitly DELETES `wineboot.exe` and
 * `winemenubuilder.exe` from `syswow64` ("some programs are 64-bit only"), so a syswow64 probe
 * would be two names shorter for no gain.
 *
 * `winhlp32.exe` IS DELIBERATELY ABSENT and is the near-miss worth naming: Wine installs it, but
 * Windows XP/Vista/7 shipped a real one, and the WinHlp32 redistributable still installs it today.
 * It lands in `C:\Windows` rather than system32 — so a probe for it in the system directory would
 * probably be fine, and "probably fine" is not the standard a false positive here is held to.
 */
export const WINE_SYSTEM_BINARIES: readonly string[] = [
  'wineboot.exe',
  'winecfg.exe',
  'winedbg.exe',
  'winemenubuilder.exe'
]

/**
 * Environment variables WINE'S OWN NTDLL APPENDS to every process it hosts — not ones a user or a
 * launcher might have exported. `add_dynamic_environment()` sets these unconditionally, from both
 * the first process in a prefix and every one after it.
 *
 * THE DISTINCTION IS THE WHOLE POINT. `WINEPREFIX` is the variable everybody reaches for and it is
 * set by the LAUNCHER — which means it is absent under a bare `wine app.exe` (false negative) and
 * present on the real-Windows box of anyone who cross-builds for Wine (false positive, the one
 * this module may not have). Nobody hand-exports `WINEDLLDIR0`.
 *
 * `WINE_HOST_PATH` earns its place from the other direction: Wine RENAMES the host's `PATH` to it
 * on the way in (`is_special_env_var` → `WINE_HOST_` prefix), so it exists on essentially every
 * Linux and macOS host and can exist on no Windows one.
 *
 * A CURATED LIST, NOT A `WINE*` PREFIX RULE — the prefix rule is shorter and claims an entire
 * namespace on the strength of five letters, and it is precisely what would have swept the
 * launcher-set variables above back in. The cost is a false negative if Wine invents a new one,
 * which is the cheap direction.
 */
export const WINE_ENV_VARS: readonly string[] = [
  'WINEHOMEDIR',
  'WINECONFIGDIR',
  'WINELOADER',
  'WINEDLLDIR0',
  'WINEUSERNAME',
  'WINESYSTEMDLLPATH',
  'WINE_HOST_PATH'
]

/** Where Windows lives, per the environment, defaulted. Wine answers this too — the same
 *  `add_dynamic_environment()` appends `SystemRoot=C:\windows` — and a machine that answers
 *  neither gets the conventional path rather than a skipped check. */
export function systemDirectory(env: Record<string, string | undefined>): string {
  const root = (env.SystemRoot ?? env.windir ?? 'C:\\Windows').trim()
  const trimmed = root.endsWith('\\') ? root.slice(0, -1) : root
  return `${trimmed || 'C:\\Windows'}\\system32`
}

/**
 * Look at the machine and say whether this is Wine, and on what evidence.
 *
 * ANY ONE SIGNAL IS ENOUGH, because each is independently impossible on real Windows — requiring
 * two would only mean a stripped prefix or a bare `wine app.exe` invocation gets the wrong answer.
 * The platform gate comes first and is absolute: a native Linux or macOS build is not a Windows
 * process being emulated, and must never take a compatibility path meant for one.
 */
export function detectWine(probe: WineProbe): WineDetection {
  if (probe.platform !== 'win32') return { wine: false, signals: [] }
  const signals: string[] = []
  const dir = systemDirectory(probe.env)
  for (const name of WINE_SYSTEM_BINARIES) {
    if (probe.fileExists(`${dir}\\${name}`)) signals.push(`file:${name}`)
  }
  for (const name of WINE_ENV_VARS) {
    const raw = probe.env[name]
    if (typeof raw === 'string' && raw.trim() !== '') signals.push(`env:${name}`)
  }
  return { wine: signals.length > 0, signals }
}

/**
 * WHAT A DETECTED WINE PREFIX ASKS FOR — the policy, in one place, stated rather than implied.
 *
 *   safeMode — **FALSE SINCE JOS-352, AND THE INVERSION IS THE WHOLE TICKET.** It shipped `true`
 *     on WineHQ bug 48618 ("Multiple applications show black client area on startup (… Electron
 *     based apps) ('--disable-gpu' command line parameter is a workaround)"), reasoning that
 *     Electron's cross-process GL into another process's HWND is what winex11.drv cannot do. That
 *     reasoning was about a Wine and an Electron that have both moved. MEASURED under CrossOver on
 *     macOS with D3D Metal (github.com/jmoyers/everquest-companion issue 28, Electron 43 /
 *     Chromium 140), `disableHardwareAcceleration()` on WINDOWS does not mean "no GPU" — it pins
 *     ANGLE to **D3D11 WARP**, Microsoft's software rasteriser, which Wine does not implement at
 *     all. The reporter's log is unambiguous: `eglInitialize D3D11Warp failed`, `ANGLE
 *     Display::initialize error 12289: No available renderers`, `all (1) EGL display types
 *     failed`, GPU process gone — the safe path pinned the ONE backend that cannot exist here and
 *     left nothing to fall back to. Meanwhile HARDWARE D3D11 is real in a modern bottle (DXVK /
 *     D3D Metal), so the compatibility path was the only broken one: a white client area, in an
 *     app whose log tailing, parsing and replay were all healthy in the same run.
 *     The two remaining GPU-process faults on the hardware path are handled by
 *     `WINE_CHROMIUM_FLAGS` below rather than by giving up on the GPU.
 *   opaqueOverlays — UNCHANGED at `true`, and independently argued: the reported symptom is a
 *     transparent frameless overlay stuck on screen as a black box. Wine's layered-window path
 *     needs a compositing WM to produce real per-pixel alpha, and Electron's own docs already
 *     require `--enable-transparent-visuals` for transparency on Linux — a flag this app does not
 *     pass. An opaque window never enters that path at all. NOTE, honestly: there is no bug report
 *     stating "Electron `transparent:true` is opaque black under Wine" — the user's report IS the
 *     evidence, and the mechanism above is why it is believable.
 *
 * Either can be turned ON by the user in one click, and that answer outranks this one for good —
 * including the Wine user who wants software rendering back (`resolveGraphicsSwitch`, and the
 * flags below are gated on the PREFIX, never on this recommendation).
 */
export const WINE_GRAPHICS_AUTO: GraphicsAuto = { safeMode: false, opaqueOverlays: true }

/**
 * CHROMIUM COMMAND-LINE FLAGS A WINE PREFIX NEEDS, appended (via `app.commandLine.appendSwitch`)
 * before `ready` — the second half of JOS-352, and the price of keeping the GPU.
 *
 * With safe mode off the WARP errors go away entirely and two NEW faults surface, both measured on
 * the same report:
 *
 *   disable-direct-composition — `DCompositionCreateDevice3 failed: Not implemented.
 *     (0x80004001)`. `E_NOTIMPL`: Wine has no DirectComposition. This one silences a real error
 *     and is the honest fit for the environment; it is NOT, on its own, what makes the app paint.
 *   in-process-gpu — `GPU process exited unexpectedly: exit_code=-1073741819` (`0xC0000005`, an
 *     access violation), three times, then Chromium gives up. Disabling DComp does not stop it, so
 *     DComp is a red herring and the fault is elsewhere in GPU-process init. Running the GPU
 *     in-process avoids it, and the app then renders correctly and is fully usable.
 *
 * TWO THINGS STATED PLAINLY, because both are the kind of thing a future reader will otherwise
 * have to rediscover. (1) `--in-process-gpu` gives up crash CONTAINMENT: a GPU fault takes the
 * whole app down instead of being restarted behind your back. Under Wine that beats a guaranteed
 * white window; on real Windows it would be a bad trade for nothing, which is exactly why this
 * list is gated on the detection and empty everywhere else. (2) The underlying access violation is
 * UNIDENTIFIED — this is a workaround, not a fix, and it is the first thing to re-measure when
 * Wine or Electron moves.
 *
 * `--no-sandbox` was tried by the reporter and turned out NOT to be required; it is not here.
 */
export const WINE_CHROMIUM_FLAGS: readonly string[] = ['disable-direct-composition', 'in-process-gpu']

/**
 * The Chromium flags this machine needs, given the detection — empty on anything that is not a
 * Wine prefix, which is every real Windows install and every native build (`detectWine` gates on
 * `win32` first, so a Linux or macOS build can never reach this list either).
 *
 * A FUNCTION RATHER THAN THE CONSTANT so the caller in main/ appends what it is handed and holds
 * no opinion about when: "which flags" is a fact about the machine and belongs beside the module
 * that decided what the machine is.
 */
export function chromiumFlagsFor(detection: WineDetection): readonly string[] {
  return detection.wine ? WINE_CHROMIUM_FLAGS : []
}

/**
 * The detection plus what it recommends — the payload the Preferences card hydrates, so the
 * sentence under a switch and the window that was actually built come from one answer.
 */
export interface GraphicsEnvironment extends WineDetection {
  auto: GraphicsAuto
}

/** An ordinary machine: nothing detected, nothing recommended. Also the renderer's initial state,
 *  so a card that has not heard back from main yet describes the common case rather than
 *  flickering through a claim it might have to take back. */
export const NO_GRAPHICS_ENVIRONMENT: GraphicsEnvironment = {
  wine: false,
  signals: [],
  auto: { safeMode: false, opaqueOverlays: false }
}

/** Fold a detection into the environment payload. */
export function graphicsEnvironmentOf(detection: WineDetection): GraphicsEnvironment {
  return {
    ...detection,
    auto: detection.wine ? WINE_GRAPHICS_AUTO : NO_GRAPHICS_ENVIRONMENT.auto
  }
}
