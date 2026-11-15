/**
 * Draws one piece of chrome, at the exact size the game's XML cuts it, in the EQ Zera app's own
 * visual language (renderer/src/theme/theme.ts): flat midnight panels, 1px accent-violet edges with
 * a soft outer glow, small radii, accentHi on hover, a tinted fill when pressed, cyan for the
 * secondary/selected accents, and the neon hairline under headers. Every pixel is drawn here; none
 * is taken from Daybreak's art.
 */
import { PALETTE } from '../../shared/palette'
import { type Rgb, hexToRgb } from './color'
import { drawText, GLYPH_H, textWidth } from './font5x7'
import type { Dir, FrameVariant, Glyph, Piece, State } from './pieceKinds'
import { type Look, lookFor } from './look'
import { buttonOrnament, frameOrnament, pieceOrnament } from './ornament'
import { Canvas, type Rect, type Rgba, fillPolygon, fillRoundRect, glowRoundRect, line, strokeRoundRect } from './raster'

const rgba = (hex: string, a = 1): Rgba => {
  const c = hexToRgb(hex)
  return [c[0], c[1], c[2], a]
}
const mixHex = (a: string, b: string, t: number, alpha = 1): Rgba => {
  const x: Rgb = hexToRgb(a)
  const y: Rgb = hexToRgb(b)
  return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t, alpha]
}

export const STYLE = {
  bg: rgba(PALETTE.bg),
  paper: rgba(PALETTE.paper),
  paperLift: mixHex(PALETTE.paper, PALETTE.accent, 0.1),
  edge: rgba(PALETTE.accent, 0.55),
  edgeSoft: rgba(PALETTE.accent, 0.3),
  edgeHi: rgba(PALETTE.accentHi, 0.95),
  glow: rgba(PALETTE.accent, 0.4),
  text: rgba(PALETTE.text),
  textDim: rgba(PALETTE.text, 0.3),
  label: rgba(PALETTE.accentHi, 0.5),
  accent: rgba(PALETTE.accent),
  cyan: rgba(PALETTE.cyan),
  ink: rgba(PALETTE.ink)
}

const FAR = 4096

/** The edges of a panel a frame piece belongs to, from its position word. */
function edgesOf(dir: Dir): { top: boolean; bottom: boolean; left: boolean; right: boolean } {
  return {
    top: dir === 'Top' || dir === 'TopLeft' || dir === 'TopRight',
    bottom: dir === 'Bottom' || dir === 'BottomLeft' || dir === 'BottomRight',
    left: dir.startsWith('Left') || dir === 'TopLeft' || dir === 'BottomLeft',
    right: dir.startsWith('Right') || dir === 'TopRight' || dir === 'BottomRight'
  }
}

