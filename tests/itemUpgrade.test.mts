// ITEM UPGRADE ENGINE TEST — src/shared/itemUpgrade.ts, the port of the eqlwiki
// ItemLevelSlider algorithm (JOS-281, phase 0 of the Gear planner).
//
// The two VERIFICATION FIXTURES are real committed items, and their stat blocks below are
// pasted VERBATIM out of `src/main/data/items.json` (the `statsBlock` field, i.e. the wiki's
// own `{{Itempage}} |statsblock`) and re-parsed by the shipped parser — so a scrape that
// changed the base data would fail here rather than silently move the planner.
//
//   Thelvorn, Blade of Light — DMG 20, Atk Delay 26, WIS +15, WT 3.0. Owner screenshot at
//        tier 2 + 3/4 reads DMG 25, ratio 0.96, WIS +19, WT 2.3; all four reproduce. ONE
//        scaling attribute, so it is also the proof that SV VOID is NOT synthesized.
//   Crown of King Tranix     — AC 13, CHA +15, SV MAGIC +20, WT 1.0. Two trigger fields, so
//        it IS the SV VOID case.
//   Axe of Lost Souls        — the NEGATIVE branches (AC -5, WIS -5, INT -5) beside the
//        `base <= 10` flat branch (STR/STA +10, five saves at +5) and a big weight.
//   A Ghoul's Heart          — a lone negative attribute and WT 0.1, the weight ENTRY GUARD.
//
// Every number asserted here comes from the reference algorithm as recorded in JOS-281 —
// none of it is this test's own arithmetic (world-model law 1).
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { damageRatio, parseStatsBlock, type ItemStatBlock } from '../src/shared/itemStats'
import {
  effectiveLevel,
  excelRound,
  excelRoundUp,
  ITEM_UPGRADE_STATE_COUNT,
  normalizeStatKey,
  normalizeUpgradeState,
  percentLabel,
  scalePrimary,
  scaleStatBlock,
  scaleWeight,
  synthesizesVoidSave,
  totalProgression,
  upgradePercent,
  upgradeStatClass,
  type ItemUpgradeState
} from '../src/shared/itemUpgrade'

// ---- fixtures (verbatim `items.json` stat blocks) --------------------------------

const THELVORN = parseStatsBlock(
  'MAGIC ITEM LORE ITEM NO DROP\n\nSlot: PRIMARY\n\nSkill: 1H Slashing Atk Delay: 26\n\n' +
    'DMG: 20 \n\nWIS: +15\n\nEffect: [[Dismiss Summoned]] (Combat, Casting Time: Instant) at Level 45\n\n' +
    'WT: 3.0 Size: MEDIUM\n\nClass: PAL\n\nRace: ALL'
)

const CROWN = parseStatsBlock(
  'MAGIC ITEM LORE ITEM\n\nSlot: HEAD\n\nAC: 13\n\nCHA: +15\n\nSV MAGIC: +20\n\n' +
    'Effect: [[Serpent Sight]] (Worn)\n\nWT: 1.0 Size: SMALL\n\nClass: ALL\n\nRace: ALL'
)

const AXE = parseStatsBlock(
  'MAGIC ITEM LORE ITEM \n\nSlot: PRIMARY\n\nSkill: 2H Slashing Atk Delay: 40\n\nDMG: 30 AC: -5\n\n' +
    'STR: +10 STA: +10 WIS: -5 INT: -5\n\n' +
    'SV FIRE: +5 SV DISEASE: +5 SV COLD: +5 SV MAGIC: +5 SV POISON: +5\n\n' +
    'WT: 12.0 Size: LARGE\n\nClass: WAR PAL RNG SHD\n\nRace: ALL'
)

const GHOUL_HEART = parseStatsBlock(
  'LORE ITEM NODROP\n\nSlot: NECK \n\nCHA: -10 \n\nWT: 0.1 Size: TINY \n\nClass: ALL \n\nRace: ALL'
)

const at = (full: number, fraction = 0): ItemUpgradeState => ({ full, fraction })
const CHECKPOINT = at(2, 3) // "Tier 2   3 / 4" — the owner screenshot
const WHOLE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

const statOf = (b: ItemStatBlock, key: string): string | undefined =>
  [...b.stats, ...b.saves].find((s) => s.key.toUpperCase() === key)?.value

// =================================================================================
// STATE ARITHMETIC
// =================================================================================

test('the state is full + fraction/2^full, and the label is ten times it', () => {
  assert.equal(effectiveLevel(CHECKPOINT), 2.75)
  assert.equal(upgradePercent(CHECKPOINT), 27.5)
  assert.equal(percentLabel(CHECKPOINT), '+27.5%')
  assert.equal(totalProgression(CHECKPOINT), 7) // 2^2 + 3

  for (const full of WHOLE) {
    assert.equal(effectiveLevel(at(full)), full)
    assert.equal(totalProgression(at(full)), 2 ** full)
    assert.equal(percentLabel(at(full)), `+${full * 10}%`)
  }
})

