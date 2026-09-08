// DRILL-AWARE readers for the combat e2e.
//
// The Combat dashboard OPENS ON LEVEL 1 again (owner ruling, 2026-08-05 — JOS-35: a meter that
// auto-drilled into your own breakdown hid every group-mate's row behind a chevron nobody knew
// to press). So the source rows are normally already on screen — but a spec step that ran after
// an earlier step drilled would still be looking at a level-2 list, and every assertion here
// that counts `meter-row` is about "the meter renders the sources it has": a claim about the
// DATA, not about which level happens to be open. Hence a reader that un-drills first, and is a
// no-op in the ordinary case.
//
// It lives in its own module rather than in the spec or in appHarness.mts because both of those
// files sit within a handful of lines of the repo's max-lines budget, and a helper is not worth
// spending a refactor wave's worth of budget in someone else's file. The JOS-116 round-trip steps
// landed here for exactly that reason too: combatSteps.mts went over the ceiling holding them,
// and the rule is to split rather than to ratchet.

import type { Page } from 'playwright-core'
import {
  check,
  countOf,
  note,
  openPicker,
  openSelectorValues,
  settle,
  settleCount,
  settleGone,
  settleStable
} from './appHarness.mjs'

const BACK = '[data-testid="drill-back"]'
/** The crumb's root link. ONE click from any level, which is what makes this reader bounded. */
const ALL = '[data-testid="drill-all"]'
const ROW = '[data-testid="meter-row"]'
/** One ability bar in a level-2 list, and the per-ability stats it expands inline (JOS-113). */
const SKILL = '[data-testid="skill-bar"]'
const STATS = '[data-testid="ability-stats"]'
/** The rejected JOS-105 chip — asserted ABSENT now (JOS-113: no category grouping layer). */
const CHIP = '[data-testid="category-chip"]'
/** The Overview glance card itself — present iff that view is mounted (JOS-116's round trip). */
const CARD = '[data-testid="overview-dps"]'

/** Is a drill open right now? (The Back button exists only at a level below the source list.) */
export async function drilled(page: Page): Promise<boolean> {
  return (await page.$$(BACK)).length > 0
}

/**
 * Un-drill (idempotent — a click on a crumb that isn't there is a no-op, not a failure) and
 * return the level-1 source-row count. Clicking out is also the live check that un-drilling still
 * works: if it stopped working, the row count goes to 0 and the spec says so.
 *
 * IT CLICKS "All", NOT "Back", and that is what keeps it bounded now the drill has TWO levels
 * (JOS-113: sources → one source's ability list; a stat-bearing ability expands INLINE, it is not
 * a level). The crumb's root link goes to level 1 from wherever it is, in one click, so "the crumb
 * is gone" stays the whole wait condition.
 */
export async function meterRows(page: Page): Promise<number> {
  if (!(await drilled(page))) return (await page.$$(ROW)).length
  if ((await page.$$(ALL)).length > 0) {
    await page.click(ALL, { timeout: 5_000 }).catch(() => undefined)
  } else {
    // The GLANCE card's compact crumb is a chevron and a label — no root link fits in a card four
    // rows tall — so there it walks out one level at a time, bounded at the number of levels
    // (a nested pet is a level-2 subject inside your level-2 row, so at most two Backs to level 1).
    for (let i = 0; i < 2 && (await drilled(page)); i++) {
      await page.click(BACK, { timeout: 5_000 }).catch(() => undefined)
    }
  }
  await page.waitForSelector(BACK, { state: 'detached', timeout: 5_000 }).catch(() => undefined)
  return (await page.$$(ROW)).length
}

