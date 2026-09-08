// THE CHARACTER MODEL (EQ Zera, 2026-09-06): the ornamentation socket is read off the dump, the
// material is read off the name, and the two toggles change what a slot LOOKS like without
// changing what it IS.

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { ORNAMENT_SOCKET_INDEX, sheetCells, type SheetCellView } from '../src/shared/characterSheet'
import {
  applyPreview,
  armorMaterial,
  handsFromLooks,
  modelLooks,
  modelSlotForEquip,
  slotLook,
  tintOfColor,
  wearFromLooks,
  INVISIBLE_MODEL_SLOTS,
  type ModelOptions,
  type ModelSlotId,
  type PreviewLook
} from '../src/shared/characterModel'

/** A dump with a helm wearing an ornament in -Slot2 and a focus in -Slot7, plus a bare chest. */
const DUMP = [
  'Location\tName\tID\tCount\tSlots',
  'Head\tValorium Helmet +1\t4851\t1\t10',
  `Head-Slot${String(ORNAMENT_SOCKET_INDEX)}\tCrown of the Froglok Kings (Exaltation)\t1234\t1\t10`,
  'Head-Slot7\tPolished Mithril Mask (Exaltation)\t4505\t1\t10',
  'Chest\tBrigandine Tunic\t3307\t1\t10',
  'Chest-Slot2\tEmpty\t0\t0\t0',
  'Primary\tShort Sword of the Ykesha\t5010\t1\t10',
  ''
].join('\r\n')

function views(): SheetCellView[] {
  const { cells } = sheetCells(parseInventoryDump(DUMP))
  return cells.map((c) => ({ ...c, item: c.item ? { ...c.item, known: true, iconId: 1, ornamentIconId: c.item.ornament ? 2 : undefined } : null }))
}

test('the ornamentation socket names the donor; the other sockets do not', () => {
  const head = views().find((c) => c.id === 'head')?.item
  assert.ok(head)
  assert.equal(head.ornament, 'Crown of the Froglok Kings')
  assert.deepEqual(head.exaltations, ['Crown of the Froglok Kings', 'Polished Mithril Mask'], 'both sockets still count as exaltations')
  const chest = views().find((c) => c.id === 'chest')?.item
  assert.equal(chest?.ornament, undefined, 'an empty -Slot2 is no ornament')
})

test('the live client spells the cosmetic socket "(Ornamentation)": that is the ornament, whatever its socket index', () => {
  const dump = [
    'Location\tName\tID\tCount\tSlots',
    'Arms\tLustrous Russet Vambraces +6\t4833\t1\t10',
    'Arms-Slot2\tEmbroidered Black Sleeves (Ornamentation)\t1362\t1\t10',
    'Arms-Slot7\tEmbroidered Black Sleeves (Exaltation)\t1362\t1\t10',
    ''
  ].join('\r\n')
  const arms = sheetCells(parseInventoryDump(dump)).cells.find((c) => c.id === 'arms')?.item
  assert.ok(arms)
  assert.equal(arms.ornament, 'Embroidered Black Sleeves')
  assert.equal(arms.ornamentId, 1362, 'the donor item id, the key into the game item table')
  assert.deepEqual(arms.exaltations, ['Embroidered Black Sleeves', 'Embroidered Black Sleeves'], 'both socket copies still count as sockets')
})

test('material is read off the name, and unknown is a colour rather than a guess', () => {
  assert.equal(armorMaterial('Valorium Helmet'), 'plate')
  assert.equal(armorMaterial('Bronze Breastplate'), 'plate')
  assert.equal(armorMaterial('Rusty Chainmail Coif'), 'chain')
  assert.equal(armorMaterial('Brigandine Tunic'), 'leather')
  assert.equal(armorMaterial('Robe of the Oracle'), 'cloth')
  assert.equal(armorMaterial('Short Sword of the Ykesha'), 'unknown')
})

test('the ornament toggle swaps the look, the helm toggle hides the head, and neither touches the item', () => {
  const cells = views()
  const head = cells.find((c) => c.id === 'head')
  assert.ok(head)
  const on = slotLook(head, { showHelm: true, showOrnaments: true })
  assert.equal(on?.name, 'Crown of the Froglok Kings')
  assert.equal(on?.iconId, 2, 'the ornament icon')
  assert.equal(on?.ornamented, true)
  assert.equal(on?.hidden, false)
  const off = slotLook(head, { showHelm: true, showOrnaments: false })
  assert.equal(off?.name, 'Valorium Helmet')
  assert.equal(off?.iconId, 1)
  assert.equal(off?.ornamented, false)
  const noHelm = slotLook(head, { showHelm: false, showOrnaments: true })
  assert.equal(noHelm?.hidden, true)
  assert.equal(head.item?.baseName, 'Valorium Helmet', 'the sheet item is untouched by the look')
  const looks = modelLooks(cells, { showHelm: false, showOrnaments: true })
  assert.deepEqual([...looks.keys()].sort(), ['chest', 'head', 'primary'])
  assert.equal(looks.get('chest')?.material, 'leather')
})

