// eqassets/wld.ts — READ A CHARACTER MODEL OUT OF A CLASSIC `.wld` (EQ Zera, 2026-09-06;
// character-model spike).
//
// A WLD is a flat list of typed FRAGMENTS that reference each other by 1-based index, plus a
// string table (XOR-obfuscated with an eight-byte key). The handful this reader understands is
// exactly the chain from an actor to its pixels:
//
//   0x14 ActorDef ("BAF_ACTORDEF")
//     └ 0x11 SkeletonRef → 0x10 Skeleton (bones; each bone → 0x13 TrackRef → 0x12 Track: the
//                            BIND POSE as one frame of translation + quaternion; the skeleton
//                            also lists its meshes → 0x2D MeshRef → 0x36 Mesh)
//   0x36 Mesh: quantised vertices, uvs, normals, triangles, "vertex pieces" (vertex ranges owned
//              by a bone — vertices are stored in BONE space), material groups
//     └ 0x31 MaterialList → 0x30 Material → 0x05 → 0x04 → 0x03 BitmapName ("bafch0001.bmp")
//
// The layouts follow the EQEmu community's documentation (LanternExtractor is the reference
// reader) for the OLD format (version 0x00015500), which is what this client's archives carry.
// PURE NODE, no Electron: tests/eqAssets.test.mts drives it over the real archives.
//
// WHAT COMES OUT is a model in the game's own frame, posed to its bind pose, with the bone each
// vertex belongs to — so the renderer can skin and animate it (wldAnim.ts reads the clips).

import { WEAR_PARTS, type EqModelBone, type EqModelGroup, type EqModelMaterial, type EqModelMesh, type EqModelWear } from '../../shared/eqModel'

const KEY = [0x95, 0x3a, 0xc5, 0x2a, 0x95, 0x7a, 0x95, 0x6a]
const MAGIC = 0x54503d02
export const OLD_FORMAT = 0x00015500

function decode(bytes: Uint8Array): string {
  const out = Buffer.alloc(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ KEY[i % 8]
  return out.toString('latin1')
}

export interface Fragment {
  index: number
  type: number
  /** body, INCLUDING the leading nameRef */
  body: Buffer
  name: string
}

export interface WldFile {
  version: number
  fragments: Fragment[]
  byName: Map<string, Fragment>
  /** a string-table reference (negative int) → the string */
  nameAt: (ref: number) => string
}

export function readWld(bytes: Uint8Array): WldFile {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (b.length < 28 || b.readUInt32LE(0) !== MAGIC) throw new Error('not a WLD file')
  const version = b.readUInt32LE(4)
  const fragCount = b.readUInt32LE(8)
  const hashSize = b.readUInt32LE(20)
  const strings = decode(b.subarray(28, 28 + hashSize))
  const nameAt = (ref: number): string => {
    if (ref >= 0) return ''
    const end = strings.indexOf('\0', -ref)
    return strings.slice(-ref, end < 0 ? undefined : end)
  }
  const fragments: Fragment[] = []
  const byName = new Map<string, Fragment>()
  let at = 28 + hashSize
  for (let i = 0; i < fragCount && at + 8 <= b.length; i++) {
    const size = b.readUInt32LE(at)
    const type = b.readUInt32LE(at + 4)
    const body = b.subarray(at + 8, at + 8 + size)
    const name = body.length >= 4 ? nameAt(body.readInt32LE(0)) : ''
    const frag = { index: i + 1, type, body, name }
    fragments.push(frag)
    if (name !== '') byName.set(name, frag)
    at += 8 + size
  }
  return { version, fragments, byName, nameAt }
}

/** The fragment a 1-based ref points at, if it is of the expected type. The ONE guard, used everywhere. */
export function fragmentAt(wld: WldFile, ref: number, type: number): Fragment | undefined {
  const f = ref > 0 ? wld.fragments[ref - 1] : undefined
  return f?.type === type ? f : undefined
}

// ---- transforms --------------------------------------------------------------------------------

export type Quat = [number, number, number, number]
export type Vec3 = [number, number, number]

export interface Xform {
  t: Vec3
  q: Quat
}

export const IDENTITY: Xform = { t: [0, 0, 0], q: [0, 0, 0, 1] }

function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz
  ]
}

