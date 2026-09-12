// ============================================================================
// crawlRoster.test.mts — THE CRAWL ESTIMATE, and the three ways it refuses (2026-09-12).
// ============================================================================
//
// WHAT IS UNDER TEST. `src/shared/crawlRoster.ts` folds the committed community table
// (`src/renderer/src/data/eqlegends/crawlRosters.json`) against a run this repo already folds out of
// the log, and produces an ESTIMATE of Dungeon Crawl completion. The game prints its own crawl
// percentage in no log line, so there is nothing to compare against and every claim here is about
// the approximation's own honesty: which denominators it is allowed to print, which it must refuse,
// and which names it can never see.
//
// THE REAL RUN IS THE INSTRUMENT FOR THE MATCHING. The Befallen case below is the owner's own
// 2026-09-10 crawl, folded by `runTracker` out of the engine-written snapshots committed beside the
// log (provenance: tests/runTracker.test.mts). That is what makes the apostrophe finding a
// measurement rather than a hypothetical: the log printed `skeleton L`rodd` and the wiki row says
// `Skeleton Lrodd`, so a match key that merely UNIFIED the two apostrophe spellings would have
// missed a rare the owner killed. The key drops the mark instead, and this suite pins the pair.
//
// THE TABLE IS READ OFF DISK, not imported through the renderer's alias: this is a node test, and
// re-reading the committed bytes is also what lets the audit below check every row against the
// interface the overlay casts to.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CoinSnap } from '../src/shared/coinTypes'
import type { DeathSnap } from '../src/shared/deathTypes'
import type { KillsSnap } from '../src/shared/kills'
import type { ProgressionSnap } from '../src/shared/progressionTypes'
import type { LootEvent } from '../src/shared/types'
import { NO_RUN, runTracker, type RunNamed, type RunState } from '../src/shared/runTracker'
import {
  type CrawlRoster,
  type CrawlRosterTable,
  crawlProgress,
  crawlZoneKey,
  mobMatchKey,
  normalizeMobName,
  rosterForZone
} from '../src/shared/crawlRoster'

const HERE = dirname(fileURLToPath(import.meta.url))
const TABLE_PATH = join(HERE, '..', 'src', 'renderer', 'src', 'data', 'eqlegends', 'crawlRosters.json')
const TABLE = JSON.parse(readFileSync(TABLE_PATH, 'utf8')) as CrawlRosterTable

/** A run with nothing in it but the fields a claim below is about. */
function runWith(over: Partial<RunState>): RunState {
  return { ...NO_RUN, ...over }
}

/** Named kills in the shape `runTracker` publishes them: raw display name, ascending instants. */
function named(names: readonly string[]): RunNamed[] {
  return names.map((name, i) => ({ name, at: 1_000_000 + i * 1000 }))
}

/** The roster a claim is about, or a failure naming the key that has gone missing. */
function roster(zone: string): CrawlRoster {
  const found = rosterForZone(zone, TABLE)
  assert.ok(found !== null, `the table has no row for ${zone}`)
  return found
}

// ---- the name fold ---------------------------------------------------------------------------

test('a mob name folds to lowercase, one space, no leading article, one apostrophe', () => {
  assert.equal(normalizeMobName('  A   Froglok   Crusader '), 'froglok crusader')
  assert.equal(normalizeMobName('An Evil Eye'), 'evil eye')
  assert.equal(normalizeMobName('The Prophet'), 'prophet')
  // The three apostrophes this corpus actually contains - EQ's backtick, the wiki's straight quote,
  // a copy-paste's curly one - are ONE character after the fold.
  assert.equal(normalizeMobName('Baron Telyx V`Zher'), "baron telyx v'zher")
  assert.equal(normalizeMobName("Baron Telyx V'Zher"), "baron telyx v'zher")
  assert.equal(normalizeMobName('Baron Telyx V’Zher'), "baron telyx v'zher")
  // `Najena` is both a zone and one of its own rares; the fold has no opinion about that.
  assert.equal(normalizeMobName('Najena'), 'najena')
})

test('the MATCH key drops the apostrophe, because the log and the wiki disagree about it', () => {
  // THE MEASURED PAIR (see the header). Unifying is not enough; dropping is.
  assert.notEqual(normalizeMobName('skeleton L`rodd'), normalizeMobName('Skeleton Lrodd'))
  assert.equal(mobMatchKey('skeleton L`rodd'), mobMatchKey('Skeleton Lrodd'))
  assert.equal(mobMatchKey("King Thex'Ka IV"), mobMatchKey('King Thex`Ka IV'))
  // It is a widening of the apostrophe only - nothing else about the name is loosened.
  assert.notEqual(mobMatchKey('ghoul sage'), mobMatchKey('ghoul savant'))
})

test('a zone folds through the repo’s own zone key, so a raw zone line works', () => {
  assert.equal(crawlZoneKey('Befallen 4 (Refined)'), 'befallen')
  assert.equal(crawlZoneKey('The Ruins of Old Paineel - Solo 4 (Refined)'), 'ruins of old paineel')
  assert.equal(crawlZoneKey("Nagafen's Lair"), 'nagafens lair')
  assert.equal(crawlZoneKey(''), '')
  assert.equal(crawlZoneKey(null), '')
})

