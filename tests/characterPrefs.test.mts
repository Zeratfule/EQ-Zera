// WHO THE CHARACTER MODEL DRAWS — race, sex and face, remembered (EQ Zera, 2026-09-08).
//
// The owner asked for faces "for both sexes and all races", and the picker that answers it is
// three controls where there used to be one Select of fused actor codes. Splitting a control
// splits a stored VALUE, which is the only interesting thing here: `eq.character.race` held `HUF`
// for every reader who ever picked a human female, and a build that forgot that turns them back
// into a human male on upgrade. So the migration is pinned first.
//
// The module under test is DOM-free on purpose (src/renderer/src/features/character/modelPrefs.ts,
// the combatPrefs.ts idiom): every default, guard, migration and degrade lives there and runs
// under plain node. ModelPickers.tsx owns the localStorage half and nothing else.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_RACE,
  DEFAULT_SEX,
  RACE_OPTIONS,
  actorCode,
  faceKey,
  readFace,
  readPick,
  readRace,
  readSex,
  storedFace
} from '../src/renderer/src/features/character/modelPrefs'

test('the old three-letter race value still names the race AND the sex it always meant', () => {
  assert.deepEqual(readPick('HUF', null), { race: 'HU', sex: 'F' }, 'a human female stays a human female')
  assert.deepEqual(readPick('HUM', null), { race: 'HU', sex: 'M' })
  assert.deepEqual(readPick('GNF', null), { race: 'GN', sex: 'F' })
  assert.deepEqual(readRace('HUF'), { race: 'HU', sex: 'F' }, 'the sex rides out of the migration, not out of the default')
})

test('the split keys win over the fused one, because they are the answer the reader gave last', () => {
  assert.deepEqual(readPick('HU', 'F'), { race: 'HU', sex: 'F' })
  assert.deepEqual(readPick('HUF', 'M'), { race: 'HU', sex: 'M' }, 'a stale fused value cannot outvote the new sex key')
  assert.deepEqual(readRace('DW'), { race: 'DW', sex: null }, 'a two-letter value carries no sex at all')
})

test('an absent, empty or unreadable value is the default, never an error and never a blank card', () => {
  assert.deepEqual(readPick(null, null), { race: DEFAULT_RACE, sex: DEFAULT_SEX })
  assert.deepEqual(readPick('', ''), { race: DEFAULT_RACE, sex: DEFAULT_SEX })
  assert.deepEqual(readPick('ZZ', 'F'), { race: DEFAULT_RACE, sex: 'F' }, 'a race this app cannot draw degrades; the sex still stands')
  assert.deepEqual(readPick('VS', null), { race: DEFAULT_RACE, sex: DEFAULT_SEX }, 'a race that is NAMED but has no model here is not pickable either')
  assert.deepEqual(readPick('hum', null), { race: DEFAULT_RACE, sex: DEFAULT_SEX }, 'the codes are upper case')
  assert.equal(readSex('X'), null)
  assert.equal(readSex(null), null)
  assert.equal(readSex('F'), 'F')
})

test('the actor code is race then sex, which is exactly what the archives are keyed by', () => {
  assert.equal(actorCode('DW', 'F'), 'DWF')
  assert.equal(actorCode('HU', 'M'), 'HUM')
  assert.equal(actorCode('IK', 'F'), 'IKF')
  // Every drawable race composes to a three-letter code, both ways round.
  for (const r of RACE_OPTIONS.filter((o) => o.modelled)) {
    for (const sex of ['M', 'F'] as const) assert.match(actorCode(r.code, sex), /^[A-Z]{2}[MF]$/)
  }
})

test('the race list names every playable race, and says which ones this app has no model for', () => {
  assert.equal(RACE_OPTIONS.length, 16)
  assert.equal(RACE_OPTIONS.filter((r) => r.modelled).length, 13, 'the twelve classic races plus the Iksar')
  assert.deepEqual(
    RACE_OPTIONS.filter((r) => !r.modelled).map((r) => r.label),
    ['Vah Shir', 'Froglok', 'Drakkin'],
    'named honestly rather than left out'
  )
  assert.equal(new Set(RACE_OPTIONS.map((r) => r.code)).size, RACE_OPTIONS.length, 'no code twice')
})

test('a face is remembered PER ACTOR, so a human pick never dresses a dwarf', () => {
  assert.equal(faceKey('HUM'), 'eq.character.face.HUM')
  assert.notEqual(faceKey('HUM'), faceKey('DWF'))
})

test('the face shown is the reader’s pick when this race still has it, and the bound face otherwise', () => {
  const human = [0, 1, 2, 3, 4, 5, 6, 7]
  const female = [1, 2, 3, 4, 5, 6, 7]
  assert.equal(readFace(3, human, 0), 3, 'a pick this race has is the pick')
  assert.equal(readFace(undefined, human, 0), 0, 'nothing picked yet shows what the head binds')
  assert.equal(readFace(undefined, female, 2), 2, 'HUF and DWF bind face 2 - the payload says so, this never assumes 0')
  assert.equal(readFace(0, female, 2), 2, 'a pick carried over from a race that HAS face 0 falls back to the bound face')
  assert.equal(readFace(9, female, 9), 1, 'and a face nobody has falls back to the first one there is')
  assert.equal(readFace(3, undefined, undefined), undefined, 'no payload, no faces, no control')
})

test('the face asked of main is a bare digit, and anything else is no pick at all', () => {
  assert.equal(storedFace('3'), 3)
  assert.equal(storedFace('0'), 0)
  assert.equal(storedFace(null), undefined)
  assert.equal(storedFace(''), undefined)
  assert.equal(storedFace('  '), undefined)
  assert.equal(storedFace('two'), undefined)
  assert.equal(storedFace('2.5'), undefined)
  assert.equal(storedFace('-1'), undefined)
})
