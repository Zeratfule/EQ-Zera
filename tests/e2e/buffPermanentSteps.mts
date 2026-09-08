// buffPermanentSteps — THE BUFFS THAT NEVER EXPIRE, IN THE REAL APP (JOS-215).
//
// Its own module for the reason `buffDismissSteps.mts` and `buffTimerSteps.mts` are: the spec that
// uses it is at the repo's 400-code-line factoring ceiling, and this is a narrative of its own.
//
// THE REPORT (01KZS7FZEAC0Q0T76ZJRS32DSR, v0.21.0): the buff window omits self buffs. It did,
// because `BuffInstances.applyMessageBuff` refused a landing with no duration and no illusion flag
// — and a PERMANENT buff has no duration precisely because it is permanent. 62 spells were in that
// state, from a cleric's Yaulp to a rogue's blade coat.
//
// WHAT ONLY THE REAL APP CAN SHOW. The admission is pinned on committed bytes in
// tests/permanentSelfBuffs.test.mts, and so is the renderer filter (`filterPermanentRows`) and the
// store's normalization of the switch. What no unit test can claim is that the PIECES ARE WIRED:
// that a permanent buff cast into the LIVE log travels the whole real path (chokidar → Tailer →
// parseEvent → BuffsModule → registry flush → `module:delta` → the overlay's fan-out → React), that
// the window a NEW INSTALL gets does NOT draw it, and that the preference reveals exactly it and
// nothing else. All three are one claim about the same instant, which is why one step makes them.
//
// AND THE HALF THAT IS EASY TO GET WRONG: hiding the roster REMOVES ROWS, and this window's whole
// job is to shout when a positive spell drops. "Instrument of Nife dropped" at the moment the user
// switched the roster off would be the window arguing with a preference they just set, so the
// switch joins the drop-flash epoch in BuffsOverlay.tsx — and this step reads the notices back to
// prove it.
//
// WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (wave E3): every read goes through settle /
// settleStable, and the ABSENCE claims use settleStable — wait for the reading to stop moving, then
// assert nothing is there.

import type { Page } from 'playwright-core'
import { check, settle, settleStable } from './appHarness.mjs'
import type { FixtureLog } from './logFixture.mjs'
import { setShowPermanent, timerRows } from './buffTimerSteps.mjs'

/**
 * A permanent self buff, cast live, in the shapes the owner's own log prints.
 *
 * `tests/fixtures/w40-nife-buff.log`, 19:26:47 / 19:26:48:
 *   You begin casting Instrument of Nife.
 *   A brilliant blue aura surrounds your weapon.
 *
 * The cast line is what ANCHORS the landing as the player's own (JOS-140 ruling 2), exactly as the
 * chain-mez and the Valor steps do. `Instrument of Nife` is `durationText: Permanent` in the
 * committed spells.json and its landing sentence names no other spell, so the row that appears can
 * only be this one.
 */
const SPELL = 'Instrument of Nife'

function castPermanent(log: FixtureLog): void {
  const at = new Date()
  log.appendAt(at, `You begin casting ${SPELL}.`)
  log.appendAt(new Date(at.getTime() + 1000), 'A brilliant blue aura surrounds your weapon.')
}

/** Every drop notice currently on screen. */
async function dropNotices(overlay: Page): Promise<string[]> {
  return overlay.evaluate(() =>
    [...document.querySelectorAll('[data-testid="buff-timer-drop"]')].map((e) => e.textContent?.trim() ?? '')
  )
}

export async function stepPermanentRows(overlay: Page, log: FixtureLog): Promise<void> {
  castPermanent(log)

  // 1. HIDDEN ON A FRESH INSTALL. Nothing has written `showPermanent`, so this is the default the
  //    owner ruled for — read on the window a new user gets. The claim is an ABSENCE, so the wait
  //    is settleStable: let the row set stop moving (the landing IS arriving, and the model IS
  //    opening an instance for it), then assert the window is not drawing it.
  const hidden = await settleStable(() => timerRows(overlay), { timeoutMs: 20_000 })
  check(
    'a permanent buff is HIDDEN by default — the owner ruling, on the window a new install gets',
    !hidden.some((r) => r.name === SPELL),
    JSON.stringify(hidden.map((r) => r.name))
  )
  check(
    '…and so is every other row that never expires',
    !hidden.some((r) => r.mode === 'permanent'),
    JSON.stringify(hidden.filter((r) => r.mode === 'permanent'))
  )

  // 2. …AND THE PREFERENCE REVEALS IT. The same landing, the same instant: what changed is one
  //    persisted per-kind flag. This is what makes the absence above a claim about the FILTER
  //    rather than about the model having refused the landing all over again.
  await setShowPermanent(overlay, true)
  const shown = await settle(() => timerRows(overlay), (r) => r.some((x) => x.name === SPELL), {
    timeoutMs: 20_000
  })
  const row = shown.find((r) => r.name === SPELL)
  if (!check(`switching the roster on draws ${SPELL}`, row !== undefined, JSON.stringify(shown.map((r) => r.name)))) {
    return
  }
  // NO CLOCK, AND IT SAYS SO. `mode: 'permanent'` is the model's answer and `permanent` is the
  // word the time column prints — never a countdown, and never a `+` count-up either.
  check('…as a row with no timer at all', row?.mode === 'permanent', JSON.stringify(row))
  check('…whose time column says so in a word', row?.time === 'permanent', JSON.stringify(row?.time))
  check('…under Your buffs — it is a self buff', row?.target === '', JSON.stringify(row?.target))
  check('…and it draws no receding bar', (await barsFor(overlay, SPELL)) === 0, `${SPELL} must have no bar`)

  // 3. SWITCHING IT BACK OFF IS NOT A DROP. The row leaves, and the window says nothing about it —
  //    the epoch guard in `useDropFlash`. Without it, hiding the roster would announce every
  //    permanent buff the user has as having just worn off.
  await setShowPermanent(overlay, false)
  const gone = await settle(() => timerRows(overlay), (r) => !r.some((x) => x.name === SPELL), { timeoutMs: 20_000 })
  check('switching it back off hides the row again', !gone.some((r) => r.name === SPELL), JSON.stringify(gone.map((r) => r.name)))
  const notices = await settleStable(() => dropNotices(overlay), { timeoutMs: 10_000 })
  check(
    '…and the window does NOT announce it as a drop — a preference is not a spell wearing off',
    !notices.some((t) => t.includes(SPELL)),
    JSON.stringify(notices)
  )
}

/** How many receding bars the named row is drawing (a permanent one must draw none). */
async function barsFor(overlay: Page, spell: string): Promise<number> {
  return overlay.evaluate(
    (name) =>
      document.querySelectorAll(
        `[data-testid="buff-timer-row"][data-spell="${name}"] [data-testid="buff-timer-fill"]`
      ).length,
    spell
  )
}
