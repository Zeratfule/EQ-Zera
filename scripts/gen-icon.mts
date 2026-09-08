// gen-icon.mts — synthesize the app icon with ZERO dependencies. Run:
//
//   export PATH="/c/Program Files/nodejs:$PATH"   # this machine
//   npx tsx scripts/gen-icon.mts        # or: npm run gen:icon
//
// Outputs build/icon.png (256x256 — the tray art today, and the Linux/reference art),
// build/icon-tray.png (32x32, see below) and build/icon.ico (the Windows exe + NSIS
// installer icon electron-builder consumes). The .ico embeds PNG-compressed frames at
// 256/128/64/48/32/16 px; Vista+ and NSIS both read PNG-in-ICO, so no legacy BMP frames.
//
// THE MARK (EQ Zera, 2026-09-08 — replaces the inherited "rounded dark panel + serif EQ",
// which read as a generic companion app). A RETRO-WAVE CARTRIDGE BADGE: a chamfered plate
// cut on the top-left/bottom-right diagonal (a console cartridge on a tilt, so the
// SILHOUETTE alone is ours), a midnight-to-magenta horizon gradient, a scanline-barred
// neon sun setting on a cyan horizon over a perspective grid, and blocky extended "EQZ"
// in the app's text colour with an accent outline and a magenta/cyan chromatic fringe.
// Every colour comes from `PALETTE`; no game art, no fonts, no dependencies — the letters
// are rectangle/quad compositions with explicit coordinates. Notes: docs/plans/app-icon.md.
//
// HOW IT DRAWS. Geometry is written once in UNIT coordinates (0..1 of the frame) and
// rendered per size at 4x supersample, then box-downscaled — so every frame is drawn at
// its own resolution rather than shrunk from one master, and the small frames drop the
// detail that turns to mud (LAYOUT + `detail`). Shapes go into binary `Mask`s (polygon
// scanline fill, disc, boolean ops, separable dilation) which a `Paint` (vertical
// gradient + alpha) composites onto the `Canvas`.
//
// EYEBALLING IT: `EQ_ICON_PREVIEW=<dir> npx tsx scripts/gen-icon.mts` also writes
// <dir>/icon-preview-<size>.png plus an 8x nearest-neighbour magnification of each, which
// is the only honest way to judge a 16px frame.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PALETTE } from '../src/shared/palette'

type RGBA = [number, number, number, number]
type Pt = [number, number]
/** An axis-aligned box; `x1`/`y1` exclusive. One parameter instead of four (max-params). */
interface Box { x0: number; y0: number; x1: number; y1: number }
/** A vertical gradient over `y0..y1` (pixels) as `[position 0..1, colour]` stops, times `alpha`. */
interface Paint { stops: [number, RGBA][]; y0: number; y1: number; alpha: number }

/** A palette token as an opaque RGBA tuple. */
function rgba(hex: string): RGBA {
  const n = parseInt(hex.slice(1, 7), 16)
  return [n >> 16, (n >> 8) & 255, n & 255, 255]
}
/** `k` of the way from `a` to `b` — how the plate's darkened sunset stops are built. */
function mix(a: RGBA, b: RGBA, k: number): RGBA {
  return [0, 1, 2, 3].map((i) => Math.round(a[i] + (b[i] - a[i]) * k)) as RGBA
}
/** A solid colour as a Paint. */
function solid(c: RGBA, alpha = 1): Paint {
  return { stops: [[0, c]], y0: 0, y1: 1, alpha }
}

const BG = rgba(PALETTE.bg)
const ACCENT = rgba(PALETTE.accent)
const ACCENT_HI = rgba(PALETTE.accentHi)
const CYAN = rgba(PALETTE.cyan)
const MAGENTA = rgba(PALETTE.magenta)
const TEXT = rgba(PALETTE.text)

