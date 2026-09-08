// ============================================================================
// windowMemory — the STORE side of the main window's memory of itself (JOS-248).
// ============================================================================
//
// Six lines of glue with a file of its own, for the reason `uiScale.ts` and `windowErrors.ts`
// already have one: windows.ts is at the repo's 400-code-line factoring ceiling and the answer to
// that is a split, never a widened threshold. This is the natural seam — the POLICY (what is worth
// remembering, and when it is written) is pure and lives in `windowState.ts`, node-tested against
// windows this machine does not have; windows.ts owns the real BrowserWindow; and the one thing
// neither of them should own is the electron-store handle sitting between them.
//
// It takes the window as an ARGUMENT rather than reaching for `getMainWindow()`, which would make
// a cycle out of two modules that have no business depending on each other in that direction. Every
// entry point tolerates `null`, so a teardown path can ask without checking first.
//
// ONE saver for the process, not one per window: `app.on('activate')` can re-create the main
// window, and a saver that came back with it would have forgotten what it last wrote and re-write
// it on the first event.

import { setWindowBounds } from './store'
import { createWindowStateSaver, windowStateOf, type WindowLike } from './windowState'
import type { Rect } from './displayFit'

const saver = createWindowStateSaver(setWindowBounds)

/**
 * Declare the rectangle the APP is applying to the window right now (and the maximized state it is
 * applying with it), so the save that follows is not mistaken for the user's own choice — the
 * store keeps the rectangle the USER chose, the screen gets the one that fits. See
 * `WindowStateSaver.applied`.
 */
export function declareWindowPlacement(rect: Rect | undefined, maximized: boolean): void {
  saver.applied(rect, maximized)
}

/** Record where the window is now, debounced. A no-op for a minimized, destroyed or absent one. */
export function rememberWindowState(w: WindowLike | null): void {
  const state = w ? windowStateOf(w) : null
  if (state) saver.queue(state)
}

/**
 * Record it and write it NOW — the window's own `close`, and `before-quit` for the quit paths that
 * never close a window (an auto-updater's `quitAndInstall`, an OS logoff; Electron does not emit
 * `window-all-closed` on those, which is what left the launch right after an update at a stale
 * size).
 */
export function flushWindowState(w: WindowLike | null): void {
  rememberWindowState(w)
  saver.flush()
}