test('a state normalizes: integer tier 0..10, fraction inside 2^full, zero at both ends', () => {
  assert.deepEqual(normalizeUpgradeState(at(-3, 5)), at(0))
  assert.deepEqual(normalizeUpgradeState(at(99, 5)), at(10))
  assert.deepEqual(normalizeUpgradeState(at(0, 7)), at(0)) // tier 0 banks nothing
  assert.deepEqual(normalizeUpgradeState(at(10, 7)), at(10)) // and neither does the cap
  assert.deepEqual(normalizeUpgradeState(at(3, 8)), at(3, 7)) // 2^3 - 1
  assert.deepEqual(normalizeUpgradeState(at(3, -2)), at(3, 0))
  assert.deepEqual(normalizeUpgradeState({ full: 2.7, fraction: 1.9 }), at(2, 1))

  // 1024 reachable states: Σ 2^full for full 0..9, plus the single capped tier 10.
  const seen = new Set<string>()
  for (let full = 0; full <= 10; full++) {
    for (let fraction = 0; fraction < 2 ** full; fraction++) {
      const n = normalizeUpgradeState(at(full, fraction))
      seen.add(`${n.full}/${n.fraction}`)
    }
  }
  assert.equal(seen.size, ITEM_UPGRADE_STATE_COUNT)
})

test('the rounding helpers are Excel ROUND/ROUNDUP, not Math.round/Math.ceil', () => {
  assert.equal(excelRound(5.5), 6)
  assert.equal(excelRound(4.125), 4)
  assert.equal(excelRound(-5.5), -6) // Math.round(-5.5) is -5; away from zero is the rule
  assert.equal(excelRound(2.2420143, 1), 2.2)
  assert.equal(excelRoundUp(2.2420143, 1), 2.3)
  assert.equal(excelRoundUp(-2.21, 1), -2.3)
})

// =================================================================================
// THELVORN — the owner screenshot, then every whole level
// =================================================================================

test('Thelvorn at tier 2 + 3/4 reproduces all four screenshot numbers', () => {
  const s = scaleStatBlock(THELVORN, CHECKPOINT)
  assert.equal(s.dmg, 25) // 20 + floor(20 * 2.75 / 10)
  assert.equal(statOf(s, 'WIS'), '+19') // floor(15 + round(4.125)), NOT 20
  assert.equal(s.weight, '2.3') // ceil-to-one-decimal of 2.2420…
  assert.equal(s.atkDelay, 26) // delay never scales
  assert.equal(damageRatio(s.dmg, s.atkDelay)?.toFixed(2), '0.96')
})

test('Thelvorn: the whole-level DMG / WIS / WT / ratio tables', () => {
  const dmg = ['20', '22', '24', '26', '28', '30', '32', '34', '36', '38', '40']
  const wis = ['15', '17', '18', '20', '21', '23', '24', '26', '27', '29', '30']
  const wt = ['3.0', '2.8', '2.5', '2.2', '2.0', '1.7', '1.4', '1.2', '0.9', '0.6', '0.4']
  const ratio = ['0.77', '0.85', '0.92', '1.00', '1.08', '1.15', '1.23', '1.31', '1.38', '1.46', '1.54']

  for (const full of WHOLE) {
    const s = scaleStatBlock(THELVORN, at(full))
    assert.equal(String(s.dmg), dmg[full], `DMG at +${full}`)
    assert.equal(statOf(s, 'WIS'), `+${wis[full]}`, `WIS at +${full}`)
    assert.equal(s.weight, wt[full], `WT at +${full}`)
    assert.equal(s.atkDelay, 26, `delay at +${full}`)
    assert.equal(damageRatio(s.dmg, s.atkDelay)?.toFixed(2), ratio[full], `ratio at +${full}`)
  }
})

test('Thelvorn states ONE trigger field, so it never grows an SV VOID line', () => {
  for (const full of WHOLE) {
    assert.equal(synthesizesVoidSave(THELVORN, at(full)), false)
    assert.deepEqual(scaleStatBlock(THELVORN, at(full)).saves, [])
  }
  assert.equal(synthesizesVoidSave(THELVORN, CHECKPOINT), false)
})

// =================================================================================
// CROWN OF KING TRANIX — the SV VOID case
// =================================================================================

