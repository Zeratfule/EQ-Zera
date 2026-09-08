// rateBasis — WHICH HOUR A PER-HOUR NUMBER IS PER, and when there is not enough of it (JOS-288).
//
// The owner's third and fourth rulings, pinned in one file because they are one mechanism:
// `src/shared/rateBasis.ts` owns the vocabulary (`elapsed` / `active` — the loot ledger's own two
// words, JOS-261), the DEFAULT, and the just-arrived gate; the shaping layers that read it are the
// Leveling range panel (`rangeStatsRows.ts`) and the XP overlay (`overlay/xpRows.ts`).
//
// EVERYTHING HERE IS A DISPLAY DECISION. `rangeStats` and `windowItemRows` keep measuring exactly
// what they measured, and the golden-window suites keep pinning it — which is precisely why the
// gate lives in this layer and not down there: a floor pushed into the derivation would change what
// this repo believes happened rather than what it is willing to say out loud.
//
// SPLIT FROM ITS TWO NEIGHBOURS (AGENTS.md: split, never ratchet). tests/rangeStatsRows.test.mts and
// tests/xpOverlay.test.mts both sat near the measured 400-line ceiling and both grew a section about
// this one ruling; the honest cut puts the ruling in its own file rather than widening the debt
// register. Each of those files keeps everything that was true of it before this ticket.
//
// SNAPSHOTS ARE HAND-BUILT AND ANCHORED IN THE PAST: the derivations read `snap.lastTs`, never
// `Date.now()`, and a fixture near the wall clock would hide exactly that.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { LootEvent } from '../src/shared/types'
import type { ProgressionSnap } from '../src/shared/progressionTypes'
import type { RangeStats, ZoneRangeRow } from '../src/shared/progressionStatsTypes'
import { IDLE_GAP_MS, rangeStats } from '../src/shared/progressionStats'
import { levelEta } from '../src/shared/levelEta'
import { resolveSlice, type SliceId } from '../src/shared/timeslice'
import { normalizeXpRows } from '../src/shared/xpOverlay'
import {
  RATE_BASES,
  RATE_BASIS_DEFAULT,
  RATE_MIN_MS,
  basisMs,
  isRateBasis,
  normalizeRateBasis,
  rateMeasurable,
  resolveRateBasis,
  toggleRateBasis,
  type RateBasis
} from '../src/shared/rateBasis'
import { dataBounds } from '../src/renderer/src/features/leveling/zoneBands'
import {
  BASIS_BUTTON_TITLE,
  BASIS_TITLE,
  NONE,
  aaRateText,
  aaRateTitle,
  rangeHeroes,
  zoneStatRows
} from '../src/renderer/src/features/leveling/rangeStatsRows'
import { fmtDuration } from '../src/renderer/src/features/leveling/levelChartGeometry'
import { xpOverlayView } from '../src/renderer/src/overlay/xpRows'

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = Date.parse('Sat Aug 01 12:00:00 2026')

function emptySnap(): ProgressionSnap {
  return {
    expTs: [], expPct: [], expFlag: [],
    killTs: [], killZone: [], killCredit: [],
    witnessTs: [], recentKills: [], lootTs: [],
    zoneStart: [], zoneEnd: [], zoneName: [],
    offlineStart: [], offlineEnd: [], offlineCamped: [],
    levelTs: [], levelValue: [], aaGainTs: [], aaGainAmount: [],
    lastTs: 0, windowStart: 0, dropped: 0
  }
}

/** A zone row with every field defaulted, so each test states only what it is about. */
function zone(over: Partial<ZoneRangeRow> & { zone: string }): ZoneRangeRow {
  const spanMs = over.spanMs ?? HOUR
  const idleMs = over.idleMs ?? 0
  const offlineMs = over.offlineMs ?? 0
  const activeMs = over.activeMs ?? spanMs - idleMs - offlineMs
  const base: ZoneRangeRow = {
    zone: over.zone, spanMs, activeMs, idleMs, offlineMs,
    visits: 1, kills: 0, killsSelf: 0, killsPet: 0,
    levelEquiv: 0, expUnstated: 0, expSamples: 0,
    levelsPerHourActive: null, levelsPerHourWall: null,
    killsPerHourActive: null, killsPerHourWall: null
  }
  return { ...base, ...over, spanMs, activeMs, idleMs, offlineMs }
}

