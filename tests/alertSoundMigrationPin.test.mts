// ============================================================================
// alertSoundMigrationPin.test.mts — JOS-272 (v): the fleet-wide alert-sound rewrite has a lock on it.
// ============================================================================
//
// WHAT `ALERT_SOUND_MIGRATION_VERSION` ACTUALLY IS. It reads like a version number and it is a
// SWITCH. `store.ts migrateStoredAlertSounds` runs the retired-pack rewrite on the first
// `getAlerts()` after the stamp in a user's store falls behind the constant — so bumping the
// constant by one re-runs `migrateAlertSounds` on EVERY install that has ever run this app, against
// whatever `LEGACY_ALERT_PACK_IDS` and the category mapping say at that moment. Every alert pointing
// into a listed pack is re-pointed at the shipped default, and the stamp records only that the
// rewrite ran, never what it did. There is no undo.
//
// That is a legitimate thing to want — a pack really can be retired later — and it is never a thing
// to do incidentally. Two ways it could happen by accident, both closed here:
//
//   1. THE BUMP ITSELF, made while changing something adjacent (the constant sits four lines under
//      the list it governs). The version is frozen below, so a bump is a red suite and therefore a
//      sentence somebody has to write in a commit message.
//   2. THE MAPPING MOVING UNDER A STORE THAT IS NOT YET STAMPED. Every user who has never run the
//      migration runs whatever the table says on the day they upgrade. The whole input → output
//      table is frozen below, verbatim, so a "harmless" re-point of one category cannot be made
//      without stating it.
//
// AND THE STAMP SEMANTICS THEMSELVES. `alertSoundMigrationPending` was extracted out of store.ts for
// this suite (JOS-272): store.ts imports Electron, the predicate does not, and "a store already
// stamped is never rewritten again" is the property the whole design rests on — including for a
// store stamped by a NEWER build, which an older build must never walk backwards.
//
// This is a PINNING suite. It asserts today's values on purpose. When a change here is deliberate,
// change these numbers in the same commit and say why.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ALERT_SOUND_MIGRATION_VERSION,
  DEFAULT_ALERT_PACK_ID,
  DEFAULT_ALERT_SOUNDS,
  LEGACY_ALERT_PACK_IDS,
  alertSoundMigrationPending,
  migrateAlertSoundRef,
  migrateAlertSounds
} from '../src/main/data/defaultPacks'
import type { AlertDef, AlertSoundRef } from '../src/shared/types'

// ------------------------------------------------------------------------ the switch

test('the migration version is 1, and moving it is a fleet-wide rewrite', () => {
  assert.equal(ALERT_SOUND_MIGRATION_VERSION, 1)
})

test('the stamp is the gate: a store that has run it never runs it again', () => {
  assert.equal(alertSoundMigrationPending(undefined), true, 'never migrated')
  assert.equal(alertSoundMigrationPending(0), true, 'stamped below the current version')
  assert.equal(alertSoundMigrationPending(ALERT_SOUND_MIGRATION_VERSION), false, 'stamped — done, forever')
  assert.equal(
    alertSoundMigrationPending(ALERT_SOUND_MIGRATION_VERSION + 5),
    false,
    'a store stamped by a NEWER build is never walked backwards through this build’s mapping'
  )
  // A hand-edited or otherwise nonsensical stamp counts as never migrated, which is the safe
  // direction: the rewrite can only ever touch refs into the legacy packs, so running it once more
  // costs nothing, while treating junk as "already done" would strand a real upgrade.
  for (const junk of [null, '1', {}, NaN, 1.5, -1]) {
    assert.equal(alertSoundMigrationPending(junk), true, `junk stamp: ${String(junk)}`)
  }
})

test('THE SOURCE PIN: store.ts asks the predicate rather than re-deriving the comparison', () => {
  const src = readFileSync(new URL('../src/main/store.ts', import.meta.url), 'utf8')
  assert.ok(src.includes("if (!alertSoundMigrationPending(store.get('alertSoundMigration'))) return alerts"))
  assert.ok(src.includes("store.set('alertSoundMigration', ALERT_SOUND_MIGRATION_VERSION)"), 'and stamps after')
})

