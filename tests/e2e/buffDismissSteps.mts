// buffDismissSteps — CLEARING A BAR BY HAND, IN THE REAL APP (JOS-203).
//
// Its own module for the reason `buffTimerSteps.mts` and `buffRestartSteps.mts` are: the spec that
// uses it is at the repo's 400-code-line factoring ceiling, and this step is a narrative of its own.
//
// WHAT ONLY THE REAL APP CAN SHOW. The verdict itself is a pure function over rows and is pinned in
// tests/timerDismiss.test.mts, together with the model half (the orphaned-record reaper and the
// 3x-DB-base retention). What no unit test can claim is that the AFFORDANCE EXISTS AND IS WIRED:
// that the control is absent while the window is locked, that ONE press never clears anything, that
// two do, that the bar STAYS cleared across the live deltas that follow — and, the load-bearing
// one, that MAIN WAS NEVER TOLD. The last assertion reads the `buffTimers` module's own snapshot
// back out of the running app and finds the hold still standing: the learner cannot notice a
// dismissal because nothing about it ever leaves the renderer.
//
// THE REPORT THIS ANSWERS (01KZQ6QAWKX8W6VNTKFRP69NZ5): "It would be nice to have some method to
// manually clear buffs/debuffs, I have noticed that if i kill something out of range so i dont get
// a death message the debuffs from the mob dont clear on death."
//
// WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (wave E3): every read below goes through `settle`.
// The disarm is a condition too — the control's own timer flips the attribute back, and this waits
// for that rather than for three seconds to pass.

import type { Page } from 'playwright-core'
import { check, note, settle } from './appHarness.mjs'
import type { FixtureLog } from './logFixture.mjs'
import { timerRows } from './buffTimerSteps.mjs'

/** The enemy the break line spared in the step before this one — the bar we clear by hand. */
const KEPT = 'a turmoil toad'
/** A third enemy, mezzed AFTER the dismissal, to prove a live delta does not resurrect the bar.
 *  Ordinary Plane of Fear trash, from the same windows the other steps' names come from. */
const LATER = 'a phoboplasm'

const dismissSel = (target: string): string =>
  `[data-testid="buff-timer-row"][data-target="${target}"] [data-testid="buff-timer-dismiss"]`

/** Press one row's dismiss control. A hidden window has no pointer, so the press is a DOM click —
 *  the same route `stepCloseOne` takes to the ✕, and the same handler a real click would reach. */
async function press(overlay: Page, target: string): Promise<void> {
  await overlay.evaluate((sel) => {
    ;(document.querySelector(sel) as HTMLElement | null)?.click()
  }, dismissSel(target))
}

/** The control's own state: 'true' armed, 'false' idle, 'gone' when there is no control at all. */
async function armState(overlay: Page, target: string): Promise<string> {
  return overlay.evaluate(
    (sel) => document.querySelector(sel)?.getAttribute('data-armed') ?? 'gone',
    dismissSel(target)
  )
}

/**
 * Lock / unlock through the PERSISTED config, which is what the header pin writes.
 *
 * Not by clicking the pin: a locked overlay's header controls are rendered only while it has
 * captured the mouse, and a window that is never shown has no pointer to hover it with — so the
 * click that locks it would strand it. `overlay:setConfig` is the same state, and it is the door
 * the grouping step already uses.
 */
async function setLocked(overlay: Page, locked: boolean): Promise<void> {
  await overlay.evaluate(
    (v) =>
      (window as unknown as { eqOverlay: { setConfig: (p: unknown) => Promise<unknown> } }).eqOverlay.setConfig({
        locked: v
      }),
    locked
  )
}

/** Which mobs the `buffTimers` MODULE is holding — read out of main, not off the screen. */
async function heldTargets(overlay: Page): Promise<string[]> {
  return overlay.evaluate(() =>
    (
      window as unknown as {
        eqOverlay: {
          getModuleSnapshot: (id: string) => Promise<{ state: { holds: { target: string }[] } } | null>
        }
      }
    ).eqOverlay
      .getModuleSnapshot('buffTimers')
      .then((s) => (s ? s.state.holds.map((h) => h.target) : []))
  )
}

