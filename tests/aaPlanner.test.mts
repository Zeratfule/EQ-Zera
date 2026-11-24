// aaPlanner.test.mts — the AA planner's arithmetic and its stored plan (src/shared/aaPlanner.ts,
// src/shared/aaPlanStore.ts): held ranks from the log ledger plus the user's own marks, cost and
// shortfall, the estimate, requirement checks, and a stored plan read back through validation.
// Entries are hand-built in the catalog's shape; the ledger rows are `aaLedger` over real-shaped
// purchase lines (tests/fixtures/e2e-leveling.log carries the same shapes).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AaCatalogEntry } from '../src/shared/aaCatalog'
import { aaLedger } from '../src/shared/aaLedger'
import { catalogIndex, evaluatePlan, heldRanks, nextRankCost, plannerSections, rowBlocked, spanCost } from '../src/shared/aaPlanner'
import {
  aaPlanStorageKey,
  EMPTY_AA_PLAN,
  moveStep,
  parseStoredPlan,
  planText,
  serializePlan,
  setStated,
  setTarget,
  targetOf
} from '../src/shared/aaPlanStore'

function aa(name: string, over: Partial<AaCatalogEntry> = {}): AaCatalogEntry {
  return {
    name,
    section: 'general',
    maxRank: 3,
    costs: [3, 6, 9],
    description: '',
    req: { levels: [1], prereqs: [], pointsSpent: null, raw: 'Level 1', unparsed: [] },
    ...over
  }
}

const FURY = aa('Fury of Magic', { section: 'archetype', maxRank: 4, costs: [1, 2, 3, 4] })
const DFURY = aa('Destructive Fury', {
  section: 'archetype',
  costs: [2, 4, 6],
  req: { levels: [1], prereqs: [{ name: 'Fury of Magic', ranks: [1] }], pointsSpent: null, raw: 'Level 1, Fury of Magic at Level 1', unparsed: [] }
})
const CASCADE = aa('Destructive Cascade', {
  section: 'archetype',
  req: { levels: [1], prereqs: [{ name: 'Critical Affliction', ranks: [1, 2, 3] }], pointsSpent: null, raw: 'Level 1', unparsed: [] }
})
const TURN = aa('Turn Summoned', { section: 'class', classes: ['MAG'], costs: [3, 6, null], req: { levels: [45, 59, 59], prereqs: [], pointsSpent: null, raw: 'Level 45', unparsed: [] } })
const SYMPH = aa('Symphonic Aura', { section: 'class', classes: ['BRD'], maxRank: 5, costs: [0, 3, 3, 3, 3] })
const GATED = aa('Gated Thing', { maxRank: 1, costs: [5], req: { levels: [], prereqs: [], pointsSpent: 40, raw: 'Must spend 40 ability points', unparsed: [] } })
const REINC = aa('Class Reincarnation: Bard', { section: 'special', costs: [], granted: 'reincarnation', rankValues: ['3', '6', '9'] })
const REMOVED = aa('Valiant Steed', { section: 'class', classes: ['PAL'], maxRank: 1, costs: [9], removed: true })
const CATALOG = [FURY, DFURY, CASCADE, TURN, SYMPH, GATED, REINC, REMOVED]
const INDEX = catalogIndex(CATALOG)

const SPENDS = [
  { ts: 1, ability: 'Fury of Magic', cost: 1 },
  { ts: 2, ability: 'Fury of Magic 2', cost: 2, rank: 2 },
  // A toggle AA prints its state into the name; the auto-granted rank 1 still counts as held.
  { ts: 3, ability: 'Symphonic Aura: Enabled', cost: 0 },
  { ts: 4, ability: 'Something Off The Wiki', cost: 3 }
]

test('held: the log ledger joins the catalog (toggle suffix folded, cost-0 grants count); unknown names are listed', () => {
  const { held, unmatched } = heldRanks(aaLedger(SPENDS), {}, INDEX)
  assert.equal(held.get('fury of magic')?.rank, 2)
  assert.equal(held.get('symphonic aura')?.rank, 1)
  assert.deepEqual(unmatched, ['Something Off The Wiki'])
})

test("held: the user's own mark raises a rank the log never saw, and is told apart from the log's", () => {
  const { held } = heldRanks(aaLedger(SPENDS), { 'Fury of Magic': 4, 'Turn Summoned': 1 }, INDEX)
  assert.deepEqual(held.get('fury of magic'), { logged: 2, stated: 4, rank: 4 })
  assert.deepEqual(held.get('turn summoned'), { logged: 0, stated: 1, rank: 1 })
})

