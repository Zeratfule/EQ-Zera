// ipc/eqModel.ts — SERVE A RACE MODEL FROM THE GAME'S OWN FILES (EQ Zera, 2026-09-06; the
// character-model spike).
//
// The renderer asks for a three-letter actor code (`BAF` = Barbarian female), what it wears and
// what it holds, and gets back a skinned model: bones with bind transforms, vertex buffers per
// mesh with a bone per vertex, the idle clip, the weapon meshes, and every texture those meshes
// use as data URLs the renderer's CSP already admits (`img-src data:`). The archives live under
// the configured EverQuest install (`effectiveEqRoot()` - never a hard-coded path), read ONCE and
// kept: global_chr.s3d for the races, the six gequip*.s3d for the items.
//
// A HAND IS DRAWN BY MODEL FIRST. The sheet carries each worn item's `IT<n>` from the item table
// (data/itemModels.json, keyed by the dump's own item id), so a monk's fist weapon draws as the
// fist weapon and not as a mace. Only an item the table does not know falls back to a
// representative of its weapon skill, and that fallback is what the old table below is now for.
//
// NOTHING IS WRITTEN and nothing leaves the machine: the user's own game files, read read-only,
// rendered in the user's own window. A missing install or archive is a `null` answer, not an
// error, so the Character tab keeps its stylised doll.

import { ipcMain } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc'
import {
  WEAR_PARTS,
  type AttachPoint,
  type EqModelHand,
  type EqModelHands,
  type EqModelMesh,
  type EqModelPayload,
  type EqModelWear,
  type EqModelWeapon,
  type Tint,
  type WearVariant
} from '../../shared/eqModel'
import { effectiveEqRoot } from '../log/config'
import { readPfs, type PfsArchive } from '../eqassets/pfs'
import { readCharacter, readWld, type WldFile } from '../eqassets/wld'
import { readItem } from '../eqassets/wldItem'
import { ddsToBmp, isDds } from '../eqassets/dds'
import { readAnimation } from '../eqassets/wldAnim'
import { logError } from '../errorLog'

const RACES = { archive: 'global_chr.s3d', wld: 'global_chr.wld' }
const ITEM_ARCHIVES = ['gequip.s3d', 'gequip2.s3d', 'gequip3.s3d', 'gequip4.s3d', 'gequip5.s3d', 'gequip6.s3d', 'gequip8.s3d', 'gequip2026.s3d']
const IDLE = 'P01'

/**
 * WHICH MODEL A WEAPON SKILL DRAWS, when the item table does not know the item. The ids were
 * identified by their textures inside gequip.s3d (`SWORD.BMP`, `DAGGER.BMP`, `MACETOP.BMP`,
 * `HAM2HND*`, `AXEBLADE`, `AXE2BLD*`).
 */
const MODEL_FOR_SKILL: Record<string, string> = {
  '1h slashing': 'IT1',
  '2h slashing': 'IT22',
  '1h blunt': 'IT7',
  '2h blunt': 'IT24',
  piercing: 'IT5',
  '1h piercing': 'IT5',
  '2h piercing': 'IT16',
  archery: 'IT4'
}

interface Loaded {
  pfs: PfsArchive
  wld: WldFile
}

const loaded = new Map<string, Loaded | null>()

function archive(name: string): Loaded | null {
  const hit = loaded.get(name)
  if (hit !== undefined) return hit
  let out: Loaded | null = null
  try {
    const path = join(effectiveEqRoot(), name)
    if (existsSync(path)) {
      const pfs = readPfs(readFileSync(path))
      const wldName = pfs.entries.find((e) => e.name.endsWith('.wld'))?.name
      const bytes = wldName ? pfs.read(wldName) : undefined
      out = bytes ? { pfs, wld: readWld(bytes) } : null
    }
  } catch (err) {
    logError('main:eqModel', { message: `could not read ${name}`, err })
  }
  loaded.set(name, out)
  return out
}

/** The item archive that carries a model actor, searched in order and remembered. */
const itemArchiveOf = new Map<string, Loaded | null>()
function itemArchive(model: string): Loaded | null {
  const hit = itemArchiveOf.get(model)
  if (hit !== undefined) return hit
  let found: Loaded | null = null
  for (const name of ITEM_ARCHIVES) {
    const a = archive(name)
    if (a?.wld.byName.has(`${model}_ACTORDEF`)) {
      found = a
      break
    }
  }
  itemArchiveOf.set(model, found)
  return found
}

