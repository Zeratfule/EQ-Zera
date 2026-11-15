/**
 * The retrowave ornament layer (look.ts): drawn OVER a piece the clean painter (paint.ts) already
 * drew, at the same size. Everything here is decoration that a tiled or stretched piece survives:
 * a gradient that must run across a whole title bar is split between its left cap (magenta),
 * middle (violet) and right cap (cyan), and nothing that would repeat badly is put on a piece
 * that tiles.
 */
import { PALETTE } from '../../shared/palette'
import type { Look } from './look'
import type { Dir, FrameVariant, Piece, State } from './pieceKinds'
import { type Canvas, type Rect, type Rgba, fillPolygon, fillRoundRect, glowRoundRect, line, strokeRoundRect } from './raster'

const hex = (h: string, a = 1): Rgba => {
  const n = parseInt(h.slice(1, 7), 16)
  return [n >> 16, (n >> 8) & 255, n & 255, a]
}
const lerp = (a: Rgba, b: Rgba, t: number): Rgba => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
  a[3] + (b[3] - a[3]) * t
]

const MAGENTA = hex(PALETTE.magenta)
const VIOLET = hex(PALETTE.accent)
const CYAN = hex(PALETTE.cyan)
const HI = hex(PALETTE.accentHi)
const AMBER = hex(PALETTE.amber)
const SHADE: Rgba = [0, 0, 0, 1]

/** The NEON rule at position t (0..1): magenta -> violet -> cyan. */
export function neon(t: number, alpha = 1): Rgba {
  const c = t < 0.5 ? lerp(MAGENTA, VIOLET, t * 2) : lerp(VIOLET, CYAN, (t - 0.5) * 2)
  return [c[0], c[1], c[2], alpha]
}

function diamond(c: Canvas, at: { x: number; y: number; r: number }, color: Rgba): void {
  const { x, y, r } = at
  fillPolygon(c, [[x, y - r], [x + r, y], [x, y + r], [x - r, y]], color)
}

function isCorner(dir: Dir): boolean {
  return dir === 'TopLeft' || dir === 'TopRight' || dir === 'BottomLeft' || dir === 'BottomRight'
}

/** A second line inside the frame's edge, a corner rivet, and extra bloom. */
export function frameOrnament(c: Canvas, at: { dir: Dir; variant: FrameVariant; panel: Rect; radius: number }, look: Look): void {
  if (at.variant === 'inner' || at.variant === 'highlight' || at.variant === 'black') return
  const p = at.panel
  if (look.bloom > 1 && p.x > 0) glowRoundRect(c, p, at.radius, { spread: 3, color: hex(PALETTE.accent, (look.bloom - 1) * 0.35) })
  if (look.innerLine) {
    const inset = Math.min(c.w, c.h) >= 5 ? 2 : 1
    const inner = { x: p.x + inset, y: p.y + inset, w: p.w - inset * 2, h: p.h - inset * 2 }
    strokeRoundRect(c, inner, Math.max(1, at.radius - inset), { width: 1, paint: look.innerLine })
  }
  if (look.rivets) rivet(c, at.dir, p)
}

/** A diamond rivet tucked into a corner piece with room for one. */
function rivet(c: Canvas, dir: Dir, p: Rect): void {
  if (!isCorner(dir) || Math.min(c.w, c.h) < 5) return
  const x = dir.endsWith('Left') ? p.x + 3.5 : p.x + p.w - 3.5
  const y = dir.startsWith('Top') ? p.y + 3.5 : p.y + p.h - 3.5
  diamond(c, { x, y, r: 1.6 }, HI)
}

/** The neon title: scanlines, a gradient band, the gradient hairline, chevron caps, the sun. */
export function titleOrnament(c: Canvas, dir: Dir, look: Look): void {
  const [from, to]: [number, number] = dir === 'Left' ? [0, 0.5] : dir === 'Right' ? [0.5, 1] : [0.5, 0.5]
  titleLines(c, (x) => from + (to - from) * (x / Math.max(1, c.w - 1)), look)
  if (look.sun && dir === 'Left' && c.w >= 10) retroSun(c)
  if (look.chevrons && dir !== 'Middle' && c.w >= 8) chevrons(c, dir === 'Left')
}

/** Scanlines, the neon band and hairline; `at` maps a column to its place in the NEON rule. */
function titleLines(c: Canvas, at: (x: number) => number, look: Look): void {
  if (look.titleScan > 0) for (let y = 1; y < c.h - 1; y += 2) fillRoundRect(c, { x: 0, y, w: c.w, h: 1 }, 0, [0, 0, 0, look.titleScan])
  if (look.titleBand > 0) fillRoundRect(c, { x: 0, y: 2, w: c.w, h: c.h - 4 }, 0, (x) => neon(at(x), look.titleBand))
  if (look.neonHairline) fillRoundRect(c, { x: 0, y: c.h - 1, w: c.w, h: 1 }, 0, (x) => neon(at(x), 0.95))
  // From the ornamental step up, the hairline blooms upward and the bar gets a lit top edge.
  if (look.chevrons) {
    fillRoundRect(c, { x: 0, y: c.h - 2, w: c.w, h: 1 }, 0, (x) => neon(at(x), 0.4))
    fillRoundRect(c, { x: 0, y: 0, w: c.w, h: 1 }, 0, hex(PALETTE.accentHi, 0.3))
  }
}

function chevrons(c: Canvas, pointRight: boolean): void {
  const cy = c.h / 2
  for (const k of [0, 3]) {
    const x = pointRight ? c.w - 7 + k : 4 - k
    const d = pointRight ? 2 : -2
    line(c, [x, cy - 2.5, x + d, cy], 1, HI)
    line(c, [x + d, cy, x, cy + 2.5], 1, HI)
  }
}

