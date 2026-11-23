// THE BUILD TAB SCORES EFFECTS AND ENDURANCE (owner, 2026-11-23: "we should account for endurance
// and procs both"), pinned against REAL rows of the committed corpus through the shipped builder.
// The formulas and their sources live in the headers of src/shared/build/effectScore.ts,
// src/main/planner/gearEffectValue.ts and the endurance block of src/shared/build/profiles.ts; this
// file holds them to named items:
//   * procs: Adamantite Bo Stick (Lightning Storm 115), Barbarian Spiritist`s Hammer (Winter's Roar,
//     `Rate +64%`), Blood Runed Short Sword (Lifespike, a `7 to 12` range), Blight, Hammer of the
//     Scourge (a twelve-tick DoT, capped at the gap between procs), Anklesmasher (Snare: not scored),
//     A Vile Substance (a RANGE-only row: not scored);
//   * focus: Checkmate (Improved Damage III), Polished Mithril Mask (Improved Damage II, decayed past
//     its level 44 cap), Robe of the Ishva (Reanimation Efficiency: a pet focus, not scored),
//     Summoned: Jolum's Brilliant Bauble (a detrimental-only mana focus: nothing to a healer);
//   * worn: Ragebringer (its worn haste IS its `Haste:` line), Swiftwind (worn haste with no stat);
//   * endurance: who weighs it, by the client's own endurance-cost column.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import itemsJson from '../src/main/data/items.json'
import type { ItemDbFile } from '../src/main/itemsDb'
import { buildGearIndex } from '../src/main/planner/gearIndex'
import type { GearEffect, GearRow } from '../src/shared/planner/gear'
import type { ClassAbbr } from '../src/shared/classCombo'
import type { PlanSlotId } from '../src/shared/planner/types'
import { itemScore, profileWeights, REFERENCE_MANA_POOL, spendsEndurance } from '../src/shared/build/profiles'
import {
  AVG_PROCS_PER_MINUTE,
  WHITE_DPS_PER_RATIO,
  effectPartText,
  effectReading,
  focusCover,
  procDps,
  rowScore,
  setScore
} from '../src/shared/build/effectScore'
import { bestBuild, buildScore } from '../src/shared/build/optimizer'
import { upgradeVerdict } from '../src/shared/build/upgradeFinder'
import { BUILD_CELLS } from '../src/shared/build/wornSet'
import { eraHides } from '../src/renderer/src/features/planner/plannerData'

const rows = buildGearIndex(itemsJson as unknown as ItemDbFile).rows
const byName = new Map(rows.map((r) => [r.name, r]))

function real(name: string): GearRow {
  const r = byName.get(name)
  assert.ok(r, `${name} is expected in the committed corpus`)
  return r
}

function effect(row: GearRow, name: string): GearEffect {
  const e = row.effects.find((x) => x.name === name)
  assert.ok(e, `${row.name} states ${name}`)
  return e
}

/** Equal to floating-point noise: the score sums in a different order than the expectation. */
function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${String(actual)} is not ${String(expected)}`)
}

const warDps = profileWeights('dps', ['WAR'])
const wizDps = profileWeights('dps', ['WIZ'])

// ---- procs -------------------------------------------------------------------------------------

test('a damage proc carries its spell page damage at the level cap, and the item rate modifier', () => {
  assert.deepEqual(effect(real('Adamantite Bo Stick'), 'Lightning Storm').value, { procDamage: 115 })
  // `Decrease Hitpoints by 251 (L34) to 263 (L40)` read at 50 is the top of the ramp; `Combat, Rate +64%`.
  assert.deepEqual(effect(real('Barbarian Spiritist`s Hammer'), "Winter's Roar").value, { procDamage: 263, procRate: 64 })
  // `Decrease Hitpoints by 7 to 12`: a range is its midpoint.
  assert.equal(effect(real('Blood Runed Short Sword'), 'Lifespike').value?.procDamage, 9.5)
  // Snare deals nothing, so it carries no number at all.
  assert.equal(effect(real('Anklesmasher'), 'Snare').value, undefined)
})

test('the proc rate is the classic per-minute model: 2 a minute, scaled by the item rate', () => {
  assert.equal(AVG_PROCS_PER_MINUTE, 2)
  assert.equal(procDps({ procDamage: 115 }), (2 * 115) / 60)
  near(procDps({ procDamage: 263, procRate: 64 }), (2 * 1.64 * 263) / 60)
})