/** A binary coverage mask. Every shape lands here first, so booleans and dilation are free. */
class Mask {
  readonly w: number
  readonly h: number
  a: Uint8Array
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.a = new Uint8Array(w * h)
  }
  private span(y: number, xa: number, xb: number): void {
    const x0 = Math.max(0, Math.round(xa))
    const x1 = Math.min(this.w, Math.round(xb))
    this.a.fill(1, y * this.w + x0, y * this.w + Math.max(x0, x1))
  }
  /** Even-odd polygon fill. Returns `this` so shapes chain. */
  poly(pts: Pt[]): this {
    const ys = pts.map((p) => p[1])
    const yTop = Math.max(0, Math.floor(Math.min(...ys)))
    const yBot = Math.min(this.h - 1, Math.ceil(Math.max(...ys)))
    for (let y = yTop; y <= yBot; y++) {
      const xs = crossings(pts, y + 0.5)
      for (let k = 0; k + 1 < xs.length; k += 2) this.span(y, xs[k], xs[k + 1])
    }
    return this
  }
  rect(b: Box): this {
    return this.poly([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]])
  }
  disc(cx: number, cy: number, r: number): this {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(this.h - 1, Math.ceil(cy + r)); y++) {
      const dy = y + 0.5 - cy
      if (Math.abs(dy) <= r) this.span(y, cx - Math.sqrt(r * r - dy * dy), cx + Math.sqrt(r * r - dy * dy))
    }
    return this
  }
  /** In-place boolean: `op` 1 = union, 0 = subtract, 2 = intersect. */
  private merge(m: Mask, op: number): this {
    for (let i = 0; i < this.a.length; i++) {
      if (op === 1) this.a[i] |= m.a[i]
      else if (op === 0) this.a[i] &= m.a[i] ^ 1
      else this.a[i] &= m.a[i]
    }
    return this
  }
  or(m: Mask): this { return this.merge(m, 1) }
  sub(m: Mask): this { return this.merge(m, 0) }
  and(m: Mask): this { return this.merge(m, 2) }
  clone(): Mask {
    const out = new Mask(this.w, this.h)
    out.a.set(this.a)
    return out
  }
  /** Translated copy — the chromatic-fringe offsets. */
  shift(dx: number, dy: number): Mask {
    const out = new Mask(this.w, this.h)
    for (let y = Math.max(0, dy); y < Math.min(this.h, this.h + dy); y++) {
      const row = (y - dy) * this.w
      for (let x = Math.max(0, dx); x < Math.min(this.w, this.w + dx); x++) {
        out.a[y * this.w + x] = this.a[row + x - dx]
      }
    }
    return out
  }
  /** Square dilation by `r`, separable (two max passes) — the letter outline and the plate rim. */
  dilate(r: number): Mask {
    return dilateAxis(dilateAxis(this, r, true), r, false)
  }
  /** The mask eroded by `r`: dilate the complement. Gives the rim its inner edge. */
  inset(r: number): Mask {
    const inv = this.clone()
    for (let i = 0; i < inv.a.length; i++) inv.a[i] ^= 1
    return this.clone().sub(inv.dilate(r))
  }
}

/** X coordinates where the polygon's edges cross scanline `yc`, sorted. */
function crossings(pts: Pt[], yc: number): number[] {
  const xs: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const [[ax, ay], [bx, by]] = [pts[i], pts[(i + 1) % pts.length]]
    if (ay <= yc !== by <= yc) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax))
  }
  return xs.sort((p, q) => p - q)
}

/** One axis of a separable square dilation. */
function dilateAxis(src: Mask, r: number, horizontal: boolean): Mask {
  const out = new Mask(src.w, src.h)
  const n = horizontal ? src.w : src.h
  for (let o = 0; o < (horizontal ? src.h : src.w); o++) {
    for (let i = 0; i < n; i++) {
      let hit = 0
      for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r) && hit === 0; k++) {
        hit = src.a[horizontal ? o * src.w + k : k * src.w + o]
      }
      out.a[horizontal ? o * src.w + i : i * src.w + o] = hit
    }
  }
  return out
}

