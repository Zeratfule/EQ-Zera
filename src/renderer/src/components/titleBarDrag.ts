/**
 * titleBarDrag — WHICH DOUBLE-CLICKS THE TITLE BAR ANSWERS (JOS-204).
 *
 * A module of its own, beside TitleBar.tsx, for the followScroll.ts reason: it is the whole
 * decision, it is pure, and node can run it (a `.tsx` full of MUI cannot be imported by the
 * suite). tests/titleBarDrag.test.mts is the unit half; tests/e2e/title-bar.e2e.mts drives the
 * real React tree in a real Electron window, because the defect below lives in the SEAM between
 * two trees and no fake can prove that seam is closed.
 *
 * THE DEFECT. The bar is a `-webkit-app-region: drag` surface and double-clicking it toggles
 * maximize. The guard was `e.target.closest('[data-no-drag]')` — a DOM-tree question — while the
 * handler receives REACT-tree events. Those are not the same tree. MUI's Menu is a PORTAL: a
 * React child of `OverlayMenu` (so its events bubble to the title bar's `onDoubleClick`) rendered
 * into a DOM node under `<body>` (so `closest` walks straight past every `data-no-drag` marker in
 * the bar and finds nothing). Result: two quick clicks anywhere in the overlay menu were read as
 * a double-click on the drag surface, and the app maximized/restored itself under the user's
 * cursor — which is exactly what checking and unchecking an overlay in a hurry looks like.
 *
 * WHY CONTAINMENT AND NOT MORE MARKERS. Marking the Menu `data-no-drag` would fix the overlay
 * menu and nothing else: the character `Select`'s dropdown, any Popover, Tooltip, Dialog or
 * Snackbar rendered from this bar is a portal too, and every one of them would have to remember.
 * `bar.contains(target)` asks where the node IS instead of what it was marked with, so it covers
 * every portaled child this bar has today and every one it grows later, with nothing to remember.
 */

/**
 * Should a double-click whose target is `target`, delivered to the drag surface `bar`, toggle
 * maximize?
 *
 * BOTH questions are load-bearing:
 *
 *   1. `bar.contains(target)` — the portal test above. A React-tree event from outside the bar's
 *      DOM subtree is not a click on the bar.
 *   2. `target.closest('[data-no-drag]')` — the in-tree test, for the controls that really are
 *      inside the bar (window buttons, the overlay trigger, the gear, the character picker).
 *      They opt out of the OS drag region already; this keeps the app's own handler off them.
 *
 * `bar.contains(bar)` is true, so a double-click on the bar's own padding still maximizes.
 */
export function isDragSurfaceDoubleClick(bar: Element, target: Element | null): boolean {
  if (!target || !bar.contains(target)) return false
  return target.closest('[data-no-drag]') == null
}
