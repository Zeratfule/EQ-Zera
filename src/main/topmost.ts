// topmost.ts — ALWAYS-ON-TOP IS RE-ASSERTED ONLY WHEN IT HAS ACTUALLY BEEN LOST (JOS-368).
//
// WHAT `setAlwaysOnTop` COSTS. It is a `SetWindowPos` — a Z-ORDER CHANGE, not an attribute write.
// Every one of them is work the compositor has to do over a running game, and field reports of
// "hitches" on every alt-tab are that call, five windows at a time.
//
// THE ORIGINAL ARGUMENT WAS SHARPER AND WRONG (JOS-375). This header used to say that over a game
// in EXCLUSIVE fullscreen a z-order change is a display-mode switch — a black flash and about a
// second of frozen game — which is true of DirectX exclusive mode and NOT true here: the live
// client's Fullscreen setting is a BORDERLESS fullscreen window, which shares the screen with a
// topmost overlay. The guard stays anyway, and the reason it stays is the plainer one it always
// also had: five system calls where zero are needed is five too many, whatever they cost.
//
// WHY IT WAS UNCONDITIONAL, AND WHY THAT PART IS KEPT. A HIDDEN window can genuinely lose topmost
// on Windows, so the re-assert after auto-hide (`setOverlaysHidden`) is load-bearing and cannot
// simply go. `isAlwaysOnTop()` reads back WS_EX_TOPMOST from the window itself — not a copy we
// remember, which is the version of this that would drift — so a window that really lost the style
// is still re-asserted, and a window that never lost it costs nothing. Same guarantee, one call
// instead of one call per show.
//
// WHY THE CURSOR RING IS THE EXCEPTION, and it is not a detail. "Above the overlays" is not a
// z-level this app can ask for: the ring and the overlays share the SAME 'screen-saver' level, and
// within one level THE MOST RECENT ASSERTION WINS. The ring therefore sits on top only because
// every overlay show/re-raise path ends by re-asserting the ring LAST. Guarding that call would
// make it a no-op exactly when it matters — the ring is already topmost, so the guard would skip,
// and the overlay that just re-raised itself would stay above the circle. The ring's raises go
// through `raiseTopmost` below, which is unconditional on purpose, and there are only ever four of
// them per re-show against five overlays that no longer pay anything.
//
// ELECTRON-FREE ON PURPOSE. The window is taken structurally (`TopmostWindow`), the same bargain
// `devRestart.ts`'s `RestartHost` and `security.ts` strike: the policy is a plain module a node
// test can drive with a fake window, and windows.ts hands it the real `BrowserWindow`.

/** The z-level every window in this app claims. One spelling, so no call site can pick another. */
export const TOPMOST_LEVEL = 'screen-saver'

/** The slice of `BrowserWindow` a z-order re-assert reads and writes. Electron's own satisfies it. */
export interface TopmostWindow {
  isAlwaysOnTop: () => boolean
  setAlwaysOnTop: (flag: boolean, level: typeof TOPMOST_LEVEL) => void
}

/** How many `SetWindowPos` calls the guard has issued, and how many it has spared the game. */
let issued = 0
let avoided = 0

/**
 * Re-assert `w`'s always-on-top ONLY IF THE WINDOW SAYS IT HAS LOST IT.
 *
 * Every overlay show/re-show path calls this instead of the bare setter. See the header for why
 * the read-back is the window's own answer rather than a remembered flag, and why the cursor ring
 * does NOT come through here.
 */
export function assertTopmost(w: TopmostWindow): void {
  if (w.isAlwaysOnTop()) {
    avoided++
    return
  }
  issued++
  w.setAlwaysOnTop(true, TOPMOST_LEVEL)
}

/**
 * Raise `w` UNCONDITIONALLY — the cursor ring's path, and nothing else.
 *
 * The ring's whole claim to being above the overlays is that its assertion is the most recent one
 * within the shared 'screen-saver' level, so "it is already topmost" is precisely the state in
 * which this call still has work to do. Counted as issued, because it is a real z-order change.
 */
export function raiseTopmost(w: TopmostWindow): void {
  issued++
  w.setAlwaysOnTop(true, TOPMOST_LEVEL)
}

/** The running tally, for the dev-only line logged at quit (src/main/index.ts). */
export function topmostStats(): { issued: number; avoided: number } {
  return { issued, avoided }
}

/** TEST SEAM ONLY: zero the tally so a test can count one scenario at a time. */
export function resetTopmostStatsForTests(): void {
  issued = 0
  avoided = 0
}