// ---- the lookup -----------------------------------------------------------------------------

test('a roster is found by key, by alias, by casing and through an instance suffix', () => {
  const lowerGuk = roster('The Ruins of Old Guk')
  assert.equal(rosterForZone('Lower Guk', TABLE), lowerGuk, 'the alias is the wiki’s own short name')
  assert.equal(rosterForZone('lower GUK', TABLE), lowerGuk)
  assert.equal(rosterForZone('The Ruins of Old Guk - Group 2 (Adaptive)', TABLE), lowerGuk)
  assert.equal(rosterForZone('the hole', TABLE), roster('The Ruins of Old Paineel'))
  assert.equal(rosterForZone('Cazic Thule', TABLE), roster('Temple of Cazic-Thule'))
  assert.equal(rosterForZone("nagafens lair", TABLE), roster("Nagafen's Lair"))
})

test('a zone the table has never described gets NOTHING, not an empty estimate', () => {
  assert.equal(rosterForZone('West Commonlands', TABLE), null)
  assert.equal(rosterForZone('', TABLE), null)
  assert.equal(rosterForZone(undefined, TABLE), null)
  // The surface reads this null as "draw no crawl block at all" (world-model law 1).
  assert.equal(crawlProgress(runWith({ named: named(['Gynok Moltor']) }), null), null)
})

// ---- the denominators ------------------------------------------------------------------------

test('Lower Guk states its counts, so the estimate may print X of Y and a percentage', () => {
  const guk = roster('Lower Guk')
  assert.equal(guk.rareCount, 25)
  assert.equal(guk.killsToComplete, 124)
  assert.equal(guk.confidence, 'stated on wiki')
  assert.equal(guk.rares.length, 24, 'the wiki row lists 24 of the 25 counted rares - see its notes')

  const run = runWith({ kills: 50, groupKills: 12, named: named(['Raster of Guk', 'a ghoul sage', 'ghoul sage']) })
  const p = crawlProgress(run, guk)
  assert.ok(p !== null)
  // `a ghoul sage` and `ghoul sage` are ONE rare: the article is not part of the name, and the meter
  // counts the creature rather than the corpses.
  assert.deepEqual(p.rareNames, ['Raster of Guk', 'ghoul sage'])
  assert.equal(p.raresKilled, 2)
  assert.equal(p.rareTotal, 25, 'the STATED count wins over the length of a list that is short by one')
  assert.equal(p.killsPct, 50, '62 of ~124')
  assert.equal(p.confidence, 'stated on wiki')
  assert.equal(p.estimated, true)
})

test('the kill percentage is capped at 100, because the published total is a rough one', () => {
  const p = crawlProgress(runWith({ kills: 300, groupKills: 40 }), roster('Lower Guk'))
  assert.equal(p?.killsPct, 100)
})

test('no published kill total means NO percentage - there is nothing to divide by', () => {
  const p = crawlProgress(runWith({ kills: 80, groupKills: 5 }), roster('Befallen'))
  assert.equal(roster('Befallen').killsToComplete, null)
  assert.equal(p?.killsPct, null)
})

test('an INFERRED row counts what it matched and refuses a denominator', () => {
  // The law: an `inferred` list is the wiki's named-mob list, not the game's rare flag. A named mob
  // may be trash to the crawl and a real rare may be absent from the list, so `rares.length` is not
  // a denominator - only an explicitly published `rareCount` is.
  const najena = roster('Najena')
  assert.equal(najena.confidence, 'inferred')
  assert.equal(najena.rareCount, null)
  assert.ok(najena.rares.length > 0)
  const p = crawlProgress(runWith({ named: named(['Drelzna', 'Moosh', 'a bat']) }), najena)
  assert.deepEqual(p?.rareNames, ['Drelzna', 'Moosh'])
  assert.equal(p?.raresKilled, 2)
  assert.equal(p?.rareTotal, null, 'a named-mob list gives no "of Y"')
})

test('a STATED row with no count may use the length of the list the wiki labelled Rare NPCs', () => {
  const unrest = roster('Unrest')
  assert.equal(unrest.confidence, 'stated on wiki')
  assert.equal(unrest.rareCount, null)
  const p = crawlProgress(runWith({ named: named(['Garanel Rucksif']) }), unrest)
  assert.equal(p?.rareTotal, unrest.rares.length)
  assert.equal(p?.raresKilled, 1)
})

test('Fear is a stated ZERO, and zero is a measurement here rather than an absence', () => {
  const fear = roster('The Plane of Fear')
  assert.deepEqual(fear.rares, [])
  assert.equal(fear.rareCount, 0)
  const p = crawlProgress(runWith({ kills: 200, named: named(['Cazic Thule']) }), fear)
  assert.equal(p?.rareTotal, 0, 'the devs said Fear labels no rare creatures')
  assert.equal(p?.raresKilled, 0)
  assert.equal(p?.killsPct, null, 'and no kill total was ever published for it')
})

// ---- the owner's own run ----------------------------------------------------------------------

