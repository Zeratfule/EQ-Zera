// eqassets/wldDress.ts - DRESSING A READ CHARACTER: armour variants, face picks and dye over the
// textures its meshes bind (EQ Zera; split out of wld.ts 2026-11-15 when the Luclin models pushed
// it over the file-length ceiling). Pure string rules over texture names plus the archive's own
// file list (`Outfit.has`); nothing is read here.

import { WEAR_PARTS, type EqModelMaterial, type EqModelMesh, type WearPart } from '../../shared/eqModel'
import { facedTexture, skinTexture } from './skinScheme'
import type { Outfit } from './wld'

/** The body part a race texture belongs to (`bafch0001.bmp` → `ch`), and its variant/index digits. */
function texturePart(texture: string, code: string): { part: WearPart; index: string; ext: string } | null {
  const m = new RegExp(`^${code.toLowerCase()}(${WEAR_PARTS.join('|')})(\\d\\d)(\\d\\d)\\.(bmp|dds)$`).exec(texture)
  if (m) return { part: m[1] as WearPart, index: m[3], ext: m[4] }
  // THE SKIN SCHEME (Kerra, 2026-11-15; the Luclin models too): the bare part is
  // `<code><part>sk<F><P>.dds`, and its armour is `<code><part>0<V>0<P>.dds` - the same piece,
  // numbered the classic way.
  const sk = skinTexture(texture, code)
  return sk && sk.part !== 'he' ? { part: sk.part as WearPart, index: `0${sk.piece}`, ext: 'dds' } : null
}

/**
 * `bafch0001.bmp` → `bafch0301.bmp`: the armour texture a part's wear names, when the wear asks for
 * one. THE CLOSEST REAL ARMOUR WHEN THAT ONE IS NOT THERE (owner, 2026-11-15): 25 of the 26 Luclin
 * actors ship no plate chest, and drawing the bare skin under a breastplate put topless figures on
 * the card. So the variant steps DOWN - plate, then chain, then leather - to the first the archive
 * has for this piece, keeping the worn item's dye; the bare skin is left only when the archive has
 * no armour texture for the piece at all.
 */
function armourFor(texture: string, code: string, outfit: Outfit): { at: NonNullable<ReturnType<typeof texturePart>>; dressed: string | null } | null {
  const at = texturePart(texture, code)
  if (!at) return null
  for (let v = outfit.wear[at.part] ?? 0; v > 0; v--) {
    const dressed = `${code.toLowerCase()}${at.part}0${String(v)}${at.index}.${at.ext}`
    if (outfit.has(dressed)) return { at, dressed }
  }
  return { at, dressed: null }
}

/** True when the wear asked this texture's part for armour the archive does not have. */
function wantedAndMissing(armour: NonNullable<ReturnType<typeof armourFor>>, outfit: Outfit): boolean {
  return (outfit.wear[armour.at.part] ?? 0) > 0 && armour.dressed === null
}

function dressedMaterial(mt: EqModelMaterial, code: string, outfit: Outfit): EqModelMaterial {
  if (!mt.texture) return mt
  const armour = armourFor(mt.texture, code, outfit)
  // A skin-scheme part under armour shows the armour, not the skin pick; a classic head texture
  // never matches `texturePart`, so the classic order (face first) is unchanged.
  const faced = armour?.dressed ? null : facedTexture(mt.texture, code, outfit)
  if (faced !== null) return { ...mt, texture: faced }
  if (!armour) return mt
  const texture = armour.dressed ?? mt.texture
  // ARMOUR ASKED FOR AND NOT IN THE ARCHIVE stays the bare skin, and the bare skin does not take
  // the armour's dye: a Luclin human in dyed plate (no Luclin plate chest exists) was drawn with a
  // red-painted bare torso. Cloth (variant 0) keeps its dye, as it always has.
  const tint = wantedAndMissing(armour, outfit) ? undefined : outfit.wear.tint?.[armour.at.part]
  return tint ? { ...mt, texture, tint } : { ...mt, texture }
}

/**
 * The worn parts the archive has NO texture for at their variant, in WEAR_PARTS order: drawn bare,
 * and named so the card can say so (the classic Iksar female's legs, for one).
 */
export function undressedParts(meshes: readonly EqModelMesh[], code: string, outfit: Outfit): WearPart[] {
  const out = new Set<WearPart>()
  for (const mesh of meshes) {
    for (const g of mesh.groups) {
      const texture = mesh.materials[g.materialIndex]?.texture
      const armour = texture ? armourFor(texture, code, outfit) : null
      if (armour && wantedAndMissing(armour, outfit)) out.add(armour.at.part)
    }
  }
  return WEAR_PARTS.filter((p) => out.has(p))
}

/**
 * A mesh with every material dressed. A HELM mesh additionally takes the head slot's dye - and it
 * takes it ON TOP of the dressing rather than instead of it, which is the point: the old form
 * returned early with the RAW material, so a dyed helm silently lost its armour and face swaps.
 */
export function dress(mesh: EqModelMesh, code: string, outfit: Outfit): EqModelMesh {
  const helmTint = /HE0[1-9]_DMSPRITEDEF$/.test(mesh.name) ? outfit.wear.tint?.helm : undefined
  const one = (mt: EqModelMaterial): EqModelMaterial => {
    const dressed = dressedMaterial(mt, code, outfit)
    return helmTint ? { ...dressed, tint: helmTint } : dressed
  }
  return { ...mesh, materials: mesh.materials.map(one) }
}
