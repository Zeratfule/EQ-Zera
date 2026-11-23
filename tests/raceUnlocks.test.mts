// raceUnlocks.test.mts — the Races tab, end to end below the screen: the achievements dump's race
// projection (shared/outputs/raceUnlocks.ts) read off the owner's REAL dump, and the plan
// (shared/raceUnlockPlan.ts) that joins it with the log's faction fold and the generated wiki
// dataset. The generator's parsers and the committed dataset are pinned in
// tests/factionSources.test.mts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAchievementsDump } from '../src/shared/outputs/achievements'
import { raceUnlockGrant, raceUnlockStates, sanitizeRaceUnlocks } from '../src/shared/outputs/raceUnlocks'
import { raceUnlockPlans, seenByKey, unlockedCount } from '../src/shared/raceUnlockPlan'
import type { FactionSourcesData } from '../src/shared/factionSources'
import type { FactionSnap } from '../src/shared/factionTypes'

const REAL = readFileSync(join(import.meta.dirname, 'fixtures', 'Primitive_freeport-Achievements.txt'), 'utf8')
const races = raceUnlockStates(parseAchievementsDump(REAL))
const byRace = new Map(races.map((r) => [r.race, r]))

const NO_SOURCES: FactionSourcesData = { source: 'test', factions: {} }

test('the owner dump carries sixteen race unlocks, both Human variants included', () => {
  assert.equal(races.length, 16)
  assert.ok(byRace.has('Human (Freeport)') && byRace.has('Human (Qeynos)'))
  // Every one carries the token row, including the two Human rows that spell it "can by bypassed".
  assert.ok(races.every((r) => r.tokenBypass))
})

test('objectives are classified: factions, the Kerran task, the Half Elf route', () => {
  const dwarf = byRace.get('Dwarf')
  assert.deepEqual(
    dwarf?.objectives.map((o) => o.faction),
    ['Kazon Stormhammer', 'Merchants of Kaladim', 'Storm Guard']
  )
  const kerran = byRace.get('Kerran')
  assert.equal(kerran?.objectives.length, 1)
  assert.equal(kerran?.objectives[0].task, 'Aid the Kerrans of Kerra Isle')
  const halfElf = byRace.get('Half Elf')
  assert.deepEqual(halfElf?.objectives[0].via, ['Human', 'Wood Elf'])
  assert.equal(byRace.get('Iksar')?.objectives.length, 1)
  // No pseudo-row leaks into the objectives, and no row is of an unknown shape in the real file.
  assert.ok(races.every((r) => r.objectives.every((o) => o.kind !== 'other')))
})

test('the two grants are read off the pseudo-rows: Froglok created-as, Ogre token', () => {
  const froglok = byRace.get('Froglok')
  const ogre = byRace.get('Ogre')
  assert.ok(froglok && ogre)
  assert.equal(raceUnlockGrant(froglok), 'created')
  assert.equal(raceUnlockGrant(ogre), 'token')
  assert.equal(raceUnlockGrant(byRace.get('Dwarf') ?? froglok), null)
  // Partial progress is kept: the owner's Erudite has Heretics maxed and nothing else.
  const erudite = byRace.get('Erudite')
  assert.deepEqual(
    erudite?.objectives.map((o) => o.complete),
    [false, true, false]
  )
})

test('a stored list round-trips the sanitizer, and junk is dropped', () => {
  assert.deepEqual(sanitizeRaceUnlocks(JSON.parse(JSON.stringify(races))), races)
  assert.deepEqual(sanitizeRaceUnlocks(undefined), [])
  assert.deepEqual(sanitizeRaceUnlocks([null, { race: 1 }, 'x']), [])
})

test('plans: unlocked races go last, the closest-to-done lead', () => {
  const plans = raceUnlockPlans(races, null, NO_SOURCES)
  assert.equal(plans.length, 16)
  assert.equal(unlockedCount(plans), 2)
  const firstUnlocked = plans.findIndex((p) => p.status === 'unlocked')
  assert.ok(plans.slice(firstUnlocked).every((p) => p.status === 'unlocked'), 'unlocked are a tail')
  const open = plans.slice(0, firstUnlocked)
  for (let i = 1; i < open.length; i++) assert.ok(open[i - 1].remaining <= open[i].remaining, 'fewest remaining first')
  // Iksar has one faction to max and nothing maxed: one remaining, so it is at the front.
  assert.equal(open[0].remaining, 1)
  const erudite = plans.find((p) => p.race === 'Erudite')
  assert.equal(erudite?.status, 'in-progress')
  assert.equal(erudite?.done, 1)
  assert.equal(erudite?.factions.find((f) => f.faction === 'Heretics')?.maxedBy, 'achievement')
})

