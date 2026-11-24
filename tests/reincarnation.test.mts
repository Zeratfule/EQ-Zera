// PURE unit tests for reincarnation (shared/reincarnation*.ts and the leveling surfaces that read it).
//
// No log, no fixture, no DOM. The reincarnation EVENTS here are synthetic — no real reincarnation has
// been logged yet, and the engine's own tests (engine/crates/fold/tests/reincarnation.rs) pin the
// assumed grant-line shape. What is pinned here:
//
//   1. THE REPORTED XP RULE: the worst component sets the rate (3/2/1/0 → 1.3, never 1.6), capped at 4x.
//   2. THE RECORD NEVER DECREASES: merging is a union by instant, a rank reached counts, a
//      correction wins, and the stored shape is a sanitizer fixed point.
//   3. THE ETA IS NOT BLOCKED AT LEVEL 1: a reincarnation after the cap's ding anchors the bar.
//   4. A REINCARNATION IS NOT A SWAP on the level series, and the history walk never mixes lives.
//
// Imported RELATIVELY: node tests run through tsx with no `@shared` / `@renderer` aliases.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { componentPenalty, xpRequirement } from '../src/shared/reincarnationXp'
import {
  applyCorrection,
  EMPTY_RECORD,
  hasNewLives,
  mergeLives,
  reincarnationAas,
  reincarnationCounts,
  sanitizeReincarnationRecord,
  type ReincarnationEvent,
  type ReincarnationGrant
} from '../src/shared/reincarnation'
import { reLevelForecast } from '../src/shared/reincarnationForecast'
import { reincarnationSummary } from '../src/shared/reincarnationSummary'
import { dingStatement } from '../src/shared/currentLevel'
import { levelEta } from '../src/shared/levelEta'
import { rangeStats } from '../src/shared/progressionStats'
import { recentLevelSpans } from '../src/renderer/src/features/overview/overviewLevelingData'
import {
  buildLevelSegments,
  swapCount,
  withRebirths,
  type LevelPoint
} from '../src/renderer/src/features/leveling/levelSeries'
import { buildFeed } from '../src/renderer/src/features/leveling/levelFeed'
import type { ProgressionSnap } from '../src/shared/progressionTypes'

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = Date.parse('Sat Nov 21 12:00:00 2026')

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

const cls = (name: string, rank = 1): ReincarnationGrant => ({ component: 'class', name, rank })
const race = (name: string, rank = 1): ReincarnationGrant => ({ component: 'race', name, rank })

function event(ts: number, grants: ReincarnationGrant[], inferred = false): ReincarnationEvent {
  return { ts, lo: ts, hi: ts, source: inferred ? 'levelDrop' : 'aa', inferred, grants }
}

// ── 1. the reported XP rule ────────────────────────────────────────────────────────────────────

test('the worst component sets the rate: counts 3/2/1/0 is +30%, not +60%', () => {
  const req = xpRequirement([
    { component: 'class', name: 'Paladin', count: 3 },
    { component: 'class', name: 'Monk', count: 2 },
    { component: 'class', name: 'Enchanter', count: 1 },
    { component: 'race', name: 'Dark Elf', count: 0 }
  ])
  assert.equal(req.multiplier, 1.3)
  assert.equal(req.setBy?.name, 'Paladin')
})

test('the penalty is capped at +300% (4x base) and a fresh loadout is base', () => {
  assert.equal(componentPenalty(40), 3)
  assert.equal(xpRequirement([{ component: 'class', name: 'Warrior', count: 40 }]).multiplier, 4)
  const base = xpRequirement([{ component: 'class', name: 'Warrior', count: 0 }])
  assert.equal(base.multiplier, 1)
  assert.equal(base.setBy, null)
})

// ── 2. the record ─────────────────────────────────────────────────────────────────────────────

test('merging is a union by instant: a re-fold adds nothing, a rotated log removes nothing', () => {
  const life1 = event(1000, [cls('Paladin'), cls('Monk'), cls('Enchanter'), race('Dark Elf')])
  const held = mergeLives([], [life1])
  assert.equal(mergeLives(held, [life1]).length, 1, 'the same instant twice is one life')
  assert.equal(mergeLives(held, []).length, 1, 'an empty (rotated) log removes nothing')
  assert.equal(hasNewLives(held, [life1]), false)
  const possible = event(5000, [], true)
  assert.equal(mergeLives(held, [possible]).length, 1, 'an inferred event is never persisted')
})

