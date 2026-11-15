// eqassets/wldPose.ts - IS THIS CLIP A STANDING IDLE? (EQ Zera, 2026-11-15; the Luclin models).
//
// The classic suite asserts every actor's idle "stands with its arms down at its sides"
// (tests/eqAssets.test.mts). The Luclin archives made that a RUNTIME question, because `P01` is
// not reliably a standing idle there. MEASURED as the worst angle over every frame, degrees off
// straight down (arms, thighs) or straight up (spine):
//   - IKF P01 holds a deep crouch: thigh 61.
//   - IKM P01 has one arm out: 55 against 28, a spread of 29.
//   - BAF P01A has one arm out (41 / 62).
//   - P08 is the clean stand on every one of them (IKF 30/29 arms, 24/30 thighs, spine 9).
// So the idle is CHOSEN: the first candidate clip that passes `standsIdle` on every frame wins,
// and an actor nothing passes for stands still in its bind pose rather than in a broken one.

import type { EqModelClip } from '../../shared/eqModel'
import type { Skeleton, WldFile } from './wld'
import { boneShortName, readAnimationOrLent, type AnimLender } from './wldAnim'

type Q = readonly number[]

function qmul(a: Q, b: Q): number[] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ]
}

function qrot(q: Q, v: Q): number[] {
  const [x, y, z, w] = q
  const ix = w * v[0] + y * v[2] - z * v[1]
  const iy = w * v[1] + z * v[0] - x * v[2]
  const iz = w * v[2] + x * v[1] - y * v[0]
  const iw = -x * v[0] - y * v[1] - z * v[2]
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]
}

/** Every bone's world orientation at one frame; a bone with no track holds its bind pose. */
function poseAt(skeleton: Skeleton, clip: EqModelClip, frame: number): number[][] {
  const out: number[][] = skeleton.bones.map(() => [0, 0, 0, 1])
  const visit = (i: number, parent: Q): void => {
    const track = clip.tracks[i]
    const f = track ? Math.min(frame, track.q.length / 4 - 1) : 0
    out[i] = qmul(parent, track ? track.q.slice(f * 4, f * 4 + 4) : skeleton.bones[i].local.q)
    for (const c of skeleton.bones[i].children) visit(c, out[i])
  }
  if (skeleton.bones.length > 0) visit(0, [0, 0, 0, 1])
  return out
}

/** One limb: the bone, the child it points at, and whether it should point UP (the spine) rather than down. */
interface Limb {
  bone: string
  child: string
  up?: boolean
}

/** The Luclin rig's limbs, by short bone name (measured on all 26 actors). */
const ARM_L: Limb = { bone: 'BIBICEPL', child: 'FOFOREARML' }
const ARM_R: Limb = { bone: 'BIBICEPR', child: 'FOFOREARMR' }
const THIGH_L: Limb = { bone: 'THTHIGHL', child: 'CACALFL' }
const THIGH_R: Limb = { bone: 'THTHIGHR', child: 'CACALFR' }
const SPINE: Limb = { bone: 'CHCHEST2', child: 'NENECK', up: true }

/** The pass marks, degrees. The classic suite's 60 for an arm; tighter for legs and spine, which is what a crouch fails. */
const ARM_MAX = 60
const ARM_SPREAD_MAX = 20
const THIGH_MAX = 45
const SPINE_MAX = 30

/** Limb angle off straight down (or up), in degrees; null when the rig lacks the limb. */
function limbAngle(skeleton: Skeleton, short: readonly string[], pose: readonly Q[], limb: Limb): number | null {
  const i = short.indexOf(limb.bone)
  const c = i < 0 ? undefined : skeleton.bones[i].children.find((k) => short[k] === limb.child)
  if (c === undefined) return null
  const v = qrot(pose[i], skeleton.bones[c].local.t)
  const n = Math.hypot(v[0], v[1], v[2])
  if (n < 1e-9) return null
  return (Math.acos(Math.max(-1, Math.min(1, ((limb.up === true ? 1 : -1) * v[2]) / n))) * 180) / Math.PI
}

