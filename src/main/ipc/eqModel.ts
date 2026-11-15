// ipc/eqModel.ts — SERVE A RACE MODEL FROM THE GAME'S OWN FILES (EQ Zera, 2026-09-06; the
// character-model spike).
//
// The renderer asks for a three-letter actor code (`BAF` = Barbarian female), what it wears and
// what it holds, and gets back a skinned model: bones with bind transforms, vertex buffers per
// mesh with a bone per vertex, the idle clip, the weapon meshes, and every texture those meshes
// use as data URLs the renderer's CSP already admits (`img-src data:`). The archives live under
// the configured EverQuest install (`effectiveEqRoot()` - never a hard-coded path), read ONCE and
// kept: global_chr.s3d for the classic races, global4_chr.s3d for the Iksar, the gequip*.s3d for
// the items.
//
// A FACE IS A HEAD TEXTURE, not a mesh (shared/eqModel.ts spells the naming out). The renderer
// sends it inside the wear and the payload answers with the faces that archive really holds for
// that actor (`faces`) and the one its bare head binds (`defaultFace`), so the picker offers
// exactly what exists - 0..7 for a human male, 1..7 for a human female, whose head binds face 2.
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
  type EqModelClip,
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
import { RACE_CODES, SKIN_FACE_MAX, facesFor, readCharacter, readWld, type CharacterModel, type Skeleton, type WldFile } from '../eqassets/wld'
import { readItem } from '../eqassets/wldItem'
import { LUCLIN_LENDER, LUCLIN_RACES, luclinFile } from '../eqassets/luclin'
import { ddsToBmp, isDds } from '../eqassets/dds'
import { readAnimation, readAnimationOrLent } from '../eqassets/wldAnim'
import { logError } from '../errorLog'

/**
 * WHICH ARCHIVE A RACE LIVES IN. The classic twelve (`RACE_CODES`, both sexes) are all in
 * global_chr.s3d; the Iksar are in global4_chr.s3d, on a 43-bone skeleton of their own. The
 * other three playable races are deliberately NOT here - Vah Shir (vsm/vsf_chr.s3d) ship no
 * face textures at all, Froglok name theirs by a different scheme entirely
 * (globalfroglok_chr.s3d, `frmhesk<F>1.dds`), and Drakkin (drm/drf_chr.s3d) have no head mesh -
 * so the picker names them and says this app has no model for them, rather than half-drawing one.
 *
 * THE TWO NEWER RACES (2026-11-15) each ship one archive PER SEX, one actor apiece: Kerra
 * (globalkem/kef_chr.s3d, July 28 2026) on the skin scheme wld.ts reads, and the Half Dark Elf
 * (globalhdm/hdf_chr.s3d, the October 22 Castle Nektropos patch) on the classic face naming. A
 * sex the archive lacks a clip for borrows from the other sex's file (`LENDER`).
 */
const PER_SEX_RACES: Record<string, string> = { KE: 'globalke', HD: 'globalhd' }
/** Which actor lends an idle across archives: HDF ships no P01 of her own. */
const LENDER: Record<string, string> = { HDF: 'HDM', HDM: 'HDF', KEF: 'KEM', KEM: 'KEF' }
/**
 * THE LUCLIN MODELS (owner, 2026-11-15: "it should just be a toggle similar to how we have the
 * helmet on or off option"). Every classic race and the Iksar also ship a Luclin-era actor, one
 * archive per actor: `global<code>_chr.s3d` (HUM through IKF; a `_chr2` beside some of them holds
 * extra ANIMATIONS only, no textures and no idle this reader needs). `readCharacter` reads them
 * as they are - one mesh with the head built in, two eyeball meshes, the skin scheme
 * (`<code><part>sk<F><P>.dds`) for the bare body and the face, and armour as
 * `<code><part>0<V>0<P>.dds`, which is the classic variant digit, so the existing wear maps onto
 * it. The archive guard (`has`) is what keeps that honest: Luclin chests ship no plate texture on
 * 25 of the 26 actors (BAF alone has `ch03`), and a part with no texture for its variant stays the
 * bare skin rather than borrowing a wrong one.
 *
 * WHAT IS NOT DRAWN: the helm. A Luclin head is part of the body mesh and has no `HE01..03` helm
 * meshes; the game draws Luclin helms as item models (lgequip_amr*.s3d, `IT5000` up in blocks of
 * thirty), and which block belongs to which race is not something these files state. So the
 * Luclin figure is bare-headed whatever the helm switch says, rather than wearing a guess.
 *
 * The races that ship ONE model (Kerra, Half Dark Elf) have no Luclin twin: the switch does not
 * apply to them (`LUCLIN_RACES`), and the payload says which kind it is (`luclin`). Eight Luclin
 * actors carry no animation at all and borrow an idle across archives (`LUCLIN_LENDER`); both
 * tables live in eqassets/luclin.ts, where the tests can reach them.
 */
const IKSAR = 'global4_chr.s3d'
const CLASSIC = 'global_chr.s3d'
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

