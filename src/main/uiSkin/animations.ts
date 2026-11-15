/**
 * Reads the `<Ui2DAnimation>` frames out of EQ UI XML: which rectangle of which texture each
 * named piece of chrome is cut from. The skin builder uses these rectangles to recolour only the
 * chrome inside an atlas and leave the icons and art sharing that atlas untouched.
 */

export interface AnimFrame {
  /** the animation's item name, e.g. A_CloseBtnNormal */
  readonly name: string
  /** lower-cased texture file name */
  readonly texture: string
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

const ANIMATION = /<Ui2DAnimation\s+item\s*=\s*"([^"]+)"\s*>([\s\S]*?)<\/Ui2DAnimation>/g
const FRAME = /<Frames>([\s\S]*?)<\/Frames>/g

function num(body: string, outer: string, inner: string): number | null {
  const block = new RegExp(`<${outer}>([\\s\\S]*?)</${outer}>`).exec(body)?.[1]
  if (block === undefined) return null
  const v = new RegExp(`<${inner}>\\s*(-?\\d+)\\s*</${inner}>`).exec(block)?.[1]
  return v === undefined ? null : Number(v)
}

function parseFrame(name: string, body: string): AnimFrame | null {
  const texture = /<Texture>\s*([^<]+?)\s*<\/Texture>/.exec(body)?.[1]
  const w = num(body, 'Size', 'CX') ?? 0
  const h = num(body, 'Size', 'CY') ?? 0
  if (!texture || w <= 0 || h <= 0) return null
  const x = num(body, 'Location', 'X') ?? 0
  const y = num(body, 'Location', 'Y') ?? 0
  return { name, texture: texture.toLowerCase(), x, y, w, h }
}

export function parseAnimationFrames(xml: string): AnimFrame[] {
  const frames: AnimFrame[] = []
  for (const anim of xml.matchAll(ANIMATION)) {
    for (const fr of (anim[2] ?? '').matchAll(FRAME)) {
      const frame = parseFrame(anim[1] ?? '', fr[1] ?? '')
      if (frame) frames.push(frame)
    }
  }
  return frames
}

/** Fills `mask` (one byte per pixel, rows of `width`) with `value` inside the rectangle, clipped. */
export function paintRect(mask: Uint8Array, width: number, f: AnimFrame, value: number): void {
  const height = Math.floor(mask.length / width)
  const x0 = Math.max(0, f.x)
  const y0 = Math.max(0, f.y)
  const x1 = Math.min(width, f.x + f.w)
  const y1 = Math.min(height, f.y + f.h)
  for (let y = y0; y < y1; y++) mask.fill(value, y * width + x0, y * width + x1)
}