/** A bitmap as the renderer can show it: a BMP as is, a DDS decoded to one (the later item archives). */
function bitmapDataUrl(bytes: Uint8Array): string | null {
  const buf = Buffer.from(bytes)
  const bmp = isDds(buf) ? ddsToBmp(buf) : buf
  return bmp ? `data:image/bmp;base64,${bmp.toString('base64')}` : null
}

/** The textures a mesh's DRAWN groups reference, as data URLs, added to `into`. */
function collectTextures(pfs: PfsArchive, mesh: EqModelMesh, into: Record<string, string>): void {
  for (const g of mesh.groups) {
    const mat = mesh.materials[g.materialIndex]
    for (const tex of mat?.frames ?? (mat?.texture ? [mat.texture] : [])) {
      if (into[tex] !== undefined) continue
      const bytes = pfs.read(tex)
      const url = bytes ? bitmapDataUrl(bytes) : null
      if (url) into[tex] = url
    }
  }
}

const variant = (v: unknown): WearVariant | undefined => (v === 0 || v === 1 || v === 2 || v === 3 ? v : undefined)
const tint = (v: unknown): Tint | undefined =>
  Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && c >= 0 && c <= 1) ? (v as Tint) : undefined

/** The wear as the renderer sent it, admitting only known parts at variants 0..3 and unit tints. */
export function sanitizeWear(raw: unknown): EqModelWear {
  const wear: EqModelWear = {}
  if (typeof raw !== 'object' || raw === null) return wear
  const rec = raw as Record<string, unknown>
  for (const part of WEAR_PARTS) {
    const v = variant(rec[part])
    if (v !== undefined) wear[part] = v
  }
  const helm = variant(rec.helm)
  if (helm !== undefined) wear.helm = helm
  const tints = typeof rec.tint === 'object' && rec.tint !== null ? (rec.tint as Record<string, unknown>) : {}
  for (const part of [...WEAR_PARTS, 'helm'] as const) {
    const t = tint(tints[part])
    if (t) (wear.tint ??= {})[part] = t
  }
  return wear
}

function sanitizeHand(raw: unknown): EqModelHand | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const rec = raw as Record<string, unknown>
  const hand: EqModelHand = {}
  if (typeof rec.model === 'string' && /^IT\d{1,6}$/.test(rec.model)) hand.model = rec.model
  if (typeof rec.skill === 'string' && rec.skill.length > 0 && rec.skill.length <= 32) hand.skill = rec.skill
  return hand.model === undefined && hand.skill === undefined ? undefined : hand
}

/** The hands as the renderer sent them. */
export function sanitizeHands(raw: unknown): EqModelHands {
  if (typeof raw !== 'object' || raw === null) return {}
  const rec = raw as Record<string, unknown>
  const out: EqModelHands = {}
  const p = sanitizeHand(rec.primary)
  const s = sanitizeHand(rec.secondary)
  if (p) out.primary = p
  if (s) out.secondary = s
  return out
}

/** The model a hand draws: the item's own when the archives have it, else its skill's representative. */
function weaponFor(hand: EqModelHand | undefined, attach: AttachPoint, textures: Record<string, string>): EqModelWeapon | null {
  if (!hand) return null
  const bySkill = hand.skill ? MODEL_FOR_SKILL[hand.skill.trim().toLowerCase()] : undefined
  for (const code of [hand.model, bySkill]) {
    if (!code) continue
    const items = itemArchive(code)
    const mesh = items ? readItem(items.wld, code) : null
    if (!items || !mesh) continue
    collectTextures(items.pfs, mesh, textures)
    return { attach, mesh }
  }
  return null
}

export function loadEqModel(code: unknown, wear?: unknown, hands?: unknown): EqModelPayload | null {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return null
  const races = archive(RACES.archive)
  if (!races) return null
  const model = readCharacter(races.wld, code, { wear: sanitizeWear(wear), has: races.pfs.has })
  if (!model) return null
  const textures: Record<string, string> = {}
  for (const mesh of model.meshes) collectTextures(races.pfs, mesh, textures)
  const idle = readAnimation(races.wld, code, model.skeleton, IDLE)
  const held = sanitizeHands(hands)
  const weapons: EqModelWeapon[] = []
  const primary = weaponFor(held.primary, 'R_POINT', textures)
  const secondary = weaponFor(held.secondary, 'L_POINT', textures)
  if (primary) weapons.push(primary)
  if (secondary) weapons.push(secondary)
  return { actor: model.actor, bones: model.bones, meshes: model.meshes, clips: idle ? [idle] : [], weapons, textures }
}

export function registerEqModelIpc(): void {
  ipcMain.handle(IPC.eqModel, (_e, code: unknown, wear: unknown, hands: unknown): EqModelPayload | null => loadEqModel(code, wear, hands))
}