test('a count is the larger of the lives seen and the rank printed, and a correction wins', () => {
  // The app saw only the THIRD Paladin reincarnation: rank 3 still means three.
  const record = { lives: mergeLives([], [event(1000, [cls('Paladin', 3), race('Dark Elf', 1)])]), corrections: [] }
  const counts = reincarnationCounts(record)
  assert.equal(counts.find((c) => c.name === 'Paladin')?.count, 3)
  const stated = applyCorrection(record, { component: 'class', name: 'paladin', count: 5, setAt: 9 })
  const after = reincarnationCounts(stated).find((c) => c.name === 'Paladin')
  assert.deepEqual([after?.count, after?.source], [5, 'user'])
  const undone = applyCorrection(stated, { component: 'class', name: 'Paladin', count: null, setAt: 10 })
  assert.equal(reincarnationCounts(undone).find((c) => c.name === 'Paladin')?.source, 'log')
})

test('the stored record is validated and a sanitizer fixed point', () => {
  const dirty = {
    lives: [{ ts: 2, grants: [cls('Monk'), { component: 'nope', name: 'x', rank: 1 }] }, { ts: 'bad' }],
    corrections: [{ component: 'race', name: 'dark elf', count: 2, setAt: 1 }, { component: 'class', name: 'X', count: -1, setAt: 1 }]
  }
  const once = sanitizeReincarnationRecord(dirty)
  assert.equal(once.lives.length, 1)
  assert.equal(once.lives[0].grants.length, 1)
  assert.deepEqual(once.corrections.map((c) => c.name), ['Dark Elf'])
  assert.deepEqual(sanitizeReincarnationRecord(once), once)
  assert.deepEqual(sanitizeReincarnationRecord(undefined), EMPTY_RECORD)
})

test('Completionist is the lowest class rank over all sixteen class AAs', () => {
  const lives = mergeLives([], [event(1, [cls('Paladin', 3), cls('Monk', 2), race('Dark Elf')])])
  const aas = reincarnationAas(reincarnationCounts({ lives, corrections: [] }))
  assert.equal(aas.completionist, 0)
  assert.equal(aas.classesTowardNext, 2)
  assert.equal(aas.rows.find((r) => r.name === 'Paladin')?.rank, 3)
})

// ── 3. the level and the ETA at level 1 ───────────────────────────────────────────────────────

/** Life 1 capped at 50 with at-cap lines, then a reincarnation and stated exp in life 2. */
function rebornSnap(): ProgressionSnap {
  const s = emptySnap()
  s.levelTs.push(T0 - 5 * HOUR)
  s.levelValue.push(50)
  for (let ts = T0 - 4 * HOUR; ts < T0 - 2 * HOUR; ts += 10 * MIN) {
    s.expTs.push(ts)
    s.expPct.push(-1)
    s.expFlag.push(1)
  }
  s.rebirthTs = [T0 - 90 * MIN]
  for (let ts = T0 - 80 * MIN; ts < T0; ts += MIN) {
    s.expTs.push(ts)
    s.expPct.push(0.5)
    s.expFlag.push(0)
    s.killTs.push(ts)
    s.killZone.push(0)
    s.killCredit.push(0)
  }
  s.zoneStart.push(T0 - 6 * HOUR)
  s.zoneEnd.push(0)
  s.zoneName.push('Overthere')
  s.lastTs = T0
  return s
}

test('a reincarnation after the cap states level 1 and the ETA is not blocked', () => {
  const snap = rebornSnap()
  assert.deepEqual(dingStatement(snap), { level: 1, ts: T0 - 90 * MIN, source: 'reincarnation' })
  const stats = rangeStats({ snap, range: { t0: T0 - HOUR, t1: T0 } })
  const eta = levelEta(snap, stats, dingStatement(snap))
  assert.equal(eta.blocked, null)
  if (eta.blocked === null) assert.equal(eta.toLevel, 2)
  // A `/who` typed after it, stating level 1, agrees with the anchor: no "swapped" refusal.
  const who = { level: 1, ts: T0 - 30 * MIN, source: 'who' as const }
  assert.equal(levelEta(snap, stats, who).blocked, null)
})

