// aaCatalog.test.mts — the AA catalog parser (scripts/sources/aaCatalog.ts) on a TRIMMED copy of
// the real wiki page (tests/fixtures/eqlwiki-aa-trimmed.wikitext: verbatim rows, one of every
// irregular shape the page has), and invariants of the COMMITTED
// src/renderer/src/data/eqlegends/aaCatalog.json, which must be exactly what the parser makes of
// the committed cache (scripts/sources/cache/aa).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAaCatalog, parseCosts, parseRequirements, tableRowCells } from '../scripts/sources/aaCatalog'
import type { AaCatalogData, AaCatalogEntry } from '../src/shared/aaCatalog'

const ROOT = join(import.meta.dirname, '..')
const FIXTURE = readFileSync(join(ROOT, 'tests/fixtures/eqlwiki-aa-trimmed.wikitext'), 'utf8').replace(/\r\n/g, '\n')
const parsed = parseAaCatalog(FIXTURE)
const byName = (name: string, list: AaCatalogEntry[] = parsed): AaCatalogEntry => {
  const e = list.find((x) => x.name === name)
  assert.ok(e, `${name} is in the catalog`)
  return e
}

test('every section is read, and a class AA two classes list is one entry naming both', () => {
  const sections = parsed.map((e) => e.section)
  assert.equal(sections.filter((s) => s === 'general').length, 3)
  assert.equal(sections.filter((s) => s === 'archetype').length, 6)
  assert.equal(sections.filter((s) => s === 'special').length, 5)
  const qe = byName('Quick Evacuation')
  assert.deepEqual(qe.classes, ['DRU', 'WIZ'])
  assert.ok(qe.issues?.some((i) => i.includes('also listed under WIZ')), 'the two listings disagree, and the entry says so')
})

test('costs: per rank, `?` is unknown (never 0), `N for all ranks`, a lone 0 on a multi-rank AA', () => {
  assert.deepEqual(byName('Adamant Will').costs, [2, 4, 6, 9])
  assert.deepEqual(byName('Packrat').costs, Array(10).fill(1))
  assert.deepEqual(byName('Turn Summoned').costs, [3, 6, null])
  assert.deepEqual(byName('Unbound Versatility').costs, [0, 0, 0])
  const issues: string[] = []
  assert.deepEqual(parseCosts('3/6', 3, issues), [3, 6, null])
  assert.equal(issues.length, 1, 'a cost list shorter than the ranks is flagged')
})

test('rows written one cell per line, and a description that runs onto a second line, are read whole', () => {
  const fp = byName('Full Potential')
  assert.equal(fp.maxRank, 1)
  assert.deepEqual(fp.costs, [0])
  assert.deepEqual(fp.req.levels, [50])
  assert.equal(byName('Point Blank Fire').section, 'archetype')
  const cam = byName('Innate Camouflage')
  assert.match(cam.description, /7-second cooldown/)
  assert.deepEqual(cam.req.levels, [40])
  assert.equal(cam.issues, undefined)
})

test('requirements: level per rank, prerequisite AAs in both spellings, prose gates', () => {
  assert.deepEqual(byName('Unbound Versatility').req.levels, [12, 30, 50])
  assert.deepEqual(byName('Destructive Fury').req.prereqs, [{ name: 'Fury of Magic', ranks: [1] }])
  assert.deepEqual(byName('Destructive Cascade').req.prereqs, [{ name: 'Critical Affliction', ranks: [1, 2, 3] }])
  // "Rank 2 requires level 59" raises rank 2 and above.
  assert.deepEqual(byName('Turn Summoned').req.levels, [45, 59, 59])
  const r = parseRequirements('Does a thing. Requirements: Level 10, Must spend 30 ability points, wear a hat.', 1)
  assert.equal(r.description, 'Does a thing.')
  assert.deepEqual(r.req.levels, [10])
  assert.equal(r.req.pointsSpent, 30)
  assert.deepEqual(r.req.unparsed, ['wear a hat'], 'a piece the parser cannot read is kept verbatim')
})

