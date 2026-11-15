// figureMounts.ts - WHERE THINGS HANG ON THE FIGURE (EQ Zera, 2026-11-15; split out of
// CharacterModel3D.tsx at its file-length ceiling): the bone a held item or a Luclin armour piece
// hangs off, the Luclin grip turn for a held item, and the hung armour pieces themselves.

import * as THREE from 'three'
import type { EqModelMesh, EqModelPayload, EqModelWeapon } from '@shared/eqModel'

/**
 * The bone an item hangs off, BY EXACT NAME FIRST: a Luclin rig also carries `HUMHAIR_POINT_DAG`,
 * `HUMSHOULDR_POINT_DAG` and `HUMGAUNTR_POINT_DAG`, all of which END in `R_POINT_DAG`, and the hair
 * comes first - a suffix match hung the sword off the scalp. The suffix stays as the fallback.
 */
export function attachBone(skeleton: THREE.Skeleton, actor: string, attach: string): THREE.Bone | undefined {
  const exact = `${actor.replace(/_ACTORDEF$/, '')}${attach}_DAG`
  return skeleton.bones.find((b) => b.name === exact) ?? skeleton.bones.find((b) => b.name.endsWith(`${attach}_DAG`))
}

/** Where a held item hangs: the bone itself, or a child turned by the Luclin grip correction (shared/eqModel.ts `grip`). */
export function gripMount(bone: THREE.Bone, grip: EqModelWeapon['grip']): THREE.Object3D {
  if (!grip) return bone
  const mount = new THREE.Group()
  mount.quaternion.set(grip[0], grip[1], grip[2], grip[3])
  bone.add(mount)
  return mount
}

/**
 * THE LUCLIN PIECES THAT HANG (helm, shoulders, wrists, boots): rigid off their named point bones,
 * moving with them and never spun. (The breastplate, flaps, belts, robe skirts and hair arrive
 * already skinned among the body meshes.) `build` makes the mesh with the figure's own materials.
 */
export function hangPieces(model: EqModelPayload, skeleton: THREE.Skeleton, build: (mesh: EqModelMesh) => THREE.Mesh): void {
  for (const p of model.pieces ?? []) {
    const bone = attachBone(skeleton, model.actor, p.attach)
    if (bone) bone.add(build(p.mesh))
  }
}