test('the wear the real model gets: material → variant per part, the heavier wrist wins, a hidden helm is bare', () => {
  const cells = views()
  const shown = wearFromLooks(modelLooks(cells, { showHelm: true, showOrnaments: false }))
  assert.deepEqual(shown, { ch: 1, helm: 3 }, 'leather tunic on the chest, plate helm on the head; a sword changes nothing')
  const hidden = wearFromLooks(modelLooks(cells, { showHelm: false, showOrnaments: false }))
  assert.deepEqual(hidden, { ch: 1 })
  const ornamented = wearFromLooks(modelLooks(cells, { showHelm: true, showOrnaments: true }))
  assert.equal(ornamented.helm, 0, 'the crown ornament reads as no known make, so the head stays bare')
})

const SHOW: ModelOptions = { showHelm: true, showOrnaments: true }
const PLAIN: ModelOptions = { showHelm: true, showOrnaments: false }

test('the hands: the item MODEL when the item table knows it, the skill as the fallback, nothing for empty hands', () => {
  const cells = views().map((c) => (c.id === 'primary' && c.item ? { ...c, item: { ...c.item, skill: '1H Slashing', model: 'IT68' } } : c))
  assert.deepEqual(handsFromLooks(modelLooks(cells, SHOW)), { primary: { model: 'IT68', skill: '1H Slashing' } })
  const skillOnly = views().map((c) => (c.id === 'primary' && c.item ? { ...c, item: { ...c.item, skill: '1H Slashing' } } : c))
  assert.deepEqual(handsFromLooks(modelLooks(skillOnly, SHOW)), { primary: { skill: '1H Slashing' } })
  assert.deepEqual(handsFromLooks(modelLooks(views(), SHOW)), {}, 'no model and no skill: no weapon')
})

test('an ornament worn in a hand draws ITS model when ornaments are shown, and never lends the skill fallback', () => {
  const orb = { ornament: 'Crystalline Orb', ornamentId: 10218, ornamentModel: 'IT10512', skill: '1H Slashing', model: 'IT68' }
  const cells = views().map((c) => (c.id === 'primary' && c.item ? { ...c, item: { ...c.item, ...orb } } : c))
  assert.deepEqual(handsFromLooks(modelLooks(cells, SHOW)), { primary: { model: 'IT10512' } })
  assert.deepEqual(handsFromLooks(modelLooks(cells, PLAIN)), { primary: { model: 'IT68', skill: '1H Slashing' } })
})

test('an ornament worn on armour dresses the model in ITS material and dye when shown; hide it and the item is back', () => {
  const look = { ornamentId: 3043, ornamentMaterial: 2, ornamentColor: 0xff323232, material: 3, color: 0xffb4a032 }
  const cells = views().map((c) => (c.id === 'head' && c.item ? { ...c, item: { ...c.item, ...look } } : c))
  const shown = wearFromLooks(modelLooks(cells, SHOW))
  assert.equal(shown.helm, 2, 'the chain ornament, not the plate helm')
  assert.deepEqual(shown.tint?.helm?.map((v) => Math.round(v * 255)), [0x32, 0x32, 0x32])
  const plain = wearFromLooks(modelLooks(cells, PLAIN))
  assert.equal(plain.helm, 3)
  assert.deepEqual(plain.tint?.helm?.map((v) => Math.round(v * 255)), [0xb4, 0xa0, 0x32])
  const unknownOrnament = views().map((c) => (c.id === 'head' && c.item ? { ...c, item: { ...c.item, material: 3 } } : c))
  assert.equal(wearFromLooks(modelLooks(unknownOrnament, SHOW)).helm, 0, 'an ornament the table does not know reads by its name: the crown is no known make')
})

test('wear prefers the item table: material code over the name, and a dye becomes a tint', () => {
  const cells = views().map((c) => (c.id === 'chest' && c.item ? { ...c, item: { ...c.item, material: 3, color: 0xff2040c0 } } : c))
  const wear = wearFromLooks(modelLooks(cells, { showHelm: false, showOrnaments: false }))
  assert.equal(wear.ch, 3, 'the leather-named tunic is plate by the table, and the table wins')
  const later = views().map((c) => (c.id === 'chest' && c.item ? { ...c, item: { ...c.item, material: 23 } } : c))
  assert.equal(wearFromLooks(modelLooks(later, { showHelm: false, showOrnaments: false })).ch, 1, 'a later-era material code has no classic texture, so the name decides')
  assert.deepEqual(wear.tint?.ch?.map((v) => Math.round(v * 255)), [0x20, 0x40, 0xc0])
  assert.equal(tintOfColor(0), undefined)
  assert.equal(tintOfColor(0xff000000), undefined, 'black is the client\'s "no dye"')
  const noTable = wearFromLooks(modelLooks(views(), { showHelm: false, showOrnaments: false }))
  assert.equal(noTable.ch, 1, 'without the table, the name decides: a tunic is leather')
  assert.equal(noTable.tint, undefined)
})

