// THE FLOOR IS ONLY A FLOOR IF THE WINDOW STILL WORKS AT IT (JOS-278).
//
// The 0.23.0 report behind this step: a player running Lossless Scaling gets the app's own minimum
// window size back MAGNIFIED along with the game, so the debuff strip could not be made narrow
// enough to sit beside the spellbar. The owner's ruling was to lower the floor, and the sanity
// condition attached to it was that the content degrade gracefully there — truncate, never overlap.
//
// The number itself is pinned where it lives (tests/overlayLayout.test.mts, `OVERLAY_MIN_SIZE`).
// What a pure test cannot say is the thing this ticket actually promised, so it is measured here,
// in a real window with a real layout engine: AT THE FLOOR, NOTHING THE USER HAS TO PRESS IS OFF
// THE WINDOW. That is not a hypothetical failure mode — it is the state this ticket found. At the
// OLD 200x90 floor the buffs, debuffs and XP windows already had their text-size stepper past the
// right edge (measured at x=237, 233 and 216 against a 200px window), clipped away by
// `overflow: hidden` in overlay.html with no scrollbar to reach it by. The floor came down anyway,
// which it could only do because the chrome learned to give way: the footer WRAPS
// (overlay/overlayScale.tsx `FOOTER_ROW`) and the header's drag gutter and kind tag shrink before
// the lock/close pair does (overlay/OverlayHeader.tsx).
//
// WHY EVERY BUTTON AND SLIDER, RATHER THAN A NAMED LIST: the failure is a layout overflow, and a
// layout overflow does not respect a list somebody wrote down. Every `<button>` and `<input>` in
// the surface is a control the user is meant to be able to hit, so every one of them is asked the
// same question — is your rectangle inside the window — on all four edges.
//
// AND THE CONTENT, SEPARATELY: rows are allowed to be taller than the pane (that is what the
// scroller is for) but they are NOT allowed to be wider than it. A row that runs wide is a name
// that failed to ellipsize, which is the "overlap, not truncate" half of the sanity condition.
//
// THE WINDOW IS DRIVEN THROUGH `setBounds`, i.e. through the same clamp a user's drag goes
// through: main is ASKED for something smaller than the floor and whatever it grants is what gets
// measured. So this step also proves the floor is enforced at all — a window that accepted 40x40
// would fail the size check below rather than quietly passing the layout one.

import type { ElectronApplication, Page } from 'playwright-core'
import { check, note, settle } from './appHarness.mjs'

/** A window rectangle, as Electron hands it over. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The floor, spelled out rather than imported: an e2e file loads no `src` module (it would reach
 * Electron through overlayLayout's neighbours), which is the same rule `SCROLL_GRIP_W` follows in
 * overlayScrollSteps.mts. A change to `OVERLAY_MIN_SIZE` that forgets this line fails loudly here.
 */
export const MIN_W = 140
export const MIN_H = 90

/**
 * …AND WHAT WINDOWS ADDS TO IT ON A FRACTIONALLY-SCALED DISPLAY (2026-09-08).
 *
 * `setMinimumSize` is stated in DIP and enforced in DEVICE pixels, so at a display scale that is
 * not a whole number the granted rectangle is the floor rounded OUTWARD — never inward, which is
 * the direction that would matter. MEASURED here with a bare Electron window and no app code in
 * the way, on a `scaleFactor: 2.25` display: `setMinimumSize(140, 90)` then `setBounds(40x40)`
 * answers **140x92**, and the same probe inside the app has answered 141x92.
 *
 * The claim this step exists to make is "a drag past the floor lands ON the floor rather than on
 * nothing", so it is asserted as a floor and a ceiling three pixels above it rather than as an
 * equality that only holds at 100 % and 200 % scaling. Three is the smallest number that covers
 * every reading above; the failure it still catches is the one that was reported — a window that
 * accepted 40x40, or one whose floor had silently gone back up to the old 200x90.
 */
const DPI_ROUNDING = 3

/** One kind's overlay window, by the `?kind=` it was opened with (the exact-match rule, JOS-119). */
function windowOfKind(app: ElectronApplication, kind: string): Promise<Bounds | null> {
  return app.evaluate(({ BrowserWindow }, k) => {
    const w = BrowserWindow.getAllWindows().find(
      (x) => new URLSearchParams(new URL(x.webContents.getURL()).search).get('kind') === k
    )
    return w ? w.getBounds() : null
  }, kind)
}

/** Ask for a rectangle. What comes back is what the minimum-size clamp allowed. */
async function askFor(app: ElectronApplication, kind: string, b: Bounds): Promise<Bounds | null> {
  await app.evaluate(
    ({ BrowserWindow }, arg) => {
      const w = BrowserWindow.getAllWindows().find(
        (x) => new URLSearchParams(new URL(x.webContents.getURL()).search).get('kind') === arg.kind
      )
      w?.setBounds(arg.b)
    },
    { kind, b }
  )
  return windowOfKind(app, kind)
}

