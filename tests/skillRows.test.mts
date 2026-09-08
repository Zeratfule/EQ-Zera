// The SKILLS panel's pure rows (ROADMAP item 10).
//
// WHAT IS PINNED HERE, and it is the law skillTypes.ts states: `value` and `ups` are DIFFERENT
// FACTS and neither derives the other. The value is the CLIENT's running total — every tick since
// the character was made, most of them before any log this app has read — and `ups` is what this
// fold watched. Nothing here adds one to the other, and a `value` of 0 is the ABSENCE of a stated
// number rather than a skill worth zero.
//
// And "this session" is COUNTED off the skill's own curve against the newest login the log states.
// With no session boundary the row says NOTHING rather than restating `ups` under a second name.
//
// Pure — no Electron, no renderer, no fixtures.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_STATED_VALUE, skillRows } from '../src/renderer/src/features/character/skillRows'
import { EMPTY_SKILL_SNAP, type SkillRow, type SkillSnap } from '../src/shared/skillTypes'

const T = 1_700_000_000_000
/** The newest login the log states — everything at or after it is "this session". */
const SESSION = T + 500

function skill(over: Partial<SkillRow> & { display: string }): SkillRow {
  return { value: 0, ups: 0, firstTs: T, lastTs: T, history: [], ...over }
}

const SNAP: SkillSnap = {
  v: 1,
  skills: {
    'eagle strike': skill({
      display: 'Eagle Strike',
      value: 25,
      ups: 24,
      lastTs: T + 900,
      history: [
        [T + 100, 23],
        [T + 600, 24],
        [T + 900, 25]
      ]
    }),
    meditate: skill({ display: 'Meditate', value: 57, ups: 5, lastTs: T + 400, history: [[T + 400, 57]] }),
    // Known only from a value-less tick: real, and honestly numberless.
    'stringed instruments': skill({ display: 'Stringed Instruments', ups: 2, lastTs: T + 700 })
  }
}

test('no snapshot is an empty list, not a throw', () => {
  assert.deepEqual(skillRows(null, SESSION), [])
  assert.deepEqual(skillRows(EMPTY_SKILL_SNAP, SESSION), [])
})

test('rows come back MOST RECENTLY TICKED FIRST', () => {
  assert.deepEqual(
    skillRows(SNAP, SESSION).map((r) => r.name),
    ['Eagle Strike', 'Stringed Instruments', 'Meditate']
  )
})

test('the value is the CLIENT’s and the ups are this log’s — two facts, never added', () => {
  const eagle = skillRows(SNAP, SESSION)[0]
  assert.equal(eagle.value, 25)
  assert.equal(eagle.valueText, '25')
  assert.equal(eagle.ups, 24)
  // The obvious wrong answer, stated so a future change cannot quietly produce it.
  assert.notEqual(eagle.value, eagle.ups)
})

test('a value of 0 is the ABSENCE of a stated number, and prints as one', () => {
  const strings = skillRows(SNAP, SESSION).find((r) => r.name === 'Stringed Instruments')
  assert.ok(strings)
  assert.equal(strings.value, 0)
  assert.equal(strings.valueText, NO_STATED_VALUE)
  // `ups` beside it still says the skill is real.
  assert.equal(strings.ups, 2)
})

test('"this session" counts CURVE TICKS at or after the session start', () => {
  const eagle = skillRows(SNAP, SESSION)[0]
  // Three points on the curve; two of them at or after T+500.
  assert.equal(eagle.thisSession, 2)
  assert.equal(eagle.sessionText, '+2 this session')
})

test('…and a session with none of them says nothing at all rather than "+0"', () => {
  const meditate = skillRows(SNAP, SESSION).find((r) => r.name === 'Meditate')
  assert.equal(meditate?.thisSession, 0)
  assert.equal(meditate?.sessionText, '')
})

test('NO SESSION BOUNDARY ⇒ no session claim — `ups` is never restated under a second name', () => {
  const rows = skillRows(SNAP, null)
  for (const row of rows) {
    assert.equal(row.thisSession, null)
    assert.equal(row.sessionText, '')
  }
  // The other columns are unaffected: the log still said what it said.
  assert.equal(rows[0].value, 25)
})

test('the search narrows on the client’s own spelling, lowercased', () => {
  assert.equal(skillRows(SNAP, SESSION, '').length, 3)
  assert.deepEqual(
    skillRows(SNAP, SESSION, 'eagle').map((r) => r.name),
    ['Eagle Strike']
  )
  assert.deepEqual(
    skillRows(SNAP, SESSION, 'instruments').map((r) => r.name),
    ['Stringed Instruments']
  )
  assert.deepEqual(skillRows(SNAP, SESSION, 'kick'), [])
})

test('no string here carries an em dash or an en dash (AGENTS.md, JOS-106)', () => {
  for (const row of skillRows(SNAP, SESSION)) {
    assert.equal(/[—–]/.test(row.valueText), false, row.valueText)
    assert.equal(/[—–]/.test(row.sessionText), false, row.sessionText)
  }
  assert.equal(/[—–]/.test(NO_STATED_VALUE), false)
})
