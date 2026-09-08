// sounds.ts — sound-pack discovery + audio bytes over IPC (Task #18).
//
// A pack = a directory containing `manifest.json`:
//   { id, name, sounds: { [soundId]: { file, label } }, license? }
// (an optional `license` string is copied verbatim from an imported pack's source
//  manifest — e.g. the CC-BY-NC-4.0 of the peon/marine PeonPing packs.)
// Two sources:
//   (1) bundled  — `resources/soundpacks/*` for a SOURCE build (`npm run fetch:packs`
//       writes the shipped alan-rickman pack there; the audio is gitignored, so a
//       CI-built installer ships none and provisionPacks.ts fetches it at runtime
//       instead). asarUnpack in electron-builder.yml keeps these on disk in production.
//   (2) user     — `<userData>/soundpacks/<id>/`, so a user can drop their own
//       audio (e.g. their real FF fanfare mp3) + a manifest and select it.
//   (3) MINE     — `<userData>/my-sounds/`, the RESERVED pack the in-app importer writes
//       (JOS-68). Same shape as any other pack, so everything below reads it unchanged; a
//       root of its own so no registry pack can ever collide with it (shared/userSounds.ts).
//
// getSoundData reads the referenced file and returns { mime, dataBase64 } so the
// CSP-restricted renderer can build a Blob URL (no file:// or remote fetch).

import { app } from 'electron'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { logError } from './errorLog'
import { DEFAULT_ALERT_PACK_ID, DEFAULT_ALERT_SOUNDS } from './data/defaultPacks'
import { USER_SOUNDS_PACK_ID, USER_SOUNDS_PACK_NAME } from '../shared/userSounds'
import { resolveSoundRef } from '../shared/soundPacks'
import type { PackSound, SoundData, SoundPack, SoundPackManifest } from '../shared/types'

const AUDIO_MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg'
}

/** Bundled soundpacks root. In dev `app.getAppPath()` is the project root (where
 *  `resources/` lives); in a packaged app the folder is unpacked next to the asar
 *  under `process.resourcesPath`. Try both. */
function bundledRoots(): string[] {
  const roots = [
    join(app.getAppPath(), 'resources', 'soundpacks'),
    join(process.resourcesPath ?? '', 'soundpacks'),
    // packaged: resources are asarUnpack'd under app.asar.unpacked/resources
    join(app.getAppPath() + '.unpacked', 'resources', 'soundpacks')
  ]
  return roots.filter((r) => r && existsSync(r))
}

/** User soundpacks root: `<userData>/soundpacks`. Created lazily on demand. */
function userRoot(): string {
  return join(app.getPath('userData'), 'soundpacks')
}

/** Public accessor for the user soundpacks root (used by packRegistry install/uninstall). */
export function userPacksRoot(): string {
  return userRoot()
}

/**
 * `<userData>/my-sounds` — the reserved "bring your own sound" pack (JOS-68). It is a
 * SIBLING of the soundpacks root, not a child: registry installs and uninstalls only ever
 * join onto `userRoot()`, so nothing the registry does can reach the user's own audio.
 */
export function userSoundsRoot(): string {
  return join(app.getPath('userData'), USER_SOUNDS_PACK_ID)
}

/**
 * The three places a pack can live, resolved once and passed down.
 *
 * Every reader below takes this record rather than calling `app` itself (the maps-library
 * pattern) — which is what lets tests/userSounds.test.mts drive the real enumeration and the
 * real missing-sound fallback against temp directories, with no Electron in the process.
 */
export interface SoundRoots {
  bundled: string[]
  /** `<userData>/soundpacks` — bundled-shadowing packs and every registry install. */
  user: string
  /** `<userData>/my-sounds` — the reserved pack the in-app importer writes. */
  mine: string
}

/** The real roots on this machine. */
function realRoots(): SoundRoots {
  return { bundled: bundledRoots(), user: userRoot(), mine: userSoundsRoot() }
}

// ----- CESP → our-manifest conversion (shared with scripts/fetch-packs.mts) -----
//
// openpeon.com packs ship a CESP `openpeon.json` that groups sounds by category
// (session.start, task.complete, …). Our manifest flattens them to soundId keys
// with a human label prefixed by the category ("Complete · Work complete."). Both
// the CLI (scripts/fetch-packs.mts, for the bundled default packs) and the in-app
// registry installer (packRegistry.ts) run the SAME conversion so labels read
// identically regardless of source.

/** Category → the label prefix our manifest uses so the picker reads well. */
export const CESP_CATEGORY_LABEL: Record<string, string> = {
  'session.start': 'Start',
  'session.end': 'End',
  'task.acknowledge': 'Acknowledge',
  'task.complete': 'Complete',
  'task.error': 'Error',
  'task.progress': 'Progress',
  'input.required': 'Input',
  'resource.limit': 'Limit',
  'user.spam': 'Spam'
}

