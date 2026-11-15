/**
 * Colour arithmetic for the in-game skin generator. Pure, 0..255 channels throughout.
 *
 * "Luminance" here is Rec. 709 luma over the stored (gamma-encoded) values: the recolour keeps
 * each pixel as bright as the original artist drew it and only moves its hue and saturation.
 */

export type Rgb = readonly [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

export function luma(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** Hue in degrees [0, 360), saturation and lightness in [0, 1]. */
export interface Hsl {
  h: number
  s: number
  l: number
}

export function rgbToHsl(c: Rgb): Hsl {
  const r = c[0] / 255
  const g = c[1] / 255
  const b = c[2] / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  return [clamp((r + m) * 255), clamp((g + m) * 255), clamp((b + m) * 255)]
}

export function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

/**
 * `c` rescaled so its luma is `y`. When scaling alone would clip a channel, the rest of the way
 * is made up by mixing toward white, so the result still lands on `y` (within rounding).
 */
export function withLuminance(c: Rgb, y: number): Rgb {
  const cur = luma(c)
  if (y <= 0) return [0, 0, 0]
  if (y >= 255) return [255, 255, 255]
  if (cur <= 0.0001) return [clamp(y), clamp(y), clamp(y)]
  const k = y / cur
  const scaled: [number, number, number] = [c[0] * k, c[1] * k, c[2] * k]
  if (Math.max(...scaled) <= 255) return [clamp(scaled[0]), clamp(scaled[1]), clamp(scaled[2])]
  // Scale to the brightest the hue allows, then mix toward white for the remaining luma.
  const top = Math.max(c[0], c[1], c[2])
  const full: Rgb = [(c[0] * 255) / top, (c[1] * 255) / top, (c[2] * 255) / top]
  const fy = luma(full)
  const t = (y - fy) / (255 - fy)
  return [clamp(full[0] + (255 - full[0]) * t), clamp(full[1] + (255 - full[1]) * t), clamp(full[2] + (255 - full[2]) * t)]
}

/** Smooth 0..1 ramp between `a` and `b`. */
export function smoothstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)]
}
