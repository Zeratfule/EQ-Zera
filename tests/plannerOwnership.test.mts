// ============================================================================
// THE OWNERSHIP INDEX (JOS-282, Gear Planner phase 1) — do I own it, where, at what +N.
// ============================================================================
//
// Two inputs, on purpose:
//
//   * A CONSTRUCTED dump, written row by row below and pushed through the REAL parser
//     (`parseInventoryDump`), so every place kind, every nesting shape and every counting
//     edge is exercised — including the ones the owner's real dump happens not to contain
//     (a non-empty SharedBank row, a base token we cannot classify, an orphaned child).
//     It is synthetic and says so; nothing here is a claim about a shape the client has
//     printed, only about how THIS fold reads shapes the model already defines.
//   * The REAL 295-line dump (`tests/fixtures/Primitive_freeport-Inventory.txt`), for the
//     invariants that must hold against bytes the game wrote: the index's copies and
//     `heldCountsFromDump`'s counts are the same number, every equipped row's slot is
//     `SLOT_OF_LOCATION`'s answer, and the `Activated` keyring row is in the dump and NOT
//     in the index.
//
// THE KEY-AGREEMENT ARM is the point of the last section. The ownership index files by
// `itemTierKey`; loot history counts by `itemCountKey`; the committed item corpus is filed by
// `itemsDb.itemKey`. Three homes for one law-2 rule, in three layers that cannot import each
// other. `tests/itemTierWindows.test.mts` set the precedent for pinning that family against
// the real log; this file pins it for the join the gear planner is about to make.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import {
  HELD_KEYRING_CATEGORIES,
  heldCountsFromDump,
  parseItemName,
  walkEntries
} from '../src/shared/outputs/inventory'
import { SLOT_OF_LOCATION } from '../src/shared/planner/inventorySlots'
import {
  highestTier,
  ownedCount,
  ownershipForLootName,
  ownershipIndex,
  ownershipKey,
  ownershipRowsFor,
  type OwnershipIndex,
  type OwnershipPlace,
  type OwnershipRow
} from '../src/shared/planner/ownership'
import { itemTierFromName, itemTierKey } from '../src/shared/itemStats'
import { itemKey } from '../src/main/itemsDb'
import { itemCountKey, itemVariantLevel } from '../src/renderer/src/lib/itemName'

const FIXTURES = join(import.meta.dirname, 'fixtures')
const REAL_DUMP = readFileSync(join(FIXTURES, 'Primitive_freeport-Inventory.txt'), 'utf8')

/** One tab-separated row of a dump. */
function row(...cols: string[]): string {
  return cols.join('\t')
}

/**
 * A CONSTRUCTED dump covering every place kind and every nesting shape. Hand-read totals live
 * in the assertions below; nothing is copied out of the code under test.
 *
 *   Head            an equipped `+2`, with an exaltation socketed into it
 *   Ear (twice)     the duplicate-base-token case, each ear with its OWN socket
 *   Any Slot / Held the two client tokens that name no wiki slot
 *   General 1       a bag, its contents, and a socket inside a bagged item (depth 2)
 *   General 2       the same crown again, with a Count of 0 (reads as one copy)
 *   Bank3           the same crown again at `+2` — a third row under one key
 *   SharedBank1/2   an `Empty` row (never ownership) and a real one
 *   Personal-Depot1 the compound base token that must NOT split into a `Depot1` sub-slot
 *   Mystery Place   a base token the model cannot classify — kept, never coerced
 *   KeyRing         two `Equipment` copies of one item, and the excluded `Activated` row
 */