// ---- previewing an item on the model (EQ Zera, "preview this item on my character") -----------

test('the model slot a wearable is tried in: paired slots take the first, a hand-only item the primary, ammo nothing', () => {
  assert.equal(modelSlotForEquip(['PRIMARY', 'SECONDARY']), 'primary', 'a one-hander that can go either side is drawn in the main hand')
  assert.equal(modelSlotForEquip(['SECONDARY']), 'secondary', 'a shield is secondary-only')
  assert.equal(modelSlotForEquip(['WRIST']), 'wrist1', 'a paired slot takes its first cell')
  assert.equal(modelSlotForEquip(['AMMO']), undefined, 'the model has no ammo cell at all')
  assert.equal(modelSlotForEquip([]), undefined, 'an item that equips nowhere is previewed nowhere')
})

test('a preview overrides ONE cell and writes nothing: the sheet keeps its own item and its own array', () => {
  const cells = views()
  assert.equal(applyPreview(cells, null), cells, 'no preview: the same array, by identity')

  const preview: PreviewLook = { item: 'Crown of Narandi', slot: 'head', model: 'IT240', materialCode: 2, color: 0xff203040 }
  const out = applyPreview(cells, preview)
  assert.equal(out.length, cells.length, 'a slot that exists is replaced, not appended to')
  const head = out.find((c) => c.id === 'head')
  assert.ok(head?.item)
  assert.deepEqual(
    { label: head.label, column: head.column, location: head.location },
    { label: 'Head', column: 'left', location: 'Head' },
    'the replaced cell keeps the sheet\'s own label, column and location'
  )
  const { name, model, material, color, known } = head.item
  assert.deepEqual(
    { name, model, material, color, known },
    { name: 'Crown of Narandi', model: 'IT240', material: 2, color: 0xff203040, known: true },
    'the item page is the evidence, so the previewed item is known and carries its look'
  )

  assert.equal(out.find((c) => c.id === 'chest'), cells.find((c) => c.id === 'chest'), 'every other cell is the same object')
  assert.equal(cells.find((c) => c.id === 'head')?.item?.baseName, 'Valorium Helmet', 'and the real sheet still wears the helm')
})

test('a preview for a slot the sheet has no cell for gains one, with that slot\'s own label', () => {
  const noLegs = views().filter((c) => c.id !== 'legs')
  const out = applyPreview(noLegs, { item: 'Crested Greaves', slot: 'legs', materialCode: 3 })
  assert.equal(out.length, noLegs.length + 1)
  const legs = out.at(-1)
  assert.equal(legs?.id, 'legs')
  assert.equal(legs?.label, 'Legs', 'the label comes from SHEET_SLOTS, never invented')
  assert.equal(legs?.column, 'right')
  assert.equal(legs?.location, 'Legs')
  assert.equal(legs?.item?.name, 'Crested Greaves')
})

test('the previewed cell feeds the real model: the chest takes its material, the hand takes its model', () => {
  const chest = applyPreview(views(), { item: 'Crafted Plate Breastplate', slot: 'chest', materialCode: 3 })
  assert.equal(wearFromLooks(modelLooks(chest, PLAIN)).ch, 3, 'the previewed plate dresses the chest, over the dump\'s leather tunic')
  assert.equal(wearFromLooks(modelLooks(views(), PLAIN)).ch, 1, 'and without the preview the tunic is back')

  const hand = applyPreview(views(), { item: 'Wu\'s Fist of Mastery', slot: 'primary', model: 'IT68' })
  assert.equal(handsFromLooks(modelLooks(hand, PLAIN)).primary?.model, 'IT68', 'the fist weapon, in place of the short sword')
})

test('the slots a preview cannot change a pixel of are jewellery and carried gear, never armour or a hand', () => {
  const drawn: readonly ModelSlotId[] = ['head', 'chest', 'arms', 'wrist1', 'wrist2', 'hands', 'legs', 'feet', 'primary', 'secondary']
  for (const id of drawn) {
    assert.ok(!INVISIBLE_MODEL_SLOTS.includes(id), `${id} is drawn, so it must not be listed as invisible`)
  }
  assert.ok(INVISIBLE_MODEL_SLOTS.includes('neck'), 'a neck piece moves the icon pin and nothing else')
})
