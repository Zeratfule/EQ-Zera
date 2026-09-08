// eqassets/wldItem.ts — AN ITEM MODEL OUT OF A WLD (EQ Zera, 2026-09-06; the character-model
// spike). The weapons and held things live in gequip*.s3d as `IT<n>` actors. This reads one as a
// single rigid mesh the renderer hangs off a hand bone; wld.ts owns the fragment, mesh and
// skeleton readers this borrows.

import { bindPose, fragmentAt, meshCandidates, readMesh, skeletonOf, type WldFile } from './wld'
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
  return parts.length > 0 ? { ...mergeMeshes(`${upper}_DMSPRITEDEF`, parts), rigged: true } : null
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
  }
  return out
}
