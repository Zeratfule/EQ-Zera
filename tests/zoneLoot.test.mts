// ROADMAP §2 — the Zone Loot joins: zone options, the (mob, drop) table, the filter and the tally.
//
// Two halves, the mobZone.test.mts shape. The first drives a hand-authored catalog so each rule is
// pinned in isolation (the `zoneKey` fold merging two spellings, the mob count that counts MOBS and
// not mentions, the sort). The second drives the REAL committed catalog
// (`data/eqlegends/mobs.json`), because the numbers this surface states are facts about bytes in
// the repo and a scrape that renamed a zone should fail HERE rather than silently show an empty
// table in the app.
//
// WHY KAESORA AND NOT CAZIC THULE for the era assertions. The mob-drops-era spec's famous split (7
// of 18 on the god's page) is a REVAMP, and a revamp is exactly the case `dropEraSubject` cannot
// see from the renderer: the witness is the item page's own era banner, which main attaches and
// which no renderer-side subject carries (zoneLoot.ts's header states this). Asked from here, all
// 18 read `in-era` - and so does every drop in the Cazic Thule ZONE, which is a different place
// again (the god lives in Plane of Fear). Kaesora is a Kunark crypt whose table this server's era
// genuinely does not open: 67 of its 111 drops are positively out of era, from the ZONE evidence
// alone, which is the layer this surface actually has.
//
// Pure: no Electron, no fixtures, NEVER skips. Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { MobEntry } from '../src/shared/types'
// RELATIVE, not `@shared/…`: these are VALUE imports and the alias only exists inside the vite
// build (mobSearch.ts documents the same constraint for the same reason).
import {
  filterRows,
  zoneLootRows,
  zoneLootSummary,
  zoneOptions,
  type ZoneLootRow,
  type ZoneUpgrade
} from '../src/renderer/src/features/zoneloot/zoneLoot'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json' with { type: 'json' }

/** A minimal catalog row — only the fields these joins read. One object, because `max-params` is 4. */
function entry(e: { page: string; name: string; level?: string; zones: string[]; drops?: string[] }): MobEntry {
  const row: MobEntry = { page: e.page, name: e.name, zones: e.zones }
  if (e.level !== undefined) row.level = e.level
  if (e.drops) row.drops = e.drops
  return row
}

const CATALOG: MobEntry[] = [
  entry({ page: 'm1', name: 'a lizard warder', level: '18-20', zones: ['Cazic Thule'], drops: ['Rusty Spear', 'Lizard Scale'] }),
  entry({ page: 'm2', name: 'a lizard broodling', level: '9-11', zones: ['Cazic-Thule'], drops: ['Lizard Scale'] }),
  entry({ page: 'm3', name: 'a temple guard', level: '30', zones: ['Cazic Thule', 'Cazic-Thule'], drops: ['Bronze Mace'] }),
  entry({ page: 'm4', name: 'a mute statue', zones: ['Cazic Thule'] }),
  entry({ page: 'm5', name: 'a froglok', level: '30', zones: ['Innothule Swamp'], drops: ['Bone Chips', 'Bone Chips'] })
]

const NO_SEEN = new Map<string, { drops: number; perHour: number | null }>()

const rowsFor = (zone: string, catalog: readonly MobEntry[] = CATALOG): ZoneLootRow[] =>
  zoneLootRows({ zone, catalog, seenByItem: NO_SEEN })

// =============================================================================
// 1. THE PICKER'S LIST
// =============================================================================

test('zoneOptions: two catalog spellings fold into ONE option, and the count counts MOBS', () => {
  const opts = zoneOptions(CATALOG)
  const ct = opts.find((o) => o.key === 'cazic thule')
  assert.ok(ct, 'the folded Cazic Thule option is missing')
  // Four distinct mobs reach the key; `a temple guard` spells BOTH names and must count once.
  assert.equal(ct.mobs, 4)
  assert.equal(ct.zone, 'Cazic Thule', 'the display name is the FIRST-SEEN spelling')
})

test('zoneOptions: sorted by display name, and a blank zone is not an option', () => {
  const opts = zoneOptions([...CATALOG, entry({ page: 'm6', name: 'a nobody', level: '1', zones: ['', '   '] })])
  assert.deepEqual(opts.map((o) => o.zone), ['Cazic Thule', 'Innothule Swamp'])
})

