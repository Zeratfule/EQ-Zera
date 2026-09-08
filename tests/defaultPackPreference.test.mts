// ============================================================================
// defaultPackPreference.test.mts — "set one and it sticks" (JOS-273).
// ============================================================================
//
// THE REPORT: "I like Alan Rickman as much as the next person, but it re-enables itself with every
// update and I have to delete it each time to use the pack I want — can I just set one and it
// sticks." Nothing reset anything. The shipped pack was HARDCODED as the pack every picker
// pre-selects and every authored alert points at, and startup provisioning re-installed it
// whenever it was missing with no memory of a deletion — so a deletion held exactly until the
// next launch, which for most people is the next update.
//
// THE OWNER'S RULING, verbatim: "if someone deletes alan rickman, they should be able to set a
// default and it should persist." Three separable claims, and this file is one section per claim:
//
//   1. THE PREFERENCE — stored, validated, and ABSENT for a fresh install (which is what makes
//      "fresh installs unchanged" a property rather than a promise).
//   2. THE TOMBSTONE — provisioning skips a shipped pack the user deleted, and installing it
//      again from the registry browser clears the stone.
//   3. THE RESOLUTION — a ref into a pack that is gone plays the closest line in the default pack
//      instead of going silently mute, keeping the sound's CESP category, and reports HOW it
//      answered so a surface can say so.
//
// Plus the two surfaces the ruling names by hand: the picker pre-selection and the SEEDS.
//
// No DOM, no Electron, no network: it never skips. The behaviours that need a running app — the
// star in the pack browser, and the preference surviving a real relaunch through electron-store —
// are `tests/e2e/default-sound-pack.e2e.mts`, which does it across two launches.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isTombstoned,
  normalizeSoundPackPrefs,
  preferredPack,
  resolveSoundRef,
  seedSoundRef,
  soundCategorySlug,
  withDefaultPack,
  withTombstone,
  type SoundFallback,
  type SoundPackPrefs
} from '../src/shared/soundPacks'
import { packsToProvision } from '../src/main/provisionPacks'
import {
  DEFAULT_ALERT_PACK_ID,
  DEFAULT_ALERT_SOUNDS,
  DEFAULT_PACK_IDS
} from '../src/main/data/defaultPacks'
import type { SoundPack } from '../src/shared/types'

/** A pack whose sounds are just the ids given (labels are irrelevant to every rule here). */
function pack(id: string, soundIds: string[], name = id): SoundPack {
  const sounds: SoundPack['sounds'] = {}
  for (const s of soundIds) sounds[s] = { file: `sounds/${s}.mp3`, label: s }
  return { id, name, sounds, source: 'user' }
}

/** The shipped pack, carrying the lines the seeds and the groups actually name. */
const RICKMAN = pack(
  DEFAULT_ALERT_PACK_ID,
  [
    DEFAULT_ALERT_SOUNDS.charmBreak,
    DEFAULT_ALERT_SOUNDS.bossDefeat,
    DEFAULT_ALERT_SOUNDS.questComplete,
    DEFAULT_ALERT_SOUNDS.buffWearsOff
  ],
  'Alan Rickman'
)

/** A third-party pack with its own derived ids in the same CESP categories. */
const TURRET = pack(
  'portal-turret',
  ['task-complete-turret-hello', 'input-required-turret-huh', 'task-error-turret-ow'],
  'Portal Turret'
)

/** What every resolution in this app is given: where to land, and the line of last resort. */
const FALLBACK: SoundFallback = {
  defaultPackId: DEFAULT_ALERT_PACK_ID,
  fallbackSoundId: DEFAULT_ALERT_SOUNDS.buffWearsOff
}

// ─── 1. the preference ────────────────────────────────────────────────────────

test('a fresh install has NO preference, and that is the whole of "unchanged"', () => {
  // Every store written before this feature is in exactly this state, and so is every new one.
  assert.deepEqual(normalizeSoundPackPrefs(undefined), {})
  assert.deepEqual(normalizeSoundPackPrefs(null), {})
  assert.deepEqual(normalizeSoundPackPrefs({}), {})
  // …and an absent preference means the shipped pack everywhere it is read.
  assert.equal(preferredPack([RICKMAN, TURRET], undefined, DEFAULT_ALERT_PACK_ID)?.id, RICKMAN.id)
})

test('the stored blob is validated on the way out, never trusted', () => {
  // A hand-edited file (or a future build) can put anything here. A pack id becomes a DIRECTORY
  // name the moment something resolves through it, so the shapes that could be a path degrade to
  // absent — which is the shipped default, i.e. the safe answer rather than a broken one.
  for (const junk of ['../evil', 'a/b', 'C:\\packs', '', '.hidden', 42, null, {}]) {
    assert.deepEqual(
      normalizeSoundPackPrefs({ defaultPackId: junk }),
      {},
      `'${String(junk)}' must not survive as a pack id`
    )
  }
  // A removed-list of junk is dropped entry by entry, not wholesale.
  assert.deepEqual(normalizeSoundPackPrefs({ removedPackIds: ['../x', 'peon'] }), {
    removedPackIds: ['peon']
  })
  assert.deepEqual(normalizeSoundPackPrefs({ removedPackIds: 'peon' }), {})
})

