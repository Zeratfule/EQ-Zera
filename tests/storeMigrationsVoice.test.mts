// Store schema migrations for VOICE ALERTS: 3 → 4 (the feature arrives) and 7 → 8 (its master
// switch is retired).
//
// A companion to `storeMigrations.test.mts` (the framework itself: chain integrity, the file
// half, the failure/downgrade policy) and `storeMigrationsPresence.test.mts` (step 4→5), for the
// reason both of those cite: that file sits at the repo's 400-code-line factoring ceiling, and
// the answer is a split, not a widened threshold. The two voice steps live TOGETHER because the
// second one reads what the first one wrote — see `normalizeLegacyVoicePrefs` in
// storeMigrations.ts, and the "survives the WHOLE chain from v3" test below.
//
// WHAT THE STEP IS FOR. `VoicePrefs.enabled` is gone from the model, the UI and every runtime gate
// (owner, 2026-08-04: "duplicative settings; you should not have to enable voice in Preferences").
// An alert speaks because ITS OWN `audio` says 'speech'/'both' — that is the entire switch now.
//
// WHY A MIGRATION IS REQUIRED AT ALL, and this is the whole content of the file: SIMPLIFYING A
// SETTING MUST NOT CHANGE WHAT A USER HEARS. The retired switch degraded spoken alerts to their
// pack SOUND while it was off (never to silence), so a user who left it off — the default — has
// alerts that say 'speech' and have been playing sounds for their entire life. Ship the removal
// without this step and every one of those alerts starts talking on update: the app overruling a
// preference on the same day it deleted the control for it.
//
//   voice.enabled          alert.audio            after v8
//   ---------------------- ---------------------- ----------------------------------
//   true                   'speech' / 'both'      unchanged — it spoke, it still speaks
//   true                   'sound' / absent       unchanged
//   false / absent / junk  'speech' / 'both'      key DELETED ⇒ 'sound' (what it was playing)
//   false / absent / junk  'sound' / absent       unchanged
//   (every case)           —                      `voice.enabled` is gone from the file
//
// The `speech` block SURVIVES a rewrite: it is inert on a sound-only def, and it is the user's own
// phrase and voice choice. Re-picking "Voice (spoken)" in the row must find their words intact.

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

/** `store-v6-perf.json` — the voice-ON store: `enabled:true`, one alert on `audio:'both'`. */
const VOICE_ON = 'store-v6-perf.json'
/** `store-v7-voice-off.json` — the voice-OFF store, with one alert of every audio channel. */
const VOICE_OFF = 'store-v7-voice-off.json'

const alertsOf = (data: StoreData): StoreData[] => data['alerts'] as StoreData[]
const byId = (data: StoreData, id: string): StoreData =>
  alertsOf(data).find((a) => a['id'] === id) as StoreData

// ============================================================ 3 → 4: voice alerts (§2/D6)
//
// The step that INTRODUCED the feature. Its alert half is TOLERATE-AND-NORMALIZE: a def written
// before voice existed is already correct (absent `audio` means 'sound', absent `speech` means
// "say your own name"), so the step never invents either key; what it does is make the v4 shape a
// promise that any value PRESENT is one this build understands.
//
// These three stop the chain AT 4 (`target`, the runner's test seam) — running to CURRENT would
// fold in 7 → 8, which retires `voice.enabled` and rewrites the very alerts this step is asserted
// to leave alone, tangling two steps' claims into one assertion. v8 is asserted below, on the
// full chain, where it belongs.

/** The v4-era default voice blob — `enabled` and all. v8 is what removes it (see below). */
const V4_VOICE_OFF = { enabled: false, engine: 'system', voiceId: null, rate: 1, volume: 1 }
const TO_V4 = { target: 4 }

