// PURE unit tests for the Overview leveling card's AA LINE — the read that survives the level
// cap (`aaLine` inside overviewLevelingData.ts, shaped by leveling/aaPaceRows.ts).
//
// ITS OWN FILE, like `overviewLevelingTiles.test.mts` beside it: `overviewLeveling.test.mts`
// pins the LEVELS half of the same fold and is at the 400-code-line factoring ceiling, and this
// is a different subject with a different failure mode. The builders are duplicated on purpose
// — a snapshot literal shared across three test files is a fixture nobody owns.
//
// WHY THIS SURFACE EXISTS AT ALL. Every other number on that card is built on stated level-bar
// percentages, and at max level the game stops stating them: the headline becomes an honest
// em-dash and the next-level projection refuses itself, exactly when AA becomes the whole game.
// These pin the answer that keeps working, and the three rules it obeys:
//
//   1. ABSENT, NEVER EM-DASHED. No completion in the hour ⇒ no line at all (law 1). A character
//      who is not earning AA is told nothing about AA rather than shown a row of unknowns, and
//      an old completion the window does not reach is not evidence about this hour either.
//   2. THE RATES ARE THE LEVELING TAB'S OWN SPELLING of the same hour (`aaRateText`), printed
//      TOGETHER and adjacent: they are equal until an item-shop bottle is running and diverge
//      while one is, and that divergence is the entire reading. The potion doubles what a
//      completion PAYS and never how fast completions arrive.
//   3. THE INFERRED WAIT CARRIES ONE WORD, and disappears rather than explaining itself. The log
//      holds no AA-experience line anywhere — there is no bar position to sum — so the wait is a
//      model over the window's own rhythm, labeled 'est.' and nothing more (AGENTS.md, the
//      tooltip and caveat diet). When that rhythm runs out (one completion, or a silence long
//      past the mean gap) the segment is simply gone; the Leveling tab's tile is where the
//      refusal and its reason live.
//
// Imported RELATIVELY: node tests run through tsx with no `@shared` / `@renderer` aliases.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { overviewLeveling } from '../src/renderer/src/features/overview/overviewLevelingData'
import { NONE } from '../src/renderer/src/features/leveling/rangeStatsRows'
import type { ProgressionSnap } from '../src/shared/progressionTypes'

const MIN = 60_000
const HOUR = 60 * MIN
/** An arbitrary, readable anchor — deliberately NOT near `Date.now()`: the window is anchored
 *  on the DATA's clock, and a wall-clock regression must fail here rather than in front of a
 *  user who alt-tabbed out of the game. */
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

/**
 * One open zone plus a kill+exp sample every minute across the last hour of LOG time — enough
 * activity that the whole hour counts as ACTIVE, so every rate below is arithmetic a reader can
 * check by hand. `unstated` makes every sample an at-cap line instead (percentage -1, flag 1).
 */
function farming(unstated = false): ProgressionSnap {
  const s = emptySnap()
  const start = T0 - HOUR
  for (let ts = start + MIN; ts < T0; ts += MIN) {
    s.expTs.push(ts)
    s.expPct.push(unstated ? -1 : 1)
    s.expFlag.push(unstated ? 1 : 0)
    s.killTs.push(ts)
    s.killZone.push(0)
    s.killCredit.push(0)
  }
  s.zoneStart.push(start)
  s.zoneEnd.push(0)
  s.zoneName.push('Plane of Sky')
  s.lastTs = T0
  return s
}

/** AA completions at each instant, each paying `amount` points (2 = a bottle is running). */
function aaAt(snap: ProgressionSnap, at: readonly number[], amount = 1): void {
  for (const ts of at) {
    snap.aaGainTs.push(ts)
    snap.aaGainAmount.push(amount)
  }
}

test('nothing at all when the hour holds no completion — never a row of em-dashes', () => {
  assert.equal(overviewLeveling(emptySnap()).aa, null, 'the empty snapshot says nothing about AA')
  assert.equal(overviewLeveling(farming()).aa, null, 'an hour with no AA is silent about AA')
  // A completion the window does not reach is not evidence about THIS hour.
  const old = farming()
  aaAt(old, [T0 - 5 * HOUR])
  assert.equal(overviewLeveling(old).aa, null)
})

test('both rates plus the inferred wait, in one line', () => {
  const snap = farming()
  // Three completions in the hour, each paying 2 — a bottle is running, so the POINTS rate is
  // double the COMPLETION rate. Printing only one of them would hide what the potion did.
  aaAt(snap, [T0 - 45 * MIN, T0 - 30 * MIN, T0 - 15 * MIN], 2)
  // Mean gap = the hour's ONLINE wall / 3 completions = 20m, of which 15m is already waited.
  assert.equal(overviewLeveling(snap).aa, '3.00 AA/hr · 6.00 pts/hr · next in ~5m est.')
})

test('the wait is one WORD of label, not a sentence', () => {
  const snap = farming()
  aaAt(snap, [T0 - 45 * MIN, T0 - 30 * MIN, T0 - 15 * MIN], 2)
  const line = overviewLeveling(snap).aa ?? ''
  assert.ok(line.endsWith('est.'), line)
  assert.ok(!/inferred|assume|projected|estimate/i.test(line), 'the tab owns the account, the line owns the number')
  assert.ok(line.length < 60, `a caption, not a footnote (${String(line.length)} chars)`)
})

test('at the cap the levels headline is an em-dash and the AA read still stands', () => {
  const snap = farming(true)
  aaAt(snap, [T0 - 40 * MIN, T0 - 20 * MIN])
  const state = overviewLeveling(snap)
  assert.equal(state.rate, NONE, 'no level-bar percentage is stated at the cap')
  assert.equal(state.atCap, true)
  assert.equal(state.eta, null, 'and the next-LEVEL projection is refused with it')
  // …which is precisely when this line is the whole point of the card.
  assert.equal(state.aa, '2.00 AA/hr · 2.00 pts/hr · next in ~10m est.')
})

test('one completion states a count but no rhythm — the wait is absent, not an em-dash', () => {
  const snap = farming()
  aaAt(snap, [T0 - 30 * MIN])
  assert.equal(overviewLeveling(snap).aa, '1.00 AA/hr · 1.00 pts/hr', 'a gap needs two completions')
})

test('past the mean gap it reads DUE, and past three of them it stops guessing', () => {
  // Two completions, the last 40 minutes ago against a 30-minute mean: overdue, never "0s".
  const due = farming()
  aaAt(due, [T0 - 55 * MIN, T0 - 40 * MIN])
  assert.equal(overviewLeveling(due).aa, '2.00 AA/hr · 2.00 pts/hr · next due est.')

  // Six completions, all early in the hour: a 10-minute rhythm that the 43 minutes of silence
  // since no longer describes. The rates are MEASURED, so they stay; the model does not.
  const cold = farming()
  aaAt(cold, [58, 55, 52, 49, 46, 43].map((m) => T0 - m * MIN))
  assert.equal(overviewLeveling(cold).aa, '6.00 AA/hr · 6.00 pts/hr', 'a stale rhythm is refused, not printed')
})