test('a struck-through row is kept and marked removed', () => {
  const v = byName('Valiant Steed')
  assert.equal(v.removed, true)
  assert.deepEqual(v.req.prereqs, [{ name: 'Holy Steed', ranks: [1] }])
})

test('names are the client spelling; the wiki spelling is kept when it differs', () => {
  assert.equal(byName('Unbound Strikethrough').wikiName, 'Unbounded Strikethrough')
  assert.equal(byName('Warriors Endurance').wikiName, "Warrior's Endurance")
  const barb = byName('Race Reincarnation: Barbarian')
  assert.equal(barb.wikiName, 'Class Reincarnation: Barbarian')
  assert.equal(byName('Class Reincarnation: Bard').wikiName, undefined, 'a class reincarnation keeps its name')
})

test('Special AAs are granted, carry their rank values, and a garbled row says so', () => {
  const bard = byName('Class Reincarnation: Bard')
  assert.equal(bard.granted, 'reincarnation')
  assert.deepEqual(bard.costs, [])
  assert.deepEqual(bard.rankValues, ['3', '6', '9'])
  assert.match(bard.activated ?? '', /^Fading Memories/)
  assert.deepEqual(byName('Race Reincarnation: Halfling').rankValues, ['15%', '30', '45'], 'the `|||` row still reads')
  assert.equal(byName('Reincarnation: Completionist').granted, 'reincarnation')
  const bane = byName('Banestrike')
  assert.equal(bane.granted, 'achievement')
  assert.ok(bane.issues?.some((i) => i.includes('rankIV')), 'the garbled rank column is flagged, not dropped')
})

test('the tokenizer ignores header rows', () => {
  const rows = tableRowCells('{| class="x"\n! colspan="4" | Bard\n|-\n! Name !! Ranks\n|-\n| A || 1 || 2 || d\n|}')
  assert.deepEqual(rows, [['A', '1', '2', 'd']])
})

const COMMITTED = JSON.parse(readFileSync(join(ROOT, 'src/renderer/src/data/eqlegends/aaCatalog.json'), 'utf8')) as AaCatalogData
const CACHE = readFileSync(join(ROOT, 'scripts/sources/cache/aa/Alternate_Advancement.wikitext'), 'utf8').replace(/\r\n/g, '\n')

test('the committed catalog is exactly what the parser makes of the committed cache', () => {
  assert.deepEqual(COMMITTED.entries, parseAaCatalog(CACHE))
})

test('committed catalog invariants', () => {
  const entries = COMMITTED.entries
  assert.ok(entries.length >= 170, `${String(entries.length)} AAs`)
  const keys = new Set<string>()
  for (const e of entries) {
    assert.ok(!keys.has(e.name.toLowerCase()), `${e.name} appears once`)
    keys.add(e.name.toLowerCase())
    assert.ok(e.maxRank >= 1, `${e.name} has a rank`)
    if (e.section === 'special') {
      assert.ok(e.granted !== undefined && e.costs.length === 0, `${e.name}: special is granted, never priced`)
    } else {
      assert.equal(e.costs.length, e.maxRank, `${e.name}: one cost per rank`)
      assert.equal(e.granted, undefined)
    }
    if (e.section === 'class') assert.ok((e.classes ?? []).length > 0, `${e.name}: a class AA names its class`)
  }
  for (const cls of ['WAR', 'CLR', 'PAL', 'RNG', 'SHD', 'DRU', 'MNK', 'BRD', 'ROG', 'SHM', 'NEC', 'WIZ', 'MAG', 'ENC', 'BST', 'BER']) {
    assert.ok(entries.some((e) => e.classes?.includes(cls as never)), `${cls} has class AAs`)
  }
  const reinc = (prefix: string): number => entries.filter((e) => e.name.startsWith(prefix) && e.granted === 'reincarnation').length
  assert.equal(reinc('Class Reincarnation: '), 16, 'one class reincarnation per class')
  assert.ok(reinc('Race Reincarnation: ') >= 15, 'the race reincarnations, under the client name')
})