/**
 * THE SAME DRILL, ON THE GLANCE CARD (JOS-105/JOS-113) — the ticket's first sentence, walked with
 * a mouse.
 *
 * The Overview card's damage panel used to draw its own bars with no `onClick` on them, so a
 * source bar that drilled on the Combat tab was inert here; it also opened DRILLED when the pet
 * preference was on, and held a drill vocabulary of its own. It now renders the Combat tab's
 * components from the Combat tab's builder, with density as a prop — so the levels and the inline
 * per-ability stats have to be reachable HERE by exactly the clicks that reach them there.
 *
 * JOS-113: the card drills to ONE BAR PER ABILITY (no category chip), and clicking a stat-bearing
 * ability expands its crit/double/triple/miss inline. This asserts the chip is gone and a bar's
 * click opens the stats. Floors and identities only: the fixture decides who is in the fight and
 * what they dealt, so this notes rather than fails on an empty selection.
 */
export async function stepGlanceDrill(page: Page): Promise<void> {
  const rows = await meterRows(page)
  if (rows === 0) {
    note('the glance card has no damage to rank right now — there is no bar to click')
    return
  }
  check('the Overview damage card opens ZOOMED OUT, like every other meter (JOS-35)', !(await drilled(page)))

  await page.click(ROW, { timeout: 15_000 })
  const opened = await settle(() => drilled(page), (d) => d, { timeoutMs: 10_000 })
  check('…and clicking a bar DRILLS — the click this card used to lack entirely', opened)
  if (!opened) return

  // The category chip the owner rejected must NOT be here — one bar per ability, flat (JOS-113).
  check('…into a FLAT ability list with no category chip (JOS-113)', (await countOf(page, CHIP)) === 0)
  const inCard = page.locator(`[data-testid="overview-dps"] ${SKILL}`)
  const bars = await inCard.count()
  if (bars === 0) {
    note('the drilled source dealt no damage in this selection — no ability bar to expand')
  } else {
    // A stat-bearing ability expands its stats inline, here exactly as on the Combat tab. A
    // positional click at the BAR row (so React re-renders between awaits), on each ability until
    // one opens its readout — most are melee/slay swings and so expandable.
    let ok = false
    for (let i = 0; i < bars && !ok; i++) {
      await inCard.nth(i).click({ position: { x: 12, y: 8 }, timeout: 5_000 }).catch(() => undefined)
      ok = (await countOf(page, STATS)) >= 1
    }
    check('…and clicking a stat-bearing ability expands its stats inline, on the card too', ok)
  }

  // THE DRILL SURVIVES A TAB ROUND TRIP HERE TOO (JOS-116). The card's drill used to be
  // deliberately card-local AND unpersisted, and "coming back to Overview always shows the glance"
  // turned out to be a description of the bug: this view unmounts on every tab switch, so a drill
  // you opened was gone the moment you looked at anything else. It has its own remembered slot now
  // (a different key from the Combat tab's, so the two still move independently).
  //
  // The trip OUT asserts the card is really gone first — an unmount that never happened would make
  // the assertion after it a tautology (the sky-filters rule).
  if (!(await leaveOverview(page))) {
    note('the Overview card did not unmount on the way out — the round trip was not exercised')
  } else if (await returnToOverview(page)) {
    const still = await settle(() => drilled(page), (d) => d, { timeoutMs: 10_000 })
    check('…and the drill SURVIVES leaving and returning to the Overview tab', still)
  }

  const back = await meterRows(page)
  check('…and the crumb walks back out to the same source list', back === rows, `${rows} → ${back} rows`)
}

/** Leave for the Combat tab and confirm the glance card really unmounted. */
async function leaveOverview(page: Page): Promise<boolean> {
  await page.click('[data-testid="nav-combat"]', { timeout: 30_000 })
  return page
    .waitForSelector(CARD, { state: 'detached', timeout: 15_000 })
    .then(() => true, () => false)
}

/** …and back, waiting for the card rather than for a clock. */
async function returnToOverview(page: Page): Promise<boolean> {
  await page.click('[data-testid="nav-overview"]', { timeout: 30_000 })
  return page.waitForSelector(CARD, { timeout: 20_000 }).then(() => true, () => false)
}

