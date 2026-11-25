// aaCharacter.test.mts — the AA tab's two character facts (src/shared/aaCharacter.ts): the race
// (detected from the game's own grant line, picked by the user, filtering the race reincarnation
// rows) and the respec (paid purchase lines before it stop counting as held; free grants stay;
// the "I hold" marks it clears come back on Undo). Stored values read back through parsers that
// degrade rather than throw.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { AaCatalogData, AaCatalogEntry } from '../src/shared/aaCatalog'
import { aaLedger } from '../src/shared/aaLedger'
import { catalogIndex, heldRanks, plannerSections } from '../src/shared/aaPlanner'
import {
  aaRaceStorageKey,
  aaRespecStorageKey,
  detectedRace,
  EMPTY_RESPECS,
  lastRespec,
  parseStoredRace,
  parseStoredRespecs,
  raceAllows,
  raceOfAa,
  recordRespec,
  serializeRace,
  serializeRespecs,
  spendsSinceRespec,
  undoRespec
} from '../src/shared/aaCharacter'

const CATALOG = JSON.parse(readFileSync(new URL('../src/renderer/src/data/eqlegends/aaCatalog.json', import.meta.url), 'utf8')) as AaCatalogData
const INDEX = catalogIndex(CATALOG.entries)
const ME = { name: 'Zeratfule', server: 'Freeport' }

test('keys sit beside the plan key, one per character', () => {
  assert.equal(aaRaceStorageKey(ME), 'eq.aa.race.zeratfule@freeport')
  assert.equal(aaRespecStorageKey(ME), 'eq.aa.respec.zeratfule@freeport')
  assert.equal(aaRaceStorageKey(null), null)
  assert.equal(aaRespecStorageKey({ name: '', server: 'x' }), null)
})

test('the race AAs are exactly the catalog Race Reincarnation rows (16: no Drakkin row on the wiki)', () => {
  const races = CATALOG.entries.map((e) => raceOfAa(e.name)).filter((r) => r !== null)
  assert.equal(races.length, 16, 'the 17 races less Drakkin, which the wiki table does not list')
  assert.equal(raceOfAa('Race Reincarnation: Dark Elf 2'), 'Dark Elf', 'a ranked log name reads too')
  assert.equal(raceOfAa('race reincarnation: half dark elf'), 'Half Dark Elf', 'canonical spelling')
  assert.equal(raceOfAa('Class Reincarnation: Bard'), null)
})

test('a stored race degrades: only one of the 17 races survives', () => {
  assert.equal(parseStoredRace(serializeRace('Iksar')), 'Iksar')
  assert.equal(parseStoredRace(serializeRace('iksar')), 'Iksar')
  assert.equal(parseStoredRace(serializeRace(null)), null)
  assert.equal(parseStoredRace(JSON.stringify({ v: 1, race: 'Vah Shir' })), null)
  assert.equal(parseStoredRace('{not json'), null)
  assert.equal(parseStoredRace(JSON.stringify({ v: 2, race: 'Human' })), null)
  assert.equal(parseStoredRace(null), null)
})

test('THE DETECTED RACE is the latest Race Reincarnation grant, from the log or the persisted record', () => {
  assert.equal(detectedRace([]), null)
  const spends = [
    { ts: 10, ability: 'Race Reincarnation: Ogre', cost: 0 },
    { ts: 20, ability: 'Fury of Magic', cost: 1 },
    { ts: 30, ability: 'Race Reincarnation: Dark Elf 2', cost: 0, rank: 2 }
  ]
  assert.deepEqual(detectedRace(spends), { race: 'Dark Elf', ts: 30 })
  const lives = [{ ts: 40, grants: [{ component: 'race' as const, name: 'Troll', rank: 1 }, { component: 'class' as const, name: 'Monk', rank: 1 }] }]
  assert.deepEqual(detectedRace(spends, lives), { race: 'Troll', ts: 40 })
  assert.deepEqual(detectedRace([], [{ ts: 5, grants: [{ component: 'class', name: 'Monk', rank: 1 }] }]), null)
})