/** Straight (non-premultiplied) RGBA canvas over a transparent ground. */
class Canvas {
  readonly w: number
  readonly h: number
  px: Uint8Array
  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.px = new Uint8Array(w * h * 4)
  }
  /** Composite `p` everywhere `m` is set. The gradient is vertical, so it resolves once a row. */
  paint(m: Mask, p: Paint): void {
    for (let y = 0; y < this.h; y++) {
      const c = sampleStops(p, y)
      for (let x = 0; x < this.w; x++) {
        if (m.a[y * this.w + x] !== 0) this.over((y * this.w + x) * 4, c, p.alpha)
      }
    }
  }
  /** Source-over of `c` at `a` onto the pixel at byte offset `i`. */
  private over(i: number, c: RGBA, a: number): void {
    const da = this.px[i + 3] / 255
    const outA = a + da * (1 - a)
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round((c[k] * a + this.px[i + k] * da * (1 - a)) / outA)
    this.px[i + 3] = Math.round(outA * 255)
  }
  /** Box-average by `n` (the supersample resolve), in premultiplied space so edges stay clean. */
  downscale(n: number): Canvas {
    const out = new Canvas(this.w / n, this.h / n)
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const b = { x0: x * n, y0: y * n, x1: x * n + n, y1: y * n + n }
        out.px.set(boxAverage(this, b), (y * out.w + x) * 4)
      }
    }
    return out
  }
  /** Nearest-neighbour magnify — previews only, so a 16px frame can be read pixel by pixel. */
  magnify(n: number): Canvas {
    const out = new Canvas(this.w * n, this.h * n)
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const i = (Math.floor(y / n) * this.w + Math.floor(x / n)) * 4
        out.px.set(this.px.subarray(i, i + 4), (y * out.w + x) * 4)
      }
    }
    return out
  }
}

/** The gradient colour for row `y`. */
function sampleStops(p: Paint, y: number): RGBA {
  const t = Math.min(1, Math.max(0, (y - p.y0) / Math.max(1, p.y1 - p.y0)))
  const { stops } = p
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [[a0, ca], [a1, cb]] = [stops[i - 1], stops[i]]
      return mix(ca, cb, (t - a0) / Math.max(1e-6, a1 - a0))
    }
  }
  return stops[stops.length - 1][1]
}

/** One output pixel of the supersample resolve. */
function boxAverage(cv: Canvas, b: Box): RGBA {
  const acc = [0, 0, 0, 0]
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = (y * cv.w + x) * 4
      const a = cv.px[i + 3] / 255
      for (let k = 0; k < 3; k++) acc[k] += cv.px[i + k] * a
      acc[3] += a
    }
  }
  const rgb = [0, 1, 2].map((k) => (acc[3] === 0 ? 0 : Math.round(acc[k] / acc[3])))
  return [rgb[0], rgb[1], rgb[2], Math.round((acc[3] / ((b.x1 - b.x0) * (b.y1 - b.y0))) * 255)] as RGBA
}

// ---------------------------------------------------------------------------
// THE ARTWORK — unit coordinates (0..1 of the frame), y down.
// ---------------------------------------------------------------------------

/** Everything a frame's proportions need. All values are unit fractions of the frame. */
interface Layout {
  /** the cartridge plate: bounding box, its two deep 45-degree cuts, its two corner nicks, rim */
  plate: Box; cut: number; nick: number; rim: number
  /** the letters: cap height, stroke weight, vertical centre, the band they span, the letterspace */
  cap: number; stroke: number; cy: number; text: { x0: number; x1: number }; gap: number
  /** snap every coordinate to a whole device pixel (small frames, so strokes stay crisp) */
  snap: boolean
  /** draw the horizon line — the 16px frame has no room for one under the letters */
  horizon: boolean
}

/**
 * THREE LAYOUTS, because a 16px frame is not a small 256px frame. `big` breathes; `small` is
 * lighter-stroked and pixel-snapped; `tiny` is hand-set bitmap — 1px strokes on a 7px cap, every
 * value a whole 16th so nothing lands between pixels. All three were chosen against the x8
 * previews: unsnapped, the E's three bars average into one grey block at 16px, and at the big
 * layout's weight the Q's counter closes up below 64px.
 */
