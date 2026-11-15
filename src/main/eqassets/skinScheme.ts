// eqassets/skinScheme.ts - FACES BY TEXTURE NAME: the classic `he00<F><P>` naming and the SKIN
// SCHEME the newer per-race archives use (EQ Zera, 2026-11-15). Split out of wld.ts, which reads
// them; pure string rules over texture names, nothing read here.

import type { EqModelMesh } from '../../shared/eqModel'
import type { Outfit } from './wld'

/**
 * THE SKIN SCHEME (Kerra, 2026-11-15). The newer per-race archives (globalkem/kef_chr.s3d) name
 * every bare body texture `<code><part>sk<F><P>.dds`: F is the skin/face pick written WITHOUT a
 * leading zero (`sk01` = face 0 piece 1, `sk11` = face 1, `sk141` = face 14), P the one-digit
 * piece. The pick re-skins the whole body, not just the head - KEM ships `chsk131` beside
 * `hesk131` - which is why the swap below runs over every part.
 */
export function skinTexture(texture: string, code: string): { part: string; face: number; piece: string } | null {
  const m = new RegExp(`^${code.toLowerCase()}([a-z]{2})sk(\\d+)\\.dds$`).exec(texture)
  if (!m || m[2].length < 2) return null
  return { part: m[1], face: Number(m[2].slice(0, -1)), piece: m[2].slice(-1) }
}

export function skinName(code: string, part: string, face: number, piece: string): string {
  return `${code.toLowerCase()}${part}sk${face === 0 ? '0' : String(face)}${piece}.dds`
}

/** The highest F the skin scheme carries in any archive read so far (KEM/KEF: 0-4 and 10-14). */
export const SKIN_FACE_MAX = 19

/**
 * WHICH FACES AN ARCHIVE ACTUALLY HAS for an actor: the F digits with a piece-1 head texture.
 * Measured, never assumed - HUM answers [0..7] and HUF [1..7], which is why the picker is handed
 * this list rather than a range (world-model law 1).
 */
export function facesFor(code: string, has: (file: string) => boolean): number[] {
  const classic = [0, 1, 2, 3, 4, 5, 6, 7].filter((f) => has(`${code.toLowerCase()}he00${String(f)}1.bmp`))
  if (classic.length > 0) return classic
  return Array.from({ length: SKIN_FACE_MAX + 1 }, (_, f) => f).filter((f) => has(skinName(code, 'he', f, '1')))
}

/** The face the head was SHIPPED wearing: the F digit of the piece-1 head texture a drawn mesh binds. */
export function boundFace(meshes: readonly EqModelMesh[], code: string): number | undefined {
  const re = new RegExp(`^${code.toLowerCase()}he00(\\d)1\\.bmp$`)
  const textures = meshes.flatMap((m) => m.materials).map((mt) => mt.texture ?? '')
  const hit = textures.map((t) => re.exec(t)).find((m) => m !== null)
  if (hit) return Number(hit[1])
  const sk = textures.map((t) => skinTexture(t, code)).find((s) => s !== null && s.part === 'he' && s.piece === '1')
  return sk ? sk.face : undefined
}

/**
 * The face pick's own head texture: `<code>he00<F><P>.bmp` with the CHOSEN F and the SAME piece,
 * and only when the archive really has that file - HUF and DWF have no face 0, and the pieces
 * above 2 (hair, beards, ears) exist at face 0 alone, so an unguarded substitution would blank
 * them. Head textures sit on some BODY meshes too, which is why this runs over every material.
 */
export function facedTexture(texture: string, code: string, outfit: Outfit): string | null {
  const face = outfit.wear.face
  if (face === undefined) return null
  const sk = skinTexture(texture, code)
  if (sk) {
    const swapped = skinName(code, sk.part, face, sk.piece)
    return outfit.has(swapped) ? swapped : null
  }
  const piece = new RegExp(`^${code.toLowerCase()}he00\\d(\\d)\\.bmp$`).exec(texture)?.[1]
  if (piece === undefined) return null
  const swapped = `${code.toLowerCase()}he00${String(face)}${piece}.bmp`
  return outfit.has(swapped) ? swapped : null
}