// =============================================================================
// 2. THE TABLE
// =============================================================================

test('zoneLootRows: one row per (mob, drop), mobs lowest level first, drops in page order', () => {
  const rows = rowsFor('The Cazic Thule')
  assert.deepEqual(
    rows.map((r) => `${r.mob}/${r.item}`),
    ['a lizard broodling/Lizard Scale', 'a lizard warder/Rusty Spear', 'a lizard warder/Lizard Scale', 'a temple guard/Bronze Mace']
  )
  // A mob with no loot contributes no row — and no empty one either.
  assert.ok(!rows.some((r) => r.mob === 'a mute statue'))
  assert.ok(rows.every((r) => r.item !== '' && r.itemKey !== ''))
})

test('zoneLootRows: the key is unique, carries the PAGE, and spells its separator as an escape', () => {
  const rows = rowsFor('Cazic Thule')
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length)
  assert.equal(rows[0].key, `${rows[0].mobPage}\u0001${rows[0].itemKey}`)
})

test('zoneLootRows: a drop listed twice on one page is ONE row (a React key is not a fact)', () => {
  const rows = rowsFor('Innothule Swamp')
  assert.deepEqual(rows.map((r) => r.item), ['Bone Chips'])
})

test('zoneLootRows: your own counts and rate ride in from the loot join, absent means never', () => {
  const seen = new Map([['lizard scale', { drops: 7, perHour: 1.25 }]])
  const rows = zoneLootRows({ zone: 'Cazic Thule', catalog: CATALOG, seenByItem: seen })
  const scale = rows.filter((r) => r.itemKey === 'lizard scale')
  assert.equal(scale.length, 2)
  for (const r of scale) {
    assert.equal(r.seen, 7)
    assert.equal(r.perHour, 1.25)
  }
  // NEVER A FAKE ZERO for the rate (the JOS-78 rule): unlooted is `0` seen and `null` per hour.
  const spear = rows.find((r) => r.itemKey === 'rusty spear')
  assert.equal(spear?.seen, 0)
  assert.equal(spear?.perHour, null)
})

test('zoneLootRows: an unknown zone is an empty table, never the whole catalog', () => {
  assert.deepEqual(rowsFor('Nowhere At All'), [])
  assert.deepEqual(rowsFor(''), [])
})

// =============================================================================
// 3. THE FILTER AND THE TALLY
// =============================================================================

test('filterRows: narrows by ITEM and by MOB, case-insensitively', () => {
  const rows = rowsFor('Cazic Thule')
  assert.deepEqual(filterRows(rows, 'LIZARD SCALE', true).map((r) => r.mob), ['a lizard broodling', 'a lizard warder'])
  assert.deepEqual(filterRows(rows, 'temple', true).map((r) => r.item), ['Bronze Mace'])
  assert.equal(filterRows(rows, 'nothing matches this', true).length, 0)
  assert.equal(filterRows(rows, '   ', true).length, rows.length)
})

test('zoneLootSummary: mobs are DISTINCT pages, drops are rows, seen is a sum', () => {
  const seen = new Map([['lizard scale', { drops: 7, perHour: null }]])
  const rows = zoneLootRows({ zone: 'Cazic Thule', catalog: CATALOG, seenByItem: seen })
  assert.deepEqual(zoneLootSummary(rows), { mobs: 3, drops: 4, outOfEra: 0, seen: 14, upgrades: 0 })
  assert.deepEqual(zoneLootSummary([]), { mobs: 0, drops: 0, outOfEra: 0, seen: 0, upgrades: 0 })
})

// =============================================================================
// 4. THE REAL COMMITTED CATALOG
// =============================================================================

const REAL: MobEntry[] = (mobsJson as unknown as { mobs: MobEntry[] }).mobs

