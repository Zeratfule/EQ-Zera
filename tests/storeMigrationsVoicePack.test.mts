// The inherited voice pack leaves, and the alerts that named it do not go quiet (14 -> 15).
//
// A companion to `storeMigrations.test.mts` and its siblings (`…Toast` 9, `…Presence` 5,
// `…Telemetry` 6, `…Perf` 7, `…Voice` 4+8, `…EqNote` 13, `…ConCard` at today's schema), for the
// same reason those are separate files: the first is at the repo's 400-code-line factoring
// ceiling, and the answer to that is a split rather than a widened threshold.
//
// WHAT HAPPENED. This fork shipped a third-party spoken-word pack it inherited from upstream as
// its default. The owner removed it (2026-09-08): it is not downloaded, bundled, credited or
// named by the app any more. But a pack id is PERSISTED - every alert authored while it was the
// default still stores `{packId, soundId}` - so the removal is only half done until the stored
// refs move.
//
// WHY A SCHEMA STEP AND NOT `LEGACY_ALERT_PACK_IDS`. The retired-pack rewrite in
// data/defaultPacks.ts is a FLEET-WIDE switch (`ALERT_SOUND_MIGRATION_VERSION`, frozen by
// alertSoundMigrationPin.test.mts): adding an id to it re-runs the whole table against every
// install that has ever run this app and would undo a user's deliberate re-point of `peon` or
// `sc_marine`. The ordered chain runs one step, once, in a known order, on the stores that have
// not had it. That is the smaller instrument, so that is the one used.
//
// THREE CLAIMS, and the second is the one that would be easy to get wrong:
//   1. Every ref into the removed pack lands on a REAL cue of the shipped pack, same CESP
//      category, so a completion sting stays a completion.
//   2. Everything else in the store is untouched - most of all an alert on another pack.
//   3. The step is idempotent and the chain stays contiguous, because that is what makes an
//      upgrade from any past build a single deterministic pass.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CURRENT_SCHEMA_VERSION, migrateStoreData, type StoreData } from '../src/main/storeMigrations'
import {
  DEFAULT_ALERT_PACK_ID,
  DEFAULT_ALERT_SOUNDS,
  REMOVED_VOICE_PACK_ID,
  migrateRemovedVoicePackRef
} from '../src/main/data/defaultPacks'
import type { SoundPackManifest } from '../src/shared/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, 'fixtures')
const fixture = (name: string): StoreData =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as StoreData

/**
 * `store-v14-voice-pack.json` - a store written the day before the pack was removed: three alerts
 * on it (two whose ids carry a CESP category, one hand-edited id that carries none), one alert on
 * the user's own imports, and a preference plus a tombstone naming the pack.
 */
const V14 = 'store-v14-voice-pack.json'

interface StoredAlert {
  id: string
  sound: { packId: string; soundId: string }
}

const alertsOf = (d: StoreData): StoredAlert[] => d['alerts'] as unknown as StoredAlert[]
const soundOf = (d: StoreData, id: string): { packId: string; soundId: string } =>
  alertsOf(d).find((a) => a.id === id)?.sound ?? { packId: '', soundId: '' }

/** The cues the shipped pack really has, read off the manifest that ships. */
function shippedCues(): Set<string> {
  const path = join(HERE, '..', 'resources', 'soundpacks', DEFAULT_ALERT_PACK_ID, 'manifest.json')
  const m = JSON.parse(readFileSync(path, 'utf8')) as SoundPackManifest
  return new Set(Object.keys(m.sounds))
}

test('the chain runs, lands on today, and reports the step it added', () => {
  const out = migrateStoreData(fixture(V14))
  assert.equal(out.status, 'migrated')
  assert.equal(out.from, 14)
  assert.equal(out.to, CURRENT_SCHEMA_VERSION)
  assert.deepEqual(out.applied, [15], 'one step, and only one')
})