const LAYOUT: Record<'big' | 'small' | 'tiny', Layout> = {
  big: {
    plate: { x0: 0.045, y0: 0.085, x1: 0.955, y1: 0.915 }, cut: 0.22, nick: 0.06, rim: 0.014,
    cap: 0.275, stroke: 0.0715, cy: 0.468, text: { x0: 0.155, x1: 0.845 }, gap: 0.03,
    snap: false, horizon: true
  },
  small: {
    plate: { x0: 0.0625, y0: 0.0625, x1: 0.9375, y1: 0.9375 }, cut: 0.1875, nick: 0.0625, rim: 0.03125,
    cap: 0.375, stroke: 0.0625, cy: 0.4375, text: { x0: 0.15625, x1: 0.875 }, gap: 0.03125,
    snap: true, horizon: true
  },
  tiny: {
    plate: { x0: 0, y0: 0, x1: 1, y1: 1 }, cut: 0.1875, nick: 0.0625, rim: 0.0625,
    cap: 0.4375, stroke: 0.0625, cy: 0.46875, text: { x0: 0.0625, x1: 0.9375 }, gap: 0.0625,
    snap: true, horizon: false
  }
}
/** Where the sun sets and the floor starts. */
const HORIZON = 0.705

/** The cartridge silhouette: a rectangle with a deep 45-degree cut on the TL/BR diagonal. */
function platePoly(l: Layout, u: (v: number) => number): Pt[] {
  const { plate: { x0, y0, x1, y1 }, cut: c, nick: n } = l
  const p: Pt[] = [
    [x0 + c, y0], [x1 - n, y0], [x1, y0 + n], [x1, y1 - c],
    [x1 - c, y1], [x0 + n, y1], [x0, y1 - n], [x0, y0 + c]
  ]
  return p.map(([x, y]) => [u(x), u(y)] as Pt)
}

/** The blocky extended "E": spine plus three bars, the middle one short. */
function letterE(b: Box, t: number, m: Mask): void {
  const mid = (b.y0 + b.y1) / 2
  m.rect({ ...b, x1: b.x0 + t })
  m.rect({ ...b, y1: b.y0 + t })
  m.rect({ x0: b.x0, y0: mid - t / 2, x1: b.x1 - t * 0.55, y1: mid + t / 2 })
  m.rect({ ...b, y0: b.y1 - t })
}

/** The blocky "Q": a rectangular ring with a chamfered south-east corner and a 45-degree tail. */
function letterQ(b: Box, t: number, m: Mask): void {
  const c = t * 0.85
  const h: Box = { x0: b.x0 + t, y0: b.y0 + t, x1: b.x1 - t, y1: b.y1 - t }
  const ring = new Mask(m.w, m.h)
  ring.poly([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1 - c], [b.x1 - c, b.y1], [b.x0, b.y1]])
  const hole = new Mask(m.w, m.h)
  hole.poly([[h.x0, h.y0], [h.x1, h.y0], [h.x1, h.y1 - c / 2], [h.x1 - c / 2, h.y1], [h.x0, h.y1]])
  ring.sub(hole)
  // The tail starts inside the counter and exits past the SE corner. Its reach is set by the
  // letter's HEIGHT, not by the stroke, so it stays proportional when a small frame drops to 1px.
  const k = (b.y1 - b.y0) * 0.32
  const [ax, ay, d] = [b.x1 - t - k, b.y1 - t - k, k + t * 1.2]
  ring.poly([[ax, ay], [ax + t, ay], [ax + t + d, ay + d], [ax + d, ay + d]])
  m.or(ring)
}

/** The blocky "Z": two bars and a slanted parallelogram. */
function letterZ(b: Box, t: number, m: Mask): void {
  const th = t * 1.5
  m.rect({ ...b, y1: b.y0 + t })
  m.rect({ ...b, y0: b.y1 - t })
  m.poly([[b.x1 - th, b.y0 + t], [b.x1, b.y0 + t], [b.x0 + th, b.y1 - t], [b.x0, b.y1 - t]])
}

/** "EQZ" as one mask, in unit coordinates scaled by `u`. */
function lettersMask(size: number, l: Layout, u: (v: number) => number): Mask {
  const m = new Mask(size, size)
  const w = (l.text.x1 - l.text.x0 - l.gap * 2) / 3
  const draw = [letterE, letterQ, letterZ]
  draw.forEach((fn, i) => {
    const x0 = l.text.x0 + i * (w + l.gap)
    fn({ x0: u(x0), y0: u(l.cy - l.cap / 2), x1: u(x0 + w), y1: u(l.cy + l.cap / 2) }, u(l.stroke), m)
  })
  return m
}

