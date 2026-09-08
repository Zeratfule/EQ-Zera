// USER SOUNDS TEST — "bring your own sound" (JOS-68). Three claims, each the one that would
// silently break a user's alert if it drifted:
//
//   1. the soundId minted from a filename is filesystem-safe and collision-safe — it BECOMES
//      the on-disk filename, so a hostile or merely odd filename must never reach `join()`;
//   2. pack enumeration surfaces the reserved `my-sounds` pack (and only once it has
//      something in it), with its identity taken from the constants rather than the file;
//   3. a missing custom sound FALLS BACK to the shipped default's line instead of going
//      mute — the whole point of copying the file in the first place.
//
// It runs the REAL copy/remove/enumeration against temp directories: every file operation in
// userSounds.ts / sounds.ts takes its root as an argument (the maps-library pattern), so no
// Electron is loaded and nothing here touches the user's own userData.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_MB,
  USER_SOUNDS_PACK_ID,
  USER_SOUNDS_PACK_NAME,
  USER_SOUND_EXTENSIONS,
  userSoundId,
  userSoundLabel
} from '../src/shared/userSounds'
import { isSafePackId } from '../src/main/security'
import {
  importUserSoundFiles,
  listUserSounds,
  readUserManifest,
  removeUserSoundFrom
} from '../src/main/userSounds'
import { getSoundDataIn, listPacksIn, type SoundRoots } from '../src/main/sounds'
import { DEFAULT_ALERT_PACK_ID, DEFAULT_ALERT_SOUNDS } from '../src/main/data/defaultPacks'

/** A throwaway tree, removed when the process exits. */
function tempTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-usersounds-'))
  process.on('exit', () => {
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

/** Write a fake audio file of `bytes` bytes and return its path. */
function fakeAudio(dir: string, name: string, bytes = 32): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, Buffer.alloc(bytes, 7))
  return path
}

/** A minimal pack directory (manifest + one audio file) under `root/<id>`. */
function fakePack(root: string, id: string, soundId: string): void {
  const dir = join(root, id)
  mkdirSync(join(dir, 'sounds'), { recursive: true })
  writeFileSync(join(dir, 'sounds', `${soundId}.wav`), Buffer.alloc(16, 3))
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id,
      name: id,
      sounds: { [soundId]: { file: `sounds/${soundId}.wav`, label: soundId } }
    })
  )
}

// ─── 1. the minted id ──────────────────────────────────────────────────────────

/** What the id may look like: it is a filename component, so nothing else is admissible. */
const MINTED_RE = /^[a-z0-9][a-z0-9-]*$/

test('a minted soundId is filesystem-safe whatever the filename was', () => {
  const hostile = [
    '../../../Windows/System32/evil.wav',
    '..\\..\\secrets.mp3',
    'C:\\Users\\me\\Fanfare.mp3',
    '.hidden.ogg',
    'stream:$DATA.wav',
    'One Winged Angel (FF7!).mp3',
    '   spaces   everywhere .wav',
    'ünïcødé.wav',
    '!!!.wav',
    `${'x'.repeat(400)}.wav`
  ]
  for (const name of hostile) {
    const id = userSoundId(name, new Set())
    assert.match(id, MINTED_RE, `${name} → ${id}`)
    assert.equal(id.length <= 64, true, `${name} → ${id} is capped`)
    // The id also has to survive the very allowlist the pack id goes through, because it is
    // the same kind of thing: a name that reaches join().
    assert.equal(isSafePackId(id), true, `${name} → ${id} is join()-safe`)
    assert.equal(id.includes('..'), false)
  }
  // A name with nothing usable in it still yields an id rather than an empty filename.
  assert.equal(userSoundId('!!!.wav', new Set()), 'sound')
  assert.equal(userSoundId('One Winged Angel (FF7!).mp3', new Set()), 'one-winged-angel-ff7')
})

test('minted ids never collide, however many times the same file is imported', () => {
  const taken = new Set<string>()
  const ids: string[] = []
  for (let i = 0; i < 5; i++) {
    const id = userSoundId('fanfare.mp3', taken)
    taken.add(id)
    ids.push(id)
  }
  assert.deepEqual(ids, ['fanfare', 'fanfare-2', 'fanfare-3', 'fanfare-4', 'fanfare-5'])
  assert.equal(new Set(ids).size, ids.length)
  // Two DIFFERENT files that slug to the same thing collide too, and are separated the same
  // way — the id is derived from the name, so this is the common case, not the odd one.
  assert.equal(userSoundId('Fan Fare.wav', new Set(['fan-fare'])), 'fan-fare-2')
})

test('the display label is the filename the user chose, minus the extension', () => {
  assert.equal(userSoundLabel('C:\\Downloads\\One Winged Angel.mp3'), 'One Winged Angel')
  assert.equal(userSoundLabel('/home/me/ding.wav'), 'ding')
  assert.equal(userSoundLabel('.wav'), '.wav') // no stem: show the name rather than nothing
})

// ─── 2. import / remove against a real tree ────────────────────────────────────

