/**
 * Turns a base-skin texture into the EQ Zera version: chrome atlases get every recognised piece
 * DRAWN at its XML rectangle, window backgrounds become flat panel. Format-agnostic over the two
 * codecs the skins use (TGA, uncompressed DDS); each file is written back in its own format.
 */
import { type AnimFrame } from './animations'
import { decodeDds, encodeDds, DdsError } from './dds'
import { type Look, lookFor } from './look'
import { paintPiece } from './paint'
import { classifyPiece } from './pieceKinds'
import { Canvas } from './raster'
import { ART_PIECES } from './rules'
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

/** Mean coverage below which a base piece counts as empty (6% of full alpha). */
export const EMPTY_ALPHA = 0.06

/** The base piece's mean alpha, 0..1, over the part of its rectangle inside the atlas. */
export function meanAlpha(img: SkinImage, f: AnimFrame): number {
  let sum = 0
  let n = 0
  for (let y = Math.max(0, f.y); y < Math.min(img.height, f.y + f.h); y++) {
    for (let x = Math.max(0, f.x); x < Math.min(img.width, f.x + f.w); x++) {
      sum += img.rgba[(y * img.width + x) * 4 + 3] ?? 0
      n++
    }
  }
  return n === 0 ? 0 : sum / n / 255
}

function isDivider(name: string): boolean {
  return /Divider|MenuSeparator/.test(name)
}

export interface AtlasResult {
  rgba: Uint8Array
  /** names of the pieces drawn */
  drawn: string[]
}

/** Every recognised piece drawn at its rectangle; art and unknown pieces restored from the base. */
export function drawAtlas(img: SkinImage, frames: readonly AnimFrame[], texture: string, look: Look = lookFor('clean')): AtlasResult {
  const atlas = new Canvas(img.width, img.height)
  atlas.px.set(img.rgba)
  // Where the XML cuts two pieces from one rectangle, the later one wins. Dividers go FIRST: the
  // modern skin cuts A_DividerVertical from the same rectangle as A_BtnDisabled, and a divider
  // drawn last turned every disabled button into an empty box with a line through it.
  const mine = frames
    .filter((f) => f.texture === texture.toLowerCase())
    .sort((a, b) => Number(!isDivider(a.name)) - Number(!isDivider(b.name)))
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
    // A piece the base skin leaves (almost) empty is a borderless or transparent window's chrome:
    // drawing a frame or fill into it would put EQ Zera chrome where the base shows nothing.
    if (meanAlpha(img, f) < EMPTY_ALPHA) {
      keep.push(f)
      continue
    }
    atlas.put(paintPiece(piece, f, look), f.x, f.y)
    drawn.push(f.name)
  }
  for (const f of keep) copyRect(atlas.px, img.rgba, img.width, f)
  return { rgba: atlas.px, drawn }
}

/**
 * A window background: BLACK, alpha kept (owner, in game 2026-11-15). Chat and combat colours are
 * player-chosen, so the content area gets the one ground every one of them reads on, and the
 * EQ Zera look stays in the frames, title bars, tabs and buttons around it.
 */
export function drawBackground(img: SkinImage): Uint8Array {
  const out = new Uint8Array(img.rgba)
  for (let i = 0; i < img.width * img.height; i++) out.fill(0, i * 4, i * 4 + 3)
  return out
}
