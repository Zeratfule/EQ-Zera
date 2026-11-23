// eqassets/wldItem.ts — AN ITEM MODEL OUT OF A WLD (EQ Zera, 2026-09-06; the character-model
// spike). The weapons and held things live in gequip*.s3d as `IT<n>` actors. This reads one as a
// single rigid mesh the renderer hangs off a hand bone; wld.ts owns the fragment, mesh and
// skeleton readers this borrows.

import { bindPose, compose, fragmentAt, IDENTITY, meshCandidates, readMesh, skeletonOf, type Skeleton, type WldFile, type Xform } from './wld'
import type { EqModelMesh } from '../../shared/eqModel'

/**
 * Read an item model ("IT1") as ONE rigid mesh. Most items are a 0x14 actor whose refs go
 * straight to a 0x2D mesh ref; the later ones (an orb on its stand, IT10512) hang their meshes
 * off a small skeleton of their own, and those are posed at bind and flattened. Returns null
 * when the archive has no such actor or mesh.
 */
export function readItem(wld: WldFile, code: string): EqModelMesh | null {
  const upper = code.toUpperCase()
  const actor = wld.byName.get(`${upper}_ACTORDEF`)
  if (actor?.type !== 0x14) return null
  // The mesh is named after the actor; the actor's own ref list is the fallback route.
  const named = wld.byName.get(`${upper}_DMSPRITEDEF`)
  if (named?.type === 0x36) return readMesh(wld, named, [])
  for (const f of wld.fragments) {
    if (f.type !== 0x2d || !f.name.startsWith(`${upper}_`)) continue
    const mesh = fragmentAt(wld, f.body.readInt32LE(4), 0x36)
    if (mesh) return readMesh(wld, mesh, [])
  }
  return readSkeletalItem(wld, upper)
}

/** An item drawn off its own skeleton: every mesh in the skeleton's list, posed at bind, as one rigid mesh. */
function readSkeletalItem(wld: WldFile, upper: string): EqModelMesh | null {
  const skeleton = skeletonOf(wld, upper)
  if (!skeleton) return null
  const world = bindPose(skeleton)
  const parts: EqModelMesh[] = []
  for (const frag of meshCandidates(wld, skeleton, upper, 0)) parts.push(readMesh(wld, frag, world))
  return parts.length > 0 ? { ...mergeMeshes(`${upper}_DMSPRITEDEF`, parts), rigged: true, skinIndices: [] } : null
}

/** Several posed meshes as one rigid mesh: vertices, indices and material groups re-based in turn. */
function mergeMeshes(name: string, parts: readonly EqModelMesh[]): EqModelMesh {
  const out: EqModelMesh = { name, positions: [], normals: [], uvs: [], indices: [], groups: [], materials: [], skinIndices: [] }
  for (const p of parts) {
    const vertexBase = out.positions.length / 3
    const indexBase = out.indices.length
    const materialBase = out.materials.length
    for (const v of p.positions) out.positions.push(v)
    for (const n of p.normals) out.normals.push(n)
    for (const t of p.uvs) out.uvs.push(t)
    for (const i of p.indices) out.indices.push(i + vertexBase)
    for (const g of p.groups) out.groups.push({ materialIndex: g.materialIndex + materialBase, start: g.start + indexBase, count: g.count })
    for (const m of p.materials) out.materials.push(m)
    for (const b of p.skinIndices) out.skinIndices.push(b)
  }
  return out
}

/** The character a worn piece is skinned onto: its skeleton, its actor code and its bind pose. */
export interface WearerRig {
  skeleton: Skeleton
  code: string
  world: readonly Xform[]
}

/**
 * A LUCLIN ARMOUR PIECE THAT IS SKINNED, NOT HUNG (2026-11-15): the breastplate, tunic flaps,
 * belts, robe skirts and hair in lgequip*.s3d carry a skeleton of their OWN that repeats the
 * wearer's bone names (`IT6360CHCHEST_DAG`, `IT4363ROBEPOINT04_DAG`, `IT1360HEHAIR1_DAG`), and the
 * client deforms them with the wearer's bones of the same name. So each item bone is matched to the
 * wearer's bone BY NAME, the vertices are posed through the WEARER's bind pose, and the mesh comes
 * back with the wearer's bone indices - ready to skin and animate exactly like the body. Null when
 * the item has no skeleton (a helm, a shoulder pad: those hang rigid off a point bone).
 *
 * THE ITEM'S ROOT IS ITS ATTACH POINT, NOT THE WEARER'S ROOT (2026-11-23, owner: "the hair is being
 * stretched down to the crotch"). Measured on all 26 Luclin actors: every skinned piece's own
 * skeleton is rooted at the wearer's `<attach>_POINT` bone (HAIR_POINT, CHEST_POINT, TUNIC_POINT,
 * PELVIS_POINT) - its matched bones sit exactly that far from it. The breastplate, flaps, belts and
 * skirts put no vertex on that root, so mapping it to the wearer's root never showed; a hair piece
 * puts most of its vertices there (65 of 88 on HUM), and they landed at the body root - the
 * crotch - stretched up to the few on the HEHAIR bones. So the unmatched root takes the attach
 * bone, and every unmatched bone below it (`NULL`, a beard bone this rig lacks) is posed through
 * the ITEM's own chain from there, skinned to its nearest matched ancestor.
 */
export function readWornPiece(wld: WldFile, code: string, wearer: WearerRig, attach?: string): EqModelMesh | null {
  const upper = code.toUpperCase()
  const skeleton = skeletonOf(wld, upper)
  if (!skeleton) return null
  const mine = wearer.skeleton.bones.map((b) => b.name)
  const parent = new Array<number>(skeleton.bones.length).fill(-1)
  skeleton.bones.forEach((b, i) => {
    for (const c of b.children) parent[c] = i
  })
  const point = attach === undefined ? -1 : mine.indexOf(`${wearer.code}${attach}_DAG`)
  const map = new Array<number>(skeleton.bones.length).fill(0)
  const world = new Array<Xform>(skeleton.bones.length).fill(IDENTITY)
  // Parents first: walk the item's tree down from each root.
  const visit = (i: number): void => {
    const b = skeleton.bones[i]
    const short = b.name.startsWith(upper) ? b.name.slice(upper.length).replace(/_DAG$/, '') : ''
    // The root's short name is empty, which would match the WEARER's root (`IT1360_DAG` -> `HUM_DAG`).
    const at = parent[i] < 0 && point >= 0 ? point : mine.indexOf(`${wearer.code}${short}_DAG`)
    if (at >= 0) {
      map[i] = at
      world[i] = wearer.world[at]
    } else {
      const up = parent[i] >= 0 ? parent[i] : -1
      map[i] = up >= 0 ? map[up] : point >= 0 ? point : 0
      world[i] = compose(up >= 0 ? world[up] : wearer.world[map[i]], b.local)
    }
    for (const c of b.children) visit(c)
  }
  skeleton.bones.forEach((_b, i) => {
    if (parent[i] < 0) visit(i)
  })
  const frags = meshCandidates(wld, skeleton, upper, 0)
  const named = wld.byName.get(`${upper}_DMSPRITEDEF`)
  if (named?.type === 0x36 && !frags.includes(named)) frags.push(named)
  const parts = frags.map((f) => readMesh(wld, f, world)).map((m) => ({ ...m, skinIndices: m.skinIndices.map((i) => map[i] ?? 0) }))
  return parts.length > 0 ? mergeMeshes(`${upper}_DMSPRITEDEF`, parts) : null
}
