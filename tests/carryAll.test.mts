// EVERYTHING YOU CARRY (JOS-327) — the flattened dump, pinned against the real 295-line file.
//
// This is the seam the carry-all table reads: `shared/carryAll.ts` turns one `InventoryDump` into
// one flat row list plus the lanes that partition it, and the surface does nothing but filter and
// draw. So everything worth asserting about the table is assertable here, without a browser.
//
// FOUR THINGS ARE UNDER TEST, and they fail for different reasons:
//
//   THE ROWS ARE THE FILE. Every non-empty row of every table appears exactly once, in file order,
//   spelling its name the way the dump spelled it — ` +N` suffix, trailing `*`, ` (Exaltation)`
//   marker and all. Law 2 strips those at COUNTING boundaries and this is not one; a table that
//   quietly showed `Drop of Crystallized Flame` for a row that says `+7` would be answering a
//   question about item identity nobody asked.
//
//   EMPTY IS NOT CARRIED. The owner's dump enumerates 24 `Bank` slots and 6 `SharedBank` slots, all
//   `Empty`, on a game whose wiki states there is no shared bank at all. An `Empty` row is evidence
//   the client enumerated a slot, never evidence about a thing — so no row, and (measured below) no
//   Bank chip either, because a chip that filters to nothing is a control that can only disappoint.
//
//   THE LANES PARTITION. Every row is in exactly one lane, the lane counts sum to the row count,
//   and each lane holds what its name claims. This is the filter-chip contract in one test.
//
//   THE UNMEASURED SHAPES ARE HANDLED WITHOUT BEING NAMED. No dump in this repo or on the internet
//   contains Dragon's Hoard rows, so there is no `Dragon Hoard` chip — the awaiting-sample law. Both
//   shapes the hoard could take (a second item-shaped section; an unclassifiable base token in the
//   `Location` table) are driven here with SYNTHETIC text, which is legitimate because the subject
//   is this module's own classification and not a claim about what EQ prints. Those cases are
//   labelled as synthetic in their test names so nobody reads them as evidence.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseInventoryDump } from '../src/main/outputs/inventoryParse'
import { carryAll, laneLabel, SECTION_LANE_PREFIX } from '../src/shared/carryAll'
import { heldCountsFromDump, walkEntries } from '../src/shared/outputs/inventory'

const REAL_DUMP = readFileSync(
  join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Inventory.txt'),
  'utf8'
)
const dump = parseInventoryDump(REAL_DUMP)
const { rows, lanes } = carryAll(dump)

const laneCount = (id: string): number => lanes.find((l) => l.id === id)?.count ?? 0
const inLane = (id: string): typeof rows => rows.filter((r) => r.lane === id)

// ---- the rows are the file -------------------------------------------------------------

test('every non-empty row of the dump is carried, exactly once, in FILE ORDER', () => {
  // The independent count: walk the parsed tree ourselves rather than trusting the module's own
  // traversal, and add the keyring rows the same way `heldCountsFromDump` sees them.
  const items = [...walkEntries(dump.items)].filter((e) => !e.empty && e.name !== '')
  const keyRing = dump.keyRing.filter((k) => k.name !== '' && k.name !== 'Empty')
  assert.equal(rows.length, items.length + keyRing.length)
  assert.equal(rows.length, 123, 'the real dump holds 123 things')

  const lineNumbers = rows.map((r) => r.line)
  assert.equal(new Set(lineNumbers).size, rows.length, 'two rows claim one line of the file')
  assert.deepEqual(lineNumbers, [...lineNumbers].sort((a, b) => a - b), 'rows are not in file order')
})

test('the name is the dump’s own spelling - the ` +N`, the `*` and the `(Exaltation)`', () => {
  const byName = (name: string): (typeof rows)[number] | undefined => rows.find((r) => r.name === name)

  // A worn item at +7. The suffix is the whole reason this column is verbatim.
  const flame = byName('Drop of Crystallized Flame +7')
  assert.ok(flame, 'the +7 ear item lost its tier suffix')
  assert.equal(flame.location, 'Ear')

  // Three states of ONE item name, all present and all distinct — which is exactly what a player
  // opening this table is trying to tell apart.
  assert.equal(rows.filter((r) => r.name.startsWith('Moonstone Ring')).length, 4)
  assert.ok(byName('Moonstone Ring +1'), 'the +1 in a bag')
  assert.ok(byName('Moonstone Ring +3'), 'the +3 in a bag')
  assert.equal(rows.filter((r) => r.name === 'Moonstone Ring (Exaltation)').length, 2, 'two sockets')

  // The trailing `*`, whose meaning the file never states and which is therefore never stripped.
  const bandages = byName('Bandages*')
  assert.ok(bandages, 'the starred row was rewritten')
  assert.equal(bandages.count, 20)
})

