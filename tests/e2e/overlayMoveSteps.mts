/**
 * MOVING A STRIP IS A BUTTON (2026-09-10) — the shared steps, for all three strips' specs.
 *
 * THE REPORT: "We need a way to move the celebration overlays" (owner). There already was a way —
 * a "Move it" switch in Preferences, Overlays that unlocked the strip and painted a dashed frame —
 * and nobody could find it. The whole ticket is discoverability plus two things the mechanism never
 * had: a way BACK to the shipped position, and a way to SEE where a card lands. So there are three
 * claims per strip, and they are written once here rather than three times, for the reason
 * stripScaleSteps.mts states: the rule is the same rule for all three, and three copies of it would
 * be three rules.
 *
 * WHAT ONLY THE REAL APP CAN SHOW. The pure halves are pinned in tests/overlayMove.test.mts (what
 * Reset puts back, what a Preview says, how long it holds). What no unit test can claim is that the
 * PRESS REACHES A BROWSERWINDOW: a button in one renderer, a main handler that unlocks a kind,
 * opens its window if the strip is off, re-places it and raises it, and a second renderer that
 * paints a frame in answer. Three processes, and a real window at the end of it.
 *
 * NO WINDOW IS EVER SHOWN (`EQ_E2E=1`, src/main/e2e.ts), so the frame is asserted in the DOM and the
 * geometry is asked of MAIN — `overlayBounds`, the probe the three specs already share.
 *
 * ONE DESCRIPTOR PER STRIP rather than a parameter list: the three kinds differ in six small
 * strings and the repo's factoring bar is four parameters, which is the right bar — a step taking
 * `(app, page, strip, kind, testId, frame, card, needle, label)` is a step nobody can call
 * correctly. Each spec declares its own `StripUnderTest` beside the selectors it already has.
 */
import type { ElectronApplication, Page } from 'playwright-core'
import { check, countOf, note, settle, settleStable } from './appHarness.mjs'
import { overlayBounds, storedBounds, type Bounds } from './stripScaleSteps.mjs'

/** Long enough for a 6 s preview to have come AND gone, with room for a slow shared machine. */
const PREVIEW_GONE_MS = 14_000

/** A window is whole pixels and `setBounds` can round on a scaled display. */
const SLACK = 2

/** Everything these three steps need to know about ONE strip. */
export interface StripUnderTest {
  /** The overlay kind, exactly as the window's `?kind=` spells it. */
  kind: string
  /** The Preferences card's testid prefix — `toast`, `banner`, `con-card`. The three were already
   *  spelled this way by the switches this row replaces, so every existing selector still reads. */
  testId: string
  /** This kind's positioning frame, by testid. Its grab handle is the same name with `-grip`. */
  frame: string
  /** The selector its cards are drawn under. */
  card: string
  /** Text that identifies THIS strip's preview sample and nothing else on screen. */
  previewNeedle: string
  /** What the run's output calls this strip, for a person reading the log. */
  label: string
}

/** Open Preferences → Overlays and wait for this strip's card. Every spec has its own route in;
 *  this is the one all three steps need, so it is done once. */
export async function openOverlayPrefs(page: Page, cardTestId: string): Promise<boolean> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="prefs-rail-overlays"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-overlays"]')
  await page.waitForSelector(`[data-testid="${cardTestId}"]`, { timeout: 15_000 })
  return (await countOf(page, `[data-testid="${cardTestId}"]`)) === 1
}

/** Press a button in the main window by testid. `el.click()` is a real DOM click, and React's
 *  delegated listener cannot tell it from a pointer — which a hidden window does not have. */
function press(page: Page, testId: string): Promise<void> {
  return page.evaluate((sel) => {
    ;(document.querySelector(sel) as HTMLElement | null)?.click()
  }, `[data-testid="${testId}"]`)
}

/** Every card this strip is drawing, as text. */
function cardTexts(strip: Page, selector: string): Promise<string[]> {
  return strip.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((el) =>
        (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
      ),
    selector
  )
}