test('setting a default is a statement; clearing it is the other statement', () => {
  const set = withDefaultPack({}, TURRET.id)
  assert.equal(set.defaultPackId, TURRET.id)
  // Clearing writes NOTHING rather than pinning today's shipped id: "use whatever the app ships"
  // is what an absent key has always meant, and pinning it would freeze a future default out.
  assert.deepEqual(withDefaultPack(set, null), {})
  // A junk id clears rather than sticks (same argument as the normalizer above).
  assert.deepEqual(withDefaultPack(set, '../evil'), {})
})

test('the preference survives the round trip a restart actually performs', () => {
  // electron-store persists as JSON and re-parses it on the next launch. That is the whole of
  // "it should persist" that a unit test can observe honestly; the real relaunch is the e2e.
  const stored = withTombstone(withDefaultPack({}, TURRET.id), DEFAULT_ALERT_PACK_ID, true)
  const reloaded = normalizeSoundPackPrefs(JSON.parse(JSON.stringify(stored)) as unknown)
  assert.deepEqual(reloaded, stored)
  assert.equal(reloaded.defaultPackId, TURRET.id)
  assert.equal(isTombstoned(reloaded, DEFAULT_ALERT_PACK_ID), true)
})

// ─── 2. the tombstone ─────────────────────────────────────────────────────────

test('provisioning skips a shipped pack the user deleted — and only that pack', () => {
  const none = new Set<string>()
  // The behaviour before this ticket, unchanged: missing ⇒ fetch it.
  assert.deepEqual(
    packsToProvision(none).map((p) => p.name),
    DEFAULT_PACK_IDS,
    'a fresh install still provisions everything it ships'
  )
  // Installed ⇒ nothing to do (the ADDITIVE law, untouched).
  assert.equal(packsToProvision(new Set(DEFAULT_PACK_IDS)).length, 0)
  // DELETED ⇒ nothing to do either, which is the new half: presence is no longer the only thing
  // that decides, because the deletion is a statement.
  assert.equal(packsToProvision(none, new Set([DEFAULT_ALERT_PACK_ID])).length, 0)
  // A tombstone for something the app does not ship changes nothing at all.
  assert.deepEqual(
    packsToProvision(none, new Set(['portal-turret'])).map((p) => p.name),
    DEFAULT_PACK_IDS
  )
})

test('installing the pack again is how the deletion is taken back', () => {
  const deleted = withTombstone({}, DEFAULT_ALERT_PACK_ID, true)
  assert.equal(isTombstoned(deleted, DEFAULT_ALERT_PACK_ID), true)
  assert.equal(packsToProvision(new Set(), new Set(deleted.removedPackIds)).length, 0)

  const reinstalled = withTombstone(deleted, DEFAULT_ALERT_PACK_ID, false)
  assert.equal(isTombstoned(reinstalled, DEFAULT_ALERT_PACK_ID), false)
  assert.deepEqual(reinstalled, {}, 'the last stone gone leaves nothing behind in the store')
  // …and a later launch that finds it missing provisions it again, exactly as it always did.
  assert.deepEqual(
    packsToProvision(new Set(), new Set(reinstalled.removedPackIds)).map((p) => p.name),
    DEFAULT_PACK_IDS
  )
})

test('tombstones are a set, not a log', () => {
  let prefs: SoundPackPrefs = {}
  for (let i = 0; i < 3; i++) prefs = withTombstone(prefs, DEFAULT_ALERT_PACK_ID, true)
  assert.deepEqual(prefs.removedPackIds, [DEFAULT_ALERT_PACK_ID], 'deleting twice says one thing')
  // Removing a stone that was never set is a no-op rather than an error.
  assert.deepEqual(withTombstone({}, 'never-seen', false), {})
})

// ─── 3. the resolution (no silent mutes) ──────────────────────────────────────

test('a derived soundId still says which category it came from', () => {
  assert.equal(soundCategorySlug('task-complete-task-complete-07'), 'task-complete')
  assert.equal(soundCategorySlug('input-required-input-required-01'), 'input-required')
  assert.equal(soundCategorySlug('session-start-session-start-01'), 'session-start')
  // A user's own imported audio carries no category, and that is a real answer (see the fallback
  // test below), not a failure.
  assert.equal(soundCategorySlug('fanfare'), null)
  assert.equal(soundCategorySlug('task-completely-unrelated'), null)
})