/** A single sound entry inside a CESP category. */
export interface CespSound {
  file: string
  label?: string
  sha256?: string
}

/** The relevant subset of a CESP `openpeon.json`. */
export interface CespManifest {
  cesp_version?: string
  name?: string
  display_name?: string
  version?: string
  license?: string
  categories: Record<string, { sounds?: CespSound[] } | CespSound[] | string[]>
  category_aliases?: Record<string, string>
}

/** Basename of a possibly `sounds/`-prefixed path. */
export function packBasename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1]
}

/**
 * Derive a stable, filesystem-safe soundId from a source filename. Used for
 * registry installs (which — unlike the bundled peon/marine packs — have no
 * hand-curated ID_MAP). Prefix with the category so ids stay unique even when two
 * categories share a basename; de-dup with a numeric suffix as a last resort.
 */
export function deriveSoundId(category: string, file: string, taken: Set<string>): string {
  const base = packBasename(file).replace(/\.[^.]+$/, '')
  const catSlug = category.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  const baseSlug = base.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'sound'
  let id = catSlug ? `${catSlug}-${baseSlug}` : baseSlug
  if (taken.has(id)) {
    let i = 2
    while (taken.has(`${id}-${i}`)) i++
    id = `${id}-${i}`
  }
  taken.add(id)
  return id
}

/**
 * Normalize a CESP category value to a `{file,label?}[]` list. Handles the common
 * `{ sounds: [...] }` shape plus defensive fallbacks: a bare array of entries, or
 * an array of filename strings.
 */
function cespCategorySounds(value: CespManifest['categories'][string]): CespSound[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? { file: v } : v))
  }
  if (value && Array.isArray(value.sounds)) return value.sounds
  return []
}

/**
 * Convert a parsed CESP manifest into OUR manifest sounds map. `idFor(category,
 * file)` yields the soundId — the CLI passes a fixed ID_MAP lookup (to byte-match
 * committed packs); the registry installer passes `deriveSoundId`. Labels become
 * "<CategoryPrefix> · <label>" (label falls back to the basename).
 */
export function cespToManifestSounds(
  cesp: CespManifest,
  idFor: (category: string, file: string) => string | null
): Record<string, PackSound> {
  const sounds: Record<string, PackSound> = {}
  for (const [category, value] of Object.entries(cesp.categories ?? {})) {
    const prefix = CESP_CATEGORY_LABEL[category] ?? category
    for (const s of cespCategorySounds(value)) {
      if (!s || typeof s.file !== 'string') continue
      const soundId = idFor(category, s.file)
      if (!soundId) continue
      const name = packBasename(s.file)
      const label = s.label?.trim() ? s.label : name
      sounds[soundId] = { file: `sounds/${name}`, label: `${prefix} · ${label}` }
    }
  }
  return sounds
}

/** Read + validate a pack manifest from a directory; null if missing/invalid. */
function readManifest(dir: string): SoundPackManifest | null {
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) return null
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as SoundPackManifest
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.sounds !== 'object') return null
    return parsed
  } catch (err) {
    logError('main:sounds', { message: `bad manifest at ${manifestPath}`, err })
    return null
  }
}

