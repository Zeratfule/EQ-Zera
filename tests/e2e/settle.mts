/**
 * settle.mts — WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (docs/plans/e2e-parallel.md, wave E3).
 *
 * The audit that grounds this counted ~60 raw `sleep(n)` calls across the suite: 800 ms after a
 * toggle, 1200 ms after a resize, 1500 ms after hydration. Every one of them is a BET on render
 * latency — and the bet loses exactly when the machine is busiest, which since wave E1 is most of
 * the time: the runner now runs four Electron apps at once, on purpose. A sleep that is long
 * enough to be safe under that contention is also long enough to make the suite slow for everyone
 * else. A condition is neither: it returns the instant the thing happened, and it fails loudly
 * (with the last value it read) when the thing never did.
 *
 * FOUR SHAPES, and they are deliberately few:
 *   • `settle(read, ok)`      — poll a reading until it satisfies a predicate. The general case.
 *   • `settleCount(page, sel)`— poll a selector's match count. The common case.
 *   • `settleGone(page, sel)` — poll for its disappearance.
 *   • `settleStable(read)`    — poll until the reading STOPS CHANGING. This is the answer to the
 *     absence assertions: "the panel is not there" is only information once the layout has
 *     finished moving, so you wait for the POSITIVE signal (a settled measurement) and then
 *     assert the absence, instead of sleeping 1.5 s and hoping that meant the same thing.
 *
 * Every one of them RETURNS WHAT IT LAST READ rather than throwing, because the caller is an
 * assertion harness: a failed wait must become a `check(..., false, <what it saw>)` line in the
 * run's output, never an exception that skips every assertion after it.
 */

import type { Page } from 'playwright-core'

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface SettleOpts {
  /** Give up after this long. Deliberately generous: four apps share this machine. */
  timeoutMs?: number
  /** How often to re-read. Small — a poll is an IPC round trip, not a render. */
  pollMs?: number
}

const DEFAULTS = { timeoutMs: 15_000, pollMs: 120 }

/**
 * Poll `read` until `ok` holds, then return that reading; on timeout return the LAST one.
 * The caller decides whether that last reading is a note or a failure — this never throws.
 */
export async function settle<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  opts: SettleOpts = {}
): Promise<T> {
  const { timeoutMs, pollMs } = { ...DEFAULTS, ...opts }
  const deadline = Date.now() + timeoutMs
  let last = await read()
  while (!ok(last)) {
    if (Date.now() >= deadline) return last
    await sleep(pollMs)
    last = await read()
  }
  return last
}

/** How many `sel` are in the DOM right now. */
export function countIn(page: Page, sel: string): Promise<number> {
  return page.evaluate((s) => document.querySelectorAll(s).length, sel)
}

/** Poll until at least `min` matches exist; returns the count actually reached. */
export function settleCount(page: Page, sel: string, min = 1, opts: SettleOpts = {}): Promise<number> {
  return settle(() => countIn(page, sel), (n) => n >= min, opts)
}

/** Poll until `sel` is gone; true when it went. */
export async function settleGone(page: Page, sel: string, opts: SettleOpts = {}): Promise<boolean> {
  return (await settle(() => countIn(page, sel), (n) => n === 0, opts)) === 0
}

/**
 * Poll until the reading REPEATS — `stable` identical samples in a row — and return it.
 *
 * The absence assertions' positive signal. Comparison is by `JSON.stringify`, which is exactly
 * right for the shapes this is used on (numbers, boxes, small records) and would be wrong for
 * anything cyclic, which nothing here reads.
 */
export async function settleStable<T>(
  read: () => Promise<T>,
  opts: SettleOpts & { stable?: number } = {}
): Promise<T> {
  const { timeoutMs, pollMs } = { ...DEFAULTS, ...opts }
  const want = opts.stable ?? 3
  const deadline = Date.now() + timeoutMs
  let last = await read()
  let key = JSON.stringify(last)
  let run = 1
  while (run < want) {
    if (Date.now() >= deadline) return last
    await sleep(pollMs)
    last = await read()
    const next = JSON.stringify(last)
    run = next === key ? run + 1 : 1
    key = next
  }
  return last
}