// ── 4. the level series ───────────────────────────────────────────────────────────────────────

test('a confirmed reincarnation opens a life, never a swap, and its 1->2 bar is timed from it', () => {
  const dings: LevelPoint[] = [
    { ts: 1000, level: 49 },
    { ts: 2000, level: 50 },
    { ts: 9000, level: 2 }
  ]
  const series = withRebirths(dings, [event(5000, [cls('Paladin'), race('Dark Elf')])])
  const segments = buildLevelSegments(series)
  assert.equal(swapCount(segments), 0)
  assert.equal(segments[1].rebirth?.life, 2)
  assert.equal(segments[1].afterSwap, false)
  const feed = buildFeed(series, [])
  assert.equal(feed.find((f) => f.kind === 'rebirth')?.label, 'Reincarnated (life 2)')
  // timed from the reincarnation (4 s), never across the life before it
  assert.ok(feed.find((f) => f.label === 'Level 2')?.detail.startsWith('+'))
  assert.ok(!feed.some((f) => f.kind === 'swap'))
})

test('an inferred reincarnation marks the fresh ding as possible', () => {
  const dings: LevelPoint[] = [{ ts: 1000, level: 50 }, { ts: 9000, level: 2 }]
  const inferred: ReincarnationEvent = { ts: 9000, lo: 1000, hi: 9000, source: 'levelDrop', inferred: true, grants: [] }
  const segments = buildLevelSegments(withRebirths(dings, [inferred]))
  assert.equal(segments[1].rebirth?.inferred, true)
  assert.equal(swapCount(segments), 0)
})

test('the per-level history never mixes lives', () => {
  const s = emptySnap()
  s.levelTs.push(1 * HOUR, 2 * HOUR, 3 * HOUR, 5 * HOUR, 6 * HOUR)
  s.levelValue.push(48, 49, 50, 2, 3)
  s.rebirthTs = [4 * HOUR]
  const spans = recentLevelSpans(s)
  assert.deepEqual(spans.map((x) => [x.fromLevel, x.toLevel, x.ms]), [[1, 2, HOUR], [2, 3, HOUR]])
  // Right after reincarnating there is no completed level in this life at all.
  const fresh = emptySnap()
  fresh.levelTs.push(HOUR, 2 * HOUR)
  fresh.levelValue.push(49, 50)
  fresh.rebirthTs = [3 * HOUR]
  assert.deepEqual(recentLevelSpans(fresh), [])
})

// ── 5. the re-level forecast ──────────────────────────────────────────────────────────────────

test('the re-level forecast scales the last life by the multiplier ratio, and hides when thin', () => {
  const s = emptySnap()
  for (let level = 1; level <= 50; level++) {
    s.levelTs.push(level * HOUR)
    s.levelValue.push(level)
  }
  s.rebirthTs = [60 * HOUR]
  const f = reLevelForecast(s, 1, 1.1)
  assert.ok(f)
  assert.equal(f.levels, 49)
  assert.ok(Math.abs(f.ms - 49 * HOUR * 1.1) < 1)
  const thin = emptySnap()
  thin.levelTs.push(HOUR, 2 * HOUR)
  thin.levelValue.push(49, 50)
  thin.rebirthTs = [3 * HOUR]
  assert.equal(reLevelForecast(thin, 1, 1.1), null)
})

test('the summary reads the active loadout and labels the worst component', () => {
  const ev = event(1000, [cls('Paladin'), cls('Monk'), cls('Enchanter'), race('Dark Elf')])
  const record = applyCorrection(EMPTY_RECORD, { component: 'class', name: 'Paladin', count: 3, setAt: 1 })
  const s = reincarnationSummary({ record, events: [ev], classCodes: ['PAL', 'MNK', 'ENC'], prog: emptySnap(), currentLevel: 1 })
  assert.equal(s.requirement.multiplier, 1.3)
  assert.equal(s.requirement.setBy?.name, 'Paladin')
  assert.equal(s.raceUnknown, false)
  assert.equal(s.forecast, null, 'no previous life on record, so no forecast')
})