test('THE RACE FILTER: own race row only, plus any held; unknown race lists every one; other AAs untouched', () => {
  const human = INDEX.get('race reincarnation: human') as AaCatalogEntry
  const ogre = INDEX.get('race reincarnation: ogre') as AaCatalogEntry
  const bard = INDEX.get('class reincarnation: bard') as AaCatalogEntry
  assert.equal(raceAllows(human, 'Human', 0), true)
  assert.equal(raceAllows(ogre, 'Human', 0), false)
  assert.equal(raceAllows(ogre, 'Human', 1), true, 'a race AA you hold stays listed')
  assert.equal(raceAllows(ogre, null, 0), true)
  assert.equal(raceAllows(bard, 'Human', 0), true)
  const special = (race: string | null): string[] => {
    const { held } = heldRanks(aaLedger([{ ts: 1, ability: 'Race Reincarnation: Ogre', cost: 0 }]), {}, INDEX)
    const s = plannerSections(CATALOG.entries, [], '', { race, held }).find((x) => x.section === 'special')
    return (s?.entries ?? []).map((e) => e.name).filter((n) => raceOfAa(n) !== null)
  }
  assert.deepEqual(special('Human'), ['Race Reincarnation: Human', 'Race Reincarnation: Ogre'])
  assert.equal(special(null).length, 16)
  assert.equal(plannerSections(CATALOG.entries, [], '').find((x) => x.section === 'special')?.entries.length, plannerSections(CATALOG.entries, [], '', { race: null, held: new Map() }).find((x) => x.section === 'special')?.entries.length)
})

const SPENDS = [
  { ts: 100, ability: 'Innate Regeneration', cost: 1 },
  { ts: 110, ability: 'Innate Regeneration 2', cost: 1, rank: 2 },
  { ts: 120, ability: 'Class Reincarnation: Monk', cost: 0 },
  { ts: 130, ability: 'Symphonic Aura: Enabled', cost: 0 },
  // the respec happens at 200; these are the re-buys after it
  { ts: 210, ability: 'Innate Regeneration', cost: 1 }
]

test('RESPEC: paid lines before it stop counting, free grants before it stay, lines after it count', () => {
  assert.deepEqual(spendsSinceRespec(SPENDS, null), SPENDS)
  const kept = spendsSinceRespec(SPENDS, { at: 200, clearedStated: {} })
  assert.deepEqual(kept.map((s) => s.ts), [120, 130, 210])
  const { held } = heldRanks(aaLedger(kept), {}, INDEX)
  assert.equal(held.get('innate regeneration')?.rank, 1, 'held from the re-buy, not the refunded rank 2')
  assert.equal(held.get('class reincarnation: monk')?.rank, 1, 'a reincarnation grant survives the respec')
  const before = heldRanks(aaLedger(SPENDS), {}, INDEX).held
  assert.equal(before.get('innate regeneration')?.rank, 2)
})

test('RESPEC clears "I hold" marks on bought AAs, keeps granted/free ones, and UNDO restores them', () => {
  const stated = { 'Innate Regeneration': 5, 'Class Reincarnation: Monk': 2, 'Steadfast Will': 3 }
  const r = recordRespec(EMPTY_RESPECS, 200, stated, INDEX)
  assert.deepEqual(r.stated, { 'Class Reincarnation: Monk': 2 })
  assert.deepEqual(lastRespec(r.history), { at: 200, clearedStated: { 'Innate Regeneration': 5, 'Steadfast Will': 3 } })
  const u = undoRespec(r.history, { ...r.stated, 'Steadfast Will': 1 })
  assert.equal(lastRespec(u.history), null)
  assert.deepEqual(u.stated, { 'Innate Regeneration': 5, 'Class Reincarnation: Monk': 2, 'Steadfast Will': 1 }, 'a mark made since wins')
  assert.deepEqual(undoRespec(EMPTY_RESPECS, { a: 1 }), { history: EMPTY_RESPECS, stated: { a: 1 } })
})

test('a second respec stacks; undo steps back to the first', () => {
  const one = recordRespec(EMPTY_RESPECS, 200, {}, INDEX).history
  const two = recordRespec(one, 300, {}, INDEX).history
  assert.equal(lastRespec(two)?.at, 300)
  assert.equal(lastRespec(undoRespec(two, {}).history)?.at, 200)
})

test('a stored respec history degrades: bad entries drop, the rest survive in order', () => {
  const h = recordRespec(recordRespec(EMPTY_RESPECS, 300, {}, INDEX).history, 200, { 'Innate Regeneration': 2 }, INDEX).history
  assert.deepEqual(parseStoredRespecs(serializeRespecs(h)), h)
  assert.deepEqual(h.respecs.map((x) => x.at), [200, 300])
  const raw = JSON.stringify({ v: 1, respecs: [{ at: 'x' }, null, { at: 50, clearedStated: { A: 2, B: -1, C: 1.5 } }] })
  assert.deepEqual(parseStoredRespecs(raw), { respecs: [{ at: 50, clearedStated: { A: 2 } }] })
  assert.deepEqual(parseStoredRespecs('nope'), EMPTY_RESPECS)
  assert.deepEqual(parseStoredRespecs(JSON.stringify({ v: 9, respecs: [] })), EMPTY_RESPECS)
  assert.deepEqual(parseStoredRespecs(null), EMPTY_RESPECS)
})