/**
 * Let the renderer paint: two animation frames, OR 50 ms, whichever arrives first.
 *
 * The honest replacement for the short sleeps that followed a pointer move — those layers are
 * rAF-coalesced by design, so "the frame happened" is the real condition. But this suite drives a
 * window that is NEVER SHOWN (`EQ_E2E=1`), and a window Chromium is not compositing may throttle
 * `requestAnimationFrame` to almost nothing or stop it entirely — the same fact that makes the
 * failure screenshots best-effort. MEASURED 2026-08-06: a bare two-frame wait against the hidden
 * window took two full seconds. So the frames are RACED against a short timer: on a compositing
 * window this returns in ~16 ms, and on a hidden one it can never become a stall.
 *
 * NO named function bindings inside the callback: tsx/esbuild's `keepNames` wraps
 * `const f = (…) => …` in a `__name` helper that lives in the NODE bundle, and Playwright ships
 * only the callback's source to the page (appHarness.mts learned this the hard way). Nested
 * anonymous arrows are the shape that survives.
 */
export function nextFrames(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve()
        }, 50)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve()
          })
        })
      })
  )
}

/**
 * Move the REAL pointer to a fractional offset inside `sel`'s VISIBLE box.
 *
 * Real, not synthetic, on purpose: the renderer then sees a genuine `pointermove` carrying
 * `ev.buttons === 0`, which is the exact condition the hover/drag seam bails on — a hand-
 * dispatched event would have to assert `buttons` itself and would prove nothing about the seam.
 *
 * "VISIBLE" IS THE WHOLE PROBLEM, and getting it wrong is what kept the leveling range-drag spec
 * red (MEASURED 2026-08-06: the level chart's box was 838..994 in a window 860 tall AND clipped by
 * the charts column's own scroller, so the old maths — clamp to the viewport only — put the drag
 * at y=848, which `elementFromPoint` resolves to the app's content area, not the chart. The
 * pointer handlers never saw a single event; the harness had been dragging a different element for
 * as long as the spec had existed). So this now:
 *   1. scrolls the element into view (a no-op when it already is, so a drag's later moves cannot
 *      move the ground under it),
 *   2. intersects its rect with EVERY clipping ancestor's rect, then with the viewport,
 *   3. VERIFIES with `elementFromPoint` that the point it computed actually lands inside the
 *      element — and returns false rather than moving the mouse somewhere meaningless.
 *
 * Returns false when the element is absent, entirely clipped away, or covered. That is the
 * caller's decision to note or fail — never a thrown harness error, which would skip every
 * remaining check in the session.
 */
export async function hoverAt(page: Page, sel: string, fx: number, fy: number): Promise<boolean> {
  await page
    .locator(sel)
    .first()
    .scrollIntoViewIfNeeded({ timeout: 5_000 })
    .catch(() => undefined)
  const pt = await page.evaluate(
    (a) => {
      const el = document.querySelector(a.sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      let left = r.left
      let top = r.top
      let right = r.right
      let bottom = r.bottom
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p)
        if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
        const pr = p.getBoundingClientRect()
        left = Math.max(left, pr.left)
        top = Math.max(top, pr.top)
        right = Math.min(right, pr.right)
        bottom = Math.min(bottom, pr.bottom)
      }
      left = Math.max(left, 0)
      top = Math.max(top, 0)
      right = Math.min(right, window.innerWidth - 1)
      bottom = Math.min(bottom, window.innerHeight - 1)
      const w = right - left
      const h = bottom - top
      if (w <= 0 || h <= 0) return null
      const x = Math.round(left + w * a.fx)
      const y = Math.round(top + h * a.fy)
      const hit = document.elementFromPoint(x, y)
      return hit && (hit === el || el.contains(hit)) ? { x, y } : null
    },
    { sel, fx, fy }
  )
  if (!pt) return false
  await page.mouse.move(pt.x, pt.y)
  // The hover layer is rAF-coalesced and change-gated by design, so the DOM lands a frame or two
  // later — read it after the frames, never on the same tick as the move.
  await nextFrames(page)
  return true
}