/** v rotated by q (v' = q v q*). */
function qrot(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  const ix = qw * vx + qy * vz - qz * vy
  const iy = qw * vy + qz * vx - qx * vz
  const iz = qw * vz + qx * vy - qy * vx
  const iw = -qx * vx - qy * vy - qz * vz
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx
  ]
}

function compose(parent: Xform, local: Xform): Xform {
  const t = qrot(parent.q, local.t)
  return { t: [parent.t[0] + t[0], parent.t[1] + t[1], parent.t[2] + t[2]], q: qmul(parent.q, local.q) }
}

/** One frame of a 0x12 track at byte offset `at` (old format: eight int16). */
export function trackFrameAt(body: Buffer, at: number): Xform {
  const rotDenom = body.readInt16LE(at)
  const rx = body.readInt16LE(at + 2)
  const ry = body.readInt16LE(at + 4)
  const rz = body.readInt16LE(at + 6)
  const sx = body.readInt16LE(at + 8)
  const sy = body.readInt16LE(at + 10)
  const sz = body.readInt16LE(at + 12)
  const shiftDenom = body.readInt16LE(at + 14)
  const t: Vec3 = shiftDenom === 0 ? [0, 0, 0] : [sx / shiftDenom, sy / shiftDenom, sz / shiftDenom]
  const len = Math.hypot(rx, ry, rz, rotDenom) || 1
  return { t, q: [rx / len, ry / len, rz / len, rotDenom / len] }
}

/** 0x12: nameRef(4) flags(4) frameCount(4) then frames of eight int16. */
export const TRACK_FRAMES_AT = 12
export const TRACK_FRAME_BYTES = 16

// ---- skeleton ----------------------------------------------------------------------------------

export interface Bone {
  name: string
  children: number[]
  local: Xform
}

export interface Skeleton {
  bones: Bone[]
  meshRefs: number[]
}

/** The bind transform a bone's 0x13 → 0x12 track states; identity when it has none. */
function boneLocal(wld: WldFile, trackRef: number): Xform {
  const track = fragmentAt(wld, trackRef, 0x13)
  const def = track ? fragmentAt(wld, track.body.readInt32LE(4), 0x12) : undefined
  return def ? trackFrameAt(def.body, TRACK_FRAMES_AT) : IDENTITY
}

/** 0x10. */
function readSkeleton(wld: WldFile, frag: Fragment): Skeleton {
  const b = frag.body
  const flags = b.readUInt32LE(4)
  const boneCount = b.readUInt32LE(8)
  let at = 16 + (flags & 1 ? 12 : 0) + (flags & 2 ? 4 : 0)
  const bones: Bone[] = []
  for (let i = 0; i < boneCount; i++) {
    const name = wld.nameAt(b.readInt32LE(at))
    const trackRef = b.readInt32LE(at + 8)
    const childCount = b.readUInt32LE(at + 16)
    at += 20
    const children: number[] = []
    for (let c = 0; c < childCount; c++) children.push(b.readInt32LE(at + c * 4))
    at += childCount * 4
    bones.push({ name, children, local: boneLocal(wld, trackRef) })
  }
  const meshRefs: number[] = []
  if (flags & 0x200) {
    const count = b.readUInt32LE(at)
    for (let i = 0; i < count; i++) meshRefs.push(b.readInt32LE(at + 4 + i * 4))
  }
  return { bones, meshRefs }
}

/** Bone → world transform for the bind pose, walking the tree from bone 0. */
export function bindPose(skeleton: Skeleton): Xform[] {
  const world: Xform[] = skeleton.bones.map(() => IDENTITY)
  const visit = (i: number, parent: Xform): void => {
    world[i] = compose(parent, skeleton.bones[i].local)
    for (const c of skeleton.bones[i].children) visit(c, world[i])
  }
  if (skeleton.bones.length > 0) visit(0, IDENTITY)
  return world
}

// ---- materials ---------------------------------------------------------------------------------

/** Resolve a 0x30 material to its bitmap file name, following 0x05 → 0x04 → 0x03. */
/** The bitmap file a 0x03 names, lower-cased. */
function bitmapName(f03: Fragment): string {
  const len = f03.body.readUInt16LE(8)
  const name = decode(f03.body.subarray(10, 10 + len))
  const nul = name.indexOf('\0')
  return (nul >= 0 ? name.slice(0, nul) : name).toLowerCase()
}

/** A material's bitmaps: one for a still texture, several for an animated one (a weapon's pulsing glow), with the period. */
interface MaterialBitmaps {
  frames: string[]
  frameMs?: number
}