/** Does one frame stand: both arms down and agreeing, both thighs under the body, the spine upright? */
function frameStands(skeleton: Skeleton, short: readonly string[], pose: readonly Q[]): boolean {
  const [l, r, tl, tr, sp] = [ARM_L, ARM_R, THIGH_L, THIGH_R, SPINE].map((limb) => limbAngle(skeleton, short, pose, limb))
  if (l === null || r === null || tl === null || tr === null || sp === null) return false
  return l < ARM_MAX && r < ARM_MAX && Math.abs(l - r) <= ARM_SPREAD_MAX && tl < THIGH_MAX && tr < THIGH_MAX && sp < SPINE_MAX
}

/** True when EVERY frame of `clip` stands at idle on this (Luclin) rig. */
export function standsIdle(skeleton: Skeleton, code: string, clip: EqModelClip): boolean {
  const short = skeleton.bones.map((b) => boneShortName(b.name, code))
  for (let f = 0; f < clip.frames; f++) if (!frameStands(skeleton, short, poseAt(skeleton, clip, f))) return false
  return true
}

/** A rig posed by a clip (or its bind pose when the clip is null). */
export interface PosedRig {
  skeleton: Skeleton
  code: string
  clip: EqModelClip | null
}

/** A bone's world orientation at the clip's middle frame, by its full name; null when the rig lacks it. */
function midWorld(rig: PosedRig, bone: string): number[] | null {
  const i = rig.skeleton.bones.findIndex((b) => b.name === bone)
  if (i < 0) return null
  const clip: EqModelClip = rig.clip ?? { name: 'bind', frameMs: 100, frames: 1, tracks: {} }
  return poseAt(rig.skeleton, clip, Math.floor(clip.frames / 2))[i]
}

/**
 * THE LUCLIN GRIP (owner, 2026-11-15: "the sword points sideways instead of up as on classic").
 * The Luclin rigs orient their `R_POINT` / `L_POINT` / `SHIELD_POINT` differently from the classic
 * ones, and by a different amount per race (measured: no single correction fits - HUM needs
 * 0.40,-0.56,-0.03,0.73, OGM -0.22,-0.51,-0.51,0.65), so a held item hung off the Luclin bone as is
 * points out of the hand. The correction is the rotation that puts the item, at the middle of the
 * Luclin idle, exactly where the CLASSIC figure of the same actor holds it at the middle of its
 * idle: inverse(Luclin point) * classic point, applied as the item's own rotation on the bone, so
 * it then moves with the Luclin hand. Null when either rig lacks the point.
 */
export function gripCorrection(luclin: PosedRig, classic: PosedRig, attach: string): [number, number, number, number] | null {
  const lq = midWorld(luclin, `${luclin.code}${attach}_DAG`)
  const cq = midWorld(classic, `${classic.code}${attach}_DAG`)
  if (!lq || !cq) return null
  const c = qmul([-lq[0], -lq[1], -lq[2], lq[3]], cq)
  return [c[0], c[1], c[2], c[3]]
}

/**
 * The clips tried for a Luclin idle, in order: the standing idle's two variants, then `P08`, the
 * clean stand the measurement above found on the actors whose `P01` fails.
 */
export const LUCLIN_IDLE_CANDIDATES = ['P01A', 'P01B', 'P08A', 'P08B'] as const

/**
 * THE LUCLIN IDLE: the actor's own candidates first, then each lender's in order (rotations only,
 * marked borrowed), and the first that `standsIdle` wins. Null = stand in the bind pose.
 */
export function luclinIdle(target: { wld: WldFile; code: string; skeleton: Skeleton }, lenders: readonly AnimLender[]): EqModelClip | null {
  for (const source of [null, ...lenders]) {
    for (const anim of LUCLIN_IDLE_CANDIDATES) {
      const lender = source ?? { wld: target.wld, code: target.code }
      const clip = readAnimationOrLent(target, anim, lender)
      if (clip && (source === null || clip.name.endsWith('*')) && standsIdle(target.skeleton, target.code, clip)) return clip
    }
  }
  return null
}