// ── THE DRILL YOU LEFT STAYS DRILLED (JOS-116) ─────────────────────────────────────────
//
// THE BUG, in the owner's words: "switching views resets combat panels to fully drilled-out."
// Same lifecycle as JOS-90's Sky filters and JOS-97's: `App`'s `ViewContent` mounts exactly ONE
// feature view at a time, so leaving the Combat tab destroys everything it was holding — the
// drilled source AND the ability whose stats you had opened inside it.
//
// WHY ONLY A REAL APP CAN SAY THIS WORKS. The storable half is pinned without a browser
// (tests/combatPrefs.test.mts) and would have passed while the feature stayed broken, because the
// bug was never in the read — it was in the lifecycle, and in an effect that could not tell a
// user's click from a mount. So every assertion here is bracketed by a NAVIGATION, and the trip
// out asserts the dashboard is GONE first: an unmount that never happened would make the rest of
// this a tautology (the sky-filters rule, verbatim).
//
// The RESTART half is its own spec (combat-drill.e2e.mts), because it needs a second process.

const DASH = '[data-testid="combat-dashboard"]'

/**
 * Count matches INSIDE the Combat tab's meter panel — the same reader combatSteps.mts uses, and
 * here for the same reason: the dashboard has four cells and several of them hold bars, so a
 * page-wide count would answer a question about the wrong panel.
 */
function inPanelCount(page: Page, sel: string): Promise<number> {
  return page.evaluate(
    (s) =>
      document
        .querySelector('[data-testid="meter-body"]')
        ?.closest('[data-testid="dash-panel"]')
        ?.querySelectorAll(s).length ?? 0,
    sel
  )
}

/** Leave for the Overview and confirm the Combat view really unmounted. Exported because every
 *  persisted view pref owes the same proof (AGENTS.md: assert the view was GONE first), and two
 *  copies of "did the tab actually unmount" is exactly how one of them ends up not asserting it. */
export async function leaveCombat(page: Page): Promise<boolean> {
  await page.click('[data-testid="nav-overview"]', { timeout: 30_000 })
  return settleGone(page, DASH, { timeoutMs: 15_000 })
}

/** …and back, waiting for the dashboard rather than for a clock. */
export async function returnToCombat(page: Page): Promise<boolean> {
  await page.click('[data-testid="nav-combat"]', { timeout: 30_000 })
  return (await settleCount(page, DASH)) === 1
}

/** Open the first ability that HAS stats to show, and return its name (null when none does). */
async function expandAnAbility(page: Page): Promise<string | null> {
  const bars = await inPanelCount(page, SKILL)
  const inPanel = page.locator(`[data-testid="dash-panel"] ${SKILL}`)
  for (let i = 0; i < bars; i++) {
    const bar = inPanel.nth(i)
    await bar.click({ position: { x: 12, y: 8 }, timeout: 5_000 }).catch(() => undefined)
    if ((await inPanelCount(page, STATS)) >= 1) {
      return ((await bar.textContent()) ?? '').split('·')[0]?.trim() ?? ''
    }
  }
  return null
}

