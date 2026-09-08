// THE PET NUDGE, END TO END (JOS-258).
//
// A summoned pet that nobody has ordered is invisible to the meter — JOS-49's accepted blind spot,
// and the thing a 0.23.0 reporter hit when they swapped in a magician. The owner's fix is one
// sentence on the meter overlay's own content background, for a while after the summon, that then
// TIMES OUT: no persistent banner, no repetition, nothing to dismiss.
//
// WHAT ONLY THE REAL APP CAN SHOW. The state machine and both fixture arcs are pinned in
// tests/petSummonNudge.test.mts, on committed bytes, with no Electron anywhere. What no unit test
// can claim is that the pieces are WIRED: that a line appended to the tailed log travels
// chokidar → Tailer → parser → CombatEngine → the `combat:snapshot` IPC → a second renderer
// process's DOM, and — the half the ruling is actually about — that the sentence comes off the
// screen again with nobody touching anything.
//
// IT IS DRIVEN BY A BACKDATED LINE, and that is the honest way to test a 55-second window inside a
// spec with a 5-minute cap. `appendAt` stamps the line EQ's way, the engine reads its own clock off
// the log exactly as it does live, and a summon stamped 35 seconds ago is a summon 35 seconds into
// its window — already past the grace, with twenty seconds left to run. Nothing about the product
// is special-cased for it; the only thing bought is not sitting through the first 35 seconds.
//
// Its own module because tests/e2e/overlay-sync.e2e.mts sits at the repo's max-lines budget:
// split, never ratchet (overlayScopeSteps / overlayScrollSteps / overlayDisplaySteps precede it).

import type { Page } from 'playwright-core'
import { check, note, settle, settleGone } from './appHarness.mjs'
import type { FixtureLog } from './logFixture.mjs'

/** The nudge itself, and the pane it must be laid over. */
const NUDGE = '[data-testid="overlay-pet-nudge"]'
const PANE = '[data-testid="overlay-bars"]'

/**
 * A pet summon nobody will bind. `Cavorting Bones` is the necromancer's level-1 pet — chosen
 * because it is the shortest cast in the family and because the fixture character is not one, so
 * nothing else in this log can be confused with it.
 *
 * The spell name is spelled here rather than imported: an e2e file loads no `src` module (the suite
 * runs against the BUILT app), so this is the same arrangement every other constant in this
 * directory has with the product.
 */
const SUMMON_LINE = 'You begin casting Cavorting Bones.'

/**
 * How far in the past to stamp it. Must sit between the engine's grace (10 s) and its full window
 * (55 s), with enough room either side that a slow machine still sees both edges: 35 s in means the
 * sentence is up NOW and gone about twenty seconds from now.
 */
const BACKDATE_MS = 35_000

/** Geometry + the click-through contract, read from the page. */
interface NudgeBox {
  text: string
  pointerEvents: string
  /** does its rectangle sit inside the bars pane's? */
  overPane: boolean
}

async function readNudge(overlay: Page): Promise<NudgeBox | null> {
  return overlay.evaluate(
    ([nudgeSel, paneSel]) => {
      const el = document.querySelector(nudgeSel)
      const pane = document.querySelector(paneSel)
      if (!el || !pane) return null
      const a = el.getBoundingClientRect()
      const b = pane.getBoundingClientRect()
      return {
        text: (el.textContent ?? '').trim(),
        pointerEvents: getComputedStyle(el).pointerEvents,
        overPane: a.left >= b.left - 4 && a.right <= b.right + 4 && a.top >= b.top - 6 && a.top < b.bottom
      }
    },
    [NUDGE, PANE] as const
  )
}

/**
 * The step.
 *
 * ORDER MATTERS AND IS PART OF THE CLAIM: nothing is appended until the meter has been asserted
 * silent, because "absent almost always" is the state this feature spends its life in and a test
 * that only ever looks after the trigger cannot tell a nudge from a banner.
 */
export async function stepPetNudge(log: FixtureLog, overlay: Page): Promise<void> {
  check('a meter with no recent summon shows no nudge at all', (await readNudge(overlay)) === null)

  const summonedAt = new Date(Date.now() - BACKDATE_MS)
  log.appendAt(summonedAt, SUMMON_LINE)
  note(`appended "${SUMMON_LINE}" stamped ${BACKDATE_MS / 1000}s ago — inside the nudge's window, past its grace`)

  const shown = await settle(() => readNudge(overlay), (n) => n !== null, { timeoutMs: 20_000 })
  if (!check('A PET SUMMON NOBODY BOUND RAISES THE NUDGE ON THE METER OVERLAY', shown !== null)) return
  const box = shown as NudgeBox

  check('it names both ways out of the blind spot', /order it once/i.test(box.text) && /\/pet who leader/i.test(box.text), box.text)
  check('one sentence, not a paragraph', box.text.length <= 90, `${box.text.length} chars`)
  check('no em dash in copy a player reads', !/[–—]/.test(box.text), box.text)
  check('it is drawn ON the meter`s own content background, not above it', box.overPane)
  // The whole panel below a pinned meter's header offers no hit target; a coaching hint is exactly
  // the thing that must not become the exception, or it eats a click meant for the game.
  check('and it takes no mouse — the pane stays click-through', box.pointerEvents === 'none', box.pointerEvents)

  // THE RULING'S OWN WORD: it TIMES OUT. Nobody clicks anything, nothing else is appended, and the
  // sentence leaves by itself.
  const gone = await settleGone(overlay, NUDGE, { timeoutMs: 45_000 })
  check('IT TIMES OUT ON ITS OWN — no dismiss, no persistent banner', gone)
}