test('a v3 store gains the voice prefs blob, and every alert keeps every field it had', () => {
  const before = fixture('store-v3-alerts.json')
  const { status, from, to, applied, data } = migrateStoreData(before, TO_V4)

  assert.equal(status, 'migrated')
  assert.equal(from, 3)
  assert.equal(to, 4)
  assert.ok(applied.includes(4))
  assert.deepEqual(data['voice'], V4_VOICE_OFF)

  const alerts = alertsOf(data)
  const beforeAlerts = before['alerts'] as StoreData[]
  assert.equal(alerts.length, 3)
  assert.deepEqual(alerts[0], beforeAlerts[0], 'a pre-voice alert comes through byte-identical')

  // A valid voice config survives verbatim, alongside every non-voice field.
  assert.equal(alerts[1]['audio'], 'both')
  assert.deepEqual(alerts[1]['speech'], { mode: 'spellFirstWord', voiceId: 'sapi:David' })
  for (const key of ['id', 'name', 'enabled', 'trigger', 'sound', 'volume', 'cooldownMs']) {
    assert.deepEqual(alerts[1][key], beforeAlerts[1][key], `${key} must survive untouched`)
  }

  // Values this build does not understand are DROPPED back to the documented default, never
  // coerced into a different intent: 'shout' does not become 'both', and a def with an unknown
  // speech mode falls back to speaking its own name.
  assert.equal('audio' in alerts[2], false, 'an unknown audio action is dropped, not guessed at')
  assert.equal('speech' in alerts[2], false, 'an unknown speech mode takes the whole block with it')
  assert.deepEqual(alerts[2]['trigger'], beforeAlerts[2]['trigger'], 'the rest of the def is untouched')

  // Nothing else in a v3 store moves.
  for (const key of ['byCharacter', 'activeLogPath', 'alertPrefs', 'overlays']) {
    assert.deepEqual(data[key], before[key], `${key} must survive untouched`)
  }
})

test('an EXISTING voice blob is repaired field by field, never replaced wholesale', () => {
  // The user's "on" survives; an engine this build has never heard of does not silently become
  // the other tier's meaning; the out-of-range knobs are clamped rather than discarded.
  const messy = { enabled: true, engine: 'chatterbox', voiceId: '  ', rate: 99, volume: -2 }
  const { data } = migrateStoreData({ [SCHEMA_VERSION_KEY]: 3, voice: messy }, TO_V4)
  assert.deepEqual(data['voice'], { ...V4_VOICE_OFF, enabled: true, rate: 2, volume: 0 })
  // A garbage blob of any type still lands on a legal shape, and a store with no alerts key
  // gains the blob without the migration inventing an alert list (store.ts owns seeding).
  for (const junk of [null, 42, 'nonsense', [], true, undefined]) {
    const out = migrateStoreData({ [SCHEMA_VERSION_KEY]: 3, voice: junk }, TO_V4)
    assert.deepEqual(out.data['voice'], V4_VOICE_OFF)
    assert.equal('alerts' in out.data, false)
  }
})

test('malformed alert voice fields are dropped and over-long phrases capped — by the MIGRATION', () => {
  // So no reader downstream has to re-check them. A phrase, a non-object speech block, and an
  // entry that is not an alert at all: none may throw, and none may take a sibling with it.
  const alerts = [
    { id: 'a', name: 'A', audio: 'speech', speech: { mode: 'custom', phrase: 'x'.repeat(400) } },
    { id: 'b', name: 'B', speech: 'loud', audio: 7 },
    'not an alert'
  ]
  const { data } = migrateStoreData({ [SCHEMA_VERSION_KEY]: 3, alerts }, TO_V4)
  const out = data['alerts'] as unknown[]
  const first = out[0] as StoreData
  assert.equal((first['speech'] as StoreData)['phrase'], 'x'.repeat(120))
  assert.equal(first['audio'], 'speech')
  assert.deepEqual(out[1], { id: 'b', name: 'B' }, 'both junk fields go; the rest is preserved')
  assert.equal(out[2], 'not an alert', 'a non-object entry is passed through, never thrown on')
})

// ================================================== 7 → 8: the master switch is retired
// ------------------------------------------------------------------ the switch itself

test('the retired `enabled` flag is gone from the voice blob, whatever it said', () => {
  for (const name of [VOICE_ON, VOICE_OFF]) {
    const { data } = migrateStoreData(fixture(name))
    assert.equal('enabled' in (data['voice'] as StoreData), false, name)
  }
  // …including a store that never had a voice blob at all.
  const bare = migrateStoreData({ [SCHEMA_VERSION_KEY]: 7 })
  assert.deepEqual(bare.data['voice'], { engine: 'system', voiceId: null, rate: 1, volume: 1 })
})

test('the voice CONFIGURATION survives untouched — only the permission was removed', () => {
  const { data } = migrateStoreData(fixture(VOICE_OFF))
  assert.deepEqual(data['voice'], {
    engine: 'kokoro',
    voiceId: 'af_bella',
    rate: 1.2,
    volume: 0.9
  })
})

// ------------------------------------------------------- direction 1: the switch was ON

test('voice ON ⇒ every spoken alert stays spoken, and the whole store is otherwise identical', () => {
  const before = fixture(VOICE_ON)
  const { status, from, to, applied, data } = migrateStoreData(before)

  assert.equal(status, 'migrated')
  assert.equal(from, 6)
  assert.equal(to, CURRENT_SCHEMA_VERSION)
  assert.ok(applied.includes(8))

  assert.deepEqual(alertsOf(data), before['alerts'], 'a talking alert must not fall silent')
  for (const key of ['byCharacter', 'alertPrefs', 'overlays', 'cursorRing', 'telemetry']) {
    assert.deepEqual(data[key], before[key], `${key} must survive untouched`)
  }
})

