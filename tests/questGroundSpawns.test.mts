// QUEST GROUND SPAWNS: the table parser (scripts/sources/questGroundSpawns.ts) and the read-time
// resolver (src/shared/questGroundSpawns.ts), against the REAL committed pages and catalog.
//
// What is pinned: "The Tragic Tale of House Everling" (cache page-72870) exactly — the four
// harpsichord pieces at the points its table states, in /loc order, each on the Nektropos Castle map,
// plus the ruined harpsichord they combine in; Tarton's Wheel's ten rods each in the zone its own row
// states; and, inline, every refusal the survey of the cache taught (a dropper column, an NPC table,
// a table that never says "ground", a bare number that is not a coordinate). Then the resolver's
// conservatism: a table whose section names two zones and whose rows name none gets NO map.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { groundSpawnsOf } from '../scripts/sources/questGroundSpawns'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json'
import type { MobData, QuestData, QuestEntry, QuestGroundSpawn } from '../src/shared/types'
import { buildMobIndex, questLocations } from '../src/shared/questLocations'
import { groundSpawnLocs } from '../src/shared/questGroundSpawns'
import { questPinsInZone } from '../src/shared/questMapPins'

const CACHE = join(import.meta.dirname, '..', 'scripts', 'sources', 'cache', 'quests')
const page = (id: number): string => readFileSync(join(CACHE, `page-${String(id)}.wikitext`), 'utf8')
const quests = (questsJson as unknown as QuestData).quests
const mobs = (mobsJson as unknown as MobData).mobs
const index = buildMobIndex(mobs, quests.map((q) => q.page))
const quest = (name: string): QuestEntry => {
  const q = quests.find((x) => x.page === name)
  assert.ok(q, `quest ${name} is in the catalog`)
  return q
}
const at = (s: QuestGroundSpawn): string => `${s.item} (${[s.ns, s.ew, ...(s.z === undefined ? [] : [s.z])].join(', ')})`

test('REAL PAGE: Tragic Tale keeps the four harpsichord pieces at their table points, and the harpsichord', () => {
  const spawns = groundSpawnsOf(page(72870), () => false)
  assert.deepEqual(spawns.map(at), [
    'Harpsichord Black Key (-37, 130)',
    'Harpsichord White Key (710, 105)',
    'Harpsichord String (120, -151)',
    'Harpsichord Plectrum (-23, -100)',
    'ruined harpsichord (368, 65)'
  ])
  assert.deepEqual(spawns.map((s) => s.kind ?? 'ground'), ['ground', 'ground', 'ground', 'ground', 'object'])
  // The table states no zone; the NPC its note names is a link the resolver reads.
  assert.ok(spawns.every((s) => s.zone === undefined))
  assert.deepEqual(spawns[0].links, [{ page: 'The Game Master' }])
  assert.match(spawns[0].note ?? '', /chessboard in front of The Game Master/)
  assert.match(spawns[0].context ?? '', /^Castle Access and Library Key: .*Nektropos Castle/)
})

test('/LOC ORDER: the table writes north-south first, as the bestiary does — the NPC beside each piece agrees', () => {
  const spawns = groundSpawnsOf(page(72870), () => false)
  // "on the chessboard in front of The Game Master; the NPC is at (-34, 118, -7)": his own page, same order.
  const gm = mobs.find((m) => m.page === 'The Game Master')
  const ut = mobs.find((m) => m.page === 'Tormentor Utzain')
  assert.deepEqual(gm?.loc?.[0], { ns: -34, ew: 118, z: -7 })
  assert.deepEqual(ut?.loc?.[0], { ns: 142, ew: -146, z: -7 })
  const near = (s: QuestGroundSpawn, l: { ns: number; ew: number }): boolean => Math.abs(s.ns - l.ns) <= 25 && Math.abs(s.ew - l.ew) <= 25
  assert.ok(gm?.loc && near(spawns[0], gm.loc[0]), 'the black key lies beside The Game Master')
  assert.ok(ut?.loc && near(spawns[2], ut.loc[0]), 'the string lies beside Tormentor Utzain')
})

test('REAL PAGE: Tarton’s Wheel keeps ten rods, each with the zone its own row states', () => {
  const spawns = groundSpawnsOf(page(15322), () => false)
  assert.equal(spawns.length, 10)
  assert.deepEqual(spawns.slice(0, 3).map((s) => `${at(s)} ${s.zone ?? '-'}`), [
    "Azia (-1159, 2329) Erud's Crossing",
    'Beza (5000, -5100) Everfrost Peaks',
    'Caza (2782, 142, -372) Lake Rathetear'
  ])
  assert.equal(spawns.find((s) => s.item === 'Izah')?.zone, 'Neriak Commons')
  // A {{Loc}} inside a note renders as its point instead of vanishing.
  assert.match(spawns.find((s) => s.item === 'Caza')?.note ?? '', /Cave entrance is at Lake Rathetear \(2826, -907, -171\)/)
})

const table = (head: string, rows: string[], lead = 'Collect these ground spawns:'): string =>
  `== Walkthrough ==\n${lead}\n{| class="wikitable"\n! ${head}\n${rows.map((r) => `|-\n| ${r}`).join('\n')}\n|}\n`

test('INLINE: bracketed, bare-cell and {{Loc}} coordinates; attributes and template pipes never split a cell', () => {
  const wt = table('Item !! Location !! Notes', [
    '[[Silver Ring]] || (12, -34, 5) || in the pit',
    'Bone Shard || -100, 200 || by the tree',
    'style="text-align:left" | [[Pearl of Odus]] || {{Loc|Erudin|(-275, -460)}} || underwater'
  ])
  assert.deepEqual(groundSpawnsOf(wt).map((s) => `${at(s)}|${s.zone ?? '-'}|${s.note ?? ''}`), [
    'Silver Ring (12, -34, 5)|-|in the pit',
    'Bone Shard (-100, 200)|-|by the tree',
    'Pearl of Odus (-275, -460)|Erudin|underwater'
  ])
})

