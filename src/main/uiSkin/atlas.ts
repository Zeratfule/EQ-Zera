/**
 * Turns a base-skin texture into the EQ Zera version: chrome atlases get every recognised piece
 * DRAWN at its XML rectangle, window backgrounds become flat panel. Format-agnostic over the two
 * codecs the skins use (TGA, uncompressed DDS); each file is written back in its own format.
 */
import { type AnimFrame } from './animations'
import { decodeDds, encodeDds, DdsError } from './dds'
import { paintPiece, STYLE } from './paint'
import { classifyPiece } from './pieceKinds'
import { Canvas, noise } from './raster'
import { ART_PIECES, isDarkBackground } from './rules'
import { decodeTga, encodeTga, TgaError } from './tga'

export interface SkinImage {
  width: number
  height: number
  rgba: Uint8Array
  encode: (rgba: Uint8Array) => Uint8Array
}

/** Decodes a TGA or uncompressed DDS; null for anything the codecs refuse. */
export function readImage(name: string, buf: Uint8Array): SkinImage | null {
  try {
    if (/\.dds$/i.test(name)) {
      const d = decodeDds(buf)
      return { width: d.width, height: d.height, rgba: d.rgba, encode: (rgba) => encodeDds({ ...d, rgba }) }
    }
    const t = decodeTga(buf)
    return { width: t.width, height: t.height, rgba: t.rgba, encode: (rgba) => encodeTga({ ...t, rgba }) }
  } catch (e) {
    if (e instanceof TgaError || e instanceof DdsError) return null
    throw e
  }
}

function copyRect(dst: Uint8Array, src: Uint8Array, width: number, f: AnimFrame): void {
  const height = dst.length / 4 / width
  for (let y = Math.max(0, f.y); y < Math.min(height, f.y + f.h); y++) {
    const a = (y * width + Math.max(0, f.x)) * 4
    const b = (y * width + Math.min(width, f.x + f.w)) * 4
    if (b > a) dst.set(src.subarray(a, b), a)
  }
}

export interface AtlasResult {
  rgba: Uint8Array
  /** names of the pieces drawn */
  drawn: string[]
}

/** Every recognised piece drawn at its rectangle; art and unknown pieces restored from the base. */
export function drawAtlas(img: SkinImage, frames: readonly AnimFrame[], texture: string): AtlasResult {
  const atlas = new Canvas(img.width, img.height)
  atlas.px.set(img.rgba)
  // Where the XML cuts two pieces from overlapping rectangles, the later one wins; a gauge's lines
  // overlay goes last so it never paints a solid fill into its neighbour.
  const mine = frames
    .filter((f) => f.texture === texture.toLowerCase())
    .sort((a, b) => Number(a.name.endsWith('GaugeLines')) - Number(b.name.endsWith('GaugeLines')))
  const drawn: string[] = []
  const keep: AnimFrame[] = []
  for (const f of mine) {
    const piece = ART_PIECES.test(f.name) ? null : classifyPiece(f.name)
    if (!piece) {
      // A rectangle covering most of the atlas is a sheet, not a piece: restoring it would undo
      // everything drawn over it.
      if (f.w * f.h < (img.width * img.height) / 4) keep.push(f)
      continue
    }
    atlas.put(paintPiece(piece, f.w, f.h), f.x, f.y)
    drawn.push(f.name)
  }
  for (const f of keep) copyRect(atlas.px, img.rgba, img.width, f)
  return { rgba: atlas.px, drawn }
}

/** A window background: the app's flat paper (or page ground), a whisper of noise, alpha kept. */
export function drawBackground(img: SkinImage, name: string): Uint8Array {
  const base = isDarkBackground(name) ? STYLE.bg : STYLE.paper
  const out = new Uint8Array(img.rgba)
  for (let i = 0; i < img.width * img.height; i++) {
    const n = Math.round((noise(i % img.width, Math.floor(i / img.width)) - 0.5) * 4)
    out[i * 4] = Math.max(0, Math.min(255, Math.round(base[0]) + n))
    out[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(base[1]) + n))
    out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(base[2]) + n))
  }
  return out
}