const ANIMATED_FLAG = 0x08
const SKIP_FLAG = 0x04

function materialBitmaps(wld: WldFile, mat: Fragment): MaterialBitmaps | null {
  const f05 = fragmentAt(wld, mat.body.readInt32LE(24), 0x05)
  const f04 = f05 ? fragmentAt(wld, f05.body.readInt32LE(4), 0x04) : undefined
  const count = f04 ? f04.body.readUInt32LE(8) : 0
  if (!f04 || count === 0) return null
  const flags = f04.body.readUInt32LE(4)
  // The bitmap refs are the LAST `count` int32s of the 0x04 body, whatever optional fields precede them.
  const first = f04.body.length - 4 * count
  const frames: string[] = []
  for (let i = 0; i < count; i++) {
    const f03 = fragmentAt(wld, f04.body.readInt32LE(first + 4 * i), 0x03)
    if (f03) frames.push(bitmapName(f03))
  }
  if (frames.length === 0) return null
  const out: MaterialBitmaps = { frames }
  // An animated 0x04 states its period after count (and after one more int32 when the skip flag is set).
  if ((flags & ANIMATED_FLAG) !== 0 && frames.length > 1) out.frameMs = f04.body.readUInt32LE((flags & SKIP_FLAG) !== 0 ? 16 : 12)
  return out
}

function readMaterials(wld: WldFile, listRef: number): EqModelMaterial[] {
  const list = fragmentAt(wld, listRef, 0x31)
  if (!list) return []
  const count = list.body.readUInt32LE(8)
  const out: EqModelMaterial[] = []
  for (let i = 0; i < count; i++) {
    const mat = fragmentAt(wld, list.body.readInt32LE(12 + i * 4), 0x30)
    if (!mat) {
      out.push({ name: '', texture: null, type: 0 })
      continue
    }
    const type = mat.body.readUInt32LE(8) & 0xff
    const bitmaps = type === 0 ? null : materialBitmaps(wld, mat)
    const entry: EqModelMaterial = { name: mat.name, texture: bitmaps?.frames[0] ?? null, type }
    if (bitmaps && bitmaps.frames.length > 1) {
      entry.frames = bitmaps.frames
      entry.frameMs = bitmaps.frameMs ?? 100
    }
    out.push(entry)
  }
  return out
}

// ---- mesh --------------------------------------------------------------------------------------

/** The 0x36 header's counts, and where the vertex data starts. */
interface MeshHeader {
  materialListRef: number
  vertexCount: number
  uvCount: number
  normalCount: number
  colorCount: number
  polygonCount: number
  pieceCount: number
  polyTexCount: number
  vertexTexCount: number
  size9: number
  scale: number
  dataAt: number
  /**
   * Where the mesh sits: vertices are stored relative to this. Zero for every race body; for a
   * weapon it is what puts the grip at the hand and the blade out in front, so a sword drawn
   * without it is centred on the fist instead of held by it.
   */
  center: Vec3
}

function readMeshHeader(b: Buffer): MeshHeader {
  // nameRef flags matList anim unk unk center(3f) params2(3) maxDist min(3f) max(3f) then ten uint16 counts
  const at = 4 + 4 + 4 + 4 + 8 + 12 + 12 + 4 + 12 + 12
  const u16 = (i: number): number => b.readUInt16LE(at + i * 2)
  return {
    materialListRef: b.readInt32LE(8),
    center: [b.readFloatLE(24), b.readFloatLE(28), b.readFloatLE(32)],
    vertexCount: u16(0),
    uvCount: u16(1),
    normalCount: u16(2),
    colorCount: u16(3),
    polygonCount: u16(4),
    pieceCount: u16(5),
    polyTexCount: u16(6),
    vertexTexCount: u16(7),
    size9: u16(8),
    scale: 1 / (1 << u16(9)),
    dataAt: at + 20
  }
}

/** Vertex pieces: runs of vertices owned by a bone, in vertex order → bone index per vertex. */
function readPieces(b: Buffer, at: number, h: MeshHeader): number[] {
  const boneOf = new Array<number>(h.vertexCount).fill(-1)
  let v = 0
  for (let i = 0; i < h.pieceCount; i++) {
    const count = b.readUInt16LE(at + i * 4)
    const bone = b.readUInt16LE(at + i * 4 + 2)
    for (let k = 0; k < count && v < h.vertexCount; k++) boneOf[v++] = bone
  }
  return boneOf
}

