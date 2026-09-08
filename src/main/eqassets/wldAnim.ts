// eqassets/wldAnim.ts — READ AN ANIMATION OUT OF A CLASSIC `.wld` (EQ Zera, 2026-09-06;
// character-model spike, phase 3).
//
// An animation is one 0x12 track per bone, named `<ANIM><RACE><BONE>_TRACKDEF` where `<BONE>` is
// the bone's short name (`BAFBI_L_DAG` → `BI_L`) — measured on this client's global_chr.wld:
// `P01` is the standing idle, `L01`/`L02` walking and running. Each track is N frames of the same
// translation + quaternion the bind pose uses (wld.ts `trackFrameAt`), and the matching 0x13
// reference carries the frame delay in milliseconds when its low flag is set.
//
// THE HUMAN FALLBACK. This archive carries the idle for humans only; the other races ship walk
// cycles but no `P01`. Their skeletons name their bones identically (`PE`, `CH`, `BI_L`, …), so a
// race without its own idle borrows the human one bone-for-bone — an approximation stated here
// and reported in the clip's name (`P01*`), never a silent substitution.

import type { EqModelClip, EqModelTrack } from '../../shared/eqModel'
import { fragmentAt, TRACK_FRAMES_AT, TRACK_FRAME_BYTES, trackFrameAt, type Skeleton, type WldFile } from './wld'

const DEFAULT_FRAME_MS = 100
const HUMAN = 'HUM'

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
  const own = `${anim}${code}`
  const has = (prefix: string): boolean => wld.byName.has(`${prefix}_TRACKDEF`) || wld.byName.has(`${prefix}PE_TRACKDEF`)
  const source = has(own) ? code : has(`${anim}${HUMAN}`) ? HUMAN : null
  if (source === null) return null
  const tracks: Record<number, EqModelTrack> = {}
  let frames = 1
  let frameMs: number | null = null
  skeleton.bones.forEach((bone, i) => {
    const short = boneShortName(bone.name, code)
    const def = wld.byName.get(`${anim}${source}${short}_TRACKDEF`)
    if (def?.type !== 0x12) return
    const track = readTrack(def.body)
    tracks[i] = track
    frames = Math.max(frames, track.q.length / 4)
    frameMs ??= frameMsOf(wld, `${anim}${source}${short}_TRACK`)
  })
  if (Object.keys(tracks).length === 0) return null
  return { name: source === code ? anim : `${anim}*`, frameMs: frameMs ?? DEFAULT_FRAME_MS, frames, tracks }
}

export { fragmentAt }