const SYNTHETIC = [
  row('Location', 'Name', 'ID', 'Count', 'Slots'),
  row('Head', 'Crown of King Tranix +2', '1001', '1', '10'),
  row('Head-Slot7', 'Polished Mithril Mask (Exaltation)', '4505', '1', '10'),
  row('Ear', 'Sapphire Earring', '1002', '1', '10'),
  row('Ear-Slot7', 'Ruby Chip (Exaltation)', '20', '1', '10'),
  row('Ear', 'Golden Hoop +1', '1003', '1', '10'),
  row('Ear-Slot7', 'Emerald Chip (Exaltation)', '21', '1', '10'),
  row('Any Slot', 'Brigandine Tunic +1', '3307', '1', '10'),
  row('Held', 'Bandages*', '2000', '20', '0'),
  row('General 1', 'Spacious Rucksack', '177751', '1', '2'),
  row('General 1-Slot1', 'Kelin`s Seven Stringed Lute +1', '11573', '1', '10'),
  row('General 1-Slot1-Slot7', 'Kelin`s Seven Stringed Lute (Exaltation)', '11573', '1', '10'),
  row('General 1-Slot2', 'Empty', '0', '0', '0'),
  row('General 2', 'Crown of King Tranix', '1001', '0', '10'),
  row('Bank3', 'Crown of King Tranix +2', '1001', '1', '10'),
  row('SharedBank1', 'Empty', '0', '0', '0'),
  row('SharedBank2', 'Brigandine Tunic', '3307', '1', '10'),
  row('Personal-Depot1', 'Griffenne Blood', '5000', '42', '0'),
  row('Mystery Place', 'Odd Thing', '9999', '1', '0'),
  '',
  row('KeyRing', 'Name', 'ID', ''),
  row('Equipment', 'Boots of the Long Road +1', '177708'),
  row('Equipment', 'Boots of the Long Road +1', '177708'),
  row('Activated', 'Guise of the Deceiver', '4444')
].join('\n')

function syntheticIndex(): OwnershipIndex {
  return ownershipIndex(parseInventoryDump(SYNTHETIC))
}

/** Every row of an index, in key-insertion order — for whole-index invariants. */
function allRows(index: OwnershipIndex): OwnershipRow[] {
  return [...index.values()].flat()
}

/** The one row an index holds for a name, asserting there is exactly one. */
function onlyRow(index: OwnershipIndex, name: string): OwnershipRow {
  const rows = ownershipRowsFor(index, name)
  assert.equal(rows.length, 1, `exactly one row for ${name}`)
  return rows[0]
}

