// THE MULTI-ATTACK PANEL'S WORDS (JOS-37; the engine half is docs/plans/attack-round-stats.md).
//
// The engine's counters are pinned in tests/combatRoundStats.test.mts. This pins what the panel
// SAYS about them, because that is where the honesty actually lands: a per-attack-type rate
// offered without its denominator, or a dual-wieldable verb presented as a measured double-attack
// rate, would be a lie the counters themselves are innocent of.
//
// It replaces roundRows.test.mts. The old panel's four tooltips (the lane tier, the riposte
// asymmetry, the flurry denominator, the exclusion list) are gone with the readouts they
// explained — the TOOLTIP AND CAVEAT DIET is what this ticket is enforcing, and the whole
// stated-vs-inferred tier is now one word, `est.`, which is asserted below.
//
// RELATIVE value import, like procRows.test.mts: node tests resolve no `@shared/*` alias for
// values (multiAttackRows.ts imports that alias type-only, which tsx strips).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flurryText, multiAttackRows } from '../src/renderer/src/features/combat/multiAttackRows'
import type { RoundLaneView, SourceRoundsView } from '../src/shared/combat'

function laneOf(o: Partial<RoundLaneView> & { verb: string; buckets: number[] }): RoundLaneView {
  const rounds = o.rounds ?? o.buckets.reduce((n, v) => n + v, 0)
  const multi = o.multiRounds ?? o.buckets.slice(1).reduce((n, v) => n + v, 0)
  return {
    label: o.verb.charAt(0).toUpperCase() + o.verb.slice(1),
    rounds,
    multiRounds: multi,
    multiPct: rounds > 0 ? (multi / rounds) * 100 : 0,
    fannedRounds: 0,
    confidence: 'aggregate',
    ...o
  }
}

function viewOf(o: Partial<SourceRoundsView> & { lanes: RoundLaneView[] }): SourceRoundsView {
  return {
    primaryRounds: o.lanes.reduce((n, l) => n + l.rounds, 0),
    excluded: { frenzy: 0, riposte: 0, flurry: 0, rampage: 0 },
    modifiers: [],
    ripostesGiven: 0,
    riposteLanded: 0,
    riposteDamage: 0,
    ripostesTaken: 0,
    rampagesTaken: 0,
    flurries: 0,
    flurryPct: 0,
    ...o
  }
}

// The w49 backstab lane, verbatim from the engine: 6 single / 4 double / 1 triple.
const BACKSTAB = laneOf({ verb: 'backstab', label: 'Backstab', buckets: [6, 4, 1, 0], confidence: 'perEvent' })
const SLASH = laneOf({ verb: 'slash', label: 'Melee', buckets: [18, 10, 5, 2] })

test('every lane states how often it doubled and tripled, over its OWN rounds', () => {
  const [bs, sl] = multiAttackRows(viewOf({ lanes: [BACKSTAB, SLASH] }))
  assert.equal(bs.rounds, 11, 'the denominator is rounds, and it is on the row')
  assert.equal(Math.round(bs.doubledPct), 36, '4 of 11')
  assert.equal(Math.round(bs.tripledPct), 9, '1 of 11')
  assert.equal(bs.quadPct, 0)
  assert.equal(bs.text, '36% doubled · 9% tripled')
  // The quad+ bucket only appears when the lane actually reached it.
  assert.equal(sl.rounds, 35)
  assert.equal(sl.text, '29% doubled · 14% tripled · 6% quad+')
})

test('a bucket that never fired is ABSENT from the run, never a 0%', () => {
  const [row] = multiAttackRows(viewOf({ lanes: [laneOf({ verb: 'kick', buckets: [40, 6, 0, 0] })] }))
  assert.equal(row.text, '13% doubled')
  assert.equal(row.tripledPct, 0)
})

test('a lane that never multi-attacked says so in words, not in zeroes', () => {
  const [row] = multiAttackRows(viewOf({ lanes: [laneOf({ verb: 'punch', buckets: [3, 0, 0, 0] })] }))
  assert.equal(row.text, 'never multi-attacked')
  assert.equal(row.doubledPct, 0)
})

test('`est.` marks the dual-wieldable verbs, and ONLY them — the whole honesty tier, one word', () => {
  const [bs, sl] = multiAttackRows(viewOf({ lanes: [BACKSTAB, SLASH] }))
  assert.equal(bs.estimated, false, 'a reuse-timer lane cannot have an off-hand in the same second')
  assert.equal(sl.estimated, true, 'a weapon verb may only be read in aggregate — dual wield')
})

test('the bar ranks lanes against the biggest, and a round-less lane never draws', () => {
  const empty = laneOf({ verb: 'bash', buckets: [0, 0, 0, 0] })
  const rows = multiAttackRows(viewOf({ lanes: [SLASH, BACKSTAB, empty] }))
  assert.deepEqual(
    rows.map((r) => r.verb),
    ['slash', 'backstab'],
    '0 rounds ⇒ no row at all'
  )
  assert.equal(rows[0].pct, 100)
  assert.ok(rows[1].pct < 100)
})

test('flurry is stated ONCE for the source — the log never says which verb flurried', () => {
  assert.equal(flurryText(viewOf({ lanes: [BACKSTAB] })), null, 'no flurries ⇒ no line at all')
  assert.equal(
    flurryText(viewOf({ lanes: [BACKSTAB], flurries: 3, flurryPct: 1.7647 })),
    'flurry ×3 · 1.8% of rounds'
  )
})