test('INLINE REFUSALS: what the survey found that is NOT a ground-spawn table', () => {
  // The Plane of Sky tests: a dropper column, and "Islands 1.5, 4, 8" is not a coordinate anyway.
  assert.deepEqual(groundSpawnsOf(table('Item || Who || Where', ['[[Brass Knuckles]] || [[Noble Dojorn]] || Islands 1.5, 4 and 8'])), [])
  // The Betrayer: an NPC table, no item column.
  assert.deepEqual(groundSpawnsOf(table('Sister !! Recorded location', ['[[Jenni Everling]] || (342, -423, 17)'])), [])
  // Items with coordinates that never say they are on the ground: a camp list could look the same.
  assert.deepEqual(groundSpawnsOf(table('Item !! Location', ['[[Bone Chips]] || (10, 20)'], 'Camp these:')), [])
  // A location cell that states no point is no row; a quantity is not a point.
  assert.deepEqual(groundSpawnsOf(table('Item !! Location', ['[[Bone Chips]] || the second floor', '[[Rat Ear]] || 48,000 exp'])), [])
  // The questTopTable is the page's header block, never a table of things.
  assert.deepEqual(groundSpawnsOf('{| class="questTopTable"\n! Item !! Ground spawn location\n|-\n| [[X]] || (1, 2)\n|}\n'), [])
})

const chipsOf = (q: QuestEntry): string[] => groundSpawnLocs(q, index).map(({ spawn, chip }) => `${spawn.item}|${chip.zone ?? 'NOMAP'}|${chip.loc ? `${String(chip.loc.ns)},${String(chip.loc.ew)}` : '-'}|${chip.sources.join('+')}`)

test('RESOLVER, REAL CATALOG: every Tragic Tale piece jumps to Nektropos Castle at its own point, from the quest page', () => {
  assert.deepEqual(chipsOf(quest('The Tragic Tale of House Everling')), [
    'Harpsichord Black Key|nektropos|-37,130|quest',
    'Harpsichord White Key|nektropos|710,105|quest',
    'Harpsichord String|nektropos|120,-151|quest',
    'Harpsichord Plectrum|nektropos|-23,-100|quest',
    'ruined harpsichord|nektropos|368,65|quest'
  ])
  const why = groundSpawnLocs(quest('The Tragic Tale of House Everling'), index).map((g) => g.chip.why)
  assert.match(why[0], /The Game Master \(linked in the step\) lives in Nektropos Castle/)
  assert.match(why[1], /the walkthrough was last in Nektropos Castle/)
})

test('RESOLVER, REAL CATALOG: each rod goes to the map its own row names (rule 0), never the start zone', () => {
  const rods = chipsOf(quest("Tarton's Wheel"))
  assert.equal(rods.length, 10)
  assert.ok(rods.includes('Azia|erudsxing|-1159,2329|quest'))
  assert.ok(rods.includes('Jaka|unrest|520,-285|quest'))
  assert.ok(!rods.some((r) => r.includes('|everfrost|') && !r.startsWith('Beza|')), 'only the Everfrost rod is on Everfrost')
})

test('RESOLVER REFUSES: a section naming two zones and a row naming none is no map, and so is a point off the spread', () => {
  const base = quest('The Tragic Tale of House Everling')
  const two: QuestEntry = { ...base, groundSpawns: [{ item: 'Harpsichord White Key', ns: 710, ew: 105, context: 'Some pieces are in Lake Nerius. The others are in Nektropos Castle.' }] }
  const [lost] = groundSpawnLocs(two, index)
  assert.equal(lost.chip.zone, undefined)
  assert.deepEqual(lost.chip.loc, { ns: 710, ew: 105 })
  const far: QuestEntry = { ...base, groundSpawns: [{ item: 'Harpsichord White Key', ns: 9000, ew: 9000, context: 'Inside Nektropos Castle.' }] }
  assert.equal(groundSpawnLocs(far, index)[0].chip.zone, undefined, 'a point outside the castle never gets the castle map')
})

test('PINS: a tracked quest’s ground spawns are on its zone’s quest layer, labelled as ground spawns', () => {
  const q = quest('The Tragic Tale of House Everling')
  const pins = questPinsInZone([{ page: q.page, name: q.name, locs: questLocations(q, index) }], 'nektropos')
  const labels = pins.flatMap((p) => p.labels)
  assert.ok(labels.includes('The Tragic Tale of House Everling - Harpsichord Black Key (ground spawn)'), JSON.stringify(labels))
  assert.ok(labels.includes('The Tragic Tale of House Everling - ruined harpsichord'))
  // The map file's own extent still has the last word.
  assert.deepEqual(questPinsInZone([{ page: q.page, name: q.name, locs: questLocations(q, index) }], 'nektropos', () => false), [])
})

test('CATALOG LAW: every committed ground spawn names its item and a real point', () => {
  const all = quests.flatMap((q) => q.groundSpawns ?? [])
  assert.ok(all.length >= 15, `expected the two surveyed tables, got ${String(all.length)}`)
  for (const s of all) {
    assert.ok(s.item.trim() !== '')
    assert.ok(Number.isFinite(s.ns) && Number.isFinite(s.ew) && Math.abs(s.ns) <= 20000 && Math.abs(s.ew) <= 20000)
  }
})