test('an import COPIES the file under the minted id and never keeps the original path', () => {
  const tree = tempTree()
  const src = join(tree, 'downloads')
  const root = join(tree, 'my-sounds')
  const chosen = fakeAudio(src, 'One Winged Angel.mp3')

  const res = importUserSoundFiles(root, [chosen])
  assert.equal(res.canceled, false)
  assert.deepEqual(res.rejected, [])
  assert.equal(res.added.length, 1)
  assert.equal(res.added[0].soundId, 'one-winged-angel')
  assert.equal(res.added[0].label, 'One Winged Angel')

  // The bytes live in the pack now, under the MINTED name (not the user's).
  const copied = join(root, 'sounds', 'one-winged-angel.mp3')
  assert.equal(existsSync(copied), true, 'the file was copied into the pack')
  assert.deepEqual(readFileSync(copied), readFileSync(chosen))

  // Deleting the original leaves the pack whole — the reason the copy exists at all.
  rmSync(chosen)
  assert.deepEqual(listUserSounds(root), [{ soundId: 'one-winged-angel', label: 'One Winged Angel' }])

  // Nothing anywhere in the manifest names the folder the user browsed.
  const manifestText = readFileSync(join(root, 'manifest.json'), 'utf8')
  assert.equal(manifestText.includes('downloads'), false, 'no source path in the manifest')
})

test('a second import of the same name lands beside the first, never over it', () => {
  const tree = tempTree()
  const root = join(tree, 'my-sounds')
  importUserSoundFiles(root, [fakeAudio(join(tree, 'a'), 'ding.wav', 8)])
  const res = importUserSoundFiles(root, [fakeAudio(join(tree, 'b'), 'ding.wav', 16)])

  assert.equal(res.added[0].soundId, 'ding-2')
  assert.equal(listUserSounds(root).length, 2)
  assert.equal(readFileSync(join(root, 'sounds', 'ding.wav')).length, 8, 'the first is untouched')
  assert.equal(readFileSync(join(root, 'sounds', 'ding-2.wav')).length, 16)
})

test('absurd files and undecodable formats are refused politely, by basename', () => {
  const tree = tempTree()
  const root = join(tree, 'my-sounds')
  const src = join(tree, 'downloads')
  const huge = fakeAudio(src, 'movie.wav', MAX_IMPORT_BYTES + 1)
  const wrong = fakeAudio(src, 'notes.txt')
  const ok = fakeAudio(src, 'ding.ogg')

  const res = importUserSoundFiles(root, [huge, wrong, ok])
  assert.equal(res.added.length, 1, 'the good one still lands')
  assert.equal(res.rejected.length, 2)

  const size = res.rejected.find((r) => r.file === 'movie.wav')
  assert.ok(size, 'the oversize file is named')
  assert.match(size.reason, new RegExp(`${MAX_IMPORT_MB} MB`), 'the message states the cap')
  const format = res.rejected.find((r) => r.file === 'notes.txt')
  assert.ok(format)
  for (const ext of USER_SOUND_EXTENSIONS) assert.match(format.reason, new RegExp(ext))
  // A rejection carries the BASENAME only — no folder ever crosses the channel.
  for (const r of res.rejected) assert.equal(r.file.includes('downloads'), false)
  assert.equal(existsSync(join(root, 'sounds', 'movie.wav')), false, 'nothing oversize was copied')
})

test('removing a sound takes its file and its entry, and an unknown id takes nothing', () => {
  const tree = tempTree()
  const root = join(tree, 'my-sounds')
  importUserSoundFiles(root, [fakeAudio(join(tree, 'a'), 'ding.wav'), fakeAudio(join(tree, 'b'), 'horn.mp3')])

  const missing = removeUserSoundFrom(root, 'never-imported')
  assert.equal(missing.removed, false)
  assert.equal(missing.sounds.length, 2)

  const gone = removeUserSoundFrom(root, 'ding')
  assert.equal(gone.removed, true)
  assert.deepEqual(gone.sounds.map((s) => s.soundId), ['horn'])
  assert.equal(existsSync(join(root, 'sounds', 'ding.wav')), false)
  assert.equal(existsSync(join(root, 'sounds', 'horn.mp3')), true, 'the other one survives')
})

test('a hand-edited manifest cannot re-title the reserved pack', () => {
  const tree = tempTree()
  const root = join(tree, 'my-sounds')
  importUserSoundFiles(root, [fakeAudio(join(tree, 'a'), 'ding.wav')])
  writeFileSync(
    join(root, 'manifest.json'),
    JSON.stringify({ id: 'alan-rickman', name: 'Alan Rickman', sounds: readUserManifest(root).sounds })
  )
  const manifest = readUserManifest(root)
  assert.equal(manifest.id, USER_SOUNDS_PACK_ID)
  assert.equal(manifest.name, USER_SOUNDS_PACK_NAME)

  // …and a corrupt one is an empty pack, never a thrown alerts view.
  writeFileSync(join(root, 'manifest.json'), '{ not json')
  assert.deepEqual(readUserManifest(root).sounds, {})
})

// ─── 3. enumeration + the missing-sound fallback ───────────────────────────────