test('the search key is the NAME ALONE - the chips own location, the box owns the item', () => {
  for (const row of rows) assert.equal(row.searchKey, row.name.toLowerCase())
  // The measurement the division of labour rests on: `KeyRing` is spelled into all 37 keyring
  // locations, so a location-inclusive haystack turns `ring` into a third of the whole table.
  const hits = rows.filter((r) => r.searchKey.includes('ring'))
  assert.equal(hits.length, 12)
  const withLocation = rows.filter((r) => `${r.name}\n${r.location}`.toLowerCase().includes('ring'))
  assert.equal(withLocation.length, 48, 'the noisy alternative, kept as the reason for the choice')
})

test('a count of 0 reads as 1 - the same rule heldCountsFromDump has always used', () => {
  for (const row of rows) assert.ok(row.count >= 1, `${row.name} carries a count of ${String(row.count)}`)
  // Stated counts survive: the stack of 86 daggers and the depot's two Griffenne Blood.
  assert.equal(rows.find((r) => r.name === 'Tiny Dagger')?.count, 86)
  assert.equal(rows.find((r) => r.name === 'Griffenne Blood')?.count, 2)

  // And the ledger agrees with the counts the rest of the app folds out of the same dump. The
  // keyring is the one place they diverge ON PURPOSE — `heldCountsFromDump` counts only the HELD
  // categories, this table lists every row the file wrote — so the comparison is over the item
  // tables, which is where a disagreement would mean one of the two is wrong.
  const held = heldCountsFromDump(dump)
  for (const row of rows) {
    if (row.lane === 'keyring') continue
    const total = held[row.name.toLowerCase()] ?? 0
    assert.ok(total >= row.count, `${row.name}: the ledger shows more than the fold counted`)
  }
})

test('an Empty row is a slot the client enumerated, and is NOT a thing you carry', () => {
  assert.equal(
    rows.filter((r) => r.name === 'Empty').length,
    0,
    'an Empty row reached the ledger'
  )
  // The measured proof it matters: the owner's dump enumerates all 24 bank and 6 shared-bank slots
  // and every one of them is Empty, so the Bank lane holds nothing and gets no chip at all.
  assert.ok(REAL_DUMP.includes('Bank1\tEmpty'), 'the fixture no longer proves the point')
  assert.equal(laneCount('bank'), 0)
  assert.ok(!lanes.some((l) => l.id === 'bank'), 'an empty lane must not draw a chip')
})

// ---- the lanes partition ---------------------------------------------------------------

test('the lanes partition the rows - every row in exactly one, and the counts add up', () => {
  const total = lanes.reduce((n, l) => n + l.count, 0)
  assert.equal(total, rows.length)
  for (const lane of lanes) assert.equal(lane.count, inLane(lane.id).length)
  assert.ok(lanes.every((l) => l.count > 0), 'a lane with no rows was emitted')
})

test('the real dump’s lanes are Worn, Bags, Depot and Key rings, in chip order', () => {
  assert.deepEqual(
    lanes.map((l) => `${l.id}:${l.label}:${String(l.count)}`),
    ['worn:Worn:28', 'bags:Bags:57', 'depot:Depot:1', 'keyring:Key rings:37']
  )
})

test('WORN is the equipment slots and their sockets - and nothing filed elsewhere', () => {
  const worn = inLane('worn')
  // The 24 top-level equipment rows minus the empty ones, plus the 6 exaltations socketed into them.
  assert.equal(worn.filter((r) => r.name.endsWith('(Exaltation)')).length, 6)
  // Every worn row's location is an equipment token, optionally with a `-Slot<n>` chain — never a
  // container. `Any Slot` is the client's own spelling of the slot-agnostic equipment slot.
  for (const row of worn) {
    assert.ok(
      !/^(General|Bank|SharedBank|Personal-Depot)/.test(row.location),
      `${row.name} is worn but filed at ${row.location}`
    )
  }
  assert.ok(worn.some((r) => r.location === 'Face-Slot7'), 'the socketed mask lost its path')
})

test('BAGS is the numbered General containers, at any depth', () => {
  const bags = inLane('bags')
  for (const row of bags) assert.match(row.location, /^General \d+/)
  // A bag row, the item in it, and the exaltation socketed into THAT item — three depths, one lane,
  // and each row's location path says exactly where it sits.
  assert.ok(bags.some((r) => r.location === 'General 1'), 'the rucksack itself is a thing you carry')
  assert.ok(bags.some((r) => r.location === 'General 1-Slot9'))
  assert.ok(bags.some((r) => r.location === 'General 1-Slot9-Slot7'))
})

