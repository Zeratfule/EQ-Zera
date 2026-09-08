// Store schema migration 8 → 9: the celebration toast defaults ON (owner, 2026-08-05: "it should
// be on by default").
//
// A companion to `storeMigrations.test.mts` (the framework and steps 1→4) and its siblings
// (`…Presence` 5, `…Telemetry` 6, `…Perf` 7, `…Voice` 4+8), for the same reason those are
// separate files: the first is at the repo's 400-code-line factoring ceiling, and the answer to
// that is a split, not a widened threshold.
//
// WHY A DEFAULT FLIP NEEDS A MIGRATION AT ALL. A default only decides the value of an ABSENT key,
// and `overlays.toast` is written to the store on the first launch of any build that touches the
// overlay config — not only when a user reaches for the switch. So the toast overlay, which
// shipped the day before with `open: false` (like the five meters it is not much like), is
// already recorded as OFF in every store that has run that build. Changing the default alone
// would leave all of them off forever, which is precisely the "silently does nothing" outcome the
// owner was reporting.
//
// AND WHY FLIPPING A STORED `false` IS HONEST HERE. The feature was hours old: no stored `false`
// in existence is a decision to decline it — they are yesterday's default, written down. The step
// is pinned to this one version, so a user who turns the toast off tomorrow writes `false` into a
// v9 store, this step never runs against it, and their switch stays where they put it. That is
// the difference between correcting a default once and an app that re-enables things.
//
// The step deliberately does NOT touch the stray `overlays.toast.toast.sound` / `.volume` keys
// that the same commit stops reading (the sound picker is gone — the seeded boss/quest ALERTS own
// that audio). Dropping a READ of optional keys needs no migration: every reader defaults, and
// `normalizeToastConfig` simply stops emitting them the next time the blob is written.

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

/** `store-v8-toast-off.json` — a store written by the FIRST toast build: three overlay kinds
 *  configured, the toast among them at its shipped `open: false`, and the retired
 *  `toast.sound`/`toast.volume` pair still sitting inside its blob. */
const V8 = 'store-v8-toast-off.json'

const overlaysOf = (d: StoreData): Record<string, StoreData> => d['overlays'] as Record<string, StoreData>

test('a v8 store has its pre-default toast switch corrected, once', () => {
  const before = fixture(V8)
  const { status, from, to, applied, data } = migrateStoreData(before)

  assert.equal(status, 'migrated')
  assert.equal(from, 8)
  assert.equal(to, CURRENT_SCHEMA_VERSION)
  // Append-proof, like the sibling files: step 9 is this file's, and the chain continues
  // contiguously from there.
  assert.equal(applied[0], 9, 'a v8 store enters the chain at the toast step')
  assert.deepEqual(applied, Array.from({ length: applied.length }, (_, i) => i + 9))

  assert.equal(overlaysOf(data)['toast']['open'], true, 'the toast is on after the upgrade')
  assert.equal(overlaysOf(before)['toast']['open'], false, 'and the input was never mutated')
})

test('it touches the toast switch and NOTHING else — not even the keys it stopped reading', () => {
  const before = fixture(V8)
  const { data } = migrateStoreData(before)

  // Every other overlay kind keeps its own open-state: this is not "open the overlays".
  assert.deepEqual(overlaysOf(data)['fight'], overlaysOf(before)['fight'])
  assert.deepEqual(overlaysOf(data)['events'], overlaysOf(before)['events'])
  // Position, lock and background are the user's; only `open` moved.
  const { open: _open, ...rest } = overlaysOf(data)['toast']
  const { open: _wasOpen, ...wasRest } = overlaysOf(before)['toast']
  assert.deepEqual(rest, wasRest, 'the rest of the toast config is byte-identical')
  // The retired sound keys ride along untouched — no read, no rewrite, no data loss.
  assert.deepEqual((overlaysOf(data)['toast']['toast'] as StoreData)['sound'], null)
  assert.equal((overlaysOf(data)['toast']['toast'] as StoreData)['volume'], 0.7)

  for (const key of ['byCharacter', 'alerts', 'alertPrefs', 'voice', 'telemetry', 'perfHud']) {
    assert.deepEqual(data[key], before[key], `${key} must survive the migration untouched`)
  }
})

test('a store with no overlays block at all is left alone (the default answers it)', () => {
  // An install that has never opened Preferences has no `overlays` key: `open` is absent, the
  // new default is true, and there is nothing here to correct.
  const out = migrateStoreData({ [SCHEMA_VERSION_KEY]: 8, byCharacter: {} })
  assert.equal(out.status, 'migrated')
  assert.equal('overlays' in out.data, false, 'the step never invents an overlays block')

  // Junk in the slot degrades rather than throwing — a hand-edited file still boots.
  for (const junk of [null, 42, 'nonsense', [], { toast: 'not an object' }]) {
    const bad = migrateStoreData({ [SCHEMA_VERSION_KEY]: 8, overlays: junk })
    assert.equal(bad.status, 'migrated', `${JSON.stringify(junk)} must not break the chain`)
    assert.equal(bad.data[SCHEMA_VERSION_KEY], CURRENT_SCHEMA_VERSION)
  }
})

test('a user who turns the toast OFF on v9 keeps it off — the correction never runs twice', () => {
  const once = migrateStoreData(fixture(V8))
  // The user decides they do not want it after all. Their choice is written into a v9 store.
  const chosen = structuredClone(once.data)
  overlaysOf(chosen)['toast']['open'] = false

  const again = migrateStoreData(chosen)
  assert.equal(again.status, 'up-to-date', 'a v9 store has nothing left to do')
  assert.equal(overlaysOf(again.data)['toast']['open'], false, 'the switch stays where the user put it')
})

test('running the chain twice equals running it once', () => {
  const once = migrateStoreData(fixture(V8))
  const twice = migrateStoreData(once.data)
  assert.equal(twice.status, 'up-to-date')
  assert.equal(twice.changed, false)
  assert.deepEqual(twice.data, once.data, 'the second pass must be a no-op')
})