function stats(over: Partial<RangeStats> = {}): RangeStats {
  const base: RangeStats = {
    t0: T0, t1: T0 + 3 * HOUR, durationMs: 3 * HOUR, activeMs: 3 * HOUR,
    idleMs: 0, idleGaps: 0, idleThresholdMs: IDLE_GAP_MS, offlineMs: 0, offlineGaps: 0,
    kills: 0, killsSelf: 0, killsPet: 0, killsWitnessed: 0,
    expSamples: 0, expParty: 0, expUnstated: 0, levelEquiv: 0,
    levelsPerHourActive: null, levelsPerHourWall: null,
    killsPerHourActive: null, killsPerHourWall: null,
    levelUps: [], levelRuns: [],
    aaGained: 0, aaGainEvents: 0,
    aaPerHourActive: null, aaPointsPerHourActive: null,
    aaPerHourWall: null, aaPointsPerHourWall: null,
    zones: [], combos: [], clipped: false
  }
  return { ...base, ...over }
}

/** An AA completion `ms` before the end. */
function aa(s: ProgressionSnap, msBeforeEnd: number, amount = 1): void {
  s.aaGainTs.push(T0 - msBeforeEnd)
  s.aaGainAmount.push(amount)
}

/** A ding `ms` before the end, so the ETA has an anchor to sum stated percentages from. */
function ding(s: ProgressionSnap, msBeforeEnd: number, level: number): void {
  s.levelTs.push(T0 - msBeforeEnd)
  s.levelValue.push(level)
}

function loot(item: string, msBeforeEnd: number, zoneName: string): LootEvent {
  return { ts: T0 - msBeforeEnd, item, zone: zoneName }
}

/** The overlay view, over the slice `id` and the hour `basis`. Absent basis is the shipped default. */
function view(
  snap: ProgressionSnap,
  events: LootEvent[],
  basis?: RateBasis,
  id: SliceId = 'all'
): ReturnType<typeof xpOverlayView> {
  const bounds = dataBounds(snap, [])
  return xpOverlayView({
    snap,
    loot: events,
    slice: resolveSlice({ snap, bounds, id }),
    visible: normalizeXpRows(undefined),
    basis
  })
}

const valueOf = (v: ReturnType<typeof xpOverlayView>, id: string): string =>
  v.rows.find((r) => r.id === id)?.value ?? '<missing>'

// ---------------------------------------------------------------------------------------
// THE VOCABULARY ITSELF
// ---------------------------------------------------------------------------------------

test('the two bases are a closed union with a stated default, and absent means the default', () => {
  assert.deepEqual([...RATE_BASES], ['elapsed', 'active'], 'the loot ledger’s own two words, in order')
  assert.equal(RATE_BASIS_DEFAULT, 'elapsed', 'the owner’s ruling, stated once for the whole app')
  assert.equal(resolveRateBasis(undefined), 'elapsed', 'absent is the default, never a third state')
  assert.equal(resolveRateBasis('active'), 'active')
  // A CLOSED union, because it is persisted: a store this build cannot read degrades to the default
  // rather than putting a number under an hour nothing here can name.
  assert.equal(isRateBasis('wall'), false, 'the internal field name is not a user-facing word')
  assert.equal(normalizeRateBasis('wall'), undefined)
  assert.equal(normalizeRateBasis(42), undefined)
  assert.equal(normalizeRateBasis('active'), 'active')
  // Two states, so the control is a flip and not a menu.
  assert.equal(toggleRateBasis(undefined), 'active', 'flipping the default lands on the other one')
  assert.equal(toggleRateBasis('active'), 'elapsed')
})

test('the elapsed denominator is durationMs minus the logout, and nothing else', () => {
  const spans = { durationMs: 3 * HOUR, activeMs: HOUR, offlineMs: 2 * HOUR }
  assert.equal(basisMs('elapsed', spans), HOUR, 'the two hours you were logged out come out')
  assert.equal(basisMs('active', spans), HOUR)
  // Medding stays IN — that is the whole point of this half of the pair.
  assert.equal(basisMs('elapsed', { durationMs: 2 * HOUR, activeMs: HOUR, offlineMs: 0 }), 2 * HOUR)
  // Never negative, whatever a caller hands in.
  assert.equal(basisMs('elapsed', { durationMs: 0, activeMs: 0, offlineMs: HOUR }), 0)
})