/** The real two-line shape the other steps use: the cast that names the rank, then the broadcast. */
function castMez(log: FixtureLog, target: string): void {
  const at = new Date()
  log.appendAt(at, 'You begin casting Mesmerization III.')
  log.appendAt(new Date(at.getTime() + 1_000), `${target} has been mesmerized.`)
}

/** THE GUARD, in three claims: no control when locked, one press arms, and an arm expires. */
async function stepGuard(overlay: Page): Promise<boolean> {
  await setLocked(overlay, true)
  const whenLocked = await settle(() => armState(overlay, KEPT), (a) => a === 'gone', { timeoutMs: 15_000 })
  check(
    'a LOCKED timer window offers no dismiss control at all — it is click-through, so drawing one would be a lie',
    whenLocked === 'gone',
    whenLocked
  )
  await setLocked(overlay, false)
  const whenUnlocked = await settle(() => armState(overlay, KEPT), (a) => a === 'false', { timeoutMs: 15_000 })
  if (!check('…and unlocking brings it back, idle', whenUnlocked === 'false', whenUnlocked)) return false

  await press(overlay, KEPT)
  const armed = await settle(() => armState(overlay, KEPT), (a) => a === 'true', { timeoutMs: 10_000 })
  check('ONE press only ARMS it — a bar over a game you are playing does not clear on a single click', armed === 'true', armed)
  const still = await timerRows(overlay)
  check('…and the bar is still there while it is armed', still.some((r) => r.target === KEPT), JSON.stringify(still.map((r) => r.target)))

  // The control disarms itself, so a press that was a mis-click can never be completed by an
  // unrelated one minutes later. Waiting for the ATTRIBUTE, not for the timeout.
  const disarmed = await settle(() => armState(overlay, KEPT), (a) => a === 'false', { timeoutMs: 15_000 })
  check('…and it disarms itself when the second press does not come', disarmed === 'false', disarmed)
  const survived = await timerRows(overlay)
  check(
    '…leaving the bar untouched: one press, however long you leave it, clears nothing',
    survived.some((r) => r.target === KEPT),
    JSON.stringify(survived.map((r) => r.target))
  )
  return true
}

/**
 * Clear the mez the break line spared, prove the model never heard, and prove it stays cleared.
 */
export async function stepDismissBar(overlay: Page, log: FixtureLog): Promise<void> {
  const before = await settle(() => timerRows(overlay), (r) => r.some((x) => x.target === KEPT), {
    timeoutMs: 20_000
  })
  if (!check('the mez the break line spared is on screen to be cleared', before.some((r) => r.target === KEPT))) {
    note('nothing to dismiss — the dismiss assertions could not run')
    return
  }
  if (!(await stepGuard(overlay))) return

  // TWO PRESSES, back to back. Each is its own round trip, so React has flushed the arm before the
  // confirm arrives — and both land far inside the arming window.
  await press(overlay, KEPT)
  await press(overlay, KEPT)
  const cleared = await settle(() => timerRows(overlay), (r) => !r.some((x) => x.target === KEPT), {
    timeoutMs: 15_000
  })
  if (!check('two presses clear the bar', !cleared.some((r) => r.target === KEPT), JSON.stringify(cleared.map((r) => r.target)))) {
    return
  }

  // THE WHOLE RULING, IN ONE READ: the module in MAIN still holds that mez. The row left the
  // screen; nothing left the renderer. A learner cannot notice what it is never told.
  const held = await heldTargets(overlay)
  check(
    '…and the model still holds it — a dismissal is a display verdict main is never told about',
    held.includes(KEPT),
    JSON.stringify(held)
  )

  // …AND IT STAYS CLEARED. Every delta replaces the whole row set, so a window that merely filtered
  // once would have the bar back the moment anything else happened.
  castMez(log, LATER)
  const after = await settle(() => timerRows(overlay), (r) => r.some((x) => x.target === LATER), {
    timeoutMs: 30_000
  })
  check('a mez on another enemy still raises its own row', after.some((r) => r.target === LATER), JSON.stringify(after.map((r) => r.target)))
  check(
    '…and the bar you cleared does not come back with it',
    !after.some((r) => r.target === KEPT),
    JSON.stringify(after.map((r) => r.target))
  )
}