/** The setting sun: a disc cut by four widening scanline bars and clipped at the horizon. */
function sunMask(size: number, u: (v: number) => number): Mask {
  const sun = new Mask(size, size).disc(u(0.5), u(0.435), u(0.3))
  const bars = new Mask(size, size)
  for (const [y, h] of [[0.556, 0.014], [0.604, 0.02], [0.646, 0.026], [0.688, 0.032]]) {
    bars.rect({ x0: 0, y0: u(y), x1: size, y1: u(y + h) })
  }
  bars.rect({ x0: 0, y0: u(HORIZON), x1: size, y1: size })
  return sun.sub(bars)
}

/** The perspective floor: rays to a vanishing point on the horizon plus three receding rungs. */
function gridMask(size: number, u: (v: number) => number): Mask {
  const g = new Mask(size, size)
  for (const x of [-0.75, -0.05, 0.28, 0.72, 1.05, 1.75]) {
    g.poly([[u(0.496), u(HORIZON)], [u(0.504), u(HORIZON)], [u(x + 0.012), size], [u(x - 0.012), size]])
  }
  for (const [y, h] of [[0.765, 0.004], [0.83, 0.005], [0.905, 0.007]]) {
    g.rect({ x0: 0, y0: u(y), x1: size, y1: u(y + h) })
  }
  return g
}

/** The plate, its neon rim, the label line, the sun and the grid. Returns the inner (clip) mask. */
function paintPlate(cv: Canvas, l: Layout, detail: number, u: (v: number) => number): Mask {
  const size = cv.w
  const plate = new Mask(size, size).poly(platePoly(l, u))
  const rimW = Math.max(1, Math.round(u(l.rim)))
  const inner = plate.inset(rimW)
  const band = { y0: u(l.plate.y0), y1: u(l.plate.y1), alpha: 1 }
  cv.paint(plate, { stops: [[0, CYAN], [0.45, ACCENT], [1, MAGENTA]], ...band })
  const ground: [number, RGBA][] = [[0, mix(BG, [0, 0, 0, 255], 0.35)], [0.5, mix(BG, ACCENT, 0.28)], [1, mix(BG, MAGENTA, 0.72)]]
  cv.paint(inner, { stops: ground, ...band })
  if (detail >= 1) {
    cv.paint(inner.inset(rimW).sub(inner.inset(rimW * 2.2)), solid(ACCENT_HI, 0.32))
    const sun: [number, RGBA][] = [[0, ACCENT_HI], [0.55, ACCENT], [1, MAGENTA]]
    cv.paint(sunMask(size, u).and(inner), { stops: sun, y0: u(0.21), y1: u(HORIZON), alpha: 0.92 })
  }
  if (detail >= 2) cv.paint(gridMask(size, u).and(inner), solid(CYAN, 0.4))
  if (l.horizon) paintHorizon(cv, inner, detail, u)
  return inner
}

/** The horizon: a soft cyan glow band with a bright line sitting on it. */
function paintHorizon(cv: Canvas, inner: Mask, detail: number, u: (v: number) => number): void {
  const size = cv.w
  const glow = new Mask(size, size).rect({ x0: 0, y0: u(HORIZON - 0.014), x1: size, y1: u(HORIZON + 0.026) })
  cv.paint(glow.and(inner), solid(CYAN, detail >= 1 ? 0.35 : 0.5))
  const line = new Mask(size, size).rect({ x0: 0, y0: u(HORIZON - 0.006), x1: size, y1: u(HORIZON + 0.014) })
  cv.paint(line.and(inner), solid(detail >= 1 ? ACCENT_HI : CYAN, 1))
}

/** "EQZ": chromatic fringe, accent outline, then the near-white core. */
function paintLetters(cv: Canvas, l: Layout, detail: number, u: (v: number) => number): void {
  const size = cv.w
  const core = lettersMask(size, l, u)
  const body = detail >= 1 ? core.dilate(Math.max(1, Math.round(size * 0.008))) : core
  if (detail >= 2) {
    const off = Math.max(1, Math.round(size * 0.012))
    cv.paint(body.shift(-off, 0), solid(MAGENTA, 0.85))
    cv.paint(body.shift(off, 0), solid(CYAN, 0.85))
  }
  if (detail >= 1) cv.paint(body.clone().sub(core), solid(ACCENT, 1))
  cv.paint(core, solid(TEXT, 1))
}