interface Fixture {
  progression: ProgressionSnap
  kills: KillsSnap
  loot: LootEvent[]
  coin: CoinSnap
  deaths: DeathSnap
}

const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'befallen-run.snapshots.json'), 'utf8')) as Fixture

/** The owner's Befallen 4 (Refined) crawl, exactly as tests/runTracker.test.mts folds it. */
const REAL: RunState = runTracker({
  snap: FIX.progression,
  kills: FIX.kills,
  loot: FIX.loot,
  coin: FIX.coin.rows,
  deaths: FIX.deaths
})

test('the owner’s real crawl matches twelve of the thirteen creatures it named', () => {
  assert.equal(REAL.base, 'Befallen')
  const p = crawlProgress(REAL, rosterForZone(REAL.base, TABLE))
  assert.ok(p !== null)
  assert.deepEqual(p.rareNames, [
    'Skeleton Lrodd',
    'Asaka L`Rei',
    'Footman of V`Zher',
    'Gynok Moltor',
    'Knight V`Tal',
    'Kahaptra Z`Taj',
    'Priest Amiaz',
    'Arisen Thaumaturgist',
    'Boondin Babbinsbort',
    'Korven Nisere',
    'Soldier of V`Zher',
    'Baron Telyx V`Zher'
  ])
  assert.equal(p.raresKilled, 12)
  // The names are the ROSTER's spelling, in the order the log killed them: `Skeleton Lrodd` leads
  // because `skeleton L`rodd` went down at +1:34, and it is only in this list at all because the
  // match key drops the apostrophe the wiki's row does not have.
  assert.equal(REAL.named[0].name, 'skeleton L`rodd')
  // `ice boned skeleton` is in `named` TWICE and in the roster not at all - a named mob the wiki's
  // list does not carry is simply not counted, in either direction.
  assert.ok(REAL.named.filter((n) => n.name === 'ice boned skeleton').length === 2)
  assert.ok(!p.rareNames.includes('ice boned skeleton'))
  // Befallen's row is `inferred`, so fourteen kills of thirteen creatures still buys no "of Y".
  assert.equal(p.rareTotal, null)
  assert.equal(p.killsPct, null)
  assert.equal(p.estimated, true)
})

// ---- the committed table ---------------------------------------------------------------------

const CONFIDENCES = new Set(['stated on wiki', 'player report', 'inferred'])

test('EVERY committed row is the shape the overlay casts it to', () => {
  const keys = Object.keys(TABLE)
  assert.ok(keys.length >= 19, `${String(keys.length)} zones in the table`)
  for (const [zone, row] of Object.entries(TABLE)) {
    assert.ok(CONFIDENCES.has(row.confidence), `${zone}: unknown confidence ${row.confidence}`)
    assert.ok(row.source.startsWith('http'), `${zone}: the row must carry where it came from`)
    assert.equal(typeof row.notes, 'string')
    assert.ok(Array.isArray(row.rares), `${zone}: rares must be a list`)
    for (const rare of row.rares) {
      assert.ok(rare.trim() !== '', `${zone}: a blank rare name`)
    }
    const keysSeen = new Set(row.rares.map(mobMatchKey))
    assert.equal(keysSeen.size, row.rares.length, `${zone}: two rares fold to one name`)
    if (row.rareCount !== null) assert.ok(row.rareCount >= row.rares.length - 1, `${zone}: count below its own list`)
    if (row.killsToComplete !== null) assert.ok(row.killsToComplete > 0, `${zone}: a non-positive kill total`)
    // Every alias resolves to THIS row, or the table has two rows fighting over one name.
    for (const alias of row.aliases ?? []) {
      assert.equal(rosterForZone(alias, TABLE), row, `${zone}: alias ${alias} resolves elsewhere`)
    }
  }
})

test('the rares an ARTICLE hides from this fold are named, and counted, on purpose', () => {
  // LIMIT 2 in crawlRoster.ts's header: `runTracker` decides a mob is named by the log spelling it
  // WITHOUT a leading article, so a rare the wiki calls `The …` can never reach `run.named` and can
  // never be counted. Pinning the list means a table refresh that adds a ninth such name shows up
  // here rather than quietly understating another zone.
  const hidden: string[] = []
  for (const row of Object.values(TABLE)) {
    for (const rare of row.rares) {
      if (/^(a|an|the)\s/i.test(rare)) hidden.push(rare)
    }
  }
  assert.deepEqual(hidden.sort((a, b) => a.localeCompare(b)), [
    'The Blood Artist',
    'The Goblin King',
    'The Ishva Mal',
    'The Prophet',
    'The Spiroc Lord',
    'The Tenderizer',
    'The Thaumaturgist',
    'The Widowmistress'
  ])
  // And the proof that they are unreachable rather than merely unlikely: the fold that produces
  // `named` drops them, so no roster entry of this shape is ever offered to the matcher.
  const p = crawlProgress(runWith({ named: named(['The Prophet']) }), roster('Clan Crushbone'))
  assert.equal(p?.raresKilled, 1, 'the matcher itself is article-blind on both sides')
})
