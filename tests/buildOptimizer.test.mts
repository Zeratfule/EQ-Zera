// THE BUILD TAB'S ARITHMETIC (EQ Zera, 2026-09-06): the profile weights say what they mean, the
// scorer adds what it says, the optimizer picks what the weights prefer, and the solo meter stays
// inside its range — all against small fixtures where the fact is the function's.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { GearRow } from '../src/shared/planner/gear'
import {
  archetypeOf,
  itemScore,
  meterPercent,
  profileWeights,
  soloKit,
  soloReading
} from '../src/shared/build/profiles'
import { bestBuild, buildScore, candidatesForCell, upgradesFor, wearable } from '../src/shared/build/optimizer'

function row(name: string, slots: GearRow['slots'], stats: GearRow['stats'], classes: GearRow['classes'] = []): GearRow {
  return {
    key: name.toLowerCase(),
    name,
    searchKey: name.toLowerCase(),
    slots,
    classes,
    races: ['ALL'],
    flags: [],
    quest: false,
    playerCrafted: false,
    stats,
    effects: []
  }
}

const PLATE = row('Plate Chest', ['CHEST'], { AC: 30, HP: 20, STA: 5 })
const ROBE = row('Wise Robe', ['CHEST'], { AC: 6, WIS: 12, INT: 12, MP: 40 })
const SWORD = row('Fast Sword', ['PRIMARY', 'SECONDARY'], { DMG: 10, DELAY: 20, STR: 3 })
const CLUB = row('Slow Club', ['PRIMARY'], { DMG: 12, DELAY: 40 })
const RING_A = row('Ring A', ['FINGER'], { AC: 5, HP: 15 })
const RING_B = row('Ring B', ['FINGER'], { AC: 4, HP: 10 })
const CLERIC_ONLY = row('Holy Hat', ['HEAD'], { WIS: 20 }, ['CLR'])

test('the archetype reads a loadout the way the weights need it', () => {
  assert.deepEqual(archetypeOf(['WAR']), { melee: true, intCaster: false, priest: false, manaStat: null, rogue: false })
  assert.equal(archetypeOf(['CLR']).manaStat, 'WIS')
  assert.equal(archetypeOf(['WIZ']).manaStat, 'INT')
  assert.equal(archetypeOf(['CLR', 'WIZ']).manaStat, 'WIS', 'a mixed loadout leans on WIS')
  assert.equal(archetypeOf(['ROG', 'CLR', 'MNK']).rogue, true)
})

test('a tank wants the plate, a healer wants the robe, and both say so in HP-equivalents', () => {
  const tank = profileWeights('tank', ['WAR'])
  const heal = profileWeights('heal', ['CLR'])
  assert.ok(itemScore(PLATE.stats, tank) > itemScore(ROBE.stats, tank))
  assert.ok(itemScore(ROBE.stats, heal) > itemScore(PLATE.stats, heal))
  // AC 30 × 12 + HP 20 + STA 5 × 10 = 430 HP-equivalents, nothing else on the item.
  assert.equal(itemScore(PLATE.stats, tank), 430)
})

test('melee DPS is the weapon ratio; caster DPS is the mana stat', () => {
  const melee = profileWeights('dps', ['WAR'])
  assert.ok(itemScore(SWORD.stats, melee) > itemScore(CLUB.stats, melee), 'a 0.5 ratio beats a 0.3 ratio')
  const caster = profileWeights('dps', ['WIZ'])
  assert.equal(caster.RATIO, undefined, 'a pure caster does not weigh weapon ratio')
  assert.ok((caster.INT ?? 0) > 0 && caster.WIS === undefined)
  const hybrid = profileWeights('dps', ['WAR', 'WIZ'])
  assert.ok((hybrid.RATIO ?? 0) > 0 && (hybrid.INT ?? 0) > 0, 'a mixed loadout weighs both halves')
})

test('wearable: a stated class list that names none of ours excludes the row; an unstated one never does', () => {
  assert.equal(wearable(CLERIC_ONLY, ['WAR']), false)
  assert.equal(wearable(CLERIC_ONLY, ['WAR', 'CLR']), true)
  assert.equal(wearable(PLATE, ['WAR']), true)
  assert.equal(wearable(CLERIC_ONLY, []), true, 'no loadout known: nothing is excluded')
})

