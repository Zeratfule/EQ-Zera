// eqassets/luclinArmour.ts - WHAT A LUCLIN FIGURE WEARS AS 3D PIECES (EQ Zera, 2026-11-15).
//
// On the Luclin models the client draws helms, breastplates, shoulders, wrists, boots, tunic flaps,
// belts, robe skirts and hair as ITEM MODELS hung off the skeleton's `*_POINT` bones, numbered by a
// per-race/sex offset. The rule comes from three open-source reverse-engineerings of the RoF2 client
// (Hailstone `actor_look.cpp` / `docs/formats/characters.md`, Gnomebrew `render/character_model.cpp`,
// rof2ClientPlus `npc_model_swap.cpp`), and every number below was checked against the actors that
// really exist in this install's lgequip_amr*.s3d / lgequip*.s3d (tests/eqAssetsLuclinArmour.test.mts):
//
//   hair        IT(1000 + offset)          HAIR_POINT     style 0; dropped under a helm
//   helm        IT(5000 + offset + id)     HEAD_POINT     id: leather 1, chain 2, plate 28
//                                                        (Iksar 3, Barbarian 29); cloth 0 exists
//                                                        for the Erudite only
//   breastplate IT(6000 + offset)          CHEST_POINT    plate chest only
//   tunic flap  IT(4010 + offset + m)      TUNIC_POINT    m = chest material; only some exist
//                                                        (no plate flap anywhere), none for a
//                                                        female gnome in leather
//   belt        IT(4020 + offset + m)      PELVIS_POINT   m = legs material; sparse
//   shoulders   IT(7000 + offset + 2m), +1 SHOULDR/L      arms slot; only plate (+6/+7) exists
//   wrists      IT(8000 + offset + 2m), +1 GAUNTR/L       wrist slot; only plate exists
//   boots       IT(9000 + offset + 2m), +1 LEGR/L         feet slot; only plate exists
//   robe skirt  IT(4000 + offset + m - 10) TUNIC_POINT    chest material 10-16; while a robe is
//                                                        worn nothing but the robe and the helm
//                                                        attach, and an Erudite's robe is its hood
//
// A piece the archive does not have is simply not drawn. Every piece takes its slot's dye.
// PURE: names and numbers only; ipc/eqModel.ts reads the meshes.

import type { EqModelWear, RobeMaterial, Tint, WearPart } from '../../shared/eqModel'

/** The per-race offset (male; a female is 30 on). Vah Shir 600 and Froglok 840 have no Luclin archive here. */
export const LUCLIN_IT_OFFSET: Readonly<Record<string, number>> = {
  GN: 0,
  HA: 60,
  DW: 120,
  DA: 180,
  EL: 240,
  HI: 300,
  HU: 360,
  IK: 420,
  ER: 480,
  BA: 540,
  TR: 660,
  OG: 720,
  HO: 780
}

/** The races whose Luclin archive carries robe textures (ch10-ch16): measured, the classic caster races plus the Iksar. */
export const ROBE_RACES: ReadonlySet<string> = new Set(['HU', 'ER', 'HI', 'DA', 'GN', 'IK'])

/** A robe's chest material, 10..16; anything else is not a robe. */
export function isRobe(m: unknown): m is RobeMaterial {
  return typeof m === 'number' && Number.isInteger(m) && m >= 10 && m <= 16
}

/** One piece to hang: the item actor, the bone suffix it hangs off, and its dye. */
export interface LuclinPiece {
  it: string
  attach: string
  tint?: Tint
}

/** What the Luclin figure wears: the body texture wear to dress the mesh with, and the pieces to hang. */
export interface LuclinDress {
  wear: EqModelWear
  pieces: LuclinPiece[]
}

export function luclinOffset(code: string): number | null {
  const base = LUCLIN_IT_OFFSET[code.slice(0, 2)]
  return base === undefined ? null : base + (code.endsWith('F') ? 30 : 0)
}

/** The helm id within the block for a helm material (cloth 0, leather 1, chain 2, plate 3). */
function helmId(race: string, helm: number): number {
  if (helm < 3) return helm
  if (race === 'IK') return 3
  return race === 'BA' ? 29 : 28
}

type Has = (it: string) => boolean

/** A piece when the archive has it, with the slot's dye. */
function piece(has: Has, n: number, attach: string, tint: Tint | undefined): LuclinPiece[] {
  const it = `IT${String(n)}`
  if (!has(it)) return []
  return [tint ? { it, attach, tint } : { it, attach }]
}

/** One slot's plate pair (shoulders, wrists, boots): its base number and its right/left point bones. */
interface PairSlot {
  base: number
  part: 'ua' | 'fa' | 'ft'
  points: readonly [string, string]
}

