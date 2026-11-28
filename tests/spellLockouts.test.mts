// THE DIRGE LOCKOUT (2026-11-27) — how one landing row reads against the wall clock.
//
// Detection (rank-blind, one timer per burst, resists/other bards/quoted lines/backfill ignored) is
// the engine's: engine/crates/fold/tests/spell_lockouts.rs. This suite pins the phases, the idle
// rows and the labels. Pure, never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCKOUT_LINGER_MS,
  idleLockoutRules,
  lockoutRankLabel,
  lockoutReading,
  lockoutTargetsLabel,
  lockoutTimeLabel,
  shownLockouts,
  type SpellLockout,
  type SpellLockoutsSnap
} from '../src/shared/spellLockouts.ts'
import { fmtDuration } from '../src/renderer/src/features/buffs/format.ts'

const T0 = 1_800_000_000_000
const DDD = "Denon's Desperate Dirge"

function lockout(over: Partial<SpellLockout> = {}): SpellLockout {
  return {
    spell: DDD,
    castName: `${DDD} VII`,
    startedTs: T0,
    earliestMs: 12_000,
    certainMs: 18_000,
    count: 3,
    targets: [
      { name: 'an ice giant', count: 2 },
      { name: 'a priest of Nagafen', count: 1 }
    ],
    ...over
  }
}

test('locked until earliest, maybe until certain, ready after', () => {
  const l = lockout()
  assert.equal(lockoutReading(l, T0)?.phase, 'locked')
  assert.equal(lockoutReading(l, T0)?.remainingMs, 12_000)
  assert.equal(lockoutReading(l, T0 + 11_999)?.phase, 'locked')
  assert.equal(lockoutReading(l, T0 + 12_000)?.phase, 'maybe')
  assert.equal(lockoutReading(l, T0 + 12_000)?.remainingMs, 6_000)
  assert.equal(lockoutReading(l, T0 + 17_999)?.phase, 'maybe')
  assert.equal(lockoutReading(l, T0 + 18_000)?.phase, 'ready')
  assert.equal(lockoutReading(l, T0 + 18_000)?.remainingMs, 0)
})

test('a ready row lingers, then is gone', () => {
  const l = lockout()
  assert.equal(lockoutReading(l, T0 + 18_000 + LOCKOUT_LINGER_MS)?.phase, 'ready')
  assert.equal(lockoutReading(l, T0 + 18_001 + LOCKOUT_LINGER_MS), null)
})

test('a stamp ahead of the local clock reads as just landed', () => {
  const r = lockoutReading(lockout(), T0 - 2_000)
  assert.equal(r?.phase, 'locked')
  assert.equal(r?.remainingMs, 12_000)
  assert.equal(r?.fraction, 0)
})

test('the bar fraction runs to certain and the notch sits at earliest', () => {
  const r = lockoutReading(lockout(), T0 + 9_000)
  assert.equal(r?.fraction, 0.5)
  assert.equal(r?.earliestFraction, 12 / 18)
})

test('shown rows are oldest first and drop expired ones; idle rules fill in the rest', () => {
  const snap: SpellLockoutsSnap = {
    rules: [{ spell: DDD, earliestMs: 12_000, certainMs: 18_000 }],
    active: [lockout({ startedTs: T0 + 5_000 }), lockout(), lockout({ startedTs: T0 - 60_000 })]
  }
  const shown = shownLockouts(snap, T0 + 6_000)
  assert.deepEqual(
    shown.map((s) => s.lockout.startedTs),
    [T0, T0 + 5_000]
  )
  assert.deepEqual(idleLockoutRules(snap, shown), [])
  const later = shownLockouts(snap, T0 + 60_000)
  assert.deepEqual(later, [])
  assert.deepEqual(
    idleLockoutRules(snap, later).map((r) => r.spell),
    [DDD]
  )
})

test('labels: targets, rank and time', () => {
  const l = lockout()
  assert.equal(lockoutTargetsLabel(l), 'an ice giant x2, a priest of Nagafen')
  assert.equal(lockoutRankLabel(l), 'VII')
  assert.equal(lockoutRankLabel(lockout({ castName: DDD })), null)
  const at = (ms: number): string => {
    const r = lockoutReading(l, T0 + ms)
    assert.ok(r)
    return lockoutTimeLabel(r, fmtDuration)
  }
  assert.equal(at(0), 'locked 12s')
  assert.equal(at(2_500), 'locked 10s')
  assert.equal(at(13_000), 'maybe 5s')
  assert.equal(at(19_000), 'ready')
})