test('a proc is scored as the weapon ratio that would deal its DPS with white swings', () => {
  const bo = real('Adamantite Bo Stick')
  const expected = ((warDps.RATIO ?? 0) * ((2 * 115) / 60)) / WHITE_DPS_PER_RATIO
  near(rowScore(bo, warDps) - itemScore(bo.stats, warDps), expected)
  // No RATIO weight, no proc score: the tank and healer price no weapon damage, and nor do they this.
  for (const w of [profileWeights('tank', ['WAR']), profileWeights('heal', ['CLR']), wizDps]) {
    assert.equal(rowScore(bo, w), itemScore(bo.stats, w))
  }
})

test('a DoT proc counts only the ticks that land before the next proc refreshes it', () => {
  const blight = real('Blight, Hammer of the Scourge')
  const scourge = effect(blight, 'Scourge').value
  assert.deepEqual(scourge?.procDot, { perTick: 98, ticks: 12 })
  // 30 s between procs at 2 a minute: five of the twelve ticks.
  assert.ok(scourge)
  assert.equal(procDps(scourge), (2 * (98 * 5)) / 60)
})

test('non-damage procs and procs on a row nobody swings are named as not scored', () => {
  assert.deepEqual(effectReading(real('Anklesmasher'), warDps).unscored, ['Proc: Snare'])
  const vile = real('A Vile Substance') // RANGE only, Disease proc
  assert.deepEqual(effectReading(vile, warDps), { parts: [], unscored: ['Proc: Disease'], total: 0 })
})

test('the breakdown line is an estimate, and says where it came from', () => {
  const reading = effectReading(real('Adamantite Bo Stick'), warDps)
  assert.deepEqual(reading.parts.map(effectPartText), ['~+134 from Proc: Lightning Storm'])
})

// ---- focus -------------------------------------------------------------------------------------

test('a spell damage focus is its band midpoint, decayed by its level cap at spell level 50', () => {
  assert.deepEqual(effect(real('Checkmate'), 'Improved Damage III').value?.focus, {
    kind: 'damage',
    pct: 10.5,
    scope: 'instant',
    polarity: 'detrimental'
  })
  // `Limit Max Level: 44`: six levels over is 70% of 10.5.
  assert.equal(effect(real('Polished Mithril Mask'), 'Improved Damage II').value?.focus?.pct, 7.35)
})

test('a focus percent is priced as that percent of the reference mana pool, at the profile MP weight', () => {
  assert.equal(REFERENCE_MANA_POOL, 9.375 * 220)
  const mask = real('Polished Mithril Mask')
  assert.equal(rowScore(mask, wizDps) - itemScore(mask.stats, wizDps), 7.35 * (REFERENCE_MANA_POOL / 100) * 1.2)
  // Checkmate is a WAR MNK ROG BER ear: a warrior has no spell side, so its focus is worth nothing there.
  const checkmate = real('Checkmate')
  assert.equal(rowScore(checkmate, warDps), itemScore(checkmate.stats, warDps))
})

test('a pet-summon mana focus is not scored, and a detrimental-only one is nothing to a healer', () => {
  const robe = real('Robe of the Ishva')
  assert.equal(effect(robe, 'Reanimation Efficiency III').value, undefined)
  assert.deepEqual(effectReading(robe, wizDps).unscored, ['Focus: Reanimation Efficiency III'])
  const bauble = real("Summoned: Jolum's Brilliant Bauble")
  const heal = profileWeights('heal', ['CLR'])
  assert.equal(rowScore(bauble, heal), itemScore(bauble.stats, heal))
  assert.ok(rowScore(bauble, wizDps) > itemScore(bauble.stats, wizDps), 'and real mana to a nuker')
})