/** The virtual panel a piece is a window onto: present edges inset by `m`, absent ones far away. */
function virtualPanel(dir: Dir, w: number, h: number, m: number): Rect {
  const e = edgesOf(dir)
  const x0 = e.left ? m : -FAR
  const x1 = e.right ? w - m : w + FAR
  const y0 = e.top ? m : -FAR
  const y1 = e.bottom ? h - m : h + FAR
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

const FRAME_LOOK: Record<FrameVariant, { fill: Rgba | null; edge: Rgba; glow: boolean }> = {
  solid: { fill: STYLE.paper, edge: STYLE.edge, glow: true },
  tooltip: { fill: STYLE.paper, edge: STYLE.edge, glow: true },
  trans: { fill: rgba(PALETTE.paper, 0.72), edge: rgba(PALETTE.accent, 0.45), glow: false },
  black: { fill: STYLE.bg, edge: rgba(PALETTE.accent, 0.2), glow: false },
  inner: { fill: null, edge: STYLE.edgeSoft, glow: false },
  highlight: { fill: null, edge: STYLE.edgeHi, glow: false }
}

function paintFrame(c: Canvas, at: { dir: Dir; variant: FrameVariant }, look: Look): void {
  const { dir, variant } = at
  const e = edgesOf(dir)
  const thick = Math.min(e.left || e.right ? c.w : FAR, e.top || e.bottom ? c.h : FAR)
  const frame = FRAME_LOOK[variant]
  const margin = frame.glow && thick >= 5 ? 2 : 0
  const panel = virtualPanel(dir, c.w, c.h, margin)
  const radius = thick >= 5 ? 4 : 2
  if (margin) glowRoundRect(c, panel, radius, { spread: margin + 1, color: STYLE.glow })
  if (frame.fill) fillRoundRect(c, panel, radius, frame.fill)
  strokeRoundRect(c, panel, radius, { width: 1, paint: frame.edge })
  frameOrnament(c, { dir, variant, panel, radius }, look)
}

function paintTitle(c: Canvas): void {
  const top = STYLE.paperLift
  const bottom = STYLE.paper
  fillRoundRect(c, { x: 0, y: 0, w: c.w, h: c.h }, 0, (_x, y) => {
    const t = y / Math.max(1, c.h - 1)
    return [top[0] + (bottom[0] - top[0]) * t, top[1] + (bottom[1] - top[1]) * t, top[2] + (bottom[2] - top[2]) * t, 1]
  })
  fillRoundRect(c, { x: 0, y: c.h - 1, w: c.w, h: 1 }, 0, rgba(PALETTE.accent, 0.5))
}

interface ButtonLook {
  fill: Rgba
  edge: Rgba
  glow: boolean
  ink: Rgba
}

function buttonLook(state: State): ButtonLook {
  switch (state) {
    case 'flyby':
      return { fill: STYLE.paperLift, edge: STYLE.edgeHi, glow: true, ink: rgba(PALETTE.accentHi) }
    case 'pressed':
      return { fill: mixHex(PALETTE.paper, PALETTE.accent, 0.32), edge: STYLE.edgeHi, glow: false, ink: STYLE.cyan }
    case 'pressedFlyby':
      return { fill: mixHex(PALETTE.paper, PALETTE.accent, 0.4), edge: STYLE.edgeHi, glow: true, ink: STYLE.cyan }
    case 'disabled':
    case 'pressedDisabled':
      return { fill: STYLE.bg, edge: rgba(PALETTE.text, 0.14), glow: false, ink: STYLE.textDim }
    default:
      return { fill: STYLE.paper, edge: STYLE.edge, glow: false, ink: STYLE.text }
  }
}

function paintButton(c: Canvas, state: State, radius = 2): ButtonLook {
  const look = buttonLook(state)
  const r = { x: 1, y: 1, w: c.w - 2, h: c.h - 2 }
  if (look.glow) glowRoundRect(c, r, radius, { spread: 1.6, color: STYLE.glow })
  fillRoundRect(c, r, radius, look.fill)
  strokeRoundRect(c, r, radius, { width: 1, paint: look.edge })
  return look
}

const ARROWS: Record<'left' | 'right' | 'up' | 'down', (b: Rect) => [number, number][]> = {
  left: (b) => [[b.x + b.w * 0.25, b.y + b.h / 2], [b.x + b.w * 0.75, b.y + b.h * 0.2], [b.x + b.w * 0.75, b.y + b.h * 0.8]],
  right: (b) => [[b.x + b.w * 0.75, b.y + b.h / 2], [b.x + b.w * 0.25, b.y + b.h * 0.2], [b.x + b.w * 0.25, b.y + b.h * 0.8]],
  up: (b) => [[b.x + b.w / 2, b.y + b.h * 0.25], [b.x + b.w * 0.2, b.y + b.h * 0.75], [b.x + b.w * 0.8, b.y + b.h * 0.75]],
  down: (b) => [[b.x + b.w / 2, b.y + b.h * 0.75], [b.x + b.w * 0.2, b.y + b.h * 0.25], [b.x + b.w * 0.8, b.y + b.h * 0.25]]
}

function paintGlyph(c: Canvas, glyph: Glyph, ink: Rgba): void {
  const s = Math.max(5, Math.min(c.w, c.h) * 0.6)
  const b = { x: (c.w - s) / 2, y: (c.h - s) / 2, w: s, h: s }
  const stroke = Math.max(1, s / 6)
  if (glyph === 'x') {
    line(c, [b.x, b.y, b.x + s, b.y + s], stroke, ink)
    line(c, [b.x + s, b.y, b.x, b.y + s], stroke, ink)
  } else if (glyph === 'minus' || glyph === 'plus') {
    line(c, [b.x, b.y + s / 2, b.x + s, b.y + s / 2], stroke, ink)
    if (glyph === 'plus') line(c, [b.x + s / 2, b.y, b.x + s / 2, b.y + s], stroke, ink)
  } else if (glyph === 'square' || glyph === 'tile') {
    strokeRoundRect(c, b, 1, { width: stroke, paint: ink })
    if (glyph === 'tile') line(c, [b.x + s / 2, b.y, b.x + s / 2, b.y + s], stroke, ink)
  } else if (glyph === 'question') {
    drawText(c, '?', { x: Math.round((c.w - 5) / 2), y: Math.round((c.h - GLYPH_H) / 2) }, ink)
  } else {
    fillPolygon(c, ARROWS[glyph](b), ink)
  }
}

function paintCheck(c: Canvas, state: State, round: boolean): void {
  const s = Math.min(c.w, c.h) - 4
  const r = { x: Math.round((c.w - s) / 2), y: Math.round((c.h - s) / 2), w: s, h: s }
  const on = state === 'pressed' || state === 'pressedFlyby' || state === 'pressedDisabled'
  const off = state === 'disabled' || state === 'pressedDisabled'
  const radius = round ? s / 2 : 2
  fillRoundRect(c, r, radius, on && !off ? STYLE.accent : STYLE.bg)
  strokeRoundRect(c, r, radius, { width: 1, paint: off ? rgba(PALETTE.text, 0.2) : state === 'flyby' ? STYLE.edgeHi : STYLE.edge })
  if (!on) return
  const ink = off ? STYLE.textDim : STYLE.ink
  if (round) fillRoundRect(c, { x: r.x + s * 0.3, y: r.y + s * 0.3, w: s * 0.4, h: s * 0.4 }, s, ink)
  else {
    line(c, [r.x + s * 0.22, r.y + s * 0.52, r.x + s * 0.42, r.y + s * 0.72], 1.6, ink)
    line(c, [r.x + s * 0.42, r.y + s * 0.72, r.x + s * 0.78, r.y + s * 0.3], 1.6, ink)
  }
}

function paintSlider(c: Canvas, dir: Dir | null): void {
  const h = Math.max(3, Math.round(c.h / 4))
  const y = Math.round((c.h - h) / 2)
  const panel = dir ? { ...virtualPanel(dir, c.w, h, 1), y, h } : { x: 0, y, w: c.w, h }
  fillRoundRect(c, panel, h / 2, STYLE.bg)
  strokeRoundRect(c, panel, h / 2, { width: 1, paint: STYLE.edgeSoft })
}

function paintThumb(c: Canvas, dir: Dir): void {
  const vertical = dir === 'Top' || dir === 'Bottom' || (dir === 'Middle' && c.w > c.h)
  const inset = 2
  const r: Rect = vertical
    ? { x: inset, y: dir === 'Top' ? 1 : -FAR, w: c.w - inset * 2, h: dir === 'Bottom' ? c.h - 1 + FAR : FAR * 2 }
    : { x: dir === 'Left' ? 1 : -FAR, y: inset, w: dir === 'Right' ? c.w - 1 + FAR : FAR * 2, h: c.h - inset * 2 }
  fillRoundRect(c, r, 4, rgba(PALETTE.accent, 0.6))
}

function paintSlot(c: Canvas, label: string): void {
  const r = { x: 1, y: 1, w: c.w - 2, h: c.h - 2 }
  fillRoundRect(c, r, 3, STYLE.bg)
  strokeRoundRect(c, r, 3, { width: 1, paint: STYLE.edgeSoft })
  if (label && textWidth(label) <= c.w - 4) {
    drawText(c, label, { x: Math.round((c.w - textWidth(label)) / 2), y: Math.round((c.h - GLYPH_H) / 2) }, STYLE.label)
  }
}

function paintDivider(c: Canvas, vertical: boolean): void {
  if (vertical) {
    fillRoundRect(c, { x: Math.floor(c.w / 2), y: 0, w: 1, h: c.h }, 0, STYLE.edgeSoft)
    return
  }
  const a = rgba(PALETTE.accent, 0.5)
  const b = rgba(PALETTE.cyan, 0.3)
  fillRoundRect(c, { x: 0, y: Math.floor(c.h / 2), w: c.w, h: 1 }, 0, (x) => {
    const t = x / Math.max(1, c.w - 1)
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t]
  })
}

