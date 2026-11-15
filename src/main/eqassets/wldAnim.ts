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
// AND THE DONOR IS CHOSEN, NOT HARD-CODED - which is the rest of the 1.19.0 bug (owner, 1.19.1:
// "human, barbarian, erudite, high elf, dark elf, half elf, halfling and gnome FEMALE models are
// doing weird things with their arms"). A track holds a bone's orientation RELATIVE TO ITS PARENT,
// so transplanting it says "stand as this actor stands" and is exact only between rigs that REST
// the same way. Every female rig rests differently from HUM, and so do the short and the huge
// males, so borrowing HUM put the arms where a human's local rotations point on a female chest:
// MEASURED as the angle of the upper arm off straight-down, over a female rig, at mid-idle -
// donor HUM 96 degrees (straight out sideways), donor ELF 34 degrees, which is ELF's own idle to
// the degree. Halfling/gnome males borrowing HUM came out at 44/17 (lopsided) against DWM's 46/42.
//
// So the donor is RANKED by bone table, best first, and the ranking is a tuple compared left to
// right: same sex, then same race, then how much of this rig's skeleton the donor covers, then how
// far the two agree about which bone hangs off which, then the fewest donor bones this rig does not
// have (a donor bone missing here means a child hangs off a different parent - the halflings' and
// gnomes' legs). Same sex outranks same race deliberately: HUM is a human female's own race and the
// worst donor she has. The Iksar female has no female donor at all in global4_chr.s3d, and the same
// race is the next rung, so she borrows IKM - which is also why she is no longer "stuck in spread
// eagle" with no clip at all.
//
// WHAT THE RANKING PICKS, measured, as the worst world-orientation error over every bone that
// carries geometry: HUF BAF ERF HIF DAF HAF -> ELF (0-2 degrees); HOF GNF -> OGF; HOM GNM TRM OGM
// -> DWM; ERM HIM DAM HAM -> ELM (9-14); IKF -> IKM (0). The only larger numbers anywhere are on
// the `*_POINT` attachment bones, which carry no geometry and whose rest orientation is per race.

import type { EqModelClip, EqModelTrack } from '../../shared/eqModel'
import { fragmentAt, skeletonOf, TRACK_FRAMES_AT, TRACK_FRAME_BYTES, trackFrameAt, type Bone, type Skeleton, type WldFile } from './wld'

const DEFAULT_FRAME_MS = 100

/** A donor must lend at least this much of the target's skeleton to be considered at all. */
const MIN_COVERAGE = 0.75

/** Every actor in this archive that carries `anim` of its own - the donor pool. */
function donorPool(wld: WldFile, anim: string): string[] {
  const named = new RegExp(`^${anim}([A-Z]{3})(PE)?_TRACKDEF$`)
  const out = new Set<string>()
  for (const name of wld.byName.keys()) {
    const actor = named.exec(name)?.[1]
    if (actor !== undefined && wld.byName.has(`${actor}_ACTORDEF`)) out.add(actor)
  }
  return [...out]
}

/** Each bone's PARENT, by the bone's own short name - how this rig says the skeleton hangs together. */
function parentNames(skeleton: Skeleton, code: string): Map<string, string> {
  const short = skeleton.bones.map((b) => boneShortName(b.name, code))
  const out = new Map<string, string>()
  skeleton.bones.forEach((bone, i) => {
    for (const child of bone.children) out.set(short[child], short[i])
  })
  return out
}

/**
 * HOW GOOD A DONOR IS FOR THIS RIG, as a tuple compared left to right (see the header for what each
 * rung is worth and what it was measured at). Null when the donor cannot cover enough of the rig
 * for the answer to be an idle at all.
 */