test('voice ON survives the WHOLE chain from v3 — the flag is not dropped in transit', () => {
  // The trap this pins: step 3 → 4 also writes the voice blob, through the same normalizer that
  // stopped emitting `enabled`. If that step lost the flag, a v3 store would arrive at v8 looking
  // like a user who had voice OFF, and this alert would be silently un-spoken on upgrade.
  const { data } = migrateStoreData({
    [SCHEMA_VERSION_KEY]: 3,
    voice: { enabled: true, engine: 'system', voiceId: null, rate: 1, volume: 1 },
    alerts: [{ id: 'a', name: 'A', audio: 'speech' }]
  })
  assert.equal(byId(data, 'a')['audio'], 'speech')
})

// ------------------------------------------------------ direction 2: the switch was OFF

test('voice OFF ⇒ spoken alerts are folded back onto the sound they were already playing', () => {
  const before = fixture(VOICE_OFF)
  const { status, to, data } = migrateStoreData(before)

  assert.equal(status, 'migrated')
  assert.equal(to, CURRENT_SCHEMA_VERSION)

  // 'speech' and 'both' both become 'sound' — expressed as the ABSENT key, which is the shape
  // every pre-voice def has and what keeps a rewritten def's share fingerprint honest.
  assert.equal('audio' in byId(data, 'mez-broke'), false)
  assert.equal('audio' in byId(data, 'raid-target'), false)
  // The two that were never speaking are not touched at all.
  const beforeAlerts = before['alerts'] as StoreData[]
  assert.deepEqual(byId(data, 'charm-break'), beforeAlerts[0], 'no `audio` key ⇒ nothing to do')
  assert.equal(byId(data, 'low-health')['audio'], 'sound', "an explicit 'sound' stays explicit")
})

test('…and the user’s own words survive the rewrite: the speech block is kept', () => {
  const { data } = migrateStoreData(fixture(VOICE_OFF))
  assert.deepEqual(byId(data, 'mez-broke')['speech'], {
    mode: 'spellFirstWord',
    voiceId: 'sapi:David'
  })
  assert.deepEqual(byId(data, 'raid-target')['speech'], {
    mode: 'custom',
    phrase: 'raid target down'
  })
  // Every other field of a rewritten def is untouched — this is a one-key change, not a rebuild.
  for (const key of ['id', 'name', 'enabled', 'trigger', 'sound', 'volume', 'cooldownMs']) {
    const before = (fixture(VOICE_OFF)['alerts'] as StoreData[])[1]
    assert.deepEqual(byId(data, 'mez-broke')[key], before[key], `${key} must survive untouched`)
  }
})

test('a MISSING or malformed voice blob counts as OFF — the same test the old reader used', () => {
  // `normalizeVoicePrefs` read the flag as `raw.enabled === true`, so anything that was not
  // literally true already behaved as off, in the only code that ever consulted it. Reading it
  // any other way here would invent a preference the user never expressed.
  for (const voice of [undefined, null, 42, 'on', [], {}, { enabled: 'yes' }, { enabled: 1 }]) {
    const { data } = migrateStoreData({
      [SCHEMA_VERSION_KEY]: 7,
      ...(voice === undefined ? {} : { voice }),
      alerts: [{ id: 'a', name: 'A', audio: 'both' }]
    })
    assert.equal('audio' in byId(data, 'a'), false, JSON.stringify(voice))
  }
})

// ------------------------------------------------------------------ robustness

test('a junk alerts list never throws the chain, and non-objects pass through', () => {
  const { status, data } = migrateStoreData({
    [SCHEMA_VERSION_KEY]: 7,
    alerts: ['not an alert', null, 42, { id: 'a', name: 'A', audio: 'speech' }]
  })
  assert.equal(status, 'migrated')
  const alerts = data['alerts'] as unknown[]
  assert.deepEqual(alerts.slice(0, 3), ['not an alert', null, 42])
  assert.deepEqual(alerts[3], { id: 'a', name: 'A' })
  // A non-array alerts key is left exactly as found, rather than coerced into a list.
  assert.equal(migrateStoreData({ [SCHEMA_VERSION_KEY]: 7, alerts: 7 }).data['alerts'], 7)
})

test('running the chain twice changes nothing the second time', () => {
  const once = migrateStoreData(fixture(VOICE_OFF)).data
  const twice = migrateStoreData(once)
  assert.equal(twice.status, 'up-to-date')
  assert.equal(twice.changed, false)
  assert.deepEqual(twice.data, once)
})