test('Crown of King Tranix at tier 2 + 3/4, synthetic SV VOID included', () => {
  const s = scaleStatBlock(CROWN, CHECKPOINT)
  assert.equal(s.ac, 17) // floor(13 + round(3.575))
  assert.equal(statOf(s, 'CHA'), '+19')
  assert.equal(statOf(s, 'SV MAGIC'), '+26') // floor(20 + round(5.5)) — half AWAY from zero
  assert.equal(s.weight, '0.8')
  assert.deepEqual(
    s.saves.map((v) => `${v.key} ${v.value}`),
    ['SV MAGIC +26', 'SV VOID +2']
  )
})

test('Crown: the whole-level AC / CHA / SV MAGIC / WT tables and the SV VOID line', () => {
  const ac = ['13', '14', '16', '17', '18', '20', '21', '22', '23', '25', '26']
  const cha = ['15', '17', '18', '20', '21', '23', '24', '26', '27', '29', '30']
  const svm = ['20', '22', '24', '26', '28', '30', '32', '34', '36', '38', '40']
  const wt = ['1.0', '1.0', '0.9', '0.8', '0.7', '0.6', '0.5', '0.4', '0.3', '0.2', '0.2']

  for (const full of WHOLE) {
    const s = scaleStatBlock(CROWN, at(full))
    assert.equal(String(s.ac), ac[full], `AC at +${full}`)
    assert.equal(statOf(s, 'CHA'), `+${cha[full]}`, `CHA at +${full}`)
    assert.equal(statOf(s, 'SV MAGIC'), `+${svm[full]}`, `SV MAGIC at +${full}`)
    assert.equal(s.weight, wt[full], `WT at +${full}`)
    // The synthetic save exists at every level ABOVE base, and states the tier.
    assert.equal(statOf(s, 'SV VOID'), full === 0 ? undefined : `+${full}`, `SV VOID at +${full}`)
  }
})

// =================================================================================
// THE FLOAT ARTIFACT — replicate, do not fix
// =================================================================================

test('the tier-10 weight is an IEEE754 artifact, and this port keeps it', () => {
  // The reference evaluates the curve in doubles. `0.09 * 10` lands just BELOW 0.9, so the
  // remainder lands just ABOVE 0.1 and the product just above the exact decimal:
  assert.equal(0.09 * 10 < 0.9, true)
  assert.equal(3.0 * (1 - 0.09 * 10), 0.30000000000000027)
  assert.equal(3.0 * (1 - 0.09 * 10) > 0.3, true)

  // …so the ceiling-to-one-decimal steps to 0.4, where exact-decimal math would say 0.3.
  assert.equal(excelRoundUp(0.3, 1), 0.3)
  assert.equal(scaleWeight(3.0, at(10)), 0.4)
  assert.equal(scaleStatBlock(THELVORN, at(10)).weight, '0.4')

  // Same artifact one decade down: 1.0 ceils to 0.2, not the exact-decimal 0.1.
  assert.equal(scaleWeight(1.0, at(10)), 0.2)
  assert.equal(scaleStatBlock(CROWN, at(10)).weight, '0.2')
})

// =================================================================================
// THE BRANCHES — negative, zero, flat, entry-guarded
// =================================================================================

test('a negative stat SHRINKS toward zero by the tier and stops there', () => {
  assert.equal(scalePrimary(-5, at(0)), -5)
  assert.equal(scalePrimary(-5, at(2, 3)), -3) // fraction ignored on this branch
  assert.equal(scalePrimary(-5, at(5)), 0)
  assert.equal(scalePrimary(-5, at(9)), 0) // never crosses into a bonus
  assert.equal(scalePrimary(-100, at(10)), -90) // and a big penalty is still a penalty

  const s = scaleStatBlock(AXE, CHECKPOINT)
  assert.equal(s.ac, -3)
  assert.equal(statOf(s, 'WIS'), '-3')
  assert.equal(statOf(s, 'INT'), '-3')
  assert.equal(scaleStatBlock(AXE, at(5)).ac, 0)
  assert.equal(statOf(scaleStatBlock(AXE, at(6)), 'WIS'), '0')
  assert.equal(statOf(scaleStatBlock(GHOUL_HEART, at(3)), 'CHA'), '-7')
})

test('base 0 stays 0, and base 1..10 is a flat +tier that ignores the fraction', () => {
  for (const full of WHOLE) assert.equal(scalePrimary(0, at(full, 1)), 0)
  const zeroed = scaleStatBlock(parseStatsBlock('AC: 0\n\nSTR: +0'), CHECKPOINT)
  assert.equal(zeroed.ac, 0)
  assert.equal(statOf(zeroed, 'STR'), '+0') // unchanged, so the SOURCE's own spelling survives

  // The `base <= 10` branch: +10 and +5 move by the TIER only — 3/4 of a tier buys nothing.
  const s = scaleStatBlock(AXE, CHECKPOINT)
  assert.equal(statOf(s, 'STR'), '+12')
  assert.equal(statOf(s, 'STA'), '+12')
  assert.equal(statOf(s, 'SV FIRE'), '+7')
  assert.equal(statOf(scaleStatBlock(AXE, at(2)), 'STR'), '+12')
  assert.equal(scalePrimary(10, at(2, 3)), 12)
  assert.equal(scalePrimary(11, at(2, 3)), 14) // …one point of base later, the fraction counts
})

