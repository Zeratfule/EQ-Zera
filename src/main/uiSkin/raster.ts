/**
 * A tiny RGBA rasteriser for drawing the EQ Zera skin's chrome: anti-aliased rounded rectangles
 * (fill, stroke, outer glow) from a signed distance, capsules for glyph strokes, supersampled
 * polygons for arrows, and blits. Straight (non-premultiplied) alpha, the way TGA and DDS store it.
 * Every shape may extend past the canvas: geometry is evaluated per pixel and clipped for free,
 * which is how a frame PIECE is cut from a virtual panel larger than itself.
 */

export type Rgba = readonly [number, number, number, number]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export class Canvas {
  readonly px: Uint8Array
  constructor(
    readonly w: number,
    readonly h: number
  ) {
    this.px = new Uint8Array(w * h * 4)
  }

  /** Source-over blend of `c` at coverage `cov` (0..1) into pixel (x, y). */
  blend(x: number, y: number, c: Rgba, cov: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || cov <= 0) return
    const sa = c[3] * Math.min(1, cov)
    if (sa <= 0) return
    const o = (y * this.w + x) * 4
    const da = (this.px[o + 3] ?? 0) / 255
    const oa = sa + da * (1 - sa)
    for (let k = 0; k < 3; k++) {
      const d = this.px[o + k] ?? 0
      this.px[o + k] = Math.round((c[k] * sa + d * da * (1 - sa)) / oa)
    }
    this.px[o + 3] = Math.round(oa * 255)
  }

  /** Copies `src` into this canvas at (x, y), replacing pixels (alpha included). */
  put(src: Canvas, x: number, y: number): void {
    for (let j = 0; j < src.h; j++) {
      const ty = y + j
      if (ty < 0 || ty >= this.h) continue
      for (let i = 0; i < src.w; i++) {
        const tx = x + i
        if (tx < 0 || tx >= this.w) continue
        const s = (j * src.w + i) * 4
        this.px.set(src.px.subarray(s, s + 4), (ty * this.w + tx) * 4)
      }
    }
  }
}

/** Signed distance from pixel centre (px, py) to a rounded rectangle; negative inside. */
export function sdRoundRect(px: number, py: number, r: Rect, radius: number): number {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const rad = Math.min(radius, r.w / 2, r.h / 2)
  const qx = Math.abs(px - cx) - (r.w / 2 - rad)
  const qy = Math.abs(py - cy) - (r.h / 2 - rad)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - rad
}

/** Visits every pixel centre of the canvas with its distance to the shape. */
function eachPixel(c: Canvas, dist: (x: number, y: number) => number, visit: (x: number, y: number, d: number) => void): void {
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) visit(x, y, dist(x + 0.5, y + 0.5))
}

export type Paint = Rgba | ((x: number, y: number) => Rgba)

const colorAt = (p: Paint, x: number, y: number): Rgba => (typeof p === 'function' ? p(x, y) : p)

export function fillRoundRect(c: Canvas, r: Rect, radius: number, paint: Paint): void {
  eachPixel(
    c,
    (x, y) => sdRoundRect(x, y, r, radius),
    (x, y, d) => {
      c.blend(x, y, colorAt(paint, x, y), 0.5 - d)
    }
  )
}

/** A stroke of `width` px lying just INSIDE the rectangle's edge. */
export function strokeRoundRect(c: Canvas, r: Rect, radius: number, stroke: { width: number; paint: Paint }): void {
  const half = stroke.width / 2
  eachPixel(
    c,
    (x, y) => sdRoundRect(x, y, r, radius),
    (x, y, d) => {
      c.blend(x, y, colorAt(stroke.paint, x, y), 0.5 - (Math.abs(d + half) - half))
    }
  )
}

/** A soft glow OUTSIDE the rectangle, fading over `spread` px. */
export function glowRoundRect(c: Canvas, r: Rect, radius: number, glow: { spread: number; color: Rgba }): void {
  eachPixel(
    c,
    (x, y) => sdRoundRect(x, y, r, radius),
    (x, y, d) => {
      if (d <= 0 || d >= glow.spread) return
      const t = 1 - d / glow.spread
      c.blend(x, y, glow.color, t * t)
    }
  )
}

/** A round-capped line segment of `width` px. */
export function line(c: Canvas, seg: readonly [number, number, number, number], width: number, color: Rgba): void {
  const [x0, y0, x1, y1] = seg
  const dx = x1 - x0
  const dy = y1 - y0
  const len2 = dx * dx + dy * dy || 1
  eachPixel(
    c,
    (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2))
      return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) - width / 2
    },
    (x, y, d) => {
      c.blend(x, y, color, 0.5 - d)
    }
  )
}

function inside(poly: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** How much of pixel (x, y) the polygon covers, from a 4x4 grid of samples. */
function coverage(poly: readonly (readonly [number, number])[], x: number, y: number): number {
  let n = 0
  for (let s = 0; s < 16; s++) if (inside(poly, x + ((s % 4) + 0.5) / 4, y + (Math.floor(s / 4) + 0.5) / 4)) n++
  return n / 16
}

/** A filled polygon, 4x4 supersampled for its edges. */
export function fillPolygon(c: Canvas, poly: readonly (readonly [number, number])[], color: Rgba): void {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const n = coverage(poly, x, y)
      if (n) c.blend(x, y, color, n)
    }
  }
}

/** A deterministic 0..1 hash noise, so a rebuild draws the same bytes. */
export function noise(x: number, y: number, seed = 1): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