function readGroups(b: Buffer, at: number, count: number): EqModelGroup[] {
  const groups: EqModelGroup[] = []
  let start = 0
  for (let i = 0; i < count; i++) {
    const tris = b.readUInt16LE(at + i * 4)
    groups.push({ materialIndex: b.readUInt16LE(at + i * 4 + 2), start, count: tris * 3 })
    start += tris * 3
  }
  return groups
}

/** 0x36, posed through `boneWorld` (bone index → world transform); a rigid item passes none. Old format. */
export function readMesh(wld: WldFile, frag: Fragment, boneWorld: readonly Xform[]): EqModelMesh {
  const b = frag.body
  const h = readMeshHeader(b)
  let at = h.dataAt
  const raw: Vec3[] = []
  for (let i = 0; i < h.vertexCount; i++, at += 6) {
    raw.push([b.readInt16LE(at) * h.scale + h.center[0], b.readInt16LE(at + 2) * h.scale + h.center[1], b.readInt16LE(at + 4) * h.scale + h.center[2]])
  }
  const uvs: number[] = []
  for (let i = 0; i < h.uvCount; i++, at += 4) uvs.push(b.readInt16LE(at) / 256, b.readInt16LE(at + 2) / 256)
  const rawNormals: Vec3[] = []
  for (let i = 0; i < h.normalCount; i++, at += 3) rawNormals.push([b.readInt8(at) / 127, b.readInt8(at + 1) / 127, b.readInt8(at + 2) / 127])
  at += h.colorCount * 4
  const indices: number[] = []
  for (let i = 0; i < h.polygonCount; i++, at += 8) indices.push(b.readUInt16LE(at + 2), b.readUInt16LE(at + 4), b.readUInt16LE(at + 6))
  const boneOf = readPieces(b, at, h)
  at += h.pieceCount * 4
  const groups = readGroups(b, at, h.polyTexCount)

  const positions: number[] = []
  const normals: number[] = []
  const skinIndices: number[] = []
  for (let i = 0; i < h.vertexCount; i++) {
    const x = boneOf[i] >= 0 ? boneWorld[boneOf[i]] : undefined
    const p = x ? compose(x, { t: raw[i], q: [0, 0, 0, 1] }).t : raw[i]
    const n = rawNormals[i] ?? [0, 0, 1]
    positions.push(...p)
    normals.push(...(x ? qrot(x.q, n) : n))
    if (boneWorld.length > 0) skinIndices.push(Math.max(0, boneOf[i]))
  }
  while (uvs.length < h.vertexCount * 2) uvs.push(0, 0)
  return { name: frag.name, positions, normals, uvs, indices, groups, materials: readMaterials(wld, h.materialListRef), skinIndices }
}

// ---- the character -----------------------------------------------------------------------------

/**
 * The classic race codes this reader knows, by the two-letter prefix the WLD's actor names use.
 * Gender is the third letter: M / F.
 */
export const RACE_CODES: Record<string, string> = {
  HU: 'Human',
  BA: 'Barbarian',
  ER: 'Erudite',
  EL: 'Wood Elf',
  HI: 'High Elf',
  DA: 'Dark Elf',
  HA: 'Half Elf',
  DW: 'Dwarf',
  TR: 'Troll',
  OG: 'Ogre',
  HO: 'Halfling',
  GN: 'Gnome'
}

export interface CharacterModel {
  actor: string
  bones: EqModelBone[]
  meshes: EqModelMesh[]
  /** the skeleton, for the animation reader */
  skeleton: Skeleton
}

/** How a character is dressed: the wear, and whether the archive has a given texture file. */
export interface Outfit {
  wear: EqModelWear
  has: (file: string) => boolean
}

const BARE: Outfit = { wear: {}, has: () => false }

/**
 * Which of a skeleton's meshes to draw: the body, plus the head mesh the helm asks for (`HE00`
 * bare, `HE01..03` the helm kinds - falling back to bare when the race has no such mesh).
 */
function drawnMeshes(names: readonly string[], code: string, helm: number): Set<string> {
  const body = `${code}_DMSPRITEDEF`
  const head = (n: number): string => `${code}HE0${String(n)}_DMSPRITEDEF`
  const chosen = helm > 0 && names.includes(head(helm)) ? head(helm) : head(0)
  return new Set([body, chosen])
}