/**
 * THE GATE IS THE IDLE THRESHOLD, IMPORTED RATHER THAN CHOSEN, and the reason is arithmetic: `idleMs`
 * counts only gaps LONGER than `IDLE_GAP_MS`, so a stretch shorter than one cannot contain a
 * qualifying gap and its active time equals its elapsed time by construction. Nothing has been
 * measured yet — the "rate" is the clock since you arrived with a per-hour suffix on it.
 */
test('the rate floor is the idle threshold exactly, and it is a floor rather than a fence', () => {
  assert.equal(RATE_MIN_MS, IDLE_GAP_MS, 'one measured constant, never a second hand-typed one')
  assert.equal(rateMeasurable(RATE_MIN_MS - 1), false)
  assert.equal(rateMeasurable(RATE_MIN_MS), true, 'the threshold itself qualifies')
  assert.equal(rateMeasurable(0), false)
})

// ---------------------------------------------------------------------------------------
// THE LEVELING TAB (rangeStatsRows)
// ---------------------------------------------------------------------------------------

/**
 * THE OWNER'S RULING, AT THE SEAM: rates default to the ELAPSED hour, and the hover names whichever
 * hour is in force rather than always naming the active one.
 */
test('the rate card defaults to the elapsed hour and names the one it used', () => {
  const s = stats({
    durationMs: 3 * HOUR,
    activeMs: 2 * HOUR,
    idleMs: HOUR,
    levelsPerHourActive: 2.13,
    levelsPerHourWall: 1.42,
    expSamples: 210
  })
  const [byDefault] = rangeHeroes(s)
  assert.equal(byDefault.value, '1.42 lvl/hr', 'absent basis is the elapsed one')
  assert.equal(byDefault.sub, 'over 3h 0m elapsed', 'and the span states the hour it divided by')
  assert.match(byDefault.title ?? '', /Elapsed time = /)
  const [flipped] = rangeHeroes(s, 'active')
  assert.equal(flipped.value, '2.13 lvl/hr', 'the toggle is one argument and the other honest answer')
  assert.equal(flipped.sub, 'over 2h 0m active')
  assert.match(flipped.title ?? '', /Active time = /)
})

/**
 * THE BUTTON THAT PICKS THE HOUR SAYS WHAT PICKING IT DOES (JOS-304, owner feedback 2026-08-13:
 * the toggle is *hard to understand*).
 *
 * One word on a button cannot say which denominator it is, and the caption beside it only reads the
 * pick back. So `BASIS_BUTTON_TITLE` leads with the effect on the numbers and then hands over to the
 * definition — and the thing pinned here is that the second half is the SAME STRING the caption
 * hovers, by lookup rather than by copy. A hand-typed paraphrase on the button would be a second
 * spelling of the definition this whole file exists to keep singular: the button would eventually
 * describe an hour the line under it does not divide by, and no other test in the suite would see
 * it. Built over `RATE_BASES`, so a third denominator cannot arrive with a missing sentence.
 */
test('each denominator button hovers the effect, then the very definition the caption carries', () => {
  for (const basis of RATE_BASES) {
    const words = BASIS_BUTTON_TITLE[basis]
    assert.equal(words, `Divides every rate by ${basis} time. ${BASIS_TITLE[basis]}`)
    // The lead clause is about the numbers on screen; the tail is the canonical definition, intact.
    assert.match(words, /^Divides every rate by (elapsed|active) time\. /)
    assert.ok(words.endsWith(BASIS_TITLE[basis]), `${basis}: the definition is appended, not reworded`)
  }
  // The two sides of the one difference, so either button teaches the pair.
  assert.match(BASIS_BUTTON_TITLE.elapsed, /Elapsed time = /)
  assert.match(BASIS_BUTTON_TITLE.elapsed, /medding, banking and travelling stay/)
  assert.match(BASIS_BUTTON_TITLE.active, /Active time = /)
  assert.match(BASIS_BUTTON_TITLE.active, /not an AFK check, and not out-of-combat time/)
})

