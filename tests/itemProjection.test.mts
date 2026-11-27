// ITEM PROJECTION TEST — src/shared/itemProjection.ts, the rows the full item window draws when
// the reader projects one item to a whole ` +N` tier.
//
// The fixtures are the same verbatim `items.json` stat blocks tests/itemUpgrade.test.mts pins the
// scaler with. Expected values are either `scaleStatBlock`'s own answer (the projection must not
// re-derive arithmetic) or one of three hand-checked whole-tier cases stated beside the assert.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStatsBlock, type ItemStatBlock } from '../src/shared/itemStats'
import { scaleStatBlock, upgradeStateForTier } from '../src/shared/itemUpgrade'
import {
  clampProjectionTier,
  defaultProjectionTier,
  itemWindowRows,
  offersProjection,
  projectionCaption,
  type ItemWindowRow
} from '../src/shared/itemProjection'

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

/** Jacinth and Mote of Major Potential, verbatim: a WT 0.1 gem and a no-stat mote. */
const JACINTH = parseStatsBlock('WT: 0.1 Size: TINY\n\nClass: ALL\n\nRace: ALL')
const MOTE: ItemStatBlock = {
  flags: ['No Trade'], stats: [], saves: [], effects: [], exaltationSlots: [], extras: [], size: 'TINY'
}

const find = (rows: ItemWindowRow[], key: string): ItemWindowRow | undefined => rows.find((r) => r.key === key)

test('tier 0 is the window as it was drawn before projection: no row carries a base', () => {
  for (const block of [THELVORN, CROWN, AXE, JACINTH, MOTE]) {
    const r = itemWindowRows(block, 0)
    for (const row of [...r.physical, ...r.combat, ...r.attrs, ...r.saves, ...(r.ratio ? [r.ratio] : [])]) {
      assert.equal(row.base, undefined, `${row.key} at +0`)
      assert.notEqual(row.added, true, `${row.key} at +0`)
    }
  }
  const t = itemWindowRows(THELVORN)
  assert.deepEqual(t.physical.map((r) => [r.key, r.value]), [['Size', 'MEDIUM'], ['Weight', '3.0'], ['Skill', '1H Slashing']])
  assert.deepEqual(t.combat.map((r) => [r.key, r.value]), [['Base Dmg', '20'], ['Delay', '26']])
  assert.equal(t.ratio?.value, (20 / 26).toFixed(2))
})

test('hand-checked whole tiers: 15 at +10 is 30, 5 at +3 is 8, DMG 20 at +5 is 30', () => {
  // floor(15 + round(15 * 10 / 10)) = 30
  assert.deepEqual(find(itemWindowRows(THELVORN, 10).attrs, 'WIS'), { key: 'WIS', value: '+30', base: '+15' })
  // 0 < base <= 10 adds the tier: 5 + 3
  assert.deepEqual(find(itemWindowRows(AXE, 3).saves, 'SV FIRE'), { key: 'SV FIRE', value: '+8', base: '+5' })
  // 20 + floor(20 * 5 / 10) = 30, and the ratio is scaled DMG over the base delay
  const t5 = itemWindowRows(THELVORN, 5)
  assert.deepEqual(find(t5.combat, 'Base Dmg'), { key: 'Base Dmg', value: '30', base: '20' })
  assert.deepEqual(t5.ratio, { key: 'Ratio', value: (30 / 26).toFixed(2), base: (20 / 26).toFixed(2) })
  assert.deepEqual(find(t5.combat, 'Delay'), { key: 'Delay', value: '26' }, 'delay never scales')
})

test('every projected value is scaleStatBlock`s own answer, beside the base it came from', () => {
  for (const block of [THELVORN, CROWN, AXE]) {
    for (let tier = 1; tier <= 10; tier++) {
      const scaled = scaleStatBlock(block, upgradeStateForTier(tier))
      const r = itemWindowRows(block, tier)
      assert.deepEqual(r.attrs.map((x) => x.value), scaled.stats.map((x) => x.value), `stats at +${String(tier)}`)
      assert.deepEqual(r.saves.map((x) => x.value), scaled.saves.map((x) => x.value), `saves at +${String(tier)}`)
      assert.deepEqual(r.attrs.map((x) => x.base ?? x.value), block.stats.map((x) => x.value))
      if (block.ac !== undefined) assert.equal(find(r.combat, 'AC')?.value, String(scaled.ac))
      assert.equal(find(r.physical, 'Weight')?.value, scaled.weight)
      assert.equal(find(r.physical, 'Weight')?.base, scaled.weight === block.weight ? undefined : block.weight)
    }
  }
})