function paintHeader(c: Canvas, dir: Dir): void {
  fillRoundRect(c, { x: 0, y: 0, w: c.w, h: c.h }, 0, STYLE.paperLift)
  fillRoundRect(c, { x: 0, y: c.h - 1, w: c.w, h: 1 }, 0, rgba(PALETTE.accent, 0.45))
  if (dir === 'Left') fillRoundRect(c, { x: 0, y: 0, w: 1, h: c.h }, 0, STYLE.edgeSoft)
  if (dir === 'Right') fillRoundRect(c, { x: c.w - 1, y: 0, w: 1, h: c.h }, 0, STYLE.edgeSoft)
}

/** Draws `piece` into a fresh transparent canvas of exactly w x h. */
export function paintPiece(piece: Piece, size: { w: number; h: number }, look: Look = lookFor('clean')): Canvas {
  const { w, h } = size
  const c = new Canvas(w, h)
  switch (piece.kind) {
    case 'frame':
      paintFrame(c, piece, look)
      break
    case 'title':
      paintTitle(c)
      break
    case 'button':
      paintButton(c, piece.state)
      buttonOrnament(c, { state: piece.state, radius: 2 }, look)
      break
    case 'glyphButton': {
      const ink = paintButton(c, piece.state).ink
      buttonOrnament(c, { state: piece.state, radius: 2 }, look)
      paintGlyph(c, piece.glyph, ink)
      break
    }
    case 'glyph':
      paintGlyph(c, piece.glyph, STYLE.text)
      break
    case 'check':
    case 'radio':
      paintCheck(c, piece.state, piece.kind === 'radio')
      break
    default:
      paintOther(c, piece)
  }
  pieceOrnament(c, piece, look)
  return c
}

function paintOther(c: Canvas, piece: Piece): void {
  switch (piece.kind) {
    case 'sliderTrack':
      paintSlider(c, piece.dir)
      break
    case 'sliderThumb':
      paintButton(c, piece.state, 3)
      break
    case 'thumb':
      paintThumb(c, piece.dir)
      break
    default:
      paintSlotLike(c, piece)
  }
}

function paintSlotLike(c: Canvas, piece: Piece): void {
  switch (piece.kind) {
    case 'slot':
      paintSlot(c, piece.label)
      break
    case 'hotslot':
      paintButton(c, piece.state, 3)
      break
    case 'divider':
      paintDivider(c, piece.vertical)
      break
    case 'header':
      paintHeader(c, piece.dir)
      break
    case 'blank':
      fillRoundRect(c, { x: 0, y: 0, w: c.w, h: c.h }, 0, STYLE.bg)
      break
    default:
      break
  }
}
