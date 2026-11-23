// factionSources.test.mts — the generated "how to raise a faction" dataset: the generator's pure
// parsers (scripts/sources/factionHits.ts) on verbatim wiki shapes, the join key, and invariants
// of the COMMITTED src/renderer/src/data/eqlegends/factionSources.json (written by
// scripts/gen-faction-sources.mts from the wiki caches).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mobFactionHits, questFactionHits, signedDelta } from '../scripts/sources/factionHits'
import { factionKey, type FactionSourcesData } from '../src/shared/factionSources'
import { parseAchievementsDump } from '../src/shared/outputs/achievements'
import { raceUnlockStates } from '../src/shared/outputs/raceUnlocks'

const ROOT = join(import.meta.dirname, '..')

// Verbatim from the cached page for Cleonae Kalen (Ocean of Tears), trimmed to the two fields.
const MOB_PAGE = `| description = Merchant with assorted goods on Sister Isle.

| factions =

* [[Clerics of Tunare]] <span class='profac'>(-30)</span>
* [[Soldiers of Tunare]] <span class='profac'>(-30)</span>

| opposing_factions =

* [[Crushbone Orcs]] <span class='oppfac'>(10)</span>
* [[Storm Guard]] <span class='oppfac'>(?)</span>
* [[Deepwater Knights]] <span class='profac'>+5</span>

| related_quests =

* [[Rogue Redemption]]
}}`

test('mob pages: own factions lower, opposing raise, a stated sign wins, no digit is unknown', () => {
  const hits = mobFactionHits(MOB_PAGE).map((h) => [h.faction, signedDelta(h), h.direction])
  assert.deepEqual(hits, [
    ['Clerics of Tunare', -30, -1],
    ['Soldiers of Tunare', -30, -1],
    ['Crushbone Orcs', 10, 1],
    ['Storm Guard', null, 1],
    ['Deepwater Knights', 5, 1]
  ])
  assert.deepEqual(mobFactionHits('| factions = \n\n* None\n'), [])
})

// Verbatim lines from cached quest pages (Cannibalize II and others).
const QUEST_PAGE = `<div class="facblock">
* Your faction standing with [[Firiona Vie]] got better.
* Your faction standing with [[Storm Guard]] has been adjusted by 5.
* Your faction standing with [[Legion of Cabilis]] got worse.
* Your faction standing with [[Pirates of Gunthak]] could not possibly get any worse.
* Your faction standing with Merchants of Halas has been adjusted by -2.
</div>`

test('quest pages: stated adjustments carry their number, the worded forms carry a direction only', () => {
  const hits = questFactionHits(QUEST_PAGE).map((h) => [h.faction, signedDelta(h), h.direction])
  assert.deepEqual(hits, [
    ['Firiona Vie', null, 1],
    ['Storm Guard', 5, 1],
    ['Legion of Cabilis', null, -1],
    ['Pirates of Gunthak', null, -1],
    ['Merchants of Halas', -2, -1]
  ])
})

test('the join key folds case, the backtick, squashed spaces and the measured aliases', () => {
  assert.equal(factionKey('King Ak`Anon'), factionKey("king ak'anon"))
  assert.equal(factionKey("King Ak'Anon (Faction)"), factionKey('King Ak`Anon'))
  assert.equal(factionKey('DaBashers'), factionKey('Da Bashers'))
  assert.equal(factionKey('Coalition of Tradefolk'), factionKey('Coalition of Tradesfolk'))
  assert.equal(factionKey('Corrupt Qeynos Guards'), factionKey('Corrupt Qeynos Guard'))
  // A different faction with a similar name is NOT folded in.
  assert.notEqual(factionKey('Coalition of Tradefolk Underground'), factionKey('Coalition of Tradesfolk'))
})

const DATA = JSON.parse(
  readFileSync(join(ROOT, 'src/renderer/src/data/eqlegends/factionSources.json'), 'utf8')
) as FactionSourcesData

test('the committed dataset covers every faction a race unlock asks for, under its join key', () => {
  const dump = parseAchievementsDump(readFileSync(join(ROOT, 'tests/fixtures/Primitive_freeport-Achievements.txt'), 'utf8'))
  const wanted = new Set<string>()
  for (const r of raceUnlockStates(dump)) for (const o of r.objectives) if (o.faction) wanted.add(factionKey(o.faction))
  assert.deepEqual(Object.keys(DATA.factions).sort(), [...wanted].sort())
  for (const [key, e] of Object.entries(DATA.factions)) assert.equal(factionKey(e.name), key)
})

type Way = FactionSourcesData['factions'][string]['mobs'][number] | FactionSourcesData['factions'][string]['quests'][number]

function checkWays(faction: string, list: Way[]): void {
  let seenUnknown = false
  for (const w of list) {
    assert.ok(w.gain === null || w.gain > 0, `${faction}: ${w.page} gain ${String(w.gain)}`)
    assert.ok(w.gain === null || !seenUnknown, `${faction}: a known gain after an unknown one (${w.page})`)
    if (w.gain === null) seenUnknown = true
    for (const l of w.lowers) assert.ok(l.delta === null || l.delta < 0, `${w.page} lowers ${l.faction}`)
  }
}

test('the committed dataset: gains are positive or unknown, known first, losses never positive', () => {
  let mobs = 0
  let quests = 0
  for (const e of Object.values(DATA.factions)) {
    checkWays(e.name, e.mobs)
    checkWays(e.name, e.quests)
    mobs += e.mobs.length
    quests += e.quests.length
  }
  // Floors, not frozen counts: a re-scrape may add pages.
  assert.ok(mobs > 300, `mobs=${String(mobs)}`)
  assert.ok(quests > 300, `quests=${String(quests)}`)
})