export async function stepDrillRoundTrip(page: Page): Promise<void> {
  // Start from level 1, whatever the steps before this left behind.
  const rows = await meterRows(page)
  if (rows === 0) {
    note('the selection has no outgoing damage right now — there is no bar to drill')
    return
  }

  // 1. DRILL, then EXPAND. Two levels of state, and the ticket is about both: the drilled source
  //    and the inline per-ability readout JOS-113 put inside it.
  await page.click('[data-testid="meter-row"]', { timeout: 15_000 })
  if (!check('a source bar drills', await settle(() => drilled(page), (d) => d, { timeoutMs: 10_000 }))) return
  const ability = await expandAnAbility(page)
  if (ability === null) {
    note('the drilled source has no stat-bearing ability in this selection — only the drill is asserted')
  }

  // 2. THE ROUND TRIP.
  if (!check('leaving the Combat tab unmounts it (the dashboard is gone)', await leaveCombat(page))) return
  if (!check('…and the Combat tab comes back', await returnToCombat(page))) return

  // 3. THE HEADLINE.
  const still = await settle(() => drilled(page), (d) => d, { timeoutMs: 10_000 })
  check('THE DRILL SURVIVES LEAVING AND RETURNING TO THE COMBAT TAB', still)
  if (ability !== null) {
    const stats = await settle(() => inPanelCount(page, STATS), (n) => n >= 1, { timeoutMs: 10_000 })
    check(`…and so does the ability whose stats were open (${ability})`, stats >= 1, `${stats} readout(s)`)
  }

  // 4. A STALE DRILL DEGRADES TO LEVEL 1, gracefully (the JOS-105 rule, now reachable from the
  //    store). Written straight into localStorage on purpose: this is not a path any UI offers —
  //    it is what a user has after the fight they were reading rolled out of the meter, or after
  //    a build that named sources differently. Level 1 with its rows, never an empty panel.
  await page.evaluate(() => {
    localStorage.setItem(
      'eq.combat.drill.combat',
      JSON.stringify({ d: { kind: 'entity', entityId: 'nobody:who-left-this-fight' }, a: ['melee|Nothing'] })
    )
  })
  if (!check('the tab unmounts for the stale-drill check', await leaveCombat(page))) return
  if (!check('…and comes back', await returnToCombat(page))) return
  const stillDrilled = await settle(() => drilled(page), (d) => !d, { timeoutMs: 10_000 })
  check('a drill naming a source this fight does not have degrades to level 1', stillDrilled === false)
  check('…and level 1 still ranks its sources rather than rendering empty', (await meterRows(page)) === rows, `${rows} rows`)
  check('…with no orphaned ability readout left open', (await inPanelCount(page, STATS)) === 0)
}

// ── THE DRILL SURVIVES A CHANGE OF FIGHT (JOS-240) ─────────────────────────────────────────
//
// Owner, 2026-08-12: "drill into a row on fight A, switch to fight B and back — the drill should be
// where you left it." It was not: the Combat tab cleared the drill on its own selection handler, so
// comparing the same breakdown across two pulls meant re-clicking into it every single time.
//
// WHY THIS NEEDS A REAL APP, when the store shape and the row builder are both node-tested
// (tests/combatPrefs.test.mts, tests/combatPetNesting.test.mts). Neither of those can see the thing
// that was actually wrong: a HANDLER in the view that ran `setDrill(null)` on the way to selecting
// a fight. Both suites were green while the bug shipped, and both stay green if it comes back. The
// only observable that moves is the crumb over the meter after a real click on a real picker row.
//
// AND THE OBSERVABLE IS THE SUBJECT, not merely "something is drilled". A drill that survived as
// some OTHER row would satisfy `drilled()` and be a worse bug than the one being fixed, so the
// assertion is that the crumb says the same name it said before the trip.

const CRUMB = '[data-testid="dash-panel"] [data-testid="drill-crumb"]'
const DRILL_KEY = 'eq.combat.drill.combat'

/** Which subject the meter is drilled into, by name — '' when it is at level 1. */
function crumbName(page: Page): Promise<string> {
  return page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() ?? '', CRUMB)
}

/** The token the renderer has stored, verbatim. `null` is level 1 (an absent key IS the default). */
function storedDrill(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), DRILL_KEY)
}

/** Pick a fight from the real picker and wait for the meter to stop moving under the new one. */
async function selectFight(page: Page, id: string): Promise<void> {
  await openPicker(page)
  await page.click(`li[data-value="${id}"]`, { timeout: 15_000 })
  await settleGone(page, '[data-testid="fight-picker"]', { timeoutMs: 8_000 })
  // The selection change is an IPC round trip to main and back, so the honest signal that the
  // dashboard has finished re-rendering is that its crumb and its row count have stopped changing.
  await settleStable(async () => [await crumbName(page), await countOf(page, ROW)] as const, {
    timeoutMs: 15_000
  })
}