/** A three-hour range with a two-hour logout in it divides by ONE hour — `wallMs`, not the clock. */
test('the elapsed span the card states carves out the logout', () => {
  const [card] = rangeHeroes(
    stats({ durationMs: 3 * HOUR, activeMs: HOUR, offlineMs: 2 * HOUR, levelsPerHourWall: 1, expSamples: 60 })
  )
  assert.equal(card.sub, 'over 1h 0m elapsed')
})

/**
 * THE JUST-ARRIVED GATE ON THE HEADLINE CARD. Its refusal outranks every other caption for a
 * reason: with no hour to divide by there is nothing yet to say about the numerator.
 */
test('a range shorter than the idle threshold refuses its rate and says why', () => {
  const heroes = rangeHeroes(
    stats({ durationMs: 3 * MIN, activeMs: 3 * MIN, levelsPerHourActive: 40, levelsPerHourWall: 40, expSamples: 3 })
  )
  assert.equal(heroes[0].value, NONE, 'three minutes is the clock since you arrived, not a rate')
  assert.equal(heroes[0].sub, 'over 3m elapsed - too short to state as a rate')
  assert.match(heroes[0].title ?? '', /too little to state as a rate per hour/)
  // The counting cards are untouched — a short stretch does not un-happen.
  assert.equal(heroes[1].id, 'kills')
  assert.equal(heroes[1].title, undefined)
})

/**
 * A RANGE WITH NO TIME OF THIS KIND KEEPS ITS OWN, OLDER SENTENCE. "No active time in this range"
 * and "too short to state as a rate" are different facts and the more specific one wins.
 */
test('an empty denominator is not the same refusal as a short one', () => {
  const [card] = rangeHeroes(stats({ activeMs: 0, idleMs: 3 * HOUR, expSamples: 0 }), 'active')
  assert.equal(card.sub, 'no active time in this range')
})

/** The AA pair follows the same hour, and both halves move together. */
test('the AA rate chip states both halves over ONE hour, and the default is elapsed', () => {
  const s = stats({
    durationMs: 2 * HOUR,
    activeMs: HOUR,
    idleMs: HOUR,
    aaGainEvents: 3,
    aaGained: 4,
    aaPerHourActive: 3,
    aaPointsPerHourActive: 4,
    aaPerHourWall: 1.5,
    aaPointsPerHourWall: 2
  })
  assert.equal(aaRateText(s), '1.50 AA/hr · 2.00 pts/hr')
  assert.equal(aaRateText(s, 'active'), '3.00 AA/hr · 4.00 pts/hr')
  assert.match(aaRateTitle(s), /Elapsed time = /)
  assert.match(aaRateTitle(s, 'active'), /Active time = /)
  assert.equal(aaRateText(stats({ aaGainEvents: 0 })), null, 'no AA in range still means no chip at all')
})

/**
 * THE TWO HOURS ARE BOTH ON A ZONE ROW, AND THE TABLE SHOWS ONE OF THEM. Both rates on a row move
 * together — a levels column on the elapsed denominator beside a kills column on the active one
 * would be two readings wearing one row, which is why `killsPerHourWall` exists at all.
 */
test('a zone row states the hour in force, and BOTH of its rates come from it', () => {
  const z = zone({
    zone: 'Befallen',
    spanMs: 2 * HOUR,
    idleMs: 30 * MIN,
    levelsPerHourActive: 2,
    levelsPerHourWall: 1.5,
    killsPerHourActive: 40,
    killsPerHourWall: 30
  })
  const [elapsed] = zoneStatRows([z])
  assert.equal(elapsed.levelsPerHour, '1.50 lvl/hr', 'the default is the elapsed hour (owner ruling)')
  assert.equal(elapsed.killsPerHour, '30.0 kills/hr', 'and its neighbour is on the same hour')
  const [active] = zoneStatRows([z], 'levels', 'active')
  assert.equal(active.levelsPerHour, '2.00 lvl/hr')
  assert.equal(active.killsPerHour, '40.0 kills/hr')
})