/** The striped retro sun: a half disc, magenta to amber, cut by widening dark gaps. */
function retroSun(c: Canvas): void {
  const r = Math.min(5.5, c.h / 2 - 2)
  const cx = r + 1
  const cy = c.h - 2
  for (let y = Math.floor(cy - r); y < cy; y++) {
    const fromTop = (y - (cy - r)) / r
    if (fromTop > 0.45 && Math.floor((y - (cy - r)) / 1.5) % 2 === 1) continue
    const half = Math.sqrt(Math.max(0, r * r - (cy - y - 0.5) ** 2))
    fillRoundRect(c, { x: cx - half, y, w: half * 2, h: 1 }, 0, lerp(MAGENTA, AMBER, 1 - fromTop))
  }
}

/** Under a button's glyph: a top-lit bevel, more bloom on hover, an inner glow when pressed. */
export function buttonOrnament(c: Canvas, at: { state: State; radius: number }, look: Look): void {
  const r = { x: 1, y: 1, w: c.w - 2, h: c.h - 2 }
  if (look.bevel) {
    fillRoundRect(c, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, Math.max(0, at.radius - 1), (_x, y) => {
      const t = (y - r.y) / Math.max(1, r.h)
      return t < 0.5 ? [255, 255, 255, 0.1 * (1 - t * 2)] : [0, 0, 0, 0.28 * (t - 0.5) * 2]
    })
  }
  const pressed = at.state === 'pressed' || at.state === 'pressedFlyby'
  if (pressed && look.pressedGlow) {
    strokeRoundRect(c, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, at.radius, { width: 2, paint: look.pressedGlow })
  }
  if (look.bloom > 1 && (at.state === 'flyby' || at.state === 'pressedFlyby')) {
    glowRoundRect(c, r, at.radius, { spread: 1.5, color: hex(PALETTE.accent, (look.bloom - 1) * 0.5) })
  }
}

/** L-shaped neon ticks in the four corners of a hot-button slot. */
function ticks(c: Canvas): void {
  const n = Math.max(3, Math.round(Math.min(c.w, c.h) / 8))
  const e = 1.5
  const segs: [number, number, number, number][] = [
    [e, e, e + n, e], [e, e, e, e + n],
    [c.w - e, e, c.w - e - n, e], [c.w - e, e, c.w - e, e + n],
    [e, c.h - e, e + n, c.h - e], [e, c.h - e, e, c.h - e - n],
    [c.w - e, c.h - e, c.w - e - n, c.h - e], [c.w - e, c.h - e, c.w - e, c.h - e - n]
  ]
  for (const s of segs) line(c, s, 1, hex(PALETTE.cyan, 0.85))
}

/** A lit stripe near the top and a shaded lower half, on the fill's own pixels only (gaps stay clear). */
function gloss(c: Canvas): void {
  for (let i = 0; i < c.w * c.h; i++) {
    if ((c.px[i * 4 + 3] ?? 0) === 0) continue
    const y = Math.floor(i / c.w)
    const k = y === 1 ? 1.2 : y >= c.h / 2 ? 0.82 : 1
    for (let ch = 0; ch < 3; ch++) c.px[i * 4 + ch] = Math.min(255, Math.round((c.px[i * 4 + ch] ?? 0) * k))
  }
}

function gaugeCap(c: Canvas, dir: Dir | null): void {
  if (dir !== 'Left' && dir !== 'Right') return
  const x = dir === 'Left' ? 0 : c.w - 1
  fillRoundRect(c, { x, y: 1, w: 1, h: c.h - 2 }, 0, dir === 'Left' ? MAGENTA : CYAN)
}

function grip(c: Canvas, dir: Dir): void {
  if (dir !== 'Middle') return
  if (c.w > c.h) for (let y = 0; y < c.h; y += 2) fillRoundRect(c, { x: 4, y, w: c.w - 8, h: 1 }, 0, [SHADE[0], SHADE[1], SHADE[2], 0.3])
  else for (let x = 0; x < c.w; x += 2) fillRoundRect(c, { x, y: 4, w: 1, h: c.h - 8 }, 0, [0, 0, 0, 0.3])
}

/** The overlay pass for the kinds that carry ornament after their clean paint. */
type Ornamenter<K extends Piece['kind']> = (c: Canvas, piece: Extract<Piece, { kind: K }>, look: Look) => void

const ORNAMENTS: { [K in Piece['kind']]?: Ornamenter<K> } = {
  title: (c, p, look) => {
    titleOrnament(c, p.dir, look)
  },
  hotslot: (c, p, look) => {
    buttonOrnament(c, { state: p.state, radius: 3 }, look)
    if (look.ticks) ticks(c)
  },
  sliderThumb: (c, p, look) => {
    buttonOrnament(c, { state: p.state, radius: 3 }, look)
  },
  gaugeFill: (c, _p, look) => {
    if (look.gloss) gloss(c)
  },
  gaugeTrack: (c, p, look) => {
    if (look.gloss) gaugeCap(c, p.dir)
  },
  divider: (c, p, look) => {
    if (look.diamond && !p.vertical && c.w >= 16) diamond(c, { x: c.w / 2, y: c.h / 2, r: Math.min(3, c.h / 2) }, HI)
  },
  thumb: (c, p, look) => {
    if (look.grip) grip(c, p.dir)
  }
}

export function pieceOrnament(c: Canvas, piece: Piece, look: Look): void {
  const fn = ORNAMENTS[piece.kind] as Ornamenter<Piece['kind']> | undefined
  fn?.(c, piece, look)
}
