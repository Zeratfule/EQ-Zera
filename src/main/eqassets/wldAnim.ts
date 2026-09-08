// eqassets/wldAnim.ts — READ AN ANIMATION OUT OF A CLASSIC `.wld` (EQ Zera, 2026-09-06;
// character-model spike, phase 3).
//
// An animation is one 0x12 track per bone, named `<ANIM><RACE><BONE>_TRACKDEF` where `<BONE>` is
// the bone's short name (`BAFBI_L_DAG` → `BI_L`) — measured on this client's global_chr.wld:
// `P01` is the standing idle, `L01`/`L02` walking and running. Each track is N frames of the same
// translation + quaternion the bind pose uses (wld.ts `trackFrameAt`), and the matching 0x13
// reference carries the frame delay in milliseconds when its low flag is set.
//
// THE BORROW, AND THE ONE THING IT MUST NOT CARRY (v1.19.1). This archive carries the idle for a
// handful of actors only; the rest ship walk cycles but no `P01`. Their skeletons name their bones
// identically (`PE`, `CH`, `BI_L`, …), so a race without its own idle borrows another actor's
// bone-for-bone BY NAME — an approximation stated here and reported in the clip's name (`P01*`),
// never a silent substitution. A target bone the source clip does not name keeps its bind pose;
// nothing is ever matched by INDEX, because two rigs agree about names and never about order.
//
// A BORROWED CLIP GIVES ROTATIONS ONLY, AND THAT IS THE WHOLE BUG OF 1.19.0. Each 0x12 frame holds
// a TRANSLATION as well as a quaternion, and the translation is the bone's OFFSET FROM ITS PARENT —
// i.e. that rig's own limb lengths. Copying a human male's offsets onto another skeleton rebuilds
// the figure at human proportions with the target's own mesh still bound to it, which is what the
// owner saw: "stretched and contorted bodies", worst on the rigs furthest from a human male.
// MEASURED, as the largest per-bone offset the borrow would have moved, over the figure's height:
// own clips 0.03-0.14; borrowed human-proportioned males 0.03-0.05; every borrowing FEMALE
// 0.18-0.19; Troll male 0.24, Ogre male 0.25, Halfling male 0.22, Gnome male 0.22. So a borrowed
// track keeps the TARGET's own bind translation and takes only the source's rotation - the idle is
// a pose, and a pose is rotations.
//
// AND A RACE LOOKS TO ITS OWN KIND FIRST. The Iksar live in global4_chr.s3d, which carries no human
// at all: before this, the Iksar female matched nothing and stood in her BIND pose ("stuck in
// spread eagle"). The order is own → the same race's other sex → human, so she borrows IKM.

import type { EqModelClip, EqModelTrack } from '../../shared/eqModel'
import { fragmentAt, TRACK_FRAMES_AT, TRACK_FRAME_BYTES, trackFrameAt, type Bone, type Skeleton, type WldFile } from './wld'

const DEFAULT_FRAME_MS = 100
const HUMAN = 'HUM'

/** The same race's other sex (`IKF` → `IKM`), or null for a code that names no sex. */
function otherSex(code: string): string | null {
  const sex = code.slice(-1)
  if (sex === 'M') return `${code.slice(0, -1)}F`
  return sex === 'F' ? `${code.slice(0, -1)}M` : null
}

/** A bone's OWN bind offset, repeated once per frame: what a borrowed track keeps instead of the source's. */
function bindTranslations(bone: Bone, frames: number): number[] {
  const out: number[] = []
  for (let f = 0; f < frames; f++) out.push(bone.local.t[0], bone.local.t[1], bone.local.t[2])
  return out
}

/** `BAFBI_L_DAG` → `BI_L`; the root `BAF_DAG` → `` (its track is `P01BAF_TRACKDEF`). */
export function boneShortName(bone: string, code: string): string {
  return bone.startsWith(code) ? bone.slice(code.length).replace(/_DAG$/, '') : bone.replace(/_DAG$/, '')
}

/** Every frame of a 0x12 track, flattened. */
function readTrack(body: Buffer): EqModelTrack {
  const frames = body.readUInt32LE(8)
  const t: number[] = []
  const q: number[] = []
  for (let f = 0; f < frames; f++) {
    const x = trackFrameAt(body, TRACK_FRAMES_AT + f * TRACK_FRAME_BYTES)
    t.push(...x.t)
    q.push(...x.q)
  }
  return { t, q }
}

/** The frame delay a 0x13 reference states, when it states one. */
function frameMsOf(wld: WldFile, name: string): number | null {
  const ref = wld.byName.get(name)
  if (ref?.type !== 0x13 || ref.body.length < 16) return null
  return ref.body.readUInt32LE(8) & 1 ? ref.body.readUInt32LE(12) : null
}

/**
 * The clip `anim` for a skeleton, tracks by bone index. Bones without a track hold their bind
 * pose. Returns null when neither the race nor the human fallback has the animation at all.
 */
export function readAnimation(wld: WldFile, code: string, skeleton: Skeleton, anim: string): EqModelClip | null {
  const has = (actor: string): boolean => wld.byName.has(`${anim}${actor}_TRACKDEF`) || wld.byName.has(`${anim}${actor}PE_TRACKDEF`)
  const source = [code, otherSex(code), HUMAN].find((a) => a !== null && has(a)) ?? null
  if (source === null || source === undefined) return null
  const borrowed = source !== code
  const tracks: Record<number, EqModelTrack> = {}
  let frames = 1
  let frameMs: number | null = null
  skeleton.bones.forEach((bone, i) => {
    const short = boneShortName(bone.name, code)
    const def = wld.byName.get(`${anim}${source}${short}_TRACKDEF`)
    if (def?.type !== 0x12) return
    const track = readTrack(def.body)
    const count = track.q.length / 4
    tracks[i] = borrowed ? { t: bindTranslations(bone, count), q: track.q } : track
    frames = Math.max(frames, count)
    frameMs ??= frameMsOf(wld, `${anim}${source}${short}_TRACK`)
  })
  if (Object.keys(tracks).length === 0) return null
  return { name: borrowed ? `${anim}*` : anim, frameMs: frameMs ?? DEFAULT_FRAME_MS, frames, tracks }
}

export { fragmentAt }
