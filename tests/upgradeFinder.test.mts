// THE UPGRADE FINDER (EQ Zera): one row against the worn set, and the zones that would sell you
// the rows that win.
//
// The `row()` helper is buildOptimizer.test.mts's, grown a `wikiSources` field — the same fixture
// idiom for the same reason: every fact asserted here is the function's own, over items small
// enough to do the arithmetic by hand.
//
// WHAT IS PINNED, and each one is a refusal the feature would otherwise get wrong:
//   * the BEST cell wins and NAMES itself (a ring beats the weaker of two worn rings);
//   * an item already worn in one paired cell is judged against the OTHER one;
//   * a cell whose worn item the index could not score gets NO verdict at all (law 1);
//   * an empty cell is `againstNothing`, which is a different sentence from "beats your chest";
//   * a farm zone counts an item ONCE however many of its mobs drop it there.
//
// Pure: no Electron, no DOM. Run: `node --import tsx --test tests/upgradeFinder.test.mts`.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { GearRow } from '../src/shared/planner/gear'
import type { PlanSlotId } from '../src/shared/planner/types'
import { profileWeights } from '../src/shared/build/profiles'
import type { BuildSet, CellUpgrade } from '../src/shared/build/optimizer'
import {
  farmPlan,
  NO_ZONE_STATED,
  upgradeVerdict,
  type FarmSource,
  type UpgradeContext
} from '../src/shared/build/upgradeFinder'
import { unknownCells, wornSet } from '../src/shared/build/wornSet'

function row(
  name: string,
  slots: GearRow['slots'],
  stats: GearRow['stats'],
  extra: { classes?: GearRow['classes']; wikiSources?: GearRow['wikiSources'] } = {}
): GearRow {
  const out: GearRow = {
    key: name.toLowerCase(),
    name,
    searchKey: name.toLowerCase(),
    slots,
    classes: extra.classes ?? [],
    races: ['ALL'],
    flags: [],
    quest: false,
    playerCrafted: false,
    stats,
    effects: []
  }
  if (extra.wikiSources) out.wikiSources = extra.wikiSources
  return out
}

const TANK = profileWeights('tank', ['WAR'])

const PLATE = row('Plate Chest', ['CHEST'], { AC: 30, HP: 20, STA: 5 })
const RING_BIG = row('Big Ring', ['FINGER'], { AC: 10, HP: 20 })
const RING_MID = row('Mid Ring', ['FINGER'], { AC: 5, HP: 15 })
const RING_SMALL = row('Small Ring', ['FINGER'], { AC: 1, HP: 2 })
const CLERIC_ONLY = row('Holy Hat', ['HEAD'], { WIS: 20 }, { classes: ['CLR'] })
const BAG = row('Big Bag', [], { WEIGHT: 1 })

/** A worn set over the cells a test names; every other cell is simply absent (and reads empty). */
function worn(entries: readonly [PlanSlotId, GearRow | null][]): BuildSet {
  return new Map<PlanSlotId, GearRow | null>(entries)
}

function ctx(over: Partial<UpgradeContext> = {}): UpgradeContext {
  return {
    classes: ['WAR'],
    weights: TANK,
    worn: worn([]),
    unknownCells: new Set<PlanSlotId>(),
    ...over
  }
}

// =============================================================================
// 1. THE VERDICT
// =============================================================================

test('a ring beats the WEAKER of two worn rings, and the verdict names that cell', () => {
  const v = upgradeVerdict(RING_BIG, ctx({ worn: worn([['FINGER', RING_MID], ['FINGER2', RING_SMALL]]) }))
  assert.ok(v)
  assert.equal(v.cell, 'FINGER2', 'the bigger gain is against the smaller ring')
  assert.equal(v.againstNothing, false)
  // AC 10 x 12 + HP 20 = 140 against AC 1 x 12 + HP 2 = 14.
  assert.equal(v.score, 140)
  assert.equal(v.currentScore, 14)
  assert.equal(v.delta, 126)
})

test('an item already worn in one paired cell is judged against the OTHER cell', () => {
  const v = upgradeVerdict(RING_BIG, ctx({ worn: worn([['FINGER', RING_BIG], ['FINGER2', RING_SMALL]]) }))
  assert.ok(v, 'a second copy in the other finger is still a real upgrade')
  assert.equal(v.cell, 'FINGER2')
  // …and with the same ring in BOTH hands there is nothing left to say.
  assert.equal(upgradeVerdict(RING_BIG, ctx({ worn: worn([['FINGER', RING_BIG], ['FINGER2', RING_BIG]]) })), null)
})

test('an UNKNOWN cell yields no verdict - a gain against a thing we cannot score is invented', () => {
  const unknown = ctx({ worn: worn([['CHEST', null]]), unknownCells: new Set<PlanSlotId>(['CHEST']) })
  assert.equal(upgradeVerdict(PLATE, unknown), null)
  // The same cell, with the dump naming nothing there, IS an answer.
  assert.ok(upgradeVerdict(PLATE, ctx({ worn: worn([['CHEST', null]]) })))
})

test('an EMPTY cell says so: the whole score is the gain', () => {
  const v = upgradeVerdict(PLATE, ctx({ worn: worn([['CHEST', null]]) }))
  assert.ok(v)
  assert.equal(v.cell, 'CHEST')
  assert.equal(v.againstNothing, true)
  assert.equal(v.currentScore, 0)
  assert.equal(v.delta, v.score)
})