/** Enumerate pack directories under a root that contain a valid manifest. */
function packsInRoot(root: string, source: SoundPack['source']): SoundPack[] {
  if (!existsSync(root)) return []
  const out: SoundPack[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const name of entries) {
    const dir = join(root, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const manifest = readManifest(dir)
    if (manifest) out.push({ ...manifest, source })
  }
  return out
}

/**
 * Locate the on-disk directory for a pack id across bundled + user roots. User
 * packs shadow bundled ones with the same id (so a user can override a shipped pack
 * with their own audio under the same id).
 */
function packDir(
  roots: SoundRoots,
  packId: string
): { dir: string; source: SoundPack['source'] } | null {
  // The reserved id resolves to its own root FIRST — ahead of both the soundpacks root and
  // the bundled ones — so a directory that somehow acquired that name over there can never
  // serve bytes in place of the user's imported audio.
  if (packId === USER_SOUNDS_PACK_ID) {
    return existsSync(join(roots.mine, 'manifest.json')) ? { dir: roots.mine, source: 'user' } : null
  }
  const uDir = join(roots.user, packId)
  if (existsSync(join(uDir, 'manifest.json'))) return { dir: uDir, source: 'user' }
  for (const root of roots.bundled) {
    const bDir = join(root, packId)
    if (existsSync(join(bDir, 'manifest.json'))) return { dir: bDir, source: 'bundled' }
  }
  return null
}

/**
 * The reserved "My sounds" pack, or null when the user has imported nothing yet.
 *
 * An EMPTY pack is not listed: a pack with no sounds is a dead entry in every picker's first
 * dropdown whose second dropdown is blank. It appears the moment there is something in it,
 * which is also when it becomes referenceable. Its id and display name come from the shared
 * constants and never from the file, so a hand-edited manifest cannot re-title it into
 * something that reads like a registry pack.
 */
function userSoundsPack(roots: SoundRoots): SoundPack | null {
  const manifest = readManifest(roots.mine)
  if (!manifest || Object.keys(manifest.sounds ?? {}).length === 0) return null
  return {
    id: USER_SOUNDS_PACK_ID,
    name: USER_SOUNDS_PACK_NAME,
    sounds: manifest.sounds,
    source: 'user'
  }
}

/**
 * List all packs (bundled first, then user), de-duped by id (user wins). "My sounds" is
 * appended LAST and overrides anything else claiming its id, so every picker in the app —
 * the alert editor, the alert row, anything that takes `SoundPack[]` — offers the user's own
 * audio through the seam it already had, with no per-picker special case.
 */
export function listPacksIn(roots: SoundRoots): SoundPack[] {
  const byId = new Map<string, SoundPack>()
  for (const root of roots.bundled) {
    for (const p of packsInRoot(root, 'bundled')) if (!byId.has(p.id)) byId.set(p.id, p)
  }
  for (const p of packsInRoot(roots.user, 'user')) byId.set(p.id, p) // user overrides bundled
  const mine = userSoundsPack(roots)
  if (mine) byId.set(mine.id, mine)
  return [...byId.values()]
}

/** Every pack on this machine. */
export function listPacks(): SoundPack[] {
  return listPacksIn(realRoots())
}

/**
 * Read a sound's bytes → { mime, dataBase64 }.
 *
 * A REF THAT CANNOT BE SERVED IS NOT SILENCE (JOS-273). This used to answer null for every pack
 * but the reserved one — "an uninstalled registry pack is a pack the user removed on purpose" —
 * which was true right up until the owner ruled that a user may DELETE the shipped pack and name
 * their own default. From that moment a `{packId, soundId}` pointing at a pack that is gone is
 * the NORMAL state of every seeded and suggested alert, and answering null makes each of them a
 * silently mute alert nobody asked to lose.
 *
 * So the ref resolves THROUGH the default-pack preference instead (shared/soundPacks.ts
 * `resolveSoundRef`), keeping the sound's CESP category so a completion sting stays a completion
 * line — the live form of the argument `migrateAlertSoundRef` makes for a retired pack. The
 * reserved pack's old fallback is now one case of that rule rather than a special one: a removed
 * custom sound still lands on "A moment of your time, if you'd be so kind."
 *
 * `defaultPackId` is passed IN rather than read here on purpose: this module is loaded by
 * node:test (tests/userSounds.test.mts drives the real enumeration over temp dirs) and the store
 * is not loadable there. The IPC handler supplies the user's preference; the shipped id is the
 * honest default for every other caller.
 */
export function getSoundDataIn(
  roots: SoundRoots,
  packId: string,
  soundId: string,
  defaultPackId: string = DEFAULT_ALERT_PACK_ID
): SoundData | null {
  const direct = readPackSound(roots, packId, soundId)
  if (direct) return direct
  const resolved = resolveSoundRef({ packId, soundId }, listPacksIn(roots), {
    defaultPackId,
    fallbackSoundId: DEFAULT_ALERT_SOUNDS.buffWearsOff
  })
  if (resolved.status === 'missing') return null
  return readPackSound(roots, resolved.packId, resolved.soundId)
}

/** One sound's bytes from the real roots — what `sounds:getData` answers with. */
export function getSoundData(
  packId: string,
  soundId: string,
  defaultPackId?: string
): SoundData | null {
  return getSoundDataIn(realRoots(), packId, soundId, defaultPackId)
}

/** One pack's one sound, straight off disk. Null if the pack/sound/file is missing. */
function readPackSound(roots: SoundRoots, packId: string, soundId: string): SoundData | null {
  const loc = packDir(roots, packId)
  if (!loc) return null
  const manifest = readManifest(loc.dir)
  const sound = manifest?.sounds?.[soundId]
  if (!sound) return null
  const file = join(loc.dir, sound.file)
  // Guard against manifest paths escaping the pack dir.
  if (!file.startsWith(loc.dir)) return null
  if (!existsSync(file)) return null
  const ext = sound.file.slice(sound.file.lastIndexOf('.')).toLowerCase()
  const mime = AUDIO_MIME[ext]
  if (!mime) return null
  try {
    const buf = readFileSync(file)
    return { mime, dataBase64: buf.toString('base64') }
  } catch (err) {
    logError('main:sounds', { message: `failed reading ${file}`, err })
    return null
  }
}