test('every ref into the removed pack becomes a REAL cue of the shipped pack, category kept', () => {
  const { data } = migrateStoreData(fixture(V14))
  const cues = shippedCues()
  for (const a of alertsOf(data)) {
    assert.notEqual(a.sound.packId, REMOVED_VOICE_PACK_ID, `${a.id} still names the removed pack`)
  }
  // An `input-required-…` id keeps meaning "look at the screen"; a `task-complete-…` one keeps
  // meaning "that finished". This is the intent-preserving rule, not a lucky sort order.
  assert.deepEqual(soundOf(data, 'charm-break'), {
    packId: DEFAULT_ALERT_PACK_ID,
    soundId: DEFAULT_ALERT_SOUNDS.buffWearsOff
  })
  assert.deepEqual(soundOf(data, 'raid-target'), {
    packId: DEFAULT_ALERT_PACK_ID,
    soundId: DEFAULT_ALERT_SOUNDS.bossDefeat
  })
  // A hand-edited id with no category in it still lands on something audible rather than mute.
  assert.deepEqual(soundOf(data, 'hand-edited'), {
    packId: DEFAULT_ALERT_PACK_ID,
    soundId: DEFAULT_ALERT_SOUNDS.buffWearsOff
  })
  for (const a of alertsOf(data)) {
    if (a.sound.packId !== DEFAULT_ALERT_PACK_ID) continue
    assert.ok(cues.has(a.sound.soundId), `${a.id}: '${a.sound.soundId}' is not a cue the pack has`)
  }
})

test("an alert on any other pack is none of this step's business", () => {
  const { data } = migrateStoreData(fixture(V14))
  assert.deepEqual(soundOf(data, 'mine'), { packId: 'my-sounds', soundId: 'ff-victory' })
  // …and the rest of the file survives verbatim.
  const before = fixture(V14)
  const untouched = ['byCharacter', 'alertPrefs', 'voice', 'overlays', 'telemetry', 'perfHud', 'resists']
  for (const key of untouched) {
    assert.deepEqual(data[key], before[key], `${key} must survive untouched`)
  }
})

test('a preference naming the removed pack is dropped, which means "use what the app ships"', () => {
  const { data } = migrateStoreData(fixture(V14))
  const prefs = data['soundPacks'] as Record<string, unknown>
  assert.equal('defaultPackId' in prefs, false, 'every picker pre-selection would otherwise keep it')
  // The tombstone exists so provisioning can skip a SHIPPED id, and nothing ships this one now.
  assert.deepEqual(prefs['removedPackIds'], ['peon'], 'another pack stone is left alone')
})

test('running it twice equals running it once, and a store already past it is untouched', () => {
  const once = migrateStoreData(fixture(V14)).data
  const twice = migrateStoreData(once).data
  assert.deepEqual(twice, once)
  const current = migrateStoreData(fixture('store-v15-con-card.json'))
  assert.equal(current.status, 'up-to-date')
  assert.equal(current.changed, false)
})

test('the mapping itself: only that pack moves, and it moves by category', () => {
  const keep = { packId: 'sc_marine', soundId: 'task-complete-shoot' }
  assert.deepEqual(migrateRemovedVoicePackRef(keep), keep, 'another pack is returned as written')
  assert.deepEqual(
    migrateRemovedVoicePackRef({ packId: REMOVED_VOICE_PACK_ID, soundId: 'task-error-x' }),
    { packId: DEFAULT_ALERT_PACK_ID, soundId: DEFAULT_ALERT_SOUNDS.illusionFade }
  )
  assert.deepEqual(
    migrateRemovedVoicePackRef({ packId: REMOVED_VOICE_PACK_ID, soundId: 'resource-limit-y' }),
    { packId: DEFAULT_ALERT_PACK_ID, soundId: DEFAULT_ALERT_SOUNDS.buffFade }
  )
})

test('THE ID SURVIVES IN EXACTLY ONE PLACE, because a rewrite has to recognize what it rewrites', () => {
  // If it ever needs spelling twice, the second copy is the one that will drift.
  const data = readFileSync(join(HERE, '..', 'src', 'main', 'data', 'defaultPacks.ts'), 'utf8')
  const spelled = data.split(REMOVED_VOICE_PACK_ID).length - 1
  assert.equal(spelled, 1, 'declared once in data/defaultPacks.ts and nowhere else in it')
  const migrations = readFileSync(join(HERE, '..', 'src', 'main', 'storeMigrations.ts'), 'utf8')
  assert.equal(migrations.includes(REMOVED_VOICE_PACK_ID), false, 'the step asks for the constant')
})