// --------------------------------------------------------------------- the legacy list

test('the legacy pack list is exactly these four, and the shipped pack is not one of them', () => {
  assert.deepEqual(LEGACY_ALERT_PACK_IDS, ['default', 'peon', 'sc_marine', 'bastion'])
  assert.equal(
    LEGACY_ALERT_PACK_IDS.includes(DEFAULT_ALERT_PACK_ID),
    false,
    'listing the shipped pack would make the rewrite rewrite its own output — and, paired with a ' +
      'version bump, re-point every alert in the fleet'
  )
})

test('a ref into any pack that is NOT on the list is returned untouched, identity included', () => {
  // The user's own choice. `bastion` was retired; `openpeon-whatever` is a pack they installed
  // themselves, and an alert pointing at it is a preference, not a legacy artefact.
  for (const packId of [DEFAULT_ALERT_PACK_ID, 'openpeon-whatever', 'my-custom-pack', 'Default', 'PEON']) {
    const ref: AlertSoundRef = { packId, soundId: 'task-complete-3' }
    assert.equal(migrateAlertSoundRef(ref), ref, `untouched, by identity: ${packId}`)
  }
})

// ------------------------------------------------------------------------ the mapping
//
// Every input the rewrite recognises, and what it turns into. Frozen VERBATIM: this table is what a
// bump would replay across the fleet, so a change to any row has to be a change to this file too.

const MAPPING: [AlertSoundRef, string][] = [
  // The four ids of the deleted synthesized `default` pack, mapped by the ROLE each one played.
  [{ packId: 'default', soundId: 'victory' }, DEFAULT_ALERT_SOUNDS.bossDefeat],
  [{ packId: 'default', soundId: 'warning' }, DEFAULT_ALERT_SOUNDS.charmBreak],
  [{ packId: 'default', soundId: 'chime' }, DEFAULT_ALERT_SOUNDS.buffWearsOff],
  [{ packId: 'default', soundId: 'horn' }, DEFAULT_ALERT_SOUNDS.buffFade],
  // CESP category, recovered from the id's own prefix — the replacement keeps the alert's INTENT.
  [{ packId: 'peon', soundId: 'session-start-01' }, 'session-start-power-01'],
  [{ packId: 'peon', soundId: 'session-end-02' }, DEFAULT_ALERT_SOUNDS.questComplete],
  [{ packId: 'peon', soundId: 'task-acknowledge-03' }, DEFAULT_ALERT_SOUNDS.debuffLands],
  [{ packId: 'peon', soundId: 'task-progress-04' }, DEFAULT_ALERT_SOUNDS.debuffLands],
  [{ packId: 'bastion', soundId: 'task-complete-3' }, DEFAULT_ALERT_SOUNDS.bossDefeat],
  [{ packId: 'sc_marine', soundId: 'task-error-01' }, DEFAULT_ALERT_SOUNDS.illusionFade],
  [{ packId: 'sc_marine', soundId: 'input-required-01' }, DEFAULT_ALERT_SOUNDS.buffWearsOff],
  [{ packId: 'peon', soundId: 'resource-limit-09' }, DEFAULT_ALERT_SOUNDS.buffFade],
  [{ packId: 'peon', soundId: 'user-spam-01' }, 'user-spam-click-01'],
  // The short prefixes the curated packs used before the CESP names.
  [{ packId: 'peon', soundId: 'start-1' }, 'session-start-power-01'],
  [{ packId: 'peon', soundId: 'ack-1' }, DEFAULT_ALERT_SOUNDS.debuffLands],
  [{ packId: 'peon', soundId: 'complete-1' }, DEFAULT_ALERT_SOUNDS.bossDefeat],
  [{ packId: 'peon', soundId: 'error-1' }, DEFAULT_ALERT_SOUNDS.illusionFade],
  [{ packId: 'peon', soundId: 'input-1' }, DEFAULT_ALERT_SOUNDS.buffWearsOff],
  [{ packId: 'peon', soundId: 'limit-1' }, DEFAULT_ALERT_SOUNDS.buffFade],
  [{ packId: 'peon', soundId: 'spam-1' }, 'user-spam-click-01'],
  // peon's two prefix-less session.start lines.
  [{ packId: 'peon', soundId: 'ready' }, 'session-start-power-01'],
  [{ packId: 'peon', soundId: 'need-doing' }, 'session-start-power-01'],
  // Unrecognisable: the "needs your attention" line rather than silence.
  [{ packId: 'peon', soundId: 'who-knows-what-this-was' }, DEFAULT_ALERT_SOUNDS.buffWearsOff]
]