/**
 * STEP 1 — MOVE THIS OVERLAY raises the frame, DONE puts it away.
 *
 * This is the discoverability claim made checkable: the control is a BUTTON with a verb on it, and
 * pressing it produces the dashed frame the user is then told to drag. Done is asserted from the
 * same place, because the whole complaint was that the two halves lived in different windows.
 */
export async function stepMoveButtonRaisesFrame(page: Page, strip: Page, s: StripUnderTest): Promise<void> {
  const frame = `[data-testid="${s.frame}"]`
  if (!check(`Preferences offers a Move this overlay BUTTON for the ${s.label}`,
    (await countOf(page, `[data-testid="pref-${s.testId}-move"]`)) === 1)) {
    return
  }
  await press(page, `pref-${s.testId}-move`)
  const up = await settle(() => countOf(strip, frame), (n) => n === 1, { timeoutMs: 20_000 })
  if (!check(`…and pressing it paints the ${s.label}'s dashed frame`, up === 1, String(up))) return
  // THE GRAB HANDLE (2026-09-10): a rectangle that can be picked up must look like one.
  check(
    `…carrying a grab handle, so the frame says out loud that it can be dragged`,
    (await countOf(strip, `${frame} [data-testid="${s.frame.replace('-frame', '-grip')}"]`)) === 1
  )
  // The row becomes an instruction plus a Done button — the mirror of the frame's own Done.
  const done = await settle(
    () => countOf(page, `[data-testid="pref-${s.testId}-move-done"]`),
    (n) => n === 1,
    { timeoutMs: 10_000 }
  )
  if (!check(`…and the row turns into a Done button while it is unlocked`, done === 1, String(done))) return
  await press(page, `pref-${s.testId}-move-done`)
  const gone = await settle(() => countOf(strip, frame), (n) => n === 0, { timeoutMs: 20_000 })
  check(`…and Done takes the ${s.label}'s frame away again`, gone === 0, String(gone))
}

/** Write a strip's stored rectangle through the overlay's own config door — the one AGENTS.md
 *  names for a persistence spec, because a programmatic `setBounds` from MAIN raises no 'moved'. */
function setStoredBounds(strip: Page, next: Bounds): Promise<unknown> {
  return strip.evaluate(
    (b) =>
      (
        window as unknown as { eqOverlay: { setConfig: (p: { bounds: Bounds }) => Promise<unknown> } }
      ).eqOverlay.setConfig({ bounds: b }),
    next
  )
}

/**
 * STEP 2 — RESET POSITION puts the window back where it shipped, from wherever it is.
 *
 * The claim a user cares about is "I can undo whatever I did to this window", and the shipped
 * rectangle is MAIN's answer rather than a number a spec can compute (an e2e file loads no `src`
 * module — tests/e2e/overlayMinSizeSteps.mts states that rule). So the step LEARNS it: press Reset
 * once and record what that produced, move the strip somewhere it demonstrably is not, press Reset
 * again, and require both the store and the live window back at what the first press produced.
 *
 * That shape also means the step does not care where in a long spec it runs, which matters: two of
 * the three specs have already dragged, scaled and refitted this window by the time it is reached.
 */
