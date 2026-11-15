/**
 * How much retrowave ornament the drawn skin carries. One switch, four steps, all built from what
 * the app already uses: the NEON rule (magenta -> violet -> cyan, magenta for gradients and glows
 * only), the accent glow, the violet-to-cyan hairline and the 4.5% accent grid of the app's ground.
 *
 *   clean       flat panels and a violet edge (the first EQ Zera draft)
 *   subtle      + neon title hairline, bevelled buttons, divider diamonds, a grip
 *   ornamental  + double-line frames, corner rivets, chevron title caps, hot-slot corner ticks,
 *                 title scanlines
 *   synthwave   + magenta inner lines, a neon title band, the striped retro sun on title bars,
 *                 stronger bloom, magenta pressed glow
 *
 * Window CONTENT is black at every step (owner, in game: chat colours are player-chosen, and only
 * black gives all of them contrast), so no ornament ever sits under text.
 */
import { PALETTE } from '../../shared/palette'
import type { Rgba } from './raster'

export type SkinStyle = 'clean' | 'subtle' | 'ornamental' | 'synthwave'

export const SKIN_STYLES: readonly SkinStyle[] = ['clean', 'subtle', 'ornamental', 'synthwave']

/** What a build uses when nobody picked: the middle step, ornament without clutter. */
export const DEFAULT_STYLE: SkinStyle = 'ornamental'

export interface Look {
  style: SkinStyle
  /** title hairline runs magenta -> violet -> cyan instead of plain violet */
  neonHairline: boolean
  /** buttons get a top-lit vertical bevel */
  bevel: boolean
  /** a small diamond in the middle of dividers wide enough to hold one */
  diamond: boolean
  /** grip lines on the scrollbar thumb */
  grip: boolean
  /** a second, inner frame line; null for none */
  innerLine: Rgba | null
  /** diamond rivets on frame and title corners */
  rivets: boolean
  /** corner ticks on hot-button slots */
  ticks: boolean
  /** chevrons on the title bar's end caps */
  chevrons: boolean
  /** alpha of the darkened every-other row on title bars */
  titleScan: number
  /** alpha of the neon band across the title bar */
  titleBand: number
  /** the striped retro sun at the title bar's left end */
  sun: boolean
  /** glow strength multiplier */
  bloom: number
  /** inner glow on pressed buttons; null for none */
  pressedGlow: Rgba | null
}

const hex = (h: string, a: number): Rgba => {
  const n = parseInt(h.slice(1, 7), 16)
  return [n >> 16, (n >> 8) & 255, n & 255, a]
}

const CLEAN: Look = {
  style: 'clean',
  neonHairline: false,
  bevel: false,
  diamond: false,
  grip: false,
  innerLine: null,
  rivets: false,
  ticks: false,
  chevrons: false,
  titleScan: 0,
  titleBand: 0,
  sun: false,
  bloom: 1,
  pressedGlow: null
}

const SUBTLE: Look = { ...CLEAN, style: 'subtle', neonHairline: true, bevel: true, diamond: true, grip: true }

const ORNAMENTAL: Look = {
  ...SUBTLE,
  style: 'ornamental',
  innerLine: hex(PALETTE.cyan, 0.4),
  rivets: true,
  ticks: true,
  chevrons: true,
  titleScan: 0.12,
  bloom: 1.2,
  pressedGlow: hex(PALETTE.accent, 0.45)
}

const SYNTHWAVE: Look = {
  ...ORNAMENTAL,
  style: 'synthwave',
  innerLine: hex(PALETTE.magenta, 0.5),
  titleScan: 0.16,
  titleBand: 0.32,
  sun: true,
  bloom: 1.6,
  pressedGlow: hex(PALETTE.magenta, 0.5)
}

const LOOKS: Record<SkinStyle, Look> = { clean: CLEAN, subtle: SUBTLE, ornamental: ORNAMENTAL, synthwave: SYNTHWAVE }

export function lookFor(style: SkinStyle): Look {
  return LOOKS[style]
}

export function isSkinStyle(v: unknown): v is SkinStyle {
  return typeof v === 'string' && (SKIN_STYLES as readonly string[]).includes(v)
}