test('a "could not possibly get any better" line in the log maxes a faction the dump has not', () => {
  const snap: FactionSnap = {
    v: 1,
    factions: {
      'storm guard': { display: 'Storm Guard', delta: 120, hits: 9, maxed: 1, bottomed: 0, firstTs: 1, lastTs: 2 },
      'kazon stormhammer': { display: 'Kazon Stormhammer', delta: 30, hits: 3, maxed: 0, bottomed: 0, firstTs: 1, lastTs: 2 }
    },
    recent: []
  }
  const dwarf = raceUnlockPlans(races, snap, NO_SOURCES).find((p) => p.race === 'Dwarf')
  const storm = dwarf?.factions.find((f) => f.faction === 'Storm Guard')
  assert.equal(storm?.maxedBy, 'log')
  assert.equal(dwarf?.done, 1)
  // The sum is carried as what the log saw, and never completes an objective by itself.
  const kazon = dwarf?.factions.find((f) => f.faction === 'Kazon Stormhammer')
  assert.equal(kazon?.maxed, false)
  assert.deepEqual(kazon?.seen, { delta: 30, hits: 3, maxed: 0 })
})

test('the log spelling joins the dump spelling through the measured alias', () => {
  const snap: FactionSnap = {
    v: 1,
    factions: {
      'coalition of tradefolk': { display: 'Coalition of Tradefolk', delta: 5, hits: 1, maxed: 0, bottomed: 0, firstTs: 1, lastTs: 1 }
    },
    recent: []
  }
  const seen = seenByKey(snap)
  const human = raceUnlockPlans(races, snap, NO_SOURCES).find((p) => p.race === 'Human (Freeport)')
  assert.equal(seen.size, 1)
  assert.equal(human?.factions.find((f) => f.faction === 'Coalition of Tradesfolk')?.seen?.delta, 5)
})

test('Half Elf takes the closest of Human and Wood Elf, and points at it', () => {
  const halfElf = raceUnlockPlans(races, null, NO_SOURCES).find((p) => p.race === 'Half Elf')
  // The owner's Human (Qeynos) has Guards of Qeynos maxed: 2 left, the closest of the three.
  assert.equal(halfElf?.via?.closest, 'Human (Qeynos)')
  assert.equal(halfElf?.remaining, 2)
  assert.equal(halfElf?.status, 'in-progress')
})

test('ways: known gains first, clean before ones that lower another needed faction, hurts flagged', () => {
  const sources: FactionSourcesData = {
    source: 'test',
    factions: {
      guardsofqeynos: {
        name: 'Guards of Qeynos',
        mobs: [
          { page: 'Unknown', name: 'an unknown', gain: null, lowers: [] },
          { page: 'Dirty', name: 'a corrupt guard', level: '5', gain: 20, lowers: [{ faction: 'Corrupt Qeynos Guard', delta: -40 }] },
          { page: 'Clean', name: 'a gnoll', level: '3', gain: 5, lowers: [{ faction: 'Storm Guard', delta: -1 }] }
        ],
        quests: []
      },
      corruptqeynosguard: { name: 'Corrupt Qeynos Guard', mobs: [], quests: [] },
      merchantsofqeynos: {
        name: 'Merchants of Qeynos',
        mobs: [],
        quests: [{ page: 'Some Quest', zone: 'North Qeynos', gain: 25, lowers: [] }]
      }
    }
  }
  // Clear the dump's Guards of Qeynos so the faction is still open and its ways are drawn.
  const open = races.map((r) =>
    r.race === 'Human (Qeynos)' ? { ...r, objectives: r.objectives.map((o) => ({ ...o, complete: false })) } : r
  )
  const human = raceUnlockPlans(open, null, sources).find((p) => p.race === 'Human (Qeynos)')
  const goq = human?.factions.find((f) => f.faction === 'Guards of Qeynos')
  assert.deepEqual(
    goq?.mobs.map((m) => m.page),
    ['Clean', 'Dirty', 'Unknown']
  )
  // Storm Guard is not a Qeynos faction, so it is not a hurt; Corrupt Qeynos Guard is.
  assert.deepEqual(goq?.mobs[0].hurts, [])
  assert.deepEqual(goq?.mobs[1].hurts, [{ faction: 'Corrupt Qeynos Guard', delta: -40 }])
  assert.equal(goq?.bestGain, 20)
  assert.equal(human?.factions.find((f) => f.faction === 'Merchants of Qeynos')?.quests[0].gain, 25)
  // One faction has no stated way at all, so the race's rate is unknown.
  assert.equal(human?.rate, null)
})