/**
 * One frame, drawn at 4x supersample and resolved.
 * `detail`: 2 = the full picture (grid + chromatic fringe), 1 = sun + outline, 0 = plate + letters.
 */
function render(size: number): Canvas {
  const detail = size >= 128 ? 2 : size >= 48 ? 1 : 0
  const l = size >= 64 ? LAYOUT.big : size >= 24 ? LAYOUT.small : LAYOUT.tiny
  const ss = 4
  const cv = new Canvas(size * ss, size * ss)
  // Unit coordinate -> supersampled pixel. `snap` rounds to a whole DEVICE pixel first.
  const u = l.snap ? (v: number): number => Math.round(v * size) * ss : (v: number): number => v * size * ss
  paintPlate(cv, l, detail, u)
  paintLetters(cv, l, detail, u)
  return cv.downscale(ss)
}

// --- minimal PNG encoder (RGBA, no filtering) ---
function crc32(buf: Uint8Array): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePng(cv: Canvas): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(cv.w, 0)
  ihdr.writeUInt32BE(cv.h, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // depth 8, colour type 6 (RGBA), deflate, no filter, no interlace
  const stride = cv.w * 4
  const raw = Buffer.alloc((stride + 1) * cv.h)
  for (let y = 0; y < cv.h; y++) {
    raw[y * (stride + 1)] = 0 // per-scanline filter type 0
    Buffer.from(cv.px.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// --- ICO container: PNG-in-ICO frames ---
function buildIco(frames: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // reserved 0, then type 1 = icon
  header.writeUInt16LE(frames.length, 4)
  const dir: Buffer[] = []
  let offset = 6 + frames.length * 16
  for (const f of frames) {
    const e = Buffer.alloc(16)
    e[0] = f.size >= 256 ? 0 : f.size // width (0 = 256)
    e[1] = f.size >= 256 ? 0 : f.size // height
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(f.png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += f.png.length
    dir.push(e)
  }
  return Buffer.concat([header, ...dir, ...frames.map((f) => f.png)])
}

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'build')
mkdirSync(outDir, { recursive: true })

const master = render(256)
const masterPng = encodePng(master)
writeFileSync(join(outDir, 'icon.png'), masterPng)

// THE TRAY FRAME, drawn at its own size. `src/main/tray.ts` today does
// `nativeImage.createFromPath(icon.png).resize({ width: 16, height: 16 })` — a 16:1 downscale of
// the 256 master, which averages the letters into one bright blob (see the -tray-16 preview).
// This is the same mark drawn at 32px with pixel-snapped 2px strokes, so the notification area
// gets a legible "EQZ". Wiring it up is a one-line import change in tray.ts.
writeFileSync(join(outDir, 'icon-tray.png'), encodePng(render(32)))

const sizes = [256, 128, 64, 48, 32, 16]
const frames = sizes.map((size) => ({ size, png: encodePng(size === 256 ? master : render(size)) }))
const ico = buildIco(frames)
writeFileSync(join(outDir, 'icon.ico'), ico)

console.log(`wrote build/icon.png (${masterPng.length} bytes, 256x256) + build/icon-tray.png (32x32)`)
console.log(`wrote build/icon.ico (${ico.length} bytes, frames: ${sizes.join('/')})`)

const previewDir = process.env.EQ_ICON_PREVIEW
if (previewDir !== undefined && previewDir !== '') {
  mkdirSync(previewDir, { recursive: true })
  for (const size of [64, 48, 32, 16]) {
    const frame = render(size)
    writeFileSync(join(previewDir, `icon-preview-${size}.png`), encodePng(frame))
    writeFileSync(join(previewDir, `icon-preview-${size}-x8.png`), encodePng(frame.magnify(8)))
  }
  // What the tray shows TODAY: the 256 master crushed to 16px.
  const trayNow = master.downscale(16)
  writeFileSync(join(previewDir, 'icon-preview-tray-16.png'), encodePng(trayNow))
  writeFileSync(join(previewDir, 'icon-preview-tray-16-x8.png'), encodePng(trayNow.magnify(8)))
  console.log(`wrote previews to ${previewDir}`)
}