test('DEPOT is the Personal Tradeskill Depot, whose base token carries a hyphen of its own', () => {
  const depot = inLane('depot')
  assert.equal(depot.length, 1)
  assert.equal(depot[0].location, 'Personal-Depot1')
  // The hyphen is NOT a path separator (`-Slot<n>` is), which is the one thing this location could
  // get wrong: a parser splitting on `-` would file this under a `Personal` row that does not exist.
  assert.equal(depot[0].name, 'Griffenne Blood')
})

test('KEY RINGS lists every category, including the one held counts refuse', () => {
  const keyring = inLane('keyring')
  assert.equal(keyring.length, 37)
  const categories = new Set(keyring.map((r) => r.location))
  assert.deepEqual([...categories].sort(), ['KeyRing / Activated', 'KeyRing / Equipment'])

  // `Activated` is deliberately OUT of `HELD_KEYRING_CATEGORIES` (nobody has measured whether it
  // holds a copy or a receipt) and deliberately IN here: this table lists what the file lists, which
  // is a weaker claim than "you own this" and does not need that evidence.
  const activated = keyring.filter((r) => r.location.endsWith('Activated'))
  assert.deepEqual(activated.map((r) => r.name), ['Guise of the Deceiver'])
  assert.equal(heldCountsFromDump(dump)['guise of the deceiver'], undefined)

  // A keyring row has no Count column at all, so a copy is one row — which is how the owner's dump
  // can list `Boots of the Long Road +1` twice without either row claiming a count of two.
  assert.equal(keyring.filter((r) => r.name === 'Boots of the Long Road +1').length, 2)
  for (const row of keyring) assert.equal(row.count, 1)
})

// ---- the shapes no dump has printed yet ------------------------------------------------
//
// SYNTHETIC INPUT, and the test names say so. The subject is this module's classification of a
// shape, not a claim that EQ prints it: `/outputfile inventory` is documented to export Dragon's
// Hoard rows and nobody has ever published a dump containing them, so both readings of "where would
// they land" are exercised rather than one of them being guessed at and hard-coded into a chip.

/** A tab-separated dump, written the way the client writes one (CRLF, header row per table). */
const synth = (...lines: string[]): string => `${lines.join('\r\n')}\r\n`

test('SYNTHETIC: a second item-shaped section becomes a lane labelled with its OWN name', () => {
  const text = synth(
    'Location\tName\tID\tCount\tSlots',
    'Head\tValorium Helmet +1\t1\t1\t10',
    '',
    "Dragon's Hoard\tName\tID\tCount\tSlots",
    "Dragon's Hoard1\tGolden Efreeti Boots\t4407\t1\t10"
  )
  const out = carryAll(parseInventoryDump(text))
  const id = `${SECTION_LANE_PREFIX}Dragon's Hoard`
  assert.deepEqual(
    out.lanes.map((l) => [l.id, l.label, l.count]),
    [
      ['worn', 'Worn', 1],
      [id, "Dragon's Hoard", 1]
    ]
  )
  // The location says which table it came from, since the base token alone would not.
  const hoard = out.rows.find((r) => r.lane === id)
  assert.equal(hoard?.location, "Dragon's Hoard / Dragon's Hoard1")
  // The chip reads what the CLIENT called the table. That is the whole design: the day a real hoard
  // dump exists, this surface names it correctly with no code change, and if the hoard turns out to
  // deserve a lane of its own, THAT is the edit a real dump earns.
  assert.equal(laneLabel(id), "Dragon's Hoard")
})

test('SYNTHETIC: an unclassifiable base token in the Location table lands in ELSEWHERE, visible', () => {
  const text = synth(
    'Location\tName\tID\tCount\tSlots',
    'Head\tValorium Helmet +1\t1\t1\t10',
    'DragonHoard3\tGolden Efreeti Boots\t4407\t1\t10'
  )
  const out = carryAll(parseInventoryDump(text))
  assert.deepEqual(
    out.lanes.map((l) => [l.id, l.label, l.count]),
    [
      ['worn', 'Worn', 1],
      ['elsewhere', 'Elsewhere', 1]
    ]
  )
  // Surfaced under the file's own spelling rather than dropped — the point of having the lane.
  assert.equal(out.rows.find((r) => r.lane === 'elsewhere')?.location, 'DragonHoard3')
})

test('SYNTHETIC: a dump with nothing in it produces no rows and no chips', () => {
  const out = carryAll(parseInventoryDump(synth('Location\tName\tID\tCount\tSlots', 'Head\tEmpty\t0\t0\t0')))
  assert.deepEqual(out.rows, [])
  assert.deepEqual(out.lanes, [])
})