export async function stepDrillAcrossFights(page: Page): Promise<void> {
  // The fights come from the PICKER, not from a snapshot: only the list actually on screen knows
  // which ids are clickable, and the head row's '__live__' sentinel re-resolves to whatever fight
  // is current — a moving target this step must not stand on.
  const fights = (await openSelectorValues(page)).filter((v) => v !== '__live__')
  const [a, b] = fights
  if (a === undefined || b === undefined || a === b) {
    note(
      `the fight list offers fewer than two selectable finalized fights (${fights.join(', ') || 'none'}) — nothing to switch between`
    )
    return
  }

  // 1. LAND ON FIGHT A AT LEVEL 1, whatever the steps before this left behind, and drill a row.
  await selectFight(page, a)
  if ((await meterRows(page)) === 0) {
    note('fight A ranks no outgoing damage — there is no bar to drill')
    return
  }
  await page.click(ROW, { timeout: 15_000 })
  if (!check('a source bar drills on fight A', await settle(() => drilled(page), (d) => d, { timeoutMs: 10_000 }))) {
    return
  }
  const subject = await crumbName(page)
  check('…and the crumb names the row it opened', subject !== '', subject || 'the crumb was empty')

  // 2. SWITCH TO FIGHT B. Whether it stays drilled depends on whether that fight HAS this row —
  //    both outcomes are correct and the ticket names both, so what is asserted unconditionally is
  //    the part that used to be false: the remembered token is never thrown away by the switch.
  await selectFight(page, b)
  const keptB = await storedDrill(page)
  check('switching fights NEVER clears the remembered drill (JOS-240)', keptB !== null, String(keptB))
  const onB = await crumbName(page)
  if (onB === subject) {
    check(`…and fight B has ${subject} too, so it opens drilled straight into it`, await drilled(page))
  } else {
    // The degrade half of the acceptance: a clean top-level view, its rows intact, no crash — and
    // the memory still standing so the next fight that has the row re-opens it (step 3 proves it).
    check(`…and a fight without ${subject} shows the clean source list instead`, !(await drilled(page)))
    check('…which still ranks its own sources rather than rendering empty', (await countOf(page, ROW)) >= 1)
  }

  // 3. …AND BACK. The headline.
  await selectFight(page, a)
  const still = await settle(() => drilled(page), (d) => d, { timeoutMs: 10_000 })
  check('THE DRILL IS WHERE YOU LEFT IT AFTER SWITCHING FIGHTS AND BACK', still)
  check('…and it is the SAME subject, not merely some drill', (await crumbName(page)) === subject, `${subject} → ${await crumbName(page)}`)

  // 4. A DIRECTION change is the one navigation that still un-drills: Outgoing / Incoming /
  //    Healing rank three different sets of subjects, so a token carried sideways means nothing
  //    where it lands. This is the boundary of the ticket, asserted rather than described.
  const TOGGLE = '[data-testid="direction-toggle"]'
  await page.click(`${TOGGLE} button[value="in"]`, { timeout: 10_000 }).catch(() => undefined)
  const cleared = await settle(() => storedDrill(page), (v) => v === null, { timeoutMs: 10_000 })
  check('switching DIRECTION still un-drills — that boundary did not move', cleared === null, String(cleared))

  // 5. YOUR DEFENCE (JOS-354) rides the Incoming direction, and ONLY it — and since JOS-361 it
  //    rides the card's SECOND TAB there. The step is here rather than in a spec of its own
  //    because this is the one place the suite already flips direction, and the claims are exactly
  //    mount claims a unit test cannot make: which tab the card opens on, that the block is on
  //    screen behind the other one, that its rows are drawn in the ranked order `defenseRows`
  //    computes, and that neither the tabs nor the block exist in the direction where a source's
  //    avoidance breakdown means the opposite thing.
  await stepMitigationTab(page)

  // …and leave the tab the way the steps after this one expect to find it: Outgoing, level 1.
  await page.click(`${TOGGLE} button[value="out"]`, { timeout: 10_000 }).catch(() => undefined)
  check(
    '…and it is GONE in Outgoing, where the same numbers would mean the mob’s avoidance of YOUR swings',
    await settleGone(page, '[data-testid="defense-panel"]', { timeoutMs: 10_000 })
  )
  check(
    '…and Outgoing offers no Mitigation TAB either — not a disabled one, none',
    await settleGone(page, TABS, { timeoutMs: 10_000 })
  )
  await settleStable(() => countOf(page, ROW), { timeoutMs: 10_000 })
}