/** Re-spell a row's tier the way a loot line would print it. */
function lootSuffix(r: OwnershipRow): string {
  return r.tier === undefined ? '' : ` +${String(r.tier)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// PLACE KINDS — all six the dump can name, plus the honest seventh.
// ─────────────────────────────────────────────────────────────────────────────

test('every place kind the dump can name reaches the index', () => {
  const index = syntheticIndex()

  const crown = ownershipRowsFor(index, 'Crown of King Tranix')
  assert.equal(crown.length, 3, 'three copies of the crown, in three places')
  assert.deepEqual(
    crown.map((r) => r.place),
    ['equipped', 'inventory', 'bank'],
    'file order: worn, loose in a bag slot, in the bank'
  )

  const tunic = ownershipRowsFor(index, 'Brigandine Tunic')
  assert.deepEqual(
    tunic.map((r) => r.place),
    ['equipped', 'sharedBank'],
    'the shared bank is its own place'
  )

  const blood = onlyRow(index, 'Griffenne Blood')
  assert.equal(blood.place, 'personalDepot')
  assert.equal(blood.count, 42, 'the depot states a stack')

  const boots = ownershipRowsFor(index, 'Boots of the Long Road')
  assert.equal(boots.length, 2, 'a keyring copy is a ROW; the table has no Count column')
  assert.deepEqual(
    boots.map((r) => r.place),
    ['keyring', 'keyring']
  )
  assert.equal(boots[0].keyRingCategory, 'Equipment')
  assert.equal(ownedCount(boots), 2)

  const odd = onlyRow(index, 'Odd Thing')
  assert.equal(odd.place, 'unknown', 'a token we cannot classify is kept, never coerced')
  assert.equal(odd.basePlace?.kind, 'unknown')
  assert.equal(odd.basePlace?.raw, 'Mystery Place', 'the raw token survives for display')
  assert.equal(odd.slot, undefined, 'a non-equipment row names no slot')
})

test('Personal-Depot1 stays one base token — no invented Depot1 sub-slot', () => {
  const blood = onlyRow(syntheticIndex(), 'Griffenne Blood')
  assert.equal(blood.containment, 'top', 'the compound hyphen is not a `-Slot` chain')
  assert.equal(blood.parentName, undefined)
  assert.equal(blood.location, 'Personal-Depot1')
  assert.equal(blood.basePlace?.kind, 'container')
  assert.equal(
    blood.basePlace?.kind === 'container' ? blood.basePlace.container : null,
    'personalDepot'
  )
  assert.equal(blood.basePlace?.kind === 'container' ? blood.basePlace.index : null, 1)
})

test('the slot join is SLOT_OF_LOCATION and nothing else', () => {
  const index = syntheticIndex()

  assert.equal(ownershipRowsFor(index, 'Crown of King Tranix')[0].slot, 'HEAD')
  assert.equal(onlyRow(index, 'Sapphire Earring').slot, 'EAR')

  // The two client tokens that name no wiki slot name NULL, not a guess (inventorySlots.ts).
  assert.equal(ownershipRowsFor(index, 'Brigandine Tunic')[0].slot, null, '`Any Slot`')
  assert.equal(onlyRow(index, 'Bandages').slot, null, '`Held`')

  // …and the table is the only opinion in the tree: every equipped row agrees with it.
  for (const r of allRows(index)) {
    if (r.place !== 'equipped') continue
    assert.equal(r.basePlace?.kind, 'equip')
    const token = r.basePlace?.kind === 'equip' ? r.basePlace.token : null
    assert.notEqual(token, null)
    if (token !== null) assert.equal(r.slot, SLOT_OF_LOCATION[token])
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// NESTING — bag contents and exaltation sockets both live at `-Slot<n>`.
// ─────────────────────────────────────────────────────────────────────────────

test('a bag`s contents and an exaltation socket are told apart', () => {
  const index = syntheticIndex()

  const lute = ownershipRowsFor(index, 'Kelin`s Seven Stringed Lute')
  assert.equal(lute.length, 2, 'the bagged lute and the exaltation socketed into it')

  const bagged = lute[0]
  assert.equal(bagged.containment, 'bag', 'one level under a numbered container is CONTENTS')
  assert.equal(bagged.exaltation, false)
  assert.equal(bagged.parentName, 'Spacious Rucksack')
  assert.equal(bagged.place, 'inventory')
  assert.equal(bagged.tier, 1)

  const socketed = lute[1]
  assert.equal(socketed.containment, 'socket', 'the name says `(Exaltation)` — the file`s own word')
  assert.equal(socketed.exaltation, true)
  assert.equal(socketed.parentName, 'Kelin`s Seven Stringed Lute', 'depth 2: socket inside a bag')
  assert.equal(socketed.tier, undefined, 'the exaltation row carried no ` +N`')

  const mask = onlyRow(index, 'Polished Mithril Mask')
  assert.equal(mask.containment, 'socket')
  assert.equal(mask.parentName, 'Crown of King Tranix')
  assert.equal(mask.place, 'equipped', 'a socket in a worn item is worn')
  assert.equal(mask.slot, 'HEAD')

  const rucksack = onlyRow(index, 'Spacious Rucksack')
  assert.equal(rucksack.containment, 'top')
  assert.equal(rucksack.parentName, undefined)
})

test('duplicate base tokens keep their own children', () => {
  const index = syntheticIndex()
  // `Ear` prints twice at top level and BOTH ears print an `Ear-Slot7`. Each socket belongs to
  // the ear the client wrote immediately before it.
  assert.equal(onlyRow(index, 'Ruby Chip').parentName, 'Sapphire Earring')
  assert.equal(onlyRow(index, 'Emerald Chip').parentName, 'Golden Hoop')
})

test('an orphaned child is not attached to whatever row came before it', () => {
  const text = [
    row('Location', 'Name', 'ID', 'Count', 'Slots'),
    row('Head', 'Crown of King Tranix', '1001', '1', '10'),
    row('Ghost-Slot3', 'Orphan Blade', '77', '1', '10')
  ].join('\n')
  const orphan = onlyRow(ownershipIndex(parseInventoryDump(text)), 'Orphan Blade')
  assert.equal(orphan.parentName, undefined, 'its parent row was never printed')
  assert.equal(orphan.place, 'unknown', '`Ghost` is not a token we know')
})