interface Escapee {
  what: string
  rect: string
}

/**
 * Every control whose rectangle leaves the window, on any edge.
 *
 * A hair of tolerance, because a sub-pixel layout on a scaled display rounds outward and half a
 * pixel is not a control anybody has lost. A control with no rectangle at all is not off-screen —
 * it is one the current mode does not draw.
 */
function controlsOffWindow(page: Page): Promise<Escapee[]> {
  return page.evaluate(() => {
    const w = window.innerWidth
    const h = window.innerHeight
    const out: { what: string; rect: string }[] = []
    for (const el of Array.from(document.querySelectorAll('button, input'))) {
      const r = el.getBoundingClientRect()
      const inside = r.left >= -1 && r.top >= -1 && r.right <= w + 1 && r.bottom <= h + 1
      if (inside || (r.width === 0 && r.height === 0)) continue
      const named = el.getAttribute('aria-label') ?? el.getAttribute('data-testid')
      out.push({
        what: named ?? `${el.tagName.toLowerCase()}:${(el.textContent ?? '').slice(0, 12)}`,
        rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
      })
    }
    return out
  })
}

/**
 * Every content row WIDER than the pane it lives in — a name that failed to ellipsize.
 *
 * Rows are allowed to be taller than the pane; that is what the scroller is for. Sideways is the
 * direction that means "overlap, not truncate". The pane is found by what it does rather than by a
 * per-kind testid: it is the one box in the surface that scrolls its own content.
 */
function rowsWiderThanPane(page: Page): Promise<Escapee[]> {
  return page.evaluate(() => {
    const pane = Array.from(document.querySelectorAll('div')).find(
      (d) => getComputedStyle(d).overflowY === 'auto'
    )
    if (!pane) return []
    const pr = pane.getBoundingClientRect()
    const out: { what: string; rect: string }[] = []
    for (const row of Array.from(pane.firstElementChild?.children ?? [])) {
      const r = row.getBoundingClientRect()
      if (r.width <= pr.width + 1) continue
      out.push({
        what: (row.textContent ?? '').replace(/\s+/g, ' ').slice(0, 24),
        rect: `${Math.round(r.width)}px in a ${Math.round(pr.width)}px pane`
      })
    }
    return out
  })
}

/**
 * THE WHOLE STEP, for one kind. `label` is what the failures are named after, so a red run says
 * which window lost its controls without the reader going and counting `?kind=` queries.
 *
 * The window is put back where it was afterwards: every step in the owning spec measures the same
 * window, and a 140px-wide overlay left behind would be a booby trap for the next assertion.
 */
export async function stepMinimumSize(
  app: ElectronApplication,
  overlay: Page,
  kind: string,
  label: string
): Promise<void> {
  const was = await windowOfKind(app, kind)
  if (!check(`${label}: the overlay window can be measured`, was !== null)) return
  const start = was as Bounds

  // Ask for something UNDER the floor, the way a user dragging the corner past it does.
  const got = await askFor(app, kind, { ...start, width: 40, height: 40 })
  if (!check(`${label}: the window answers a resize`, got !== null)) return
  const at = got as Bounds
  check(
    `${label}: THE FLOOR HOLDS — a drag past it lands on ${MIN_W}x${MIN_H}, not on nothing`,
    at.width >= MIN_W &&
      at.width <= MIN_W + DPI_ROUNDING &&
      at.height >= MIN_H &&
      at.height <= MIN_H + DPI_ROUNDING,
    `${at.width}x${at.height}`
  )

  // Let the renderer finish laying out at the new size before reading rectangles off it. The
  // condition is the page agreeing about its own width, not a clock (wave E3).
  const seen = await settle(
    () => overlay.evaluate(() => `${window.innerWidth}x${window.innerHeight}`),
    (s) => s === `${at.width}x${at.height}`,
    { timeoutMs: 8_000 }
  )
  note(`${label}: laid out at ${seen}`)

  const escaped = await controlsOffWindow(overlay)
  check(
    `${label}: AT THE FLOOR, EVERY CONTROL IS STILL INSIDE THE WINDOW`,
    escaped.length === 0,
    escaped.map((e) => `${e.what} @ ${e.rect}`).join('; ')
  )
  const wide = await rowsWiderThanPane(overlay)
  check(
    `${label}: …and the rows TRUNCATE rather than run wide — the pane is not overflowed sideways`,
    wide.length === 0,
    wide.map((e) => `${e.what} — ${e.rect}`).join('; ')
  )

  await askFor(app, kind, start)
}
