// THE QUEST-ITEM POP-UP'S THREE PREFERENCES — the vocabulary half (ROADMAP §1).
//
// `features/quests/questToastPrefs.ts` is DOM-free on purpose: the hook around it only moves
// strings in and out of localStorage, and everything that can silently go wrong — a default, a
// guard, a degrade — is here. What is worth pinning:
//
//   * an ABSENT key is the DEFAULT, never `false`. A user who has never opened Preferences has
//     not switched the pop-up off, and has not asked for every quest in the catalog either.
//   * '0' really is off. The booleans are '1'/'0' so they read at a glance in devtools, and the
//     off state has to survive a round trip or the switch is a lie.
//   * a repeat window this build does not offer degrades to five minutes (JOS-105): a
//     hand-edited '7', a future build's stop, a word. Never an error, never zero, never a
//     silent flood.
//   * `repeatLabel` says an hour as an hour.
//
// No window, no React, no Electron — this suite can never skip.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_QUEST_TOAST_PREFS,
  QUEST_TOAST_KEYS,
  REPEAT_CHOICES,
  readQuestToastPrefs,
  repeatLabel
} from '../src/renderer/src/features/quests/questToastPrefs'

/** A `localStorage.getItem` over a plain object — what the hook hands the reader. */
function store(entries: Record<string, string>): (key: string) => string | null {
  return (key) => entries[key] ?? null
}

test('an empty store reads the defaults: on, my classes, five minutes', () => {
  const prefs = readQuestToastPrefs(store({}))
  assert.deepEqual(prefs, DEFAULT_QUEST_TOAST_PREFS)
  assert.equal(prefs.enabled, true)
  assert.equal(prefs.myClasses, true)
  assert.equal(prefs.repeatMin, 5)
})

test("'0' is off, for both booleans", () => {
  const prefs = readQuestToastPrefs(
    store({ [QUEST_TOAST_KEYS.enabled]: '0', [QUEST_TOAST_KEYS.myClasses]: '0' })
  )
  assert.equal(prefs.enabled, false)
  assert.equal(prefs.myClasses, false)
  // …and the third answer is untouched by the other two.
  assert.equal(prefs.repeatMin, 5)
})

test("'1' is on, so a stored answer round-trips either way", () => {
  const prefs = readQuestToastPrefs(
    store({ [QUEST_TOAST_KEYS.enabled]: '1', [QUEST_TOAST_KEYS.myClasses]: '1' })
  )
  assert.equal(prefs.enabled, true)
  assert.equal(prefs.myClasses, true)
})

test("a stored '15' is fifteen minutes", () => {
  assert.equal(readQuestToastPrefs(store({ [QUEST_TOAST_KEYS.repeatMin]: '15' })).repeatMin, 15)
})

test('every offered stop reads back as itself', () => {
  for (const m of REPEAT_CHOICES) {
    assert.equal(readQuestToastPrefs(store({ [QUEST_TOAST_KEYS.repeatMin]: String(m) })).repeatMin, m)
  }
})

test("a minute count this build does not offer degrades to five — '7' and 'abc' alike", () => {
  assert.equal(readQuestToastPrefs(store({ [QUEST_TOAST_KEYS.repeatMin]: '7' })).repeatMin, 5)
  assert.equal(readQuestToastPrefs(store({ [QUEST_TOAST_KEYS.repeatMin]: 'abc' })).repeatMin, 5)
  assert.equal(readQuestToastPrefs(store({ [QUEST_TOAST_KEYS.repeatMin]: '' })).repeatMin, 5)
  assert.equal(readQuestToastPrefs(store({ [QUEST_TOAST_KEYS.repeatMin]: '0' })).repeatMin, 5)
})

test('a getter that throws degrades to the defaults rather than taking the detector down', () => {
  const prefs = readQuestToastPrefs(() => {
    throw new Error('site data blocked')
  })
  assert.deepEqual(prefs, DEFAULT_QUEST_TOAST_PREFS)
})

test('repeatLabel says an hour as an hour', () => {
  assert.equal(repeatLabel(1), '1 min')
  assert.equal(repeatLabel(5), '5 min')
  assert.equal(repeatLabel(15), '15 min')
  assert.equal(repeatLabel(60), '1 hour')
})