const PAIRS: readonly PairSlot[] = [
  { base: 7000, part: 'ua', points: ['SHOULDR_POINT', 'SHOULDL_POINT'] },
  { base: 8000, part: 'fa', points: ['GAUNTR_POINT', 'GAUNTL_POINT'] },
  { base: 9000, part: 'ft', points: ['LEGR_POINT', 'LEGL_POINT'] }
]

/** The plate pair for one slot: right then left, only for plate (the only pair the archives carry). */
function platePair(has: Has, off: number, slot: PairSlot, wear: EqModelWear): LuclinPiece[] {
  const m = wear[slot.part]
  if (m !== 3) return []
  const tint = wear.tint?.[slot.part]
  return [...piece(has, slot.base + off + 2 * m, slot.points[0], tint), ...piece(has, slot.base + off + 2 * m + 1, slot.points[1], tint)]
}

/** The body-texture wear under a robe: chest, arms and wrists take the robe's number and the chest's dye. */
function robeWear(wear: EqModelWear, robe: RobeMaterial): EqModelWear {
  const tint: Partial<Record<WearPart | 'helm', Tint>> = { ...wear.tint }
  delete tint.ua
  delete tint.fa
  const t = wear.tint?.ch
  if (t) Object.assign(tint, { ua: t, fa: t })
  return { ...wear, ch: robe, ua: robe, fa: robe, tint }
}

/** The wear with the chest left at its base look and undyed: what lies under a breastplate. */
function withoutChest(wear: EqModelWear): EqModelWear {
  const body: EqModelWear = { ...wear }
  delete body.ch
  if (body.tint) {
    body.tint = { ...body.tint }
    delete body.tint.ch
  }
  return body
}

/** The helm when one is worn (an Erudite's robe is its hood), else the hair the race has. */
function headPieces(has: Has, { code, off }: { code: string; off: number }, wear: EqModelWear, robed: boolean): LuclinPiece[] {
  const race = code.slice(0, 2)
  const helm = wear.helm !== undefined && !(race === 'ER' && robed) ? piece(has, 5000 + off + helmId(race, wear.helm), 'HEAD_POINT', wear.tint?.helm) : []
  return helm.length > 0 ? helm : piece(has, 1000 + off, 'HAIR_POINT', undefined)
}

/** Everything but the head when no robe is worn: breastplate, tunic flap, belt and the plate pairs. */
function bodyPieces(has: Has, code: string, off: number, wear: EqModelWear): LuclinPiece[] {
  const tint = wear.tint ?? {}
  const m = wear.ch ?? 0
  const out: LuclinPiece[] = m === 3 ? piece(has, 6000 + off, 'CHEST_POINT', tint.ch) : []
  if (m > 0 && !(code === 'GNF' && m === 1)) out.push(...piece(has, 4010 + off + m, 'TUNIC_POINT', tint.ch))
  const lg = wear.lg ?? 0
  if (lg > 0) out.push(...piece(has, 4020 + off + lg, 'PELVIS_POINT', tint.lg))
  for (const slot of PAIRS) out.push(...platePair(has, off, slot, wear))
  return out
}

/**
 * THE LUCLIN DRESS for an actor: `hasIt` says whether the armour archives carry an item actor,
 * `hasRobeTexture` whether this actor's archive has the robe's chest texture.
 */
export function luclinDress(code: string, wear: EqModelWear, hasIt: Has, hasRobeTexture: (robe: RobeMaterial) => boolean): LuclinDress {
  const off = luclinOffset(code)
  if (off === null) return { wear, pieces: [] }
  const robe = isRobe(wear.robe) && ROBE_RACES.has(code.slice(0, 2)) && hasRobeTexture(wear.robe) ? wear.robe : undefined
  const head = headPieces(hasIt, { code, off }, wear, robe !== undefined)
  // Under a robe only the robe and the helm attach.
  if (robe !== undefined) return { wear: robeWear(wear, robe), pieces: [...head, ...piece(hasIt, 4000 + off + robe - 10, 'TUNIC_POINT', wear.tint?.ch)] }
  const body = bodyPieces(hasIt, code, off, wear)
  // UNDER A BREASTPLATE THE CHEST TEXTURE STAYS THE BASE LOOK: the Luclin chest's plate material
  // (`HUMCH0301_MDF`) binds the bare skin, and the piece is the armour.
  const plated = body.some((p) => p.attach === 'CHEST_POINT')
  return { wear: plated ? withoutChest(wear) : wear, pieces: [...head, ...body] }
}