/** The body part a race texture belongs to (`bafch0001.bmp` → `ch`), and its variant/index digits. */
function texturePart(texture: string, code: string): { part: (typeof WEAR_PARTS)[number]; index: string } | null {
  const m = new RegExp(`^${code.toLowerCase()}(${WEAR_PARTS.join('|')})(\\d\\d)(\\d\\d)\\.bmp$`).exec(texture)
  return m ? { part: m[1] as (typeof WEAR_PARTS)[number], index: m[3] } : null
}

/** `bafch0001.bmp` → `bafch0301.bmp` when the wear says plate and the archive has it; plus the part's dye. */
function dressedMaterial(mt: EqModelMaterial, code: string, outfit: Outfit): EqModelMaterial {
  const at = mt.texture ? texturePart(mt.texture, code) : null
  if (!at || !mt.texture) return mt
  const variant = outfit.wear[at.part] ?? 0
  const dressed = `${code.toLowerCase()}${at.part}0${String(variant)}${at.index}.bmp`
  const texture = variant > 0 && outfit.has(dressed) ? dressed : mt.texture
  const tint = outfit.wear.tint?.[at.part]
  return tint ? { ...mt, texture, tint } : { ...mt, texture }
}

function dress(mesh: EqModelMesh, code: string, outfit: Outfit): EqModelMesh {
  const helmTint = outfit.wear.tint?.helm
  const isHelm = /HE0[1-9]_DMSPRITEDEF$/.test(mesh.name)
  return {
    ...mesh,
    materials: mesh.materials.map((mt) => (isHelm && helmTint ? { ...mt, tint: helmTint } : dressedMaterial(mt, code, outfit)))
  }
}

/** The skeleton an actor's name resolves to: `<CODE>_HS_DEF` is the 0x10 the 0x11 points at. */
export function skeletonOf(wld: WldFile, code: string): Skeleton | null {
  const named = wld.byName.get(`${code}_HS_DEF`)
  const direct = named?.type === 0x10 ? named : undefined
  const viaRef = named?.type === 0x11 ? fragmentAt(wld, named.body.readInt32LE(4), 0x10) : undefined
  const frag = direct ?? viaRef
  return frag ? readSkeleton(wld, frag) : null
}

/**
 * The meshes an actor could draw: the skeleton's own list, plus the helm head found by NAME -
 * the list carries the body and the bare head only (measured on this archive).
 */
export function meshCandidates(wld: WldFile, skeleton: Skeleton, code: string, helm: number): Fragment[] {
  const out: Fragment[] = []
  for (const ref of skeleton.meshRefs) {
    const mr = fragmentAt(wld, ref, 0x2d)
    const mesh = mr ? fragmentAt(wld, mr.body.readInt32LE(4), 0x36) : undefined
    if (mesh) out.push(mesh)
  }
  const helmFrag = wld.byName.get(`${code}HE0${String(helm)}_DMSPRITEDEF`)
  if (helmFrag?.type === 0x36 && !out.includes(helmFrag)) out.push(helmFrag)
  return out
}

/** The bone tree with each bone's bind transform, for a renderer that skins. */
function boneList(skeleton: Skeleton): EqModelBone[] {
  const bones: EqModelBone[] = skeleton.bones.map((b) => ({ name: b.name, parent: -1, t: b.local.t, q: b.local.q }))
  skeleton.bones.forEach((bone, i) => {
    for (const c of bone.children) bones[c].parent = i
  })
  return bones
}

/** Read one actor ("BAF") out of a WLD as a posed, dressed model. Returns null when the actor is absent. */
export function readCharacter(wld: WldFile, code: string, outfit: Outfit = BARE): CharacterModel | null {
  const upper = code.toUpperCase()
  const actor = wld.byName.get(`${upper}_ACTORDEF`)
  const skeleton = actor?.type === 0x14 ? skeletonOf(wld, upper) : null
  if (!actor || !skeleton) return null
  const world = bindPose(skeleton)
  const helm = outfit.wear.helm ?? 0
  const candidates = meshCandidates(wld, skeleton, upper, helm)
  const drawn = drawnMeshes(candidates.map((m) => m.name), upper, helm)
  const meshes: EqModelMesh[] = []
  for (const mesh of candidates) if (drawn.has(mesh.name)) meshes.push(dress(readMesh(wld, mesh, world), upper, outfit))
  return { actor: actor.name, bones: boneList(skeleton), meshes, skeleton }
}