/** Roots over a temp tree: one bundled root, the soundpacks root, and the reserved one. */
function rootsIn(tree: string): SoundRoots {
  return {
    bundled: [join(tree, 'resources')],
    user: join(tree, 'soundpacks'),
    mine: join(tree, USER_SOUNDS_PACK_ID)
  }
}

test('the reserved pack is listed once it has a sound — and not before', () => {
  const tree = tempTree()
  const roots = rootsIn(tree)
  fakePack(roots.bundled[0], DEFAULT_ALERT_PACK_ID, DEFAULT_ALERT_SOUNDS.buffWearsOff)
  fakePack(roots.user, 'portal-turret', 'task-complete-1')

  // Empty (nothing imported yet): a first dropdown entry whose second dropdown is blank is
  // worse than no entry at all, so it is absent.
  assert.deepEqual(
    listPacksIn(roots).map((p) => p.id),
    [DEFAULT_ALERT_PACK_ID, 'portal-turret']
  )

  importUserSoundFiles(roots.mine, [fakeAudio(join(tree, 'dl'), 'Fanfare.mp3')])
  const packs = listPacksIn(roots)
  assert.deepEqual(packs.map((p) => p.id), [DEFAULT_ALERT_PACK_ID, 'portal-turret', USER_SOUNDS_PACK_ID])

  // It arrives with the identity the constants state, marked as the user's, carrying the
  // imported sound under its display label — which is all any picker needs.
  const mine = packs[packs.length - 1]
  assert.equal(mine.name, USER_SOUNDS_PACK_NAME)
  assert.equal(mine.source, 'user')
  assert.deepEqual(Object.keys(mine.sounds), ['fanfare'])
  assert.equal(mine.sounds.fanfare.label, 'Fanfare')
})

test('a soundpacks dir claiming the reserved id never displaces the real one', () => {
  const tree = tempTree()
  const roots = rootsIn(tree)
  // Registry installs are refused this name (packRegistry.ts), but the directory could still
  // be planted by hand — the resolution order is what makes the outcome unambiguous.
  fakePack(roots.user, USER_SOUNDS_PACK_ID, 'impostor')
  importUserSoundFiles(roots.mine, [fakeAudio(join(tree, 'dl'), 'Fanfare.mp3')])

  const listed = listPacksIn(roots).filter((p) => p.id === USER_SOUNDS_PACK_ID)
  assert.equal(listed.length, 1, 'one entry, not two')
  assert.deepEqual(Object.keys(listed[0].sounds), ['fanfare'], 'the imported sound, not the impostor')
  // Serving agrees with the listing: the imported sound answers as itself…
  const own = getSoundDataIn(roots, USER_SOUNDS_PACK_ID, 'fanfare')
  assert.equal(own?.mime, 'audio/mpeg')
  // …and the impostor's own soundId NEVER serves the impostor's bytes. Since JOS-273 an
  // unresolvable ref is not silence — it resolves to the closest thing installed — so what this
  // pins is WHOSE bytes come back: the user's imported audio, from the reserved root, and not the
  // planted directory that claimed the id.
  assert.deepEqual(getSoundDataIn(roots, USER_SOUNDS_PACK_ID, 'impostor'), own)
})

test('a removed custom sound falls back to the shipped default line instead of going mute', () => {
  const tree = tempTree()
  const roots = rootsIn(tree)
  fakePack(roots.bundled[0], DEFAULT_ALERT_PACK_ID, DEFAULT_ALERT_SOUNDS.buffWearsOff)
  importUserSoundFiles(roots.mine, [fakeAudio(join(tree, 'dl'), 'Fanfare.mp3')])

  const own = getSoundDataIn(roots, USER_SOUNDS_PACK_ID, 'fanfare')
  assert.equal(own?.mime, 'audio/mpeg', 'the imported sound plays as itself')

  // The alert def is deliberately NOT rewritten when the sound goes, so the ref outlives it.
  removeUserSoundFrom(roots.mine, 'fanfare')
  const fallback = getSoundDataIn(roots, USER_SOUNDS_PACK_ID, 'fanfare')
  const shipped = getSoundDataIn(roots, DEFAULT_ALERT_PACK_ID, DEFAULT_ALERT_SOUNDS.buffWearsOff)
  assert.ok(fallback, 'a removed custom sound still answers with audio')
  assert.deepEqual(fallback, shipped, 'and it is the shipped default line')

  // THE FALLBACK IS NO LONGER THE RESERVED PACK'S ALONE (JOS-273). It used to be — "an
  // uninstalled registry pack is a pack the user removed on purpose" — and that stopped being
  // true the moment the owner ruled that a user may delete the shipped pack and name their own
  // default: from then on a ref into a pack that is gone is the ordinary state of every seeded
  // and suggested alert, and answering null makes each of them a silently mute alert. So the
  // uninstalled pack resolves through the default too.
  assert.deepEqual(
    getSoundDataIn(roots, 'portal-turret', 'anything'),
    shipped,
    'an uninstalled pack resolves through the default rather than going mute'
  )

  // What is STILL null is the honestly unanswerable case: nothing installed at all.
  const bare = rootsIn(tempTree())
  assert.equal(getSoundDataIn(bare, 'portal-turret', 'anything'), null)
})