// ─────────────────────────────────────────────────────────────────────────────
// +N VARIANTS, COUNTS, AND THE EMPTY ROW.
// ─────────────────────────────────────────────────────────────────────────────

test('a +N variant is its own ROW under the shared key, never its own key', () => {
  const index = syntheticIndex()

  const crown = ownershipRowsFor(index, 'Crown of King Tranix')
  assert.deepEqual(
    crown.map((r) => r.tier),
    [2, undefined, 2],
    'absent means the name carried no suffix — NOT +0'
  )
  assert.equal(highestTier(crown), 2)
  assert.deepEqual(
    crown.map((r) => r.key),
    ['crown of king tranix', 'crown of king tranix', 'crown of king tranix'],
    'one key for the family'
  )
  assert.equal(
    index.has('crown of king tranix +2'),
    false,
    'the suffix never becomes part of a key'
  )

  const tunic = ownershipRowsFor(index, 'Brigandine Tunic')
  assert.deepEqual(
    tunic.map((r) => r.tier),
    [1, undefined]
  )
  assert.equal(highestTier(tunic), 1)
  assert.equal(highestTier(ownershipRowsFor(index, 'Spacious Rucksack')), undefined)

  // Every spelling of the name reaches the same rows.
  assert.equal(ownershipRowsFor(index, 'crown of king tranix +9').length, 3)
})

test('counts follow heldCountsFromDump`s rule, and Empty is never ownership', () => {
  const index = syntheticIndex()

  assert.equal(onlyRow(index, 'Bandages').count, 20, 'the Count column, verbatim')
  const crown = ownershipRowsFor(index, 'Crown of King Tranix')
  assert.equal(crown[1].count, 1, 'a Count of 0 is one copy (the old parser`s rule)')
  assert.equal(ownedCount(crown), 3)

  assert.equal(index.has('empty'), false, 'an Empty row is an ENUMERATED slot, not an item')
  assert.equal(index.has(''), false)
  assert.equal(index.size, 13, 'thirteen distinct items in the constructed dump')
  assert.equal(allRows(index).length, 18, 'sixteen item rows plus two held keyring rows')
})

