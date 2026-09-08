// THE SHIPPED SOUND PACK (EQ Zera, 2026-09-06): `eq-zera-console` is bundled, original, and
// carries every cue the seeded alerts, the templates and the curated groups point at - and the
// one-time migration still lands every retired-pack ref on a REAL cue of it.
//
// The pack is what scripts/gen-sounds.mts wrote under resources/soundpacks/ and what
// electron-builder.yml ships; this suite reads THAT directory, so a cue deleted or renamed in the
// generator without its reference being updated is a red test rather than a mute alert.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALAN_RICKMAN_PACK_ID,
  DEFAULT_ALERT_PACK_ID,
  DEFAULT_ALERT_SOUNDS,
  DEFAULT_PACK,
  DEFAULT_PACKS,
  DEFAULT_PACK_IDS,
  LEGACY_ALERT_PACK_IDS,
  REQUIRED_SOUND_IDS,
  migrateAlertSoundRef
} from '../src/main/data/defaultPacks'
import { GROUP_PACK_ID } from '../src/shared/alertGroups'
import { soundCategorySlug } from '../src/shared/soundPacks'
import { DEFAULT_PACK_ID as RENDERER_DEFAULT_PACK_ID } from '../src/renderer/src/features/alerts/suggestions'
import type { SoundPackManifest } from '../src/shared/types'

const here = dirname(fileURLToPath(import.meta.url))
const PACK_DIR = join(here, '..', 'resources', 'soundpacks', DEFAULT_ALERT_PACK_ID)

function manifest(): SoundPackManifest {
  return JSON.parse(readFileSync(join(PACK_DIR, 'manifest.json'), 'utf8')) as SoundPackManifest
}

test('the shipped default is the bundled console pack, and nothing is provisioned from the registry', () => {
  assert.equal(DEFAULT_ALERT_PACK_ID, 'eq-zera-console')
  assert.equal(GROUP_PACK_ID, DEFAULT_ALERT_PACK_ID, 'the groups author against the shipped pack')
  assert.equal(RENDERER_DEFAULT_PACK_ID, DEFAULT_ALERT_PACK_ID, 'the renderer mirror agrees')
  assert.deepEqual(DEFAULT_PACKS, [], 'first launch downloads nothing')
  assert.deepEqual(DEFAULT_PACK_IDS, [])
  assert.equal(DEFAULT_PACK.name, ALAN_RICKMAN_PACK_ID, 'the retired default is still described, for the migration tables')
  assert.equal(LEGACY_ALERT_PACK_IDS.includes(DEFAULT_ALERT_PACK_ID), false)
  assert.equal(LEGACY_ALERT_PACK_IDS.includes(ALAN_RICKMAN_PACK_ID), false, 'Alan Rickman refs are left alone - the pack is still installable')
})

test('the pack is on disk, its manifest is its own, and every file it names is a WAV', () => {
  const m = manifest()
  assert.equal(m.id, DEFAULT_ALERT_PACK_ID)
  assert.ok(Object.keys(m.sounds).length >= 27, 'three takes per CESP category')
  for (const [id, sound] of Object.entries(m.sounds)) {
    const path = join(PACK_DIR, sound.file)
    assert.ok(existsSync(path), `${id}: ${sound.file} is missing`)
    const head = readFileSync(path).subarray(0, 12).toString('latin1')
    assert.ok(head.startsWith('RIFF') && head.endsWith('WAVE'), `${id}: not a WAV`)
    assert.ok(soundCategorySlug(id) !== null, `${id}: no CESP category prefix, so a missing-sound fallback could not keep its intent`)
    assert.ok(sound.label.includes(' · '), `${id}: label carries its category`)
  }
})

test('every cue the seeded alerts, the templates and the groups reference exists in the pack', () => {
  const ids = new Set(Object.keys(manifest().sounds))
  for (const id of REQUIRED_SOUND_IDS) assert.ok(ids.has(id), `pack is missing '${id}'`)
  for (const id of Object.values(DEFAULT_ALERT_SOUNDS)) assert.ok(ids.has(id), `pack is missing '${id}'`)
})

test('migration rewrites every retired-pack sound onto a REAL cue, keeping the category', () => {
  const ids = new Set(Object.keys(manifest().sounds))
  const legacy: [string, string][] = [
    ['default', 'victory'],
    ['default', 'warning'],
    ['default', 'chime'],
    ['default', 'horn'],
    ['peon', 'ready'],
    ['peon', 'need-doing'],
    ['peon', 'ack-okie'],
    ['peon', 'complete-work'],
    ['peon', 'error-ugh'],
    ['peon', 'input-hmm'],
    ['peon', 'limit-whynot'],
    ['peon', 'spam-notime'],
    ['sc_marine', 'start-pieceofme'],
    ['sc_marine', 'ack-gogogo'],
    ['sc_marine', 'complete-shoot'],
    ['bastion', 'task-complete-3'],
    ['bastion', 'session-end-1'],
    ['bastion', 'task-progress-5'],
    ['bastion', 'user-spam-2'],
    ['peon', 'who-knows-what-this-was']
  ]
  for (const [packId, soundId] of legacy) {
    const next = migrateAlertSoundRef({ packId, soundId })
    assert.equal(next.packId, DEFAULT_ALERT_PACK_ID, `${packId}/${soundId} -> shipped pack`)
    assert.ok(ids.has(next.soundId), `${packId}/${soundId} -> real id (${next.soundId})`)
  }
  assert.equal(migrateAlertSoundRef({ packId: 'default', soundId: 'victory' }).soundId, DEFAULT_ALERT_SOUNDS.bossDefeat)
  assert.equal(migrateAlertSoundRef({ packId: 'default', soundId: 'warning' }).soundId, DEFAULT_ALERT_SOUNDS.charmBreak)
  assert.equal(migrateAlertSoundRef({ packId: 'peon', soundId: 'error-ugh' }).soundId, DEFAULT_ALERT_SOUNDS.illusionFade)
  assert.equal(migrateAlertSoundRef({ packId: 'bastion', soundId: 'resource-limit-4' }).soundId, DEFAULT_ALERT_SOUNDS.buffFade)
  const keep = { packId: DEFAULT_ALERT_PACK_ID, soundId: DEFAULT_ALERT_SOUNDS.questComplete }
  assert.deepEqual(migrateAlertSoundRef(keep), keep)
  const alan = { packId: ALAN_RICKMAN_PACK_ID, soundId: 'task-complete-task-complete-07' }
  assert.deepEqual(migrateAlertSoundRef(alan), alan, 'an installed Alan Rickman ref is not rewritten')
})