test('cost math: ranks above held, unknown ranks counted not priced, next rank, granted never priced', () => {
  assert.deepEqual(spanCost(FURY, 2, 4), { cost: 7, unknownRanks: 0 })
  assert.deepEqual(spanCost(TURN, 0, 3), { cost: 9, unknownRanks: 1 })
  assert.equal(nextRankCost(FURY, 2), 3)
  assert.equal(nextRankCost(FURY, 4), null)
  assert.equal(nextRankCost(REINC, 0), null)
})

test('a plan: cumulative points, shortfall against the bank, and the estimate at the pace', () => {
  const { held } = heldRanks(aaLedger(SPENDS), {}, INDEX)
  const steps = [
    { name: 'Fury of Magic', target: 4 },
    { name: 'Destructive Fury', target: 2 }
  ]
  const { rows, totals } = evaluatePlan(steps, INDEX, held, { level: 50, banked: 5, allocated: 3, pointsPerHour: 2 })
  assert.deepEqual(
    rows.map((r) => [r.name, r.from, r.to, r.cost, r.cumulative, r.shortfall]),
    [
      ['Fury of Magic', 2, 4, 7, 7, 2],
      ['Destructive Fury', 0, 2, 6, 13, 8]
    ]
  )
  assert.equal(rows[0].etaMs, 3_600_000, '2 points short at 2 an hour is an hour')
  assert.deepEqual(totals, { needed: 13, unknownRanks: 0, banked: 5, shortfall: 8, etaMs: 4 * 3_600_000 })
  const noPace = evaluatePlan(steps, INDEX, held, { level: 50, banked: 5, allocated: 3, pointsPerHour: null })
  assert.equal(noPace.totals.etaMs, null, 'no pace, no estimate')
  const rich = evaluatePlan(steps, INDEX, held, { level: 50, banked: 20, allocated: 3, pointsPerHour: null })
  assert.equal(rich.totals.shortfall, 0)
  assert.equal(rich.totals.etaMs, 0, 'affordable now needs no pace')
})

test('requirement checks: level met/unmet/unknown, prerequisite held or reached by an earlier step', () => {
  const held = heldRanks([], {}, INDEX).held
  const ctx = { level: 46, banked: 0, allocated: 0, pointsPerHour: null }
  const turn = evaluatePlan([{ name: 'Turn Summoned', target: 2 }], INDEX, held, ctx).rows[0]
  assert.deepEqual(turn.checks[0], { kind: 'level', status: 'unmet', label: 'needs level 59' })
  assert.equal(rowBlocked(turn), true)
  const turn1 = evaluatePlan([{ name: 'Turn Summoned', target: 1 }], INDEX, held, ctx).rows[0]
  assert.equal(turn1.checks[0].status, 'met')
  const noLevel = evaluatePlan([{ name: 'Turn Summoned', target: 1 }], INDEX, held, { ...ctx, level: null }).rows[0]
  assert.equal(noLevel.checks[0].status, 'unknown')
  const gated = evaluatePlan([{ name: 'Gated Thing', target: 1 }], INDEX, held, ctx).rows[0]
  assert.equal(gated.checks[0].status, 'unknown', 'no level stated is unknown, never met')

  const before = evaluatePlan([{ name: 'Destructive Fury', target: 1 }], INDEX, held, ctx).rows[0]
  assert.equal(before.checks[1].status, 'unmet', 'Fury of Magic is not held')
  const after = evaluatePlan(
    [
      { name: 'Fury of Magic', target: 1 },
      { name: 'Destructive Fury', target: 1 }
    ],
    INDEX,
    held,
    ctx
  ).rows[1]
  assert.deepEqual(after.checks[1], { kind: 'prereq', status: 'met', label: 'needs Fury of Magic rank 1 (step 1)' })
  const cascade = evaluatePlan([{ name: 'Destructive Cascade', target: 3 }], INDEX, held, ctx).rows[0]
  assert.equal(cascade.checks[1].status, 'unknown', 'a prerequisite the catalog lacks is unknown')
  assert.match(cascade.checks[1].label, /rank 3/, 'per-rank prerequisites take the highest rank planned')
})

test('requirement checks: a points-spent gate counts points already allocated plus earlier steps', () => {
  const held = heldRanks([], {}, INDEX).held
  const steps = [
    { name: 'Fury of Magic', target: 4 },
    { name: 'Gated Thing', target: 1 }
  ]
  const short = evaluatePlan(steps, INDEX, held, { level: 50, banked: 0, allocated: 29, pointsPerHour: null }).rows[1]
  assert.equal(short.checks.find((c) => c.kind === 'points')?.status, 'unmet', '29 + 10 < 40')
  const enough = evaluatePlan(steps, INDEX, held, { level: 50, banked: 0, allocated: 30, pointsPerHour: null }).rows[1]
  assert.equal(enough.checks.find((c) => c.kind === 'points')?.status, 'met')
})

