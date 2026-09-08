// shared/eqModel.ts — THE SHAPE OF A RACE MODEL ON THE WIRE (EQ Zera, 2026-09-06; the
// character-model spike). Main builds it from the game's own archives (ipc/eqModel.ts), preload
// types the call, the renderer draws it. Every buffer is a plain number array so it crosses IPC
// as JSON; textures are data URLs the renderer's CSP already admits.
//
// EVERYTHING IS IN THE GAME'S OWN FRAME (Z up). The renderer rotates the whole figure once; that
// keeps the skeleton, the skinned vertices and the animation tracks in one consistent space.

export interface EqModelMaterial {
  name: string
  /** the bitmap file inside the archive, lower-cased; null for an invisible/boundary material */
  texture: string | null
  /** the material's raw render type (0 = boundary/invisible; 1 = diffuse; others translucent/masked) */
  type: number
  /** a dye multiplied over the texture, when the worn item is dyed */
  tint?: Tint
  /** an animated texture: every frame's bitmap in order (`texture` is the first), and the period per frame */
  frames?: string[]
  frameMs?: number
}

export interface EqModelGroup {
  materialIndex: number
  /** first index into `indices`, and how many (a multiple of 3) */
  start: number
  count: number
}

export interface EqModelMesh {
  /**
   * The mesh was flattened off a skeleton of its own (an orb on its stand): the archives carry
   * no animation for these, the client turns them in the hand, and so does the renderer.
   */
  rigged?: boolean
  name: string
  /** bind-posed, game frame (Z up): x, y, z per vertex */
  positions: number[]
  normals: number[]
  uvs: number[]
  indices: number[]
  groups: EqModelGroup[]
  materials: EqModelMaterial[]
  /** the bone that owns each vertex (one bone per vertex in this format); empty for a rigid item */
  skinIndices: number[]
}

/** A bone: its parent, and its BIND transform relative to that parent (translation, quaternion xyzw). */
export interface EqModelBone {
  name: string
  parent: number
  t: [number, number, number]
  q: [number, number, number, number]
}

/** One bone's frames in a clip: `frames` translations (3 each) and quaternions (4 each), flattened. */
export interface EqModelTrack {
  t: number[]
  q: number[]
}

export interface EqModelClip {
  /** the game's code: P01 idle, L01 walk, … */
  name: string
  /** milliseconds per frame */
  frameMs: number
  frames: number
  /** by bone index; a bone without a track holds its bind pose */
  tracks: Record<number, EqModelTrack>
}

/** The three attachment bones a classic skeleton carries, by the short name inside `<RACE><NAME>_DAG`. */
export type AttachPoint = 'R_POINT' | 'L_POINT' | 'SHIELD_POINT'

export interface EqModelWeapon {
  attach: AttachPoint
  mesh: EqModelMesh
}

/**
 * WHAT THE FIGURE WEARS (phase 2). Classic armour is a TEXTURE VARIANT per body part - the files
 * are `<race><part><variant><index>.bmp`, variants 00 bare · 01 leather · 02 chain · 03 plate
 * (measured on this client's global_chr.s3d) - plus a separate head MESH per helm kind
 * (`<race>HE01..03`). A part left undefined stays bare.
 *
 * THE HEAD IS THE OTHER NAMING RULE, and it is not the armour one. A face is a head TEXTURE,
 * `<race>he00<F><P>.bmp`: `F` is the face (0-7) and `P` the piece - 1 and 2 are the face itself,
 * higher pieces (hair, beards, ears) exist at face 0 only on the races that carry them, and head
 * textures also appear on a few BODY meshes (HUF, ERM, OGM, HOF neck strips). So a face pick
 * substitutes the F digit and KEEPS the piece, over every drawn mesh, and only where the archive
 * really has the file: HUF and DWF have no face 0 at all and their bare heads bind face 2
 * (`hufhe0021.bmp`). Which faces exist is MEASURED per actor and travels on the payload
 * (`faces`, `defaultFace`) - the renderer never guesses one.
 */
export const WEAR_PARTS = ['ch', 'ua', 'fa', 'hn', 'lg', 'ft'] as const
export type WearPart = (typeof WEAR_PARTS)[number]
export type WearVariant = 0 | 1 | 2 | 3
export type EqModelWear = Partial<Record<WearPart, WearVariant>> & {
  /** the helm mesh to draw: 0 bare head, 1..3 the helm kinds; undefined = bare */
  helm?: WearVariant
  /**
   * WHICH FACE THE HEAD WEARS: the `F` digit above, an integer 0..7 and deliberately NOT a
   * `WearVariant` - it indexes a different set of files and nothing the player equips moves it.
   * Undefined leaves every head texture exactly as the archive bound it.
   */
  face?: number
  /** dye per part, when the item table states a colour */
  tint?: Partial<Record<WearPart | 'helm', Tint>>
}

/**
 * WHAT THE FIGURE HOLDS (phase 3): per hand, the item's MODEL when the item table knows it
 * (`IT68` - exact), and its weapon skill as the fallback when it does not (a representative).
 */
export interface EqModelHand {
  model?: string
  skill?: string
}
export interface EqModelHands {
  primary?: EqModelHand
  secondary?: EqModelHand
}

/** A dye tint for a part, 0..1 per channel, from the item table's colour. */
export type Tint = [number, number, number]

export interface EqModelPayload {
  actor: string
  bones: EqModelBone[]
  meshes: EqModelMesh[]
  clips: EqModelClip[]
  weapons: EqModelWeapon[]
  /** bitmap file name → data URL, for every texture a drawn mesh group references */
  textures: Record<string, string>
  /** the faces this actor's archive really has: the `F` digits with a piece-1 head texture, ascending */
  faces?: number[]
  /** the `F` digit the bare head binds with no pick at all (2 for HUF and DWF, which have no face 0) */
  defaultFace?: number
}

/**
 * The look of an item BY NAME, as `eqassets:itemLook` answers it (EQ Zera, item preview). The same
 * three facts the character sheet joins by item id (`SheetItemView.model/material/color`), plus
 * how many DISTINCT looks the table holds under this name: 1,018 catalog names carry more than
 * one item id and 293 of those disagree about model, material or dye. The answer is the first
 * id's look, and `looks > 1` is how the UI says "one of N" instead of pretending to know.
 */
export interface ItemLook {
  /** the model actor (`IT68`); '' when the table has none for it */
  model: string
  /** the client's armour material code: 0 cloth, 1 leather, 2 chain, 3 plate, others special */
  material: number
  /** dye colour as the client stores it (ARGB), 0 for none */
  color: number
  /** how many distinct looks the table holds under this name (1 = unambiguous) */
  looks: number
}