test('the synthesized SV VOID is a new row, marked added, with no base', () => {
  const r = itemWindowRows(CROWN, 3)
  assert.deepEqual(r.saves.at(-1), { key: 'SV VOID', value: '+3', added: true })
  assert.deepEqual(find(r.saves, 'SV MAGIC'), { key: 'SV MAGIC', value: '+26', base: '+20' })
  assert.deepEqual(find(r.combat, 'AC'), { key: 'AC', value: '17', base: '13' })
  // One scaling attribute is not enough to trigger it.
  assert.equal(find(itemWindowRows(THELVORN, 3).saves, 'SV VOID'), undefined)
})

test('a penalty shrinks toward zero and says what it was', () => {
  const r = itemWindowRows(AXE, 3)
  assert.deepEqual(find(r.combat, 'AC'), { key: 'AC', value: '-2', base: '-5' })
  assert.deepEqual(find(r.attrs, 'WIS'), { key: 'WIS', value: '-2', base: '-5' })
})

test('timing keys stay out of the attribute grid and never scale', () => {
  const block: ItemStatBlock = {
    ...MOTE,
    stats: [{ key: 'STR', value: '+12' }, { key: 'CAST TIME', value: 'Instant' }, { key: 'CHARGES', value: '5' }]
  }
  const r = itemWindowRows(block, 4)
  assert.deepEqual(r.attrs.map((x) => x.key), ['STR'])
  assert.deepEqual(r.timing, [{ key: 'CAST TIME', value: 'Instant' }, { key: 'CHARGES', value: '5' }])
})

test('the control is offered only on wearable gear where more than Weight moves', () => {
  assert.equal(offersProjection(THELVORN), true)
  assert.equal(offersProjection(CROWN), true)
  assert.equal(offersProjection(AXE), true)
  assert.equal(offersProjection(JACINTH), false, 'WT 0.1 is the weight entry guard, and no slot')
  assert.equal(offersProjection(MOTE), false, 'no stats at all')
  assert.equal(offersProjection(undefined), false)
  const heroicOnly: ItemStatBlock = { ...MOTE, slot: 'NECK', stats: [{ key: 'HEROIC STR', value: '+5' }], dmgBonus: 4 }
  assert.equal(offersProjection(heroicOnly), false, 'heroics and Dmg Bon are left alone by the reference')
  const scroll: ItemStatBlock = {
    ...MOTE, weight: '0.1', effects: [{ kind: 'click', name: 'Minor Healing' }], stats: [{ key: 'CAST TIME', value: '1.5' }]
  }
  assert.equal(offersProjection(scroll), false, 'a spell scroll gets no control')
  assert.equal(offersProjection({ ...MOTE, weight: '2.0' }), false, 'food / a hide only loses weight')
  assert.equal(offersProjection({ ...MOTE, slot: 'CHEST', weight: '9.0' }), false, 'slotted but weight-only')
  assert.equal(offersProjection({ ...MOTE, stats: [{ key: 'STR', value: '+5' }] }), false, 'no slot, not gear')
  assert.equal(offersProjection({ ...MOTE, slot: 'RANGE', dmg: 8, atkDelay: 30 }), true, 'a lone DMG moves')
  assert.equal(offersProjection({ ...MOTE, slot: 'FINGER', saves: [{ key: 'SV FIRE', value: '+3' }] }), true)
})

test('the default projection is the item`s own tier', () => {
  assert.equal(defaultProjectionTier('Thelvorn, Blade of Light +5', 2), 5, 'the name wins')
  assert.equal(defaultProjectionTier('Thelvorn, Blade of Light', 2), 2, 'observed merge next')
  assert.equal(defaultProjectionTier('Thelvorn, Blade of Light', undefined), 0)
  assert.equal(defaultProjectionTier('Thing +14', undefined), 10, 'clamped to the cap')
  assert.equal(clampProjectionTier(-3), 0)
  assert.equal(clampProjectionTier(4.7), 4)
})

test('the caption says when the bright numbers are not the item`s own tier', () => {
  assert.equal(projectionCaption(0, 0), undefined)
  assert.equal(projectionCaption(7, 0), 'Projected at +7 · grey is base +0')
  assert.equal(projectionCaption(7, 5), 'Projected at +7 · grey is base +0')
  assert.equal(projectionCaption(0, 5), 'Projected at +0', 'nothing is grey at the base')
  assert.equal(projectionCaption(5, 5), "At this item's +5 · grey is base +0")
})