function donorRank(target: Skeleton, code: string, donor: Skeleton, actor: string): number[] | null {
  const mine = target.bones.map((b) => boneShortName(b.name, code))
  const theirs = new Set(donor.bones.map((b) => boneShortName(b.name, actor)))
  const shared = mine.filter((n) => theirs.has(n))
  if (shared.length < mine.length * MIN_COVERAGE) return null
  const myParent = parentNames(target, code)
  const theirParent = parentNames(donor, actor)
  const agreed = shared.filter((n) => (myParent.get(n) ?? '') === (theirParent.get(n) ?? '')).length
  return [
    // A PLAYER RACE'S ACTOR FIRST, and the archives say which those are by NAMING A SEX: the same
    // `global4_chr.s3d` that holds IKM also holds IKS, an undead Iksar whose skeleton covers the
    // Iksar female's bones slightly better and whose idle is a walking corpse's. Ranked on the
    // rungs below alone she borrowed IKS; a player character borrows a player character.
    /[MF]$/.test(actor) ? 1 : 0,
    code.slice(-1) === actor.slice(-1) ? 1 : 0,
    code.slice(0, 2) === actor.slice(0, 2) ? 1 : 0,
    shared.length / mine.length,
    agreed / shared.length,
    -(theirs.size - shared.length)
  ]
}

/** Tuples compared left to right: the first rung that differs decides. */
function outranks(a: readonly number[], b: readonly number[]): boolean {
  const at = a.findIndex((v, i) => v !== b[i])
  return at >= 0 && a[at] > b[at]
}

