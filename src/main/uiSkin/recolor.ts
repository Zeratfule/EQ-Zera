/**
 * The XML colour rules: how a colour in the base skin's window XML becomes the app's "Midnight &
 * arcane" palette. Snapped by hue to a token, with the rule chosen by the element: a gauge fill
 * gets the gauge set (HP red, mana cyan, endurance amber), text gets the text set (light greys are
 * the app's text colour, gold headings accentHi, blue links cyan), and a tint keeps neutrals.
 */
import { PALETTE } from '../../shared/palette'
import { type Rgb, hexToRgb, luma, rgbToHsl, withLuminance } from './color'

const P = {
  text: hexToRgb(PALETTE.text),
  accent: hexToRgb(PALETTE.accent),
  accentHi: hexToRgb(PALETTE.accentHi),
  cyan: hexToRgb(PALETTE.cyan),
  green: hexToRgb(PALETTE.green),
  amber: hexToRgb(PALETTE.amber),
  red: hexToRgb(PALETTE.red),
  magenta: hexToRgb(PALETTE.magenta)
}

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
/** A grey at least this bright is body text, and becomes the app's text colour exactly. */
const BODY_TEXT_LUMA = 200

/**
 * Maps one XML colour to the palette. Dark text and every neutral tint stay exactly as they were;
 * a mid grey (disabled text) keeps its brightness in the text colour's hue; a dim saturated text
 * colour keeps its dimness.
 */
export function mapXmlColor(c: Rgb, role: XmlColorRole): Rgb {
  const chroma = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])
  const y = luma(c)
  if (chroma < NEUTRAL_CHROMA) {
    if (role !== 'text' || y < 64) return c
    return y >= BODY_TEXT_LUMA ? P.text : withLuminance(P.text, y)
  }
  const fam = hueFamily(rgbToHsl(c).h)
  const target = (role === 'text' ? TEXT_BY_FAMILY : GAUGE_BY_FAMILY)[fam]
  if (role === 'tint') return withLuminance(target, y)
  const v = Math.max(c[0], c[1], c[2]) / 255
  // A gauge always takes the token; text keeps a deliberately dim colour dim.
  return role === 'gauge' || v >= 0.55 ? target : withLuminance(target, y)
}