test('the weight ENTRY GUARD leaves a 0.1 item alone at every tier, output clamps at 0', () => {
  for (const full of WHOLE) {
    assert.equal(scaleStatBlock(GHOUL_HEART, at(full)).weight, '0.1')
    assert.equal(scaleWeight(0.1, at(full)), 0.1)
    assert.equal(scaleWeight(0, at(full)), 0)
  }
  assert.equal(scaleWeight(3.0, at(0, 0)), 3.0) // tier 0 is the other half of the guard
  assert.equal(scaleWeight(12.0, CHECKPOINT), 9.0)
  assert.equal(scaleStatBlock(AXE, CHECKPOINT).weight, '9.0')
})

test('DELAY never scales, so the whole ratio gain is the DMG numerator', () => {
  for (const full of WHOLE) {
    assert.equal(scaleStatBlock(AXE, at(full)).atkDelay, 40)
    assert.equal(scaleStatBlock(THELVORN, at(full)).atkDelay, 26)
  }
  const s = scaleStatBlock(AXE, CHECKPOINT)
  assert.equal(s.dmg, 38) // 30 + floor(30 * 2.75 / 10)
  assert.equal(damageRatio(s.dmg, s.atkDelay)?.toFixed(2), '0.95')
  assert.equal(damageRatio(AXE.dmg, AXE.atkDelay)?.toFixed(2), '0.75')
})

// =================================================================================
// KEYS, CLASSES, AND WHAT IS LEFT ALONE
// =================================================================================

test('stat keys normalize longest-first, and heroics are not attributes', () => {
  assert.equal(normalizeStatKey('sv magic'), 'SV_MAGIC')
  assert.equal(normalizeStatKey('MAGIC'), 'SV_MAGIC')
  assert.equal(normalizeStatKey('Mana'), 'MP')
  assert.equal(normalizeStatKey('Mana Regen'), 'MANA_REGEN') // never folded into MANA → MP
  assert.equal(normalizeStatKey('ENDUR'), 'END')
  assert.equal(normalizeStatKey('Damage'), 'DMG')
  assert.equal(normalizeStatKey('WT'), 'WEIGHT')
  assert.equal(normalizeStatKey('HEROIC STR'), 'HEROIC_STR')

  assert.equal(upgradeStatClass('WIS'), 'primary')
  assert.equal(upgradeStatClass('SV POISON'), 'primary')
  assert.equal(upgradeStatClass('Mana'), 'primary')
  assert.equal(upgradeStatClass('Haste'), 'flat')
  assert.equal(upgradeStatClass('Mana Regen'), 'flat')
  assert.equal(upgradeStatClass('DMG'), 'damage')
  assert.equal(upgradeStatClass('Atk Delay'), 'delay')
  assert.equal(upgradeStatClass('WT'), 'weight')
  for (const k of ['Attack', 'Dmg Bon', 'Backstab', 'Range', 'Size', 'Rec Level', 'HEROIC STR', 'Charges']) {
    assert.equal(upgradeStatClass(k), 'unchanged', k)
  }
})

test('a flat stat takes the tier and keeps its own spelling; unmodeled fields are copied', () => {
  const b = parseStatsBlock('Haste: 36% Regen: +2\n\nAttack: +10 Backstab: 25 Dmg Bon: 24\n\nRec Level: 45')
  const s = scaleStatBlock(b, at(3, 5))
  assert.equal(statOf(s, 'HASTE'), '39%') // +full, fraction ignored, unit preserved
  assert.equal(statOf(s, 'REGEN'), '+5')
  assert.equal(statOf(s, 'ATTACK'), '+10')
  assert.equal(statOf(s, 'REC LEVEL'), '45')
  assert.equal(s.backstab, 25)
  assert.equal(s.dmgBonus, 24)
})

test('scaling is pure: the source block is never mutated and the rest is carried across', () => {
  const before = JSON.stringify(THELVORN)
  const s = scaleStatBlock(THELVORN, CHECKPOINT)
  assert.equal(JSON.stringify(THELVORN), before)
  assert.deepEqual(s.flags, THELVORN.flags)
  assert.equal(s.slot, 'PRIMARY')
  assert.equal(s.skill, '1H Slashing')
  assert.equal(s.size, 'MEDIUM')
  assert.deepEqual(s.classes, ['PAL'])
  assert.deepEqual(s.effects, THELVORN.effects)
  assert.deepEqual(s.extras, THELVORN.extras)
})