test('the index holds exactly the copies heldCountsFromDump counts', () => {
  for (const [what, text] of [
    ['the constructed dump', SYNTHETIC],
    ['the real 295-line dump', REAL_DUMP]
  ] as const) {
    const dump = parseInventoryDump(text)
    const held = heldCountsFromDump(dump)
    const heldTotal = Object.values(held).reduce((a, b) => a + b, 0)
    const index = ownershipIndex(dump)
    assert.equal(ownedCount(allRows(index)), heldTotal, `${what}: same copies, different shape`)
    assert.ok(
      index.size <= Object.keys(held).length,
      `${what}: the index folds ` + '`+N` variants that heldCounts keeps apart'
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// THE KEYRING, AND THE INHERITED `Activated` EXCLUSION.
// ─────────────────────────────────────────────────────────────────────────────

test('the Activated keyring category stays out — inherited, not re-decided', () => {
  assert.deepEqual(
    HELD_KEYRING_CATEGORIES,
    ['Equipment'],
    'the roster lives in shared/outputs/inventory.ts and this index reads it'
  )

  for (const [what, text] of [
    ['the constructed dump', SYNTHETIC],
    ['the real 295-line dump', REAL_DUMP]
  ] as const) {
    const dump = parseInventoryDump(text)
    const guise = dump.keyRing.filter((k) => k.name === 'Guise of the Deceiver')
    assert.equal(guise.length, 1, `${what}: the dump DOES carry the Activated row`)
    assert.equal(guise[0].category, 'Activated')

    const index = ownershipIndex(dump)
    assert.equal(
      index.has('guise of the deceiver'),
      false,
      `${what}: and the index does not count it (awaiting-sample law)`
    )
    for (const r of allRows(index)) {
      if (r.place === 'keyring') assert.equal(r.keyRingCategory, 'Equipment')
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// THE REAL DUMP.
// ─────────────────────────────────────────────────────────────────────────────

test('the real dump indexes into the places the client filed it under', () => {
  const dump = parseInventoryDump(REAL_DUMP)
  const index = ownershipIndex(dump)
  const places = new Set(allRows(index).map((r) => r.place))

  const want: OwnershipPlace[] = ['equipped', 'inventory', 'personalDepot', 'keyring']
  for (const p of want) assert.ok(places.has(p), `the real dump has a ${p} row`)
  assert.equal(places.has('unknown'), false, 'every base token in the real dump classifies')

  // The three `Boots of the Long Road` keyring rows the outputs header counts by hand:
  // base once, `+1` twice — one key, three rows, two of them tiered.
  const boots = ownershipRowsFor(index, 'Boots of the Long Road')
  assert.equal(boots.length, 3)
  assert.deepEqual(
    boots.map((r) => r.tier),
    [undefined, 1, 1]
  )
  assert.ok(
    boots.every((r) => r.place === 'keyring'),
    'the keyring is DISJOINT from the item table in this dump'
  )

  // Every row round-trips through the lookup, and every key is the key of its own name.
  for (const [key, rows] of index) {
    assert.equal(ownershipRowsFor(index, key).length, rows.length)
    for (const r of rows) assert.equal(r.key, key)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// KEY AGREEMENT — the itemTierWindows precedent, for the loot-history join.
// ─────────────────────────────────────────────────────────────────────────────

test('ownershipKey is itemCountKey is itemsDb`s itemKey', () => {
  const names = [
    'Crown of King Tranix',
    'Crown of King Tranix +2',
    'Cloak of Flames +10',
    'Kelin`s Seven Stringed Lute +1',
    'Sphinx Claw +1',
    'Boots of the Long Road',
    'Thelvorn, Blade of Light +5'
  ]
  for (const n of names) {
    assert.equal(ownershipKey(n), itemCountKey(n), n)
    assert.equal(ownershipKey(n), itemKey(n), n)
    assert.equal(ownershipKey(n), itemTierKey(n), n)
  }
})

test('the real dump`s names key the same way loot history keys them', () => {
  const dump = parseInventoryDump(REAL_DUMP)
  const index = ownershipIndex(dump)

  for (const e of walkEntries(dump.items)) {
    if (e.empty) continue
    const base = e.parsedName.base
    assert.equal(ownershipKey(base), itemCountKey(base), e.name)
  }

  // A row's tier and loot history's variant level are the same number on a `+N` name; the ONE
  // difference is the base case, where `itemVariantLevel` says 0 and this index says "the name
  // stated nothing". Assert both halves so neither can drift.
  for (const r of allRows(index)) {
    const spelled = `${r.name}${lootSuffix(r)}`
    assert.equal(itemVariantLevel(spelled), r.tier ?? 0, r.rawName)
    assert.equal(itemTierFromName(spelled), r.tier, r.rawName)
    assert.equal(ownershipKey(spelled), itemCountKey(spelled), r.rawName)
  }
})

test('the loot-history join flags what the dump does not hold', () => {
  const index = syntheticIndex()

  const owned = ownershipForLootName(index, 'Crown of King Tranix +4')
  assert.equal(owned.key, 'crown of king tranix')
  assert.equal(owned.tier, 4, 'the tier the LOOT line spelled, not the dump`s')
  assert.equal(owned.rows.length, 3)
  assert.equal(owned.missingFromDump, false)

  const gone = ownershipForLootName(index, 'Cloak of Flames +2')
  assert.deepEqual(gone.rows, [])
  assert.equal(gone.missingFromDump, true, 'looted once, in no dump row today')
  assert.equal(gone.key, itemCountKey('Cloak of Flames +2'), 'the loot key, exactly')

  const bare = ownershipForLootName(index, 'Crown of King Tranix')
  assert.equal(bare.tier, undefined, 'a name with no suffix stated no tier')
  assert.equal(bare.tier ?? 0, itemVariantLevel('Crown of King Tranix'), 'the documented offset')

  // A dump-only decoration never leaks into the key the loot line would produce.
  assert.equal(ownershipKey(parseItemName('Bandages*').base), itemCountKey('Bandages'))
  assert.equal(
    ownershipKey(parseItemName('Polished Mithril Mask (Exaltation)').base),
    itemCountKey('Polished Mithril Mask')
  )
})