/** The best-ranked actor in this archive to borrow `anim` from, or null when nobody can lend it. */
function bestDonor(wld: WldFile, code: string, target: Skeleton, anim: string): string | null {
  let best: { actor: string; rank: number[] } | null = null
  for (const actor of donorPool(wld, anim)) {
    if (actor === code) continue
    const donor = skeletonOf(wld, actor)
    const rank = donor ? donorRank(target, code, donor, actor) : null
    if (rank && (best === null || outranks(rank, best.rank))) best = { actor, rank }
  }
  return best?.actor ?? null
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

/**
 * A rig in ANOTHER archive that may lend its clip (Half Dark Elf, 2026-11-15): the per-race
 * archives hold one actor each, so globalhdf_chr.s3d has no P01 and no neighbour to borrow from.
 * The lender is tried only when the actor's own WLD answers nothing, and it lends rotations only,
 * exactly like an in-archive donor.
 */
export interface AnimLender {
  wld: WldFile
  code: string
}

/**
 * Every frame of a 0x12 track, flattened. A scaled read (Luclin) ALWAYS carries the per-frame
 * scale, 1s included: a frame at 1 on a bone whose bind scale is not 1 is a real change the
 * renderer must play, and leaving `s` off would hold the bind scale instead.
 */
function readTrack(body: Buffer, scaled: boolean): EqModelTrack {
  const frames = body.readUInt32LE(8)
  const t: number[] = []
  const q: number[] = []
  const s: number[] = []
  for (let f = 0; f < frames; f++) {
    const x = trackFrameAt(body, TRACK_FRAMES_AT + f * TRACK_FRAME_BYTES, scaled)
    t.push(...x.t)
    q.push(...x.q)
    s.push(x.s ?? 1)
  }
  return scaled ? { t, q, s } : { t, q }
}

/** The frame delay a 0x13 reference states, when it states one. */
function frameMsOf(wld: WldFile, name: string): number | null {
  const ref = wld.byName.get(name)
  if (ref?.type !== 0x13 || ref.body.length < 16) return null
  return ref.body.readUInt32LE(8) & 1 ? ref.body.readUInt32LE(12) : null
}

/**
 * THE LUCLIN NAMING (2026-11-15). The per-actor Luclin archives (global<code>_chr.s3d) name a clip's
 * tracks `<ANIM><V><CODE><BONE>_TRACKDEF` - one more letter than the classic scheme, `V` the
 * clip's variant (`P01A`, `P01B`) - and the ROOT track is `<ANIM><V><CODE><ANIM><V>_<CODE>_TRACKDEF`
 * (`P01AIKMP01A_IKM_TRACKDEF`) rather than the classic `P01BAF_TRACKDEF`. Measured on all 26
 * classic-race actors: every animated one carries both P01A and P01B, 21 frames at 100 ms, one
 * track per bone; the idle read here is the `A` variant, `B` when an archive ever lacks it.
 */
const LUCLIN_VARIANTS = ['A', 'B'] as const

/** How a clip's tracks are named in one WLD: the classic scheme, or Luclin's with its variant letter. */
type TrackNaming = { scheme: 'classic' } | { scheme: 'luclin'; prefix: string }

/** The 0x12 name a bone's track carries under `naming` (`short` '' is the root). */
function trackName(naming: TrackNaming, anim: string, code: string, short: string): string {
  if (naming.scheme === 'classic') return `${anim}${code}${short}_TRACKDEF`
  const p = naming.prefix
  return short === '' ? `${p}${code}${p}_${code}_TRACKDEF` : `${p}${code}${short}_TRACKDEF`
}

/** Which naming this WLD uses for `anim` on `code`, or null when it carries the clip under neither. */
function namingOf(wld: WldFile, code: string, anim: string): TrackNaming | null {
  if (wld.byName.has(`${anim}${code}_TRACKDEF`) || wld.byName.has(`${anim}${code}PE_TRACKDEF`)) return { scheme: 'classic' }
  for (const v of LUCLIN_VARIANTS) {
    const prefix = `${anim}${v}`
    if (wld.byName.has(`${prefix}${code}${prefix}_${code}_TRACKDEF`) || wld.byName.has(`${prefix}${code}PEBIP01_TRACKDEF`)) return { scheme: 'luclin', prefix }
  }
  return null
}

/** Does this WLD carry `anim` for `code`, under either naming? */
function hasClip(wld: WldFile, code: string, anim: string): boolean {
  return namingOf(wld, code, anim) !== null
}

/**
 * HOW GOOD `donor` IS AT LENDING ITS CLIPS TO `target`, on the same ranking `bestDonor` uses inside
 * one archive (see the header). Exported so the Luclin lender table in ipc/eqModel.ts is pinned
 * against the ranking by a test rather than by hand; null when the donor covers too little.
 */
export function lenderRank(target: Skeleton, code: string, donor: Skeleton, actor: string): number[] | null {
  return donorRank(target, code, donor, actor)
}

/** True when rank `a` beats rank `b` (tuples compared left to right). */
export function rankBeats(a: readonly number[], b: readonly number[]): boolean {
  return outranks(a, b)
}

/**
 * The clip `anim` for a skeleton, tracks by bone index. Bones without a track hold their bind
 * pose. Returns null when neither the race nor the human fallback has the animation at all.
 */
export function readAnimation(wld: WldFile, code: string, skeleton: Skeleton, anim: string): EqModelClip | null {
  const source = hasClip(wld, code, anim) ? code : bestDonor(wld, code, skeleton, anim)
  return source === null ? null : clipFrom({ wld, code: source }, code, skeleton, anim)
}

/**
 * `readAnimation`, and when the actor's own WLD has nothing at all, the LENDER's clip from another
 * archive (rotations only, marked borrowed). See `AnimLender`.
 */
export function readAnimationOrLent(target: AnimLender & { skeleton: Skeleton }, anim: string, lender: AnimLender): EqModelClip | null {
  const { code, skeleton } = target
  const own = readAnimation(target.wld, code, skeleton, anim)
  if (own !== null || !hasClip(lender.wld, lender.code, anim)) return own
  return clipFrom(lender, code, skeleton, anim)
}

/** Read `anim` as `source.code` plays it in `source.wld`, onto `code`'s skeleton. */
function clipFrom(source: AnimLender, code: string, skeleton: Skeleton, anim: string): EqModelClip | null {
  const { wld } = source
  const naming = namingOf(wld, source.code, anim)
  if (naming === null) return null
  const borrowed = source.code !== code
  const tracks: Record<number, EqModelTrack> = {}
  let frames = 1
  let frameMs: number | null = null
  skeleton.bones.forEach((bone, i) => {
    const short = boneShortName(bone.name, code)
    const name = trackName(naming, anim, source.code, short)
    const def = wld.byName.get(name)
    if (def?.type !== 0x12) return
    const track = readTrack(def.body, wld.scaledTracks === true)
    const count = track.q.length / 4
    // A borrowed track is rotations only: the target keeps its own bind offsets AND its own bind
    // scale (no `s`, so the renderer holds what the skeleton states).
    tracks[i] = borrowed ? { t: bindTranslations(bone, count), q: track.q } : track
    frames = Math.max(frames, count)
    frameMs ??= frameMsOf(wld, name.replace(/DEF$/, ''))
  })
  if (Object.keys(tracks).length === 0) return null
  return { name: borrowed ? `${anim}*` : anim, frameMs: frameMs ?? DEFAULT_FRAME_MS, frames, tracks }
}

export { fragmentAt }