test('sections: the trio cuts class AAs, removed rows never show, archetype and special always do, search filters', () => {
  const names = (classes: ('MAG' | 'BRD' | 'PAL')[], q = ''): string[] =>
    plannerSections(CATALOG, classes, q).flatMap((s) => s.entries.map((e) => e.name))
  assert.ok(names(['MAG']).includes('Turn Summoned'))
  assert.ok(!names(['MAG']).includes('Symphonic Aura'))
  assert.ok(!names(['PAL']).includes('Valiant Steed'))
  assert.ok(names([]).includes('Symphonic Aura'), 'an unknown trio shows every class AA')
  assert.ok(names(['MAG']).includes('Destructive Fury') && names(['MAG']).includes('Class Reincarnation: Bard'))
  assert.deepEqual(names(['MAG'], 'fury'), ['Destructive Fury', 'Fury of Magic'])
  assert.deepEqual(
    plannerSections(CATALOG, ['MAG'], '').map((s) => s.section),
    ['general', 'archetype', 'class', 'special']
  )
})

test('plan edits: add at the end, keep place, remove at/below held, granted never added, reorder', () => {
  let plan = setTarget(EMPTY_AA_PLAN, FURY, 3, 2)
  plan = setTarget(plan, DFURY, 1, 0)
  plan = setTarget(plan, FURY, 4, 2)
  assert.deepEqual(plan.steps, [
    { name: 'Fury of Magic', target: 4 },
    { name: 'Destructive Fury', target: 1 }
  ])
  assert.equal(setTarget(plan, REINC, 2, 0), plan, 'a reincarnation AA is granted, never planned')
  assert.deepEqual(moveStep(plan, 1, -1).steps.map((s) => s.name), ['Destructive Fury', 'Fury of Magic'])
  assert.equal(moveStep(plan, 0, -1), plan)
  assert.deepEqual(setTarget(plan, FURY, 2, 2).steps.map((s) => s.name), ['Destructive Fury'])
  assert.equal(targetOf(plan, 'fury of magic'), 4)
  const marked = setStated(plan, FURY, 3)
  assert.deepEqual(marked.stated, { 'Fury of Magic': 3 })
  assert.deepEqual(setStated(marked, FURY, 0).stated, {})
})

test('persistence: round trip, and a stored value DEGRADES - bad JSON, wrong version, unknown or granted AAs, over-max targets', () => {
  const plan = { steps: [{ name: 'Fury of Magic', target: 4 }], stated: { 'Turn Summoned': 1 } }
  assert.deepEqual(parseStoredPlan(serializePlan(plan), INDEX), plan)
  assert.deepEqual(parseStoredPlan(null, INDEX), EMPTY_AA_PLAN)
  assert.deepEqual(parseStoredPlan('{not json', INDEX), EMPTY_AA_PLAN)
  assert.deepEqual(parseStoredPlan(JSON.stringify({ v: 99, steps: plan.steps }), INDEX), EMPTY_AA_PLAN)
  const dirty = JSON.stringify({
    v: 1,
    steps: [
      { name: 'fury of magic', target: 99 },
      { name: 'Fury of Magic', target: 1 },
      { name: 'Gone From The Wiki', target: 1 },
      { name: 'Class Reincarnation: Bard', target: 2 },
      { name: 'Valiant Steed', target: 1 },
      { name: 'Turn Summoned', target: 0 },
      { name: 'Destructive Fury', target: 1.5 },
      'junk',
      null
    ],
    stated: { 'Turn Summoned': 9, 'Fury of Magic': 2, Nope: 1, 'Class Reincarnation: Bard': 2 }
  })
  assert.deepEqual(parseStoredPlan(dirty, INDEX), {
    steps: [{ name: 'Fury of Magic', target: 4 }],
    stated: { 'Fury of Magic': 2, 'Class Reincarnation: Bard': 2 }
  })
  assert.equal(aaPlanStorageKey({ name: 'Primitive', server: 'freeport' }), 'eq.aa.plan.primitive@freeport')
  assert.equal(aaPlanStorageKey(null), null)
})

test('plan as text names each step, its cost, the totals and the estimate', () => {
  const held = heldRanks([], {}, INDEX).held
  const { rows, totals } = evaluatePlan([{ name: 'Turn Summoned', target: 3 }], INDEX, held, { level: 46, banked: 1, allocated: 0, pointsPerHour: 4 })
  const text = planText(rows, totals)
  assert.match(text, /1\. Turn Summoned 0 -> 3: 9 pts \+ 1 rank\(s\) of unknown cost \(total 9\) \[blocked: needs level 59\]/)
  assert.match(text, /Needed 9 pts, banked 1, short 8\./)
  assert.match(text, /Estimated 2h 00m at the current pace\./)
})
