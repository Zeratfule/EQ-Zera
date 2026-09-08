// Store schema migration 12 → 13: retiring the exclusive-fullscreen note's memory (JOS-375).
//
// A companion to `storeMigrations.test.mts` (the framework and steps 1→4) and its siblings, for
// the reason those exist: the first file is at the repo's 400-code-line factoring ceiling, and
// the answer to that is a split rather than a widened threshold.
//
// WHAT THIS STEP IS. Every other step in the chain ADDS a shape. This one DELETES a key —
// `eqExclusiveNoticeDismissedVersion`, the app version at which an install dismissed the JOS-368
// Preferences note telling a player their game was in exclusive fullscreen. On the live client
// `Fullscreen=1` is a BORDERLESS fullscreen WINDOW, which an always-on-top overlay shares
// perfectly well, so the note could never be true for anybody it was shown to (JOS-375). It was
// removed rather than reworded, and a key nothing reads is a thing a future reader has to look up
// before they can rule it out.
//
// WHY IT IS A STEP RATHER THAN A TOLERATED ORPHAN: 1 → 2 already set the precedent by dropping
// `liveLoot` when live loot stopped being persisted. The point of a versioned chain is that the
// file on disk matches the shape the code believes in.
//
// WHAT IT MUST NOT DO is touch anything else. A deletion step is the one shape of migration that
// could quietly take a setting away, so the fixture below is fully populated and every other key
// is asserted byte-identical.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_SCHEMA_VERSION,
  SCHEMA_VERSION_KEY,
  migrateStoreData,
  type StoreData
} from '../src/main/storeMigrations'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name: string): StoreData => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

const KEY = 'eqExclusiveNoticeDismissedVersion'

/** `store-v12-eq-note.json` — the only store that can hold this key: a dev-cohort install that ran
 *  the one unreleased build carrying the note, and dismissed it. */
const V12 = 'store-v12-eq-note.json'

test('a v12 store that dismissed the note loses the key, and keeps everything else', () => {
  const before = fixture(V12)
  assert.equal(before[KEY], '0.28.0', 'the fixture must actually carry what this step removes')

  const { status, from, to, applied, data } = migrateStoreData(before)
  assert.equal(status, 'migrated')
  assert.equal(from, 12)
  assert.equal(to, CURRENT_SCHEMA_VERSION)
  assert.equal(applied[0], 13, 'a v12 store enters the chain at this step')

  assert.equal(KEY in data, false, 'the dismissal has nothing left to remember')
  for (const key of Object.keys(before)) {
    if (key === KEY || key === SCHEMA_VERSION_KEY) continue
    assert.deepEqual(data[key], before[key], `${key} must come through untouched`)
  }
})

test('a store that never saw the note is unchanged by the step', () => {
  // Which is every install outside the dev cohort: JOS-368 shipped in no release at all, so the
  // key exists on a handful of machines and `delete` on an absent key is a no-op.
  for (const name of ['store-v1-first-build.json', 'store-v6-perf.json', 'store-v8-toast-off.json']) {
    const { data } = migrateStoreData(fixture(name))
    assert.equal(KEY in data, false, `${name}: nothing to drop, nothing added`)
  }
})

test('running the chain twice over the dismissed store is the same as running it once', () => {
  const once = migrateStoreData(fixture(V12))
  const twice = migrateStoreData(once.data)
  assert.equal(twice.status, 'up-to-date')
  assert.equal(twice.changed, false)
  assert.deepEqual(twice.data, once.data)
})