export async function stepResetPosition(
  app: ElectronApplication,
  page: Page,
  strip: Page,
  s: StripUnderTest
): Promise<void> {
  await press(page, `pref-${s.testId}-reset`)
  const homeWin = await settle(() => overlayBounds(app, s.kind), (r) => r !== null, { timeoutMs: 15_000 })
  const homeStored = await storedBounds(strip)
  if (!check(`the ${s.label} window has a shipped rectangle to reset to`,
    homeWin !== null && homeStored !== undefined, JSON.stringify(homeWin))) {
    return
  }
  const win = homeWin as Bounds
  const stored = homeStored as Bounds

  // Somewhere it is not: 60 px in from where it shipped, which is inside every work area a
  // first-open strip already fits in.
  const moved = { ...stored, x: Math.max(0, stored.x - 60), y: stored.y + 60 }
  await setStoredBounds(strip, moved)
  const away = await settle(() => storedBounds(strip), (b) => b?.y === moved.y, { timeoutMs: 10_000 })
  if (!check(`…and moving the ${s.label} is recorded`, away?.y === moved.y, JSON.stringify(away))) return

  await press(page, `pref-${s.testId}-reset`)
  // THE NOTE FIRST, because it is the only assertion here with a clock of its own: it says
  // "Position reset" for a few seconds and then goes, so reading it after two geometry settles
  // would be reading a race rather than a claim.
  const noted = await settle(
    () => countOf(page, `[data-testid="pref-${s.testId}-reset-note"]`),
    (n) => n === 1,
    { timeoutMs: 8_000 }
  )
  check(`Reset position says so, rather than answering a press with silence`, noted === 1)

  const backStored = await settle(
    () => storedBounds(strip),
    (b) => b !== undefined && Math.abs(b.x - stored.x) <= SLACK && Math.abs(b.y - stored.y) <= SLACK,
    { timeoutMs: 15_000 }
  )
  check(
    `…and the ${s.label}'s stored rectangle is back to the shipped one`,
    backStored !== undefined && Math.abs(backStored.x - stored.x) <= SLACK &&
      Math.abs(backStored.y - stored.y) <= SLACK,
    `${JSON.stringify(backStored)} vs ${JSON.stringify(stored)}`
  )
  // …AND THE LIVE WINDOW WENT WITH IT. Writing the store is half a reset; the other half is the
  // window the user is looking at, which main moves itself (`applyOverlayBounds`).
  const backWin = await settle(
    () => overlayBounds(app, s.kind),
    (r) => r !== null && Math.abs(r.x - win.x) <= SLACK && Math.abs(r.y - win.y) <= SLACK,
    { timeoutMs: 15_000 }
  )
  check(
    `…and the live ${s.label} window is back there too, not just the store`,
    backWin !== null && Math.abs(backWin.x - win.x) <= SLACK && Math.abs(backWin.y - win.y) <= SLACK,
    `${JSON.stringify(backWin)} vs ${JSON.stringify(win)}`
  )
}

/**
 * STEP 3 — PREVIEW draws a real sample, and it LEAVES.
 *
 * The second thing the mechanism never had: you positioned an empty rectangle and then waited for a
 * raid target to die to find out whether you had put it somewhere sensible. The sample is
 * main-built (shared/overlayPreview.ts) and pushed straight at the window, so what this proves is
 * that the press reaches a card in the DOM and that the card goes away on its own a few seconds
 * later rather than becoming something to dismiss.
 */
export async function stepPreview(page: Page, strip: Page, s: StripUnderTest): Promise<void> {
  const texts = (): Promise<string[]> => cardTexts(strip, s.card)
  const has = (list: string[]): boolean => list.some((x) => x.includes(s.previewNeedle))
  if (!check(`Preferences offers a Preview button for the ${s.label}`,
    (await countOf(page, `[data-testid="pref-${s.testId}-preview"]`)) === 1)) {
    return
  }
  await press(page, `pref-${s.testId}-preview`)
  const shown = await settle(() => texts(), has, { timeoutMs: 15_000 })
  if (!check(`…and pressing it draws a sample on the ${s.label}`, has(shown),
    shown.join(' | ') || 'nothing drawn')) {
    return
  }
  // IT LEAVES BY ITSELF. A preview that had to be dismissed would be a worse version of the problem
  // it solves — six seconds, with a generous deadline because four Electron apps share this machine.
  const t0 = Date.now()
  const gone = await settle(() => texts(), (t) => !has(t), { timeoutMs: PREVIEW_GONE_MS, pollMs: 150 })
  const elapsed = Date.now() - t0
  check(`…and the sample leaves on its own, unprompted`, !has(gone), `${String(elapsed)} ms`)
  note(`the ${s.label} preview stood ${String(elapsed)} ms`)
  // …AND IT WAS NEVER AN EVENT. A preview is built in main out of a pure module and pushed at the
  // window; nothing is recorded on either side. The strip back at its resting state is the half
  // this spec can see.
  const rest = await settleStable(() => texts(), { timeoutMs: 5_000, stable: 4, pollMs: 150 })
  check(`…leaving the ${s.label} exactly as it found it`, !has(rest), rest.join(' | '))
}