/** The gate again, per row: the COUNTS and the TIME still print, because they happened. */
test('a zone you only passed through states its time and refuses its rates', () => {
  const [row] = zoneStatRows([
    zone({ zone: 'Befallen', spanMs: 3 * MIN, kills: 3, levelsPerHourActive: 40, levelsPerHourWall: 40 })
  ])
  assert.equal(row.time, '3m')
  assert.equal(row.kills, 3, 'the kills happened')
  assert.equal(row.levelsPerHour, NONE, 'three minutes is not an hour to extrapolate from')
  assert.equal(row.killsPerHour, NONE)
  const [ok] = zoneStatRows([zone({ zone: 'Befallen', spanMs: 6 * MIN, levelsPerHourWall: 40 })])
  assert.equal(ok.levelsPerHour, '40.0 lvl/hr', 'one minute past the threshold the number is back')
})

// ---------------------------------------------------------------------------------------
// THE XP OVERLAY (overlay/xpRows)
// ---------------------------------------------------------------------------------------

/** An hour in which half the time was one long silence: the two denominators part company. */
function halfIdleHour(): ProgressionSnap {
  const s = emptySnap()
  const start = T0 - HOUR
  // Samples in the first half only, so the 31-minute tail is one gap over the idle threshold.
  for (let ts = start + MIN; ts < start + 30 * MIN; ts += MIN) {
    s.expTs.push(ts)
    s.expPct.push(1)
    s.expFlag.push(0)
    s.killTs.push(ts)
    s.killZone.push(0)
    s.killCredit.push(0)
  }
  s.zoneStart.push(start)
  s.zoneEnd.push(0)
  s.zoneName.push('Befallen')
  s.lastTs = T0
  return s
}

test('the overlay rates default to the ELAPSED hour, and the toggle is the other honest answer', () => {
  const snap = halfIdleHour()
  aa(snap, 50 * MIN, 2)
  aa(snap, 40 * MIN, 1)
  const elapsed = view(snap, [])
  const active = view(snap, [], 'active')
  assert.equal(elapsed.basis, 'elapsed', 'an absent basis is the default, not a third state')
  // Two completions over one elapsed hour, and the same two over the half-hour that was play.
  assert.equal(valueOf(elapsed, 'aa'), '2.00')
  assert.equal(valueOf(active, 'aa'), '4.14', 'the 31-minute silence is out of the active denominator')
  assert.equal(elapsed.rows.find((r) => r.id === 'aa')?.detail, '3.00 pts/hr')
  assert.equal(active.rows.find((r) => r.id === 'aa')?.detail, '6.21 pts/hr')
  // The levels pace moves with it…
  assert.notEqual(valueOf(elapsed, 'xp'), valueOf(active, 'xp'))
  // …and the WORD for the hour in force is on the view, which is what the footer's basis toggle
  // prints. The rows used to name it on a hover each; JOS-358 took every row hover off this window
  // (owner ruling: tooltips live in the title bar out here), so the window states it ONCE, in the
  // open, on the control that also changes it.
  assert.equal(elapsed.basis, 'elapsed')
  assert.equal(active.basis, 'active')
  // …and the span line states the hour it just divided by, in the same word (owner ruling 2).
  assert.equal(elapsed.span, 'over 1h 0m elapsed')
  assert.equal(active.span, 'over 29m active')
})

test('the mote rates follow the same hour as the paces above them', () => {
  const snap = halfIdleHour()
  const events = [
    loot('Mote of Minor Potential', 50 * MIN, 'Befallen'),
    loot('Mote of Minor Potential', 45 * MIN, 'Befallen')
  ]
  const mote = (v: ReturnType<typeof xpOverlayView>): string | undefined =>
    v.rows.find((r) => r.row === 'motes')?.value
  assert.equal(mote(view(snap, events)), '2.00', 'two motes in one elapsed hour')
  assert.equal(mote(view(snap, events, 'active')), '4.14', 'and in the 29 minutes of it that were play')
})

/**
 * THE BONUS HONESTY. `levelEta` has ALWAYS divided by `levelsPerHourWall` while the pace row above
 * it printed the ACTIVE rate, so the two lines were measured over different hours. With the elapsed
 * default they agree: the projection is exactly the remaining bar over the rate on screen, which is
 * a property nothing could assert before.
 */