test('zoneOptions over the REAL catalog: 189 zones, Cazic Thule folded to one 30-mob option', () => {
  const opts = zoneOptions(REAL)
  // 185 -> 186 on the 2026-10-07 rescrape, and the one new option is a SPELLING, not a place:
  // `The Lair of the Splitpaw` (one row, Nisch Mal Gnoll), which is `shared/zones.ts`'s own `paw`
  // name beside the catalog's `Splitpaw Lair` (31) and `Infected Paw` (1). The picker folds on
  // `zoneKey` only, so all three were never going to merge here - `Splitpaw Lair` and `Infected
  // Paw` were already two options before - while `mobsInZone` joins the verified aliases, so any
  // of the three serves the same bestiary. Nothing else in the option list appeared or vanished.
  // 186 -> 189 on the 2026-11-15 rescrape (the Oct 22 Castle Nektropos patch): +3 real zones (Nektropos Castle, Lake Nerius, Nektropos
  // Undercrofts), -1 `Lake of Ill Omen.` (the wiki dropped the stray full stop, so it folds into
  // the real zone), and +1 WIKI TYPO: `a moss snake`'s page lists "Toxxulia Forest Lake Nerius"
  // with the comma missing, a one-mob option that is fixed on the wiki, never papered over here.
  assert.equal(opts.length, 189, 'the committed catalog stopped yielding 189 folded zones')
  // The corpus spells it `Cazic Thule` (28 rows) AND `Cazic-Thule` (2); the fold is why this is one
  // option and not two, and 30 is the number the picker states beside it.
  const ct = opts.find((o) => o.zone === 'Cazic Thule')
  assert.ok(ct, "the catalog no longer spells a zone 'Cazic Thule'")
  assert.equal(ct.mobs, 30)
  // Sorted by display name, so the reader can scan for a place they can already name.
  const names = opts.map((o) => o.zone)
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)))
})

test('zoneLootRows over the REAL catalog: Cazic Thule is 61 drops across 21 mobs', () => {
  // 42/15 -> 47/14 on the 2026-10-07 rescrape, all of it the wiki's own edits: `a lizard
  // ritualist` gained five Rubicite drops (1 -> 6), `Cazic Cenobite` and `Tae Ew Templar`/`Diviner`
  // gained Lizard Meat/Tail rows (+4), and `Tae Ew Archon` LEFT the table - its page (rev
  // 2026-09-04) rewrote `|known_loot` from `{{:Item}}` transclusions to plain `[[Item]]` links.
  // 47/14 -> 61/21 when `parseMobLoot` learned to read a loot LINK whose target is an item page
  // (same 2026-10-18 cache, offline reparse): +14 edges on 7 mobs, each hand-checked as a loot list
  // entry - Tae Ew Archon is back (+4), a lizard judicator (+3 Words), a lizard page (+2), a lizard
  // warder (+2), a lizard defender (+1), and the `Cazic-Thule`-spelled a dwarven merc / a gnomish
  // mage (+1 each). The group link "Fine Steel Weapons" on the Archon's list is NOT read.
  const rows = zoneLootRows({ zone: 'Cazic Thule', catalog: REAL, seenByItem: NO_SEEN })
  assert.deepEqual(zoneLootSummary(rows), { mobs: 21, drops: 61, outOfEra: 0, seen: 0, upgrades: 0 })
  assert.ok(rows.every((r) => r.item.trim() !== ''), 'a drop row carried an empty item name')
  assert.ok(rows.every((r) => r.mobPage !== '' && r.era.key === r.itemKey))
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'a row key collided')
})

test('zoneLootRows over the REAL catalog: Kaesora folds 72 of its 117 drops out of era', () => {
  // 111/67/44 -> 117/72/45 when `parseMobLoot` learned to read item-page loot LINKS: the only new
  // mob is `Strathbone spider` (Kaesora/Temple of Droga/Mines of Nurga), whose list is six links,
  // all hand-checked list entries; five fold out of era (the Strathbone/Truesilver set its siblings
  // already fold) and Spider Legs is shown.
  const rows = zoneLootRows({ zone: 'Kaesora', catalog: REAL, seenByItem: NO_SEEN })
  const summary = zoneLootSummary(rows)
  assert.equal(summary.drops, 117)
  assert.equal(summary.outOfEra, 72)
  // The DISCLOSURE, not a deletion: hidden + folded = the wiki's whole claim, always.
  const shown = filterRows(rows, '', false)
  const all = filterRows(rows, '', true)
  assert.equal(shown.length, 45)
  assert.equal(all.length, 117)
  assert.equal(shown.length + summary.outOfEra, all.length)
  // …and nothing shown is one of the folded ones.
  assert.ok(!shown.some((r) => r.outOfEra))
})