/** The meter card's own tab strip (JOS-361) — Incoming only, and only while nothing is drilled. */
const TABS = '[data-testid="meter-tabs"]'

/** The `count · pct%` a defence row ends with, per row, top to bottom — the RANK as drawn. */
async function defenceCounts(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="defense-row"]')].map((el) => {
      // The row's right end is `<count> · <pct>%`; the label sits to its left and may itself
      // contain no digits, so the LAST such run is unambiguous.
      const m = /(\d+) · [\d.]+%\s*$/.exec(el.textContent ?? '')
      return m ? Number(m[1]) : -1
    })
  )
}

/**
 * THE CARD OPENS ON DAMAGE BREAKDOWN, AND MITIGATION IS ONE CLICK AWAY (JOS-361).
 *
 * Called with the dashboard already on Incoming at level 1 (step 4 above left it there). The
 * defence block being ABSENT on arrival is the owner's actual ask — "not selected by default" —
 * so it is asserted before anything is clicked, not merely implied by the tab that is selected.
 */
async function stepMitigationTab(page: Page): Promise<void> {
  const tabs = await settleCount(page, TABS, 1, { timeoutMs: 10_000 })
  if (!check('the INCOMING card carries the two tabs', tabs === 1, `${tabs} tab strips`)) return

  check(
    'THE CARD OPENS ON DAMAGE BREAKDOWN — mitigation is not selected by default',
    (await page.$$(`${TABS} button[value="damage"].Mui-selected`)).length === 1
  )
  check(
    '…so the defence block is NOT on screen until it is asked for',
    (await page.$$('[data-testid="defense-panel"]')).length === 0
  )
  // The damage tab is still the meter: the attacker rows the card is for are what it shows.
  check('…and the ranked attacker rows are what that tab shows', (await countOf(page, ROW)) >= 1)

  await page.click(`${TABS} button[value="mitigation"]`, { timeout: 10_000 })
  const headline = await settle(
    () => page.evaluate(() => document.querySelector('[data-testid="defense-headline"]')?.textContent ?? ''),
    (t) => t.length > 0,
    { timeoutMs: 10_000 }
  )
  check('YOUR DEFENCE IS ON SCREEN ON THE MITIGATION TAB', headline.length > 0, headline)
  check(
    '…and the headline carries its own denominator — a rate with no exposure is a lie',
    /swings at you|nothing has swung/i.test(headline),
    headline
  )

  // THE STACK RANK, read off the screen. A segment where nothing has swung at you draws the quiet
  // note and no rows at all, which is the honest degenerate case rather than a failure.
  const counts = await defenceCounts(page)
  if (counts.length === 0) {
    note('this fight has no swings aimed at you — the panel states that instead of ranking rows')
    return
  }
  check('every defence row states a count', !counts.includes(-1), counts.join(', '))
  const ranked = [...counts].sort((a, b) => b - a)
  check(
    'THE ROWS ARE STACK-RANKED BY COUNT, DESCENDING (JOS-361)',
    counts.join(',') === ranked.join(','),
    `${counts.join(' ≥ ')} (expected ${ranked.join(' ≥ ')})`
  )
}