test('every legacy sound maps to exactly the shipped line it maps to today', () => {
  for (const [ref, soundId] of MAPPING) {
    assert.deepEqual(
      migrateAlertSoundRef(ref),
      { packId: DEFAULT_ALERT_PACK_ID, soundId },
      `${ref.packId}/${ref.soundId}`
    )
  }
})

test('the seven shipped sound ids are the ones the mapping lands on', () => {
  // The mapping's right-hand side is written in terms of DEFAULT_ALERT_SOUNDS, so the table above
  // would follow a rename silently. These are the literals a user's store actually holds.
  assert.deepEqual(DEFAULT_ALERT_SOUNDS, {
    charmBreak: 'input-required-alarm-01',
    bossDefeat: 'task-complete-fanfare-01',
    questComplete: 'task-complete-fanfare-02',
    buffWearsOff: 'input-required-alarm-02',
    buffFade: 'resource-limit-thud-01',
    debuffLands: 'task-acknowledge-blip-01',
    illusionFade: 'task-error-buzz-01'
  })
  assert.equal(DEFAULT_ALERT_PACK_ID, 'eq-zera-console')
})

// ----------------------------------------------------------------------- the list form

test('a list with nothing to rewrite is returned BY IDENTITY, so no store write happens', () => {
  // `migrateStoredAlertSounds` only calls `store.set('alerts', …)` when `changed > 0`. A migration
  // that reported a change it did not make would rewrite the user's alert list on the strength of
  // nothing — the same contract `migrateAlertTriggers` copied from here.
  const alerts = [
    { id: 'a', sound: { packId: DEFAULT_ALERT_PACK_ID, soundId: DEFAULT_ALERT_SOUNDS.charmBreak } },
    { id: 'b', sound: { packId: 'openpeon-whatever', soundId: 'task-complete-1' } }
  ] as unknown as AlertDef[]
  const res = migrateAlertSounds(alerts)
  assert.equal(res.changed, 0)
  assert.equal(res.alerts, alerts, 'identity — nothing moved')
})

test('a mixed list rewrites only the legacy refs, and counts only those', () => {
  const alerts = [
    { id: 'legacy', sound: { packId: 'peon', soundId: 'ready' } },
    { id: 'mine', sound: { packId: 'openpeon-whatever', soundId: 'task-complete-1' } }
  ] as unknown as AlertDef[]
  const res = migrateAlertSounds(alerts)
  assert.equal(res.changed, 1)
  assert.deepEqual(res.alerts[0].sound, {
    packId: DEFAULT_ALERT_PACK_ID,
    soundId: 'session-start-power-01'
  })
  assert.equal(res.alerts[1], alerts[1], 'the untouched def is the SAME object')
})

test('the rewrite is idempotent: running it twice is running it once', () => {
  const alerts = [{ id: 'legacy', sound: { packId: 'peon', soundId: 'ready' } }] as unknown as AlertDef[]
  const once = migrateAlertSounds(alerts)
  const twice = migrateAlertSounds(once.alerts)
  assert.equal(twice.changed, 0, 'a second pass finds nothing — the output is never legacy')
  assert.equal(twice.alerts, once.alerts)
})