test('the projection and the pace row above it are finally the same arithmetic', () => {
  const snap = halfIdleHour()
  ding(snap, 55 * MIN, 43)
  const v = view(snap, [])
  const perHour = Number(valueOf(v, 'xp'))
  const eta = v.rows.find((r) => r.id === 'eta')
  assert.ok(perHour > 0 && eta)
  // THE REMAINING BAR, asked of `levelEta` directly. It used to be read back off the row's hover
  // ('42% of level 43 stated since your last level-up'); JOS-358 deleted every row title, so the
  // identity is now checked against the derivation the row is built from — which is the stronger
  // reading of it anyway, and does not depend on a sentence continuing to be phrased that way.
  const bounds = dataBounds(snap, [])
  const slice = resolveSlice({ snap, bounds, id: 'all' })
  const progress = levelEta(snap, rangeStats({ snap, range: slice.range }), null).progress
  const expectedMs = ((1 - progress) / perHour) * HOUR
  // fmtDuration rounds, so this compares the printed minute rather than the millisecond.
  assert.equal(eta.value, `~${fmtDuration(expectedMs)}`)
})

/** `ms` of one zone ending at the live edge, with one exp line inside it. */
function justArrived(ms: number): ProgressionSnap {
  const s = emptySnap()
  s.expTs.push(T0 - ms + 1000)
  s.expPct.push(1)
  s.expFlag.push(0)
  s.killTs.push(T0 - ms + 1000)
  s.killZone.push(0)
  s.killCredit.push(0)
  s.zoneStart.push(T0 - ms)
  s.zoneEnd.push(0)
  s.zoneName.push('Befallen')
  s.lastTs = T0
  return s
}

/**
 * THE DEFECT THE AUDIT NAMED: a confident `0.00 AA/hr` one second into a zone, loudest because the
 * AA row is drawn unconditionally (JOS-202).
 */
test('a stretch shorter than the idle threshold refuses every rate, with its reason', () => {
  const v = view(justArrived(40_000), [loot('Mote of Minor Potential', 30_000, 'Befallen')])
  assert.equal(v.measurable, false)
  assert.equal(valueOf(v, 'aa'), NONE, 'the confident 0.00 forty seconds in is the defect')
  assert.equal(valueOf(v, 'xp'), NONE)
  assert.equal(v.rows.find((r) => r.row === 'motes')?.value, NONE)
  // THE REASON IS IN THE OPEN RATHER THAN ON FOUR HOVERS. Each pace row used to append
  // `RATE_TOO_SHORT_TITLE` to its own title; JOS-358 deleted every row title on this window (owner
  // ruling: the overlay windows keep tooltips only in the title bar), and `measurable` — asserted
  // above, and the flag the window renders as `· too short to rate` beside the span — is the one
  // statement that now covers all four blanks.
  // THE COUNT IS NEVER GATED — what dropped, dropped.
  assert.equal(v.rows.find((r) => r.row === 'motes')?.detail, '1×')
  // …and the projection goes with the pace it is built on, rather than asserting what the row above
  // it just refused.
  assert.equal(valueOf(v, 'eta'), NONE)
})

/**
 * THE RULING IS NOT AN OVERTURN OF JOS-202. That owner ruling says a slice holding no completion
 * reads a measured 0.00 rather than dropping the row; this gate is about the DENOMINATOR and never
 * about the count, so the row is always DRAWN and only its number waits for an hour to divide by.
 */
test('the rows are drawn either way — only the number waits for evidence', () => {
  const short = view(justArrived(40_000), [])
  assert.deepEqual(short.rows.map((r) => r.id), ['xp', 'aa', 'eta', 'motes-none'])
  const at = view(justArrived(RATE_MIN_MS), [])
  assert.equal(at.measurable, true)
  assert.equal(valueOf(at, 'aa'), '0.00', 'a measured zero over a real span still prints')
  // …and it is a rate PER THE HOUR IN FORCE, which the window states once on its basis toggle
  // rather than on the row (JOS-358 — no row hovers out here).
  assert.equal(at.basis, 'elapsed')
  assert.equal(at.rows.find((r) => r.id === 'aa')?.unit, 'AA/hr')
})