/** `scaledTracks`: read the archive's bone tracks with their scales (the Luclin archives; wld.ts `trackFrameAt`). */
function archive(name: string, scaledTracks = false): Loaded | null {
  const hit = loaded.get(name)
  if (hit !== undefined) return hit
  let out: Loaded | null = null
  try {
    const path = join(effectiveEqRoot(), name)
    if (existsSync(path)) {
      const pfs = readPfs(readFileSync(path))
      const wldName = pfs.entries.find((e) => e.name.endsWith('.wld'))?.name
      const bytes = wldName ? pfs.read(wldName) : undefined
      out = bytes ? { pfs, wld: readWld(bytes, { scaledTracks }) } : null
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

/** The archive a race actor reads from, cached per FILE by `archive` - the `itemArchive` idiom. */
function raceArchive(code: string): Loaded | null {
  const race = code.slice(0, 2)
  if (race === 'IK') return archive(IKSAR)
  const perSex = PER_SEX_RACES[race]
  if (perSex !== undefined) return archive(`${perSex}${code.slice(2).toLowerCase()}_chr.s3d`)
  return Object.hasOwn(RACE_CODES, race) ? archive(CLASSIC) : null
}

/** The actor's Luclin archive, or null when the race has none (or this install does not ship it). */
function luclinArchive(code: string): Loaded | null {
  return LUCLIN_RACES.has(code.slice(0, 2)) ? archive(luclinFile(code), true) : null
}

/** The highest face pick any scheme carries: `he00<F><P>` stops at 7, the skin scheme at 14 (wld.ts `facesFor` says which exist). */
const FACE_MAX = SKIN_FACE_MAX

/**
 * The idle, or NONE. A non-classic skeleton is a shape this reader has not measured, and a still
 * figure is a better answer than the stylised doll: anything the animation reader throws on is
 * logged and swallowed. (Measured: IKM carries its own P01; IKF carries no P01 and no human
 * fallback lives in global4_chr.wld, so the Iksar female stands still.)
 */
function idleClip(wld: WldFile, code: string, skeleton: Skeleton, luclin = false): EqModelClip | null {
  try {
    const lendCode = luclin ? LUCLIN_LENDER[code] : LENDER[code]
    const lendWld = lendCode !== undefined ? (luclin ? luclinArchive(lendCode) : raceArchive(lendCode))?.wld : undefined
    if (lendWld && lendCode) return readAnimationOrLent({ wld, code, skeleton }, IDLE, { wld: lendWld, code: lendCode })
    return readAnimation(wld, code, skeleton, IDLE)
  } catch (err) {
    logError('main:eqModel', { message: 'no idle for ' + code, err })
    return null
  }
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
/** A face pick as the renderer sent it: an INTEGER 0..FACE_MAX, and nothing else - not a `WearVariant`. */
const facePick = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= FACE_MAX ? v : undefined
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
  const face = facePick(rec.face)
  if (face !== undefined) wear.face = face
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

/**
 * The actor's archive and its model, Luclin first when asked for and there. A Luclin ask the race
 * or the install cannot answer is the classic figure, said so by the payload's `luclin: false`.
 */
function readActor(code: string, wear: EqModelWear, luclin: boolean): { races: Loaded; model: CharacterModel; luclin: boolean } | null {
  const lu = luclin ? luclinArchive(code) : null
  const luModel = lu ? readCharacter(lu.wld, code, { wear, has: lu.pfs.has }) : null
  if (lu && luModel) return { races: lu, model: luModel, luclin: true }
  const races = raceArchive(code)
  const model = races ? readCharacter(races.wld, code, { wear, has: races.pfs.has }) : null
  return races && model ? { races, model, luclin: false } : null
}

export function loadEqModel(code: unknown, wear?: unknown, hands?: unknown, luclin?: unknown): EqModelPayload | null {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return null
  const read = readActor(code, sanitizeWear(wear), luclin === true)
  if (!read) return null
  const { races, model } = read
  const textures: Record<string, string> = {}
  for (const mesh of model.meshes) collectTextures(races.pfs, mesh, textures)
  const idle = idleClip(races.wld, code, model.skeleton, read.luclin)
  const held = sanitizeHands(hands)
  const weapons: EqModelWeapon[] = []
  const primary = weaponFor(held.primary, 'R_POINT', textures)
  const secondary = weaponFor(held.secondary, 'L_POINT', textures)
  if (primary) weapons.push(primary)
  if (secondary) weapons.push(secondary)
  const out: EqModelPayload = { actor: model.actor, bones: model.bones, meshes: model.meshes, clips: idle ? [idle] : [], weapons, textures }
  const faces = facesFor(code, races.pfs.has)
  if (faces.length > 0) out.faces = faces
  if (model.defaultFace !== undefined) out.defaultFace = model.defaultFace
  if (luclin === true) out.luclin = read.luclin
  if (model.undressed) out.undressed = model.undressed
  return out
}

export function registerEqModelIpc(): void {
  // code, wear, hands, and whether the Luclin model was asked for - each untrusted, each checked by loadEqModel.
  ipcMain.handle(IPC.eqModel, (_e, ...args: unknown[]): EqModelPayload | null => loadEqModel(args[0], args[1], args[2], args[3]))
}