test('a working ref is never touched', () => {
  const ref = { packId: RICKMAN.id, soundId: DEFAULT_ALERT_SOUNDS.bossDefeat }
  assert.deepEqual(resolveSoundRef(ref, [RICKMAN, TURRET], FALLBACK), { ...ref, status: 'exact' })
})

test('a ref into a DELETED pack plays the default pack, keeping what the sound MEANT', () => {
  // The reporter's own end state: Alan Rickman deleted, their pack made the default, and every
  // alert authored against the shipped pack still fires — with a completion line for a completion.
  const prefs = withDefaultPack({}, TURRET.id)
  const fallback: SoundFallback = { ...FALLBACK, defaultPackId: prefs.defaultPackId ?? '' }
  const r = resolveSoundRef(
    { packId: RICKMAN.id, soundId: DEFAULT_ALERT_SOUNDS.bossDefeat }, // a task-complete line
    [TURRET],
    fallback
  )
  assert.equal(r.status, 'substituted')
  assert.equal(r.packId, TURRET.id)
  assert.equal(r.soundId, 'task-complete-turret-hello', 'a completion sting stays a completion')
  assert.equal(r.askedPackId, RICKMAN.id, 'and it reports what was asked for, so a row can say so')
})

test('the same pack, a missing sound: stay in the pack the user chose', () => {
  // A re-cut pack, or a custom sound the user removed. Jumping to another pack would be a bigger
  // change than the one that actually happened.
  const r = resolveSoundRef({ packId: TURRET.id, soundId: 'task-error-gone' }, [TURRET, RICKMAN], FALLBACK)
  assert.equal(r.status, 'substituted')
  assert.equal(r.packId, TURRET.id)
  assert.equal(r.soundId, 'task-error-turret-ow')
})

test('no category to keep ⇒ the stated fallback line, never silence', () => {
  // The user's own imported audio has file-slug ids, so there is no intent to preserve. This is
  // the case sounds.ts has always answered with "A moment of your time, if you'd be so kind."
  const r = resolveSoundRef({ packId: 'my-sounds', soundId: 'fanfare' }, [RICKMAN], FALLBACK)
  assert.equal(r.status, 'substituted')
  assert.deepEqual(
    { packId: r.packId, soundId: r.soundId },
    { packId: RICKMAN.id, soundId: DEFAULT_ALERT_SOUNDS.buffWearsOff }
  )
})

test('nothing installed at all is REPORTED, not papered over', () => {
  // The one state the app cannot make audible — and the alert row says so rather than looking
  // like a working alert that happens never to fire.
  const r = resolveSoundRef({ packId: RICKMAN.id, soundId: 'anything' }, [], FALLBACK)
  assert.equal(r.status, 'missing')
  assert.deepEqual({ packId: r.packId, soundId: r.soundId }, { packId: RICKMAN.id, soundId: 'anything' })
})

// ─── the two surfaces the ruling names ────────────────────────────────────────

test('the picker pre-selects the preference, then the shipped pack, then anything', () => {
  const packs = [RICKMAN, TURRET]
  assert.equal(preferredPack(packs, TURRET.id, RICKMAN.id)?.id, TURRET.id, 'the preference wins')
  // A preference naming a pack that is GONE does not strand the picker on nothing…
  assert.equal(preferredPack(packs, 'uninstalled', RICKMAN.id)?.id, RICKMAN.id)
  // …and with the shipped pack deleted too, the picker still offers something real.
  assert.equal(preferredPack([TURRET], 'uninstalled', RICKMAN.id)?.id, TURRET.id)
  // No packs at all is null, which every caller has an answer for.
  assert.equal(preferredPack([], TURRET.id, RICKMAN.id), null)
})

test('seeded alerts are written with the default pack — and a fresh install is byte-identical', () => {
  const shipped = { packId: RICKMAN.id, soundId: DEFAULT_ALERT_SOUNDS.charmBreak }

  // FRESH INSTALL, nothing provisioned yet: the identity function. This is the assertion that
  // makes "fresh installs unchanged" true rather than intended.
  assert.deepEqual(seedSoundRef(shipped, [], FALLBACK), shipped)
  // Shipped pack installed, no preference: still the identity function.
  assert.deepEqual(seedSoundRef(shipped, [RICKMAN], FALLBACK), shipped)

  // A user who set their own default and pressed "Reset to defaults" gets THEIR pack back — with
  // the charm-break line landing on the turret's input-required line, not on whatever sorts first.
  const mine: SoundFallback = { ...FALLBACK, defaultPackId: TURRET.id }
  assert.deepEqual(seedSoundRef(shipped, [TURRET], mine), {
    packId: TURRET.id,
    soundId: 'input-required-turret-huh'
  })
  // …and it does that even while the shipped pack is still installed, which is the bug: a seed
  // that resolved in the shipped pack used to be left there.
  assert.deepEqual(seedSoundRef(shipped, [RICKMAN, TURRET], mine).packId, TURRET.id)
})
