/**
 * The recolour rules: how a default-skin pixel or XML colour becomes the app's "Midnight &
 * arcane" palette. Pure; every rule keeps luminance (texture pixels) and never touches alpha.
 *
 * Textures (chrome only - the builder decides WHICH pixels via masks):
 *   neutral stone / steel  -> navy (paper's hue) in the shadows, drifting to violet in highlights
 *   gold / bronze trim     -> accent violet; bright gold lands on accentHi naturally
 *   blue                   -> cyan
 *   anything else (red gems, green lights) is left as drawn.
 * Low-chroma pixels blend smoothly between the neutral and the coloured treatment, so an
 * anti-aliased gold edge does not seam.
 *
 * XML colours are snapped by hue to a palette token (`mapXmlColor`), with the rule chosen by the
 * element: a gauge fill gets the gauge set (HP red, mana cyan, endurance amber), text gets the
 * text set, and a tint keeps neutrals as they are.
 */
import { PALETTE } from '../../shared/palette'
import { type Rgb, hexToRgb, hslToRgb, luma, mix, rgbToHsl, smoothstep, withLuminance } from './color'

const P = {
  paper: hexToRgb(PALETTE.paper),
  text: hexToRgb(PALETTE.text),
  accent: hexToRgb(PALETTE.accent),
  accentHi: hexToRgb(PALETTE.accentHi),
  cyan: hexToRgb(PALETTE.cyan),
  green: hexToRgb(PALETTE.green),
  amber: hexToRgb(PALETTE.amber),
  red: hexToRgb(PALETTE.red),
  magenta: hexToRgb(PALETTE.magenta)
}

const NAVY_HUE = rgbToHsl(P.paper).h
const VIOLET_HUE = rgbToHsl(P.accent).h
const CYAN_HUE = rgbToHsl(P.cyan).h

export type HueFamily = 'red' | 'gold' | 'green' | 'blue' | 'violet' | 'magenta'

/** Which named family a hue (degrees) belongs to. Gold spans orange through yellow. */
export function hueFamily(h: number): HueFamily {
  if (h < 18 || h >= 345) return 'red'
  if (h < 72) return 'gold'
  if (h < 170) return 'green'
  if (h < 255) return 'blue'
  if (h < 315) return 'violet'
  return 'magenta'
}

/** The neutral treatment: navy in the shadows, a soft violet in the highlights, same luma. */
function neutralPixel(c: Rgb, y: number): Rgb {
  const l = y / 255
  const hue = NAVY_HUE + (VIOLET_HUE - NAVY_HUE) * smoothstep(0.35, 0.85, l)
  const sat = 0.06 + 0.3 * (1 - l) ** 1.5
  return withLuminance(hslToRgb({ h: hue, s: sat, l: Math.max(0.02, rgbToHsl(c).l) }), y)
}

function huePixel(c: Rgb, y: number, hue: number): Rgb {
  const { s, l } = rgbToHsl(c)
  return withLuminance(hslToRgb({ h: hue, s: Math.max(0.55, s), l }), y)
}

/** Recolours one chrome pixel. Returns the input unchanged for hues the skin does not own. */
export function recolorPixel(c: Rgb): Rgb {
  const y = luma(c)
  const chroma = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])
  const coloured = smoothstep(14, 46, chroma)
  const neutral = neutralPixel(c, y)
  if (coloured === 0) return neutral
  const fam = hueFamily(rgbToHsl(c).h)
  let target: Rgb
  if (fam === 'gold') target = huePixel(c, y, VIOLET_HUE)
  else if (fam === 'blue') target = huePixel(c, y, CYAN_HUE)
  else target = c
  return mix(neutral, target, coloured)
}

/**
 * Recolours an RGBA buffer in place where `mask[i]` is non-zero. Alpha bytes are never written.
 * A small cache keeps a 256x256 atlas to a few thousand distinct colour computations.
 */
export function recolorRgba(rgba: Uint8Array, mask: Uint8Array | null): number {
  const cache = new Map<number, Rgb>()
  let changed = 0
  const n = rgba.length / 4
  for (let i = 0; i < n; i++) {
    if (mask?.[i] === 0) continue
    const o = i * 4
    if (rgba[o + 3] === 0) continue
    const r = rgba[o] ?? 0
    const g = rgba[o + 1] ?? 0
    const b = rgba[o + 2] ?? 0
    const key = (r << 16) | (g << 8) | b
    let out = cache.get(key)
    if (!out) {
      out = recolorPixel([r, g, b])
      cache.set(key, out)
    }
    if (out[0] !== r || out[1] !== g || out[2] !== b) changed++
    rgba[o] = out[0]
    rgba[o + 1] = out[1]
    rgba[o + 2] = out[2]
  }
  return changed
}

// ---------------------------------------------------------------------------------- XML colours

export type XmlColorRole = 'gauge' | 'text' | 'tint'

/** The colour elements the generator rewrites, by role. Anything else is left byte-identical. */
export const XML_COLOR_ROLES: Readonly<Record<string, XmlColorRole>> = {
  FillTint: 'gauge',
  LinesFillTint: 'gauge',
  TextColor: 'text',
  TabTextColor: 'text',
  TabTextActiveColor: 'text',
  MouseoverColor: 'text',
  PressedColor: 'text',
  DisabledColor: 'text',
  MiddleTint: 'tint',
  BackgroundTextureTint: 'tint',
  DisabledBackgroundTextureTint: 'tint',
  Tint1: 'tint',
  Tint2: 'tint'
}

const GAUGE_BY_FAMILY: Record<HueFamily, Rgb> = {
  red: P.red,
  gold: P.amber,
  green: P.green,
  blue: P.cyan,
  violet: P.accent,
  magenta: P.magenta
}

const TEXT_BY_FAMILY: Record<HueFamily, Rgb> = {
  red: P.red,
  gold: P.accentHi,
  green: P.green,
  blue: P.cyan,
  violet: P.accentHi,
  magenta: P.magenta
}

/** A colour with chroma below this is treated as a grey. */
const NEUTRAL_CHROMA = 40

/**
 * Maps one XML colour to the palette. Dark text (drawn on light buttons) and every neutral tint
 * stay exactly as they were; a dim saturated colour keeps its dimness.
 */
export function mapXmlColor(c: Rgb, role: XmlColorRole): Rgb {
  const chroma = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])
  const y = luma(c)
  if (chroma < NEUTRAL_CHROMA) {
    if (role !== 'text' || y < 64) return c
    // A light grey becomes the app's text colour, at the original brightness.
    return withLuminance(P.text, y)
  }
  const fam = hueFamily(rgbToHsl(c).h)
  const target = (role === 'text' ? TEXT_BY_FAMILY : GAUGE_BY_FAMILY)[fam]
  if (role === 'tint') return withLuminance(target, y)
  const v = Math.max(c[0], c[1], c[2]) / 255
  // A gauge always takes the token; text keeps a deliberately dim colour dim.
  return role === 'gauge' || v >= 0.55 ? target : withLuminance(target, y)
}