test('filterRows over the REAL catalog: the search narrows within the era fold', () => {
  const rows = zoneLootRows({ zone: 'Kaesora', catalog: REAL, seenByItem: NO_SEEN })
  const steel = filterRows(rows, 'fine steel', true)
  assert.ok(steel.length > 0, 'Kaesora no longer lists any Fine Steel drop')
  assert.ok(steel.every((r) => r.itemKey.includes('fine steel')))
  const librarian = filterRows(rows, 'librarian', true)
  assert.ok(librarian.length > 0, 'Kaesora no longer lists a spectral librarian')
  assert.ok(librarian.every((r) => r.mob.toLowerCase().includes('librarian')))
})

// =============================================================================
// 5. THE UPGRADE JOIN (EQ Zera)
// =============================================================================
//
// The verdict is INJECTED (`ZoneLootArgs.verdict`) precisely so it can be driven from here: the
// real one needs the gear index, the inventory dump and three React hooks. What this half pins is
// the JOIN — that a verdict reaches every row for its item, that it is asked once per distinct
// item and not once per (mob, drop), that a row without one carries no field at all, and that the
// filter and the tally read the same fact the chip does.

/** A verdict function over a small allow-list, counting how often it was actually asked. */
function verdictOver(byItem: Readonly<Record<string, ZoneUpgrade>>): {
  fn: (item: string) => ZoneUpgrade | null
  asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    fn: (item: string): ZoneUpgrade | null => {
      asked.push(item)
      return byItem[item] ?? null
    }
  }
}

const SCALE_UP: ZoneUpgrade = { cell: 'CHEST', delta: 14, againstNothing: false }

test('zoneLootRows: the verdict reaches every row for its item, and is asked ONCE per item', () => {
  const v = verdictOver({ 'Lizard Scale': SCALE_UP })
  const rows = zoneLootRows({ zone: 'Cazic Thule', catalog: CATALOG, seenByItem: NO_SEEN, verdict: v.fn })
  const scale = rows.filter((r) => r.itemKey === 'lizard scale')
  assert.equal(scale.length, 2, 'two mobs drop it')
  for (const r of scale) assert.deepEqual(r.upgrade, SCALE_UP)
  // Everything else carries NO field — absent is the honest answer, never a zero-gain verdict.
  for (const r of rows) {
    if (r.itemKey !== 'lizard scale') assert.equal(r.upgrade, undefined)
  }
  assert.deepEqual(v.asked, ['Lizard Scale', 'Rusty Spear', 'Bronze Mace'], 'one ask per distinct item, in the table order')
})

test('zoneLootRows: no verdict function is a table with no verdicts, not a table of refusals', () => {
  const rows = rowsFor('Cazic Thule')
  assert.ok(rows.every((r) => r.upgrade === undefined))
  assert.equal(zoneLootSummary(rows).upgrades, 0)
})

test('filterRows: upgradesOnly keeps the flagged rows, and composes with the search and the era fold', () => {
  const v = verdictOver({ 'Lizard Scale': SCALE_UP, 'Bronze Mace': { cell: 'PRIMARY', delta: 3, againstNothing: true } })
  const rows = zoneLootRows({ zone: 'Cazic Thule', catalog: CATALOG, seenByItem: NO_SEEN, verdict: v.fn })
  assert.equal(filterRows(rows, '', true, false).length, 4)
  assert.deepEqual(
    filterRows(rows, '', true, true).map((r) => r.item),
    ['Lizard Scale', 'Lizard Scale', 'Bronze Mace']
  )
  // The search still applies on top of it.
  assert.deepEqual(filterRows(rows, 'temple', true, true).map((r) => r.item), ['Bronze Mace'])
  assert.equal(filterRows(rows, 'rusty', true, true).length, 0, 'a row with no verdict is not an upgrade')
})

test('zoneLootSummary: `upgrades` counts flagged ROWS, which is what the footer states', () => {
  const v = verdictOver({ 'Lizard Scale': SCALE_UP })
  const rows = zoneLootRows({ zone: 'Cazic Thule', catalog: CATALOG, seenByItem: NO_SEEN, verdict: v.fn })
  assert.equal(zoneLootSummary(rows).upgrades, 2, 'one item, two mobs, two rows')
  assert.equal(zoneLootSummary(filterRows(rows, '', true, true)).upgrades, 2)
})
