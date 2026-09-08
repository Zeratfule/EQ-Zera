// ============================================================================
// What the dev restart button's handler ANSWERS — the contract the renderer reads (JOS-63).
// ============================================================================
//
// JOS-61 replied with a bare `boolean`, which was enough while there was one way to restart. There
// are now THREE outcomes and they are visibly different to the person who clicked:
//
//   'relaunched' — the process is going away right now (no dev server involved).
//   'watcher'    — nothing has happened YET. Main asked the electron-vite watcher to rebuild and
//                  relaunch it, which takes a couple of seconds (measured ~2 s of rebuild plus a
//                  fresh launch), so the button has to say it is waiting rather than look dead.
//   'refused'    — nothing happened and nothing will. A packaged build, or a dev run whose
//                  project tree could not be found.
//
// `detail` is OPERATOR text: the anchor file that was touched, or the reason for a refusal. It is
// dev-only by construction (the only caller is stripped from production bytes) and is written to
// the dev console as well, so a stalled restart can be diagnosed from either end.
//
// It lives in `shared/` because it crosses the IPC boundary three ways: main builds it
// (src/main/devRestart.ts), preload types it (src/preload/dev.ts), and the renderer branches on
// it (features/preferences/PerfSetting.tsx). A type in main/ would have the renderer reaching
// across the trust boundary for it; a type in preload/ would have main doing the same.

/** What main did when the renderer asked for a restart. */
export type DevRestartAction = 'relaunched' | 'watcher' | 'refused'

/** The reply to `dev:restart`. */
export interface DevRestartResult {
  readonly action: DevRestartAction
  /** Operator-facing note — the file that was touched, or why the request was refused. */
  readonly detail?: string
}