test('candidates come slot-matched, class-matched, filtered, best first', () => {
  const rows = [PLATE, ROBE, SWORD, CLUB, RING_A, RING_B, CLERIC_ONLY]
  const ctx = { classes: ['WAR'] as const, weights: profileWeights('tank', ['WAR']) }
  assert.deepEqual(candidatesForCell(rows, 'CHEST', ctx).map((c) => c.row.name), ['Plate Chest', 'Wise Robe'])
  assert.deepEqual(candidatesForCell(rows, 'HEAD', ctx), [], 'the cleric hat is not a warrior candidate')
  const noPlate = { ...ctx, excluded: (r: GearRow) => r.name === 'Plate Chest' }
  assert.deepEqual(candidatesForCell(rows, 'CHEST', noPlate).map((c) => c.row.name), ['Wise Robe'])
  assert.deepEqual(candidatesForCell(rows, 'FINGER2', ctx).map((c) => c.row.name), ['Ring A', 'Ring B'], 'a second cell draws from its slot')
})

test('the best build takes the top row per cell and two DIFFERENT rings', () => {
  const rows = [PLATE, ROBE, SWORD, CLUB, RING_A, RING_B]
  const ctx = { classes: ['WAR'] as const, weights: profileWeights('tank', ['WAR']) }
  const best = bestBuild(rows, ['CHEST', 'FINGER', 'FINGER2', 'PRIMARY', 'HEAD'], ctx)
  assert.equal(best.get('CHEST')?.name, 'Plate Chest')
  assert.equal(best.get('FINGER')?.name, 'Ring A')
  assert.equal(best.get('FINGER2')?.name, 'Ring B')
  assert.equal(best.get('HEAD'), null, 'a cell nothing fits stays empty')
  assert.equal(buildScore(best, ctx.weights), itemScore(PLATE.stats, ctx.weights) + itemScore(RING_A.stats, ctx.weights) + itemScore(RING_B.stats, ctx.weights) + itemScore(SWORD.stats, ctx.weights))
})

test('upgrades list only what beats the worn item, skip what is already worn elsewhere, and cap per cell', () => {
  const rows = [PLATE, ROBE, RING_A, RING_B]
  const ctx = { classes: ['WAR'] as const, weights: profileWeights('tank', ['WAR']) }
  const set = new Map<'CHEST' | 'FINGER' | 'FINGER2', GearRow | null>([
    ['CHEST', ROBE],
    ['FINGER', RING_B],
    ['FINGER2', null]
  ])
  const ups = upgradesFor(rows, set, ['CHEST', 'FINGER', 'FINGER2'], { ...ctx, perCell: 5 })
  assert.deepEqual(ups[0].options.map((o) => o.row.name), ['Plate Chest'])
  assert.ok(ups[0].options[0].delta > 0)
  assert.deepEqual(ups[1].options.map((o) => o.row.name), ['Ring A'])
  assert.deepEqual(ups[2].options.map((o) => o.row.name), ['Ring A'], 'the empty second cell wants Ring A too; Ring B is worn, so it is not offered')
  assert.equal(upgradesFor(rows, set, ['CHEST'], { ...ctx, perCell: 0 })[0].options.length, 0)
})

test('meters and the solo reading stay in 0..100 and read the kit the way the table says', () => {
  assert.equal(meterPercent(50, 100), 50)
  assert.equal(meterPercent(120, 100), 100)
  assert.equal(meterPercent(10, 0), 0)
  const cleric = soloKit(['CLR'])
  assert.equal(cleric.heal, 1)
  const trio = soloKit(['WAR', 'CLR', 'NEC'])
  assert.equal(trio.heal, 1, 'the loadout has the cleric')
  assert.equal(trio.pet, 0.9, 'and the necromancer')
  const r = soloReading(trio, { tank: 60, dps: 40, heal: 80 })
  assert.ok(r.percent >= 0 && r.percent <= 100 && r.kitPercent >= 0 && r.gearPercent >= 0)
  const warrior = soloReading(soloKit(['WAR']), { tank: 60, dps: 40, heal: 80 })
  assert.ok(warrior.percent < r.percent, 'a warrior alone solos worse than a warrior with a cleric and a necromancer in the loadout')
})