test('focus does not stack: two ranks of Improved Damage in one set count the better once', () => {
  const checkmate = real('Checkmate')
  const mask = real('Polished Mithril Mask')
  const w = profileWeights('dps', ['WIZ', 'ROG'])
  const statsOnly = itemScore(checkmate.stats, w) + itemScore(mask.stats, w)
  assert.equal(setScore([checkmate, mask], w), statsOnly + 10.5 * (w.FOCUS_DAMAGE ?? 0))
  // The mask against a set already holding Checkmate adds its stats and nothing for its focus.
  assert.equal(rowScore(mask, w, focusCover([checkmate])), itemScore(mask.stats, w))
  const worn = new Map<PlanSlotId, GearRow | null>([
    ['EAR', checkmate],
    ['FACE', null]
  ])
  const verdict = upgradeVerdict(mask, { classes: ['WIZ', 'ROG'], weights: w, worn, unknownCells: new Set() })
  assert.equal(verdict?.delta, itemScore(mask.stats, w))
  assert.equal(buildScore(worn, w), rowScore(checkmate, w))
})

test('no best set wears one row in two cells, and none carries two of one focus group', () => {
  const combos: [ClassAbbr[], 'tank' | 'dps' | 'heal'][] = [
    [['MNK'], 'dps'],
    [['RNG'], 'dps'],
    [['WIZ'], 'dps'],
    [['CLR'], 'heal']
  ]
  for (const [classes, profile] of combos) {
    const weights = profileWeights(profile, classes)
    const best = bestBuild(rows, BUILD_CELLS, { classes, weights, excluded: (r) => eraHides(r, true) })
    const keys = [...best.values()].flatMap((r) => (r ? [r.key] : []))
    assert.equal(new Set(keys).size, keys.length, `${classes.join('/')} ${profile} repeats a row`)
    let summed = 0
    for (const r of best.values()) if (r) summed += rowScore(r, weights)
    assert.ok(buildScore(best, weights) <= summed + 1e-9)
  }
})

test('a Temporary summoned item is never a best-set pick, however well its focus scores', () => {
  // The bauble's mana focus made it the WIZ ear pick until Temporary rows were left out: it
  // vanishes on logout, so it is not gear anyone can plan a set around.
  assert.ok(real("Summoned: Jolum's Brilliant Bauble").flags.includes('Temporary'))
  const best = bestBuild(rows, BUILD_CELLS, { classes: ['WIZ'], weights: wizDps, excluded: (r) => eraHides(r, true) })
  for (const r of best.values()) assert.ok(!r || !r.flags.includes('Temporary'), `${r?.name} is Temporary`)
})

// ---- worn --------------------------------------------------------------------------------------

test('a worn haste line counts only what it adds above the row own Haste stat', () => {
  const rage = real('Ragebringer') // `Haste: 40%` and a worn Seething Fury of 40%, AC 9, ATK 40
  assert.deepEqual(effect(rage, 'Seething Fury').value?.stats, { HASTE: 40, AC: 9, ATTACK: 40 })
  const rogue = profileWeights('dps', ['ROG'])
  assert.equal(rowScore(rage, rogue) - itemScore(rage.stats, rogue), 9 * (rogue.AC ?? 0) + 40 * (rogue.ATTACK ?? 0))
  const swiftwind = real('Swiftwind') // no Haste line of its own
  const ranger = profileWeights('dps', ['RNG'])
  assert.equal(rowScore(swiftwind, ranger) - itemScore(swiftwind.stats, ranger), 40 * (ranger.HASTE ?? 0) + 30 * (ranger.ATTACK ?? 0))
})

// ---- endurance ---------------------------------------------------------------------------------

test('endurance is weighed for the five classes that learn an endurance ability by 50, in tank and DPS', () => {
  for (const c of ['WAR', 'MNK', 'ROG', 'BER', 'RNG'] as ClassAbbr[]) {
    assert.equal(spendsEndurance([c]), true, c)
    assert.ok((profileWeights('dps', [c]).END ?? 0) > 0, `${c} dps`)
    assert.ok((profileWeights('tank', [c]).END ?? 0) > 0, `${c} tank`)
    assert.equal(profileWeights('heal', [c]).END, undefined, `${c} heal`)
  }
  for (const c of ['PAL', 'SHD', 'BRD', 'BST', 'CLR', 'WIZ', 'ENC', 'NEC'] as ClassAbbr[]) {
    assert.equal(spendsEndurance([c]), false, c)
    assert.equal(profileWeights('dps', [c]).END, undefined, `${c} dps`)
    assert.equal(profileWeights('tank', [c]).END, undefined, `${c} tank`)
  }
  // A hybrid loadout with one endurance user weighs it.
  assert.ok((profileWeights('tank', ['PAL', 'CLR', 'WAR']).END ?? 0) > 0)
})
