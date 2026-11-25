// aaRankCaps.test.mts — the per-class rank cap (src/shared/aaRankCaps.ts) and its enforcement in
// the planner (src/shared/aaPlanner.ts evaluatePlan). The table is hand-authored from one wiki
// sentence, so the first test re-reads the committed catalog and fails when the sentence moves.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AaCatalogData } from '../src/shared/aaCatalog'
import { AA_CLASS_CAPS, rankCapFor } from '../src/shared/aaRankCaps'
import { catalogIndex, evaluatePlan, heldRanks, rowBlocked } from '../src/shared/aaPlanner'

const CATALOG = JSON.parse(readFileSync(new URL('../src/renderer/src/data/eqlegends/aaCatalog.json', import.meta.url), 'utf8')) as AaCatalogData
const INDEX = catalogIndex(CATALOG.entries)
const WILL = INDEX.get('steadfast will')

test('TRIPWIRE: every cap rule names a catalog AA whose description still carries the rule sentence', () => {
  for (const rule of AA_CLASS_CAPS) {
    const e = INDEX.get(rule.name.toLowerCase())
    assert.ok(e, `${rule.name} is in the catalog`)
    assert.ok(e.description.includes(rule.evidence), `${rule.name}: the description still states the caps`)
    const all = [rule.otherwise, ...Object.values(rule.byClass)]
    assert.ok(Math.max(...all) <= e.maxRank, 'no cap above the catalog max rank')
  }
})

test('Steadfast Will: tanks 8, rangers and monks 7, everyone else 6; a loadout takes its best class', () => {
  assert.ok(WILL)
  assert.equal(WILL.maxRank, 8)
  assert.equal(rankCapFor(WILL, ['WAR', 'ENC', 'WIZ'], 3).cap, 8)
  assert.equal(rankCapFor(WILL, ['SHD'], 1).cap, 8)
  assert.equal(rankCapFor(WILL, ['MNK', 'BRD', 'SHM'], 3).cap, 7)
  assert.equal(rankCapFor(WILL, ['RNG', 'DRU'], 2).cap, 7)
  const caster = rankCapFor(WILL, ['ENC', 'WIZ', 'NEC'], 3)
  assert.deepEqual([caster.cap, caster.limited, caster.certain], [6, true, true])
})

test('an unknown class slot makes the cap uncertain: nothing is enforced and the range is said', () => {
  assert.ok(WILL)
  const partial = rankCapFor(WILL, ['ENC', 'WIZ'], 3)
  assert.deepEqual([partial.cap, partial.certain, partial.range], [8, false, [6, 8]])
  const none = rankCapFor(WILL, [], 0)
  assert.deepEqual([none.cap, none.certain], [8, false])
})

test('an AA with no rule caps at its catalog max', () => {
  const other = CATALOG.entries.find((e) => e.name === 'Innate Regeneration')
  assert.ok(other)
  assert.deepEqual(rankCapFor(other, ['ENC'], 1), { cap: other.maxRank, limited: false, certain: true, range: null, evidence: null })
})

test('THE PLANNER ENFORCES IT: a target past the cap is priced to the cap and the step is blocked, saying why', () => {
  const { held } = heldRanks([], {}, INDEX)
  const ctx = { level: 50, banked: 100, allocated: 0, pointsPerHour: null, classes: ['MNK', 'BRD', 'SHM'] as const, slots: 3 }
  const { rows } = evaluatePlan([{ name: 'Steadfast Will', target: 8 }], INDEX, held, { ...ctx, classes: [...ctx.classes] })
  assert.equal(rows[0].to, 7)
  assert.equal(rows[0].cost, 2 + 2 + 3 + 3 + 3 + 3 + 6, 'rank 8 (12 pts) is not priced')
  assert.ok(rowBlocked(rows[0]))
  assert.ok(rows[0].checks.some((c) => c.kind === 'cap' && c.status === 'unmet' && c.label === 'your classes cap this at rank 7'))
  const ok = evaluatePlan([{ name: 'Steadfast Will', target: 7 }], INDEX, held, { ...ctx, classes: [...ctx.classes] }).rows[0]
  assert.equal(rowBlocked(ok), false)
  const tank = evaluatePlan([{ name: 'Steadfast Will', target: 8 }], INDEX, held, { ...ctx, classes: ['WAR', 'BRD', 'SHM'] }).rows[0]
  assert.deepEqual([tank.to, rowBlocked(tank)], [8, false])
  const unknown = evaluatePlan([{ name: 'Steadfast Will', target: 8 }], INDEX, held, { ...ctx, classes: ['BRD'], slots: 3 }).rows[0]
  assert.equal(unknown.to, 8)
  assert.ok(unknown.checks.some((c) => c.kind === 'cap' && c.status === 'unknown'))
})