test('a worse item is not an upgrade, and neither is one nobody here can wear', () => {
  assert.equal(upgradeVerdict(RING_SMALL, ctx({ worn: worn([['FINGER', RING_BIG], ['FINGER2', RING_MID]]) })), null)
  assert.equal(upgradeVerdict(CLERIC_ONLY, ctx()), null, 'a cleric-only hat is not a warrior verdict')
  assert.equal(upgradeVerdict(BAG, ctx()), null, 'a row with no equip slot occupies no cell')
  const excluded = ctx({ worn: worn([['CHEST', null]]), excluded: (r: GearRow) => r.key === PLATE.key })
  assert.equal(upgradeVerdict(PLATE, excluded), null, 'the caller filters, and the finder obeys')
})

test('the worn read feeds the finder: unknown hosts become the cells it refuses to speak about', () => {
  const byKey = new Map([[PLATE.key, PLATE]])
  const reading = wornSet(
    [
      { slot: 'CHEST', key: PLATE.key, name: PLATE.name },
      { slot: 'HEAD', key: 'a hat nobody scraped', name: 'A Hat Nobody Scraped' }
    ],
    byKey
  )
  assert.equal(reading.worn.get('CHEST')?.name, 'Plate Chest')
  assert.equal(reading.worn.get('HEAD'), null)
  assert.deepEqual(reading.unknown, [{ cell: 'HEAD', name: 'A Hat Nobody Scraped' }])
  assert.deepEqual([...unknownCells(reading.unknown)], ['HEAD'])
})

// =============================================================================
// 2. THE FARM PLAN
// =============================================================================

const SOURCES: Record<string, FarmSource[]> = {
  [RING_BIG.key]: [
    { mob: 'a guk sentry', zones: ['Lower Guk'] },
    { mob: 'a guk cook', zones: ['Lower Guk'] },
    { mob: 'a guk savant', zones: ['Lower Guk'] }
  ],
  [RING_MID.key]: [{ mob: 'a hill giant', zones: ['Rathe Mountains'] }],
  [PLATE.key]: [{ mob: 'a nameless smith', zones: [] }],
  [RING_SMALL.key]: []
}

function upgrade(cell: PlanSlotId, options: readonly [GearRow, number][]): CellUpgrade {
  return {
    cell,
    current: null,
    currentScore: 0,
    options: options.map(([r, delta]) => ({ row: r, score: delta, delta }))
  }
}

const sourcesFor = (key: string): readonly FarmSource[] => SOURCES[key] ?? []

test('farmPlan groups by zone, counts an item ONCE per zone, and ranks by summed gain', () => {
  const plan = farmPlan(
    [upgrade('FINGER', [[RING_BIG, 126], [RING_MID, 40]]), upgrade('CHEST', [[PLATE, 430]])],
    sourcesFor
  )
  assert.deepEqual(plan.map((z) => z.zone), [NO_ZONE_STATED, 'Lower Guk', 'Rathe Mountains'])
  const guk = plan.find((z) => z.zone === 'Lower Guk')
  assert.ok(guk)
  assert.equal(guk.items.length, 1, 'three mobs, one ring, one item')
  assert.equal(guk.totalDelta, 126, 'and 126 of gain, not 378')
  assert.deepEqual(guk.items[0].mobs, ['a guk sentry', 'a guk cook', 'a guk savant'])
  assert.equal(guk.items[0].cell, 'FINGER')
})

test('farmPlan files a source that states no zone under a heading, and drops an item with none', () => {
  const plan = farmPlan([upgrade('CHEST', [[PLATE, 430]]), upgrade('FINGER', [[RING_SMALL, 5]])], sourcesFor)
  assert.deepEqual(plan.map((z) => z.zone), [NO_ZONE_STATED])
  assert.deepEqual(plan[0].items.map((i) => i.row.name), ['Plate Chest'])
  assert.equal(farmPlan([upgrade('FINGER', [[RING_SMALL, 5]])], sourcesFor).length, 0, 'no sources, no camp')
})

test('farmPlan sorts items within a zone by gain, and caps the zone list', () => {
  const many: CellUpgrade[] = []
  const wide: Record<string, FarmSource[]> = {}
  for (let i = 0; i < 20; i += 1) {
    const r = row(`Ring ${String(i)}`, ['FINGER'], { AC: 1 })
    wide[r.key] = [{ mob: `mob ${String(i)}`, zones: [`Zone ${String(i)}`] }]
    many.push(upgrade('FINGER', [[r, i + 1]]))
  }
  const capped = farmPlan(many, (k) => wide[k] ?? [])
  assert.equal(capped.length, 12, 'the default cap is twelve zones')
  assert.equal(capped[0].zone, 'Zone 19', 'and the largest gain leads')
  assert.equal(farmPlan(many, (k) => wide[k] ?? [], { maxZones: 3 }).length, 3)

  // Two items in one zone, ordered by their own gain.
  const shared: Record<string, FarmSource[]> = {
    [RING_BIG.key]: [{ mob: 'a guk sentry', zones: ['Lower Guk'] }],
    [RING_MID.key]: [{ mob: 'a guk cook', zones: ['Lower Guk'] }]
  }
  const one = farmPlan([upgrade('FINGER', [[RING_MID, 40], [RING_BIG, 126]])], (k) => shared[k] ?? [])
  assert.deepEqual(one[0].items.map((i) => i.row.name), ['Big Ring', 'Mid Ring'])
  assert.equal(one[0].totalDelta, 166)
})
