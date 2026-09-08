// THE COLOUR TOKENS, MEASURED (EQ Zera, 2026-09-06).
//
// `src/shared/palette.ts` is the one source every surface paints from — the MUI theme, the
// overlay/tray bundles that have no theme, the main process's window backgrounds. The values are
// a design choice; what this suite pins is that the choice WORKS: every token used as text clears
// WCAG AA (4.5) on the ground it is used on, the tier ladder's dark ink clears it on every rung,
// the series tokens are pairwise distinct, and the opaque-overlay background is the same colour
// the translucent overlays already paint.

import test from 'node:test'
import assert from 'node:assert/strict'
import { PALETTE, withAlpha } from '../src/shared/palette'
import { OPAQUE_OVERLAY_BG } from '../src/shared/graphicsPrefs'
import { TIER_STYLES } from '../src/renderer/src/lib/tierChip'

const HEX = /^#[0-9a-f]{6}$/

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}
function lin(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}
function lum(hex: string): number {
  const [r, g, b] = rgb(hex)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('every token is a lowercase six-digit hex', () => {
  for (const [name, hex] of Object.entries(PALETTE)) assert.match(hex, HEX, name)
})

test('withAlpha spells a token as the rgba() the overlays paint', () => {
  assert.equal(withAlpha(PALETTE.accent, 0.5), 'rgba(167,139,250,0.5)')
  assert.equal(withAlpha(PALETTE.bg, 0), 'rgba(11,15,26,0)')
  // A template expression may hand it a string — the overlays pass `String(bgAlpha)`.
  assert.equal(withAlpha(PALETTE.bg, '0.65'), 'rgba(11,15,26,0.65)')
})

test('body text and every coloured token clear WCAG AA on the paper ground', () => {
  assert.ok(contrast(PALETTE.text, PALETTE.bg) >= 7, 'text on bg (AAA)')
  assert.ok(contrast(PALETTE.text, PALETTE.paper) >= 7, 'text on paper (AAA)')
  for (const name of ['accent', 'cyan', 'green', 'amber', 'red'] as const) {
    const ratio = contrast(PALETTE[name], PALETTE.paper)
    assert.ok(ratio >= 4.5, `${name} ${PALETTE[name]} on paper: ${ratio.toFixed(2)}`)
  }
})

test('the tier ladder keeps dark ink readable on every rung', () => {
  for (const t of TIER_STYLES) {
    const ratio = contrast(t.fg, t.bg)
    assert.ok(ratio >= 4.5, `${t.label} ${t.fg} on ${t.bg}: ${ratio.toFixed(2)}`)
  }
  assert.equal(new Set(TIER_STYLES.map((t) => t.bg)).size, TIER_STYLES.length, 'five distinct rungs')
})

test('the series tokens are pairwise distinct — a chart never draws two lanes in one colour', () => {
  const series = [PALETTE.accent, PALETTE.cyan, PALETTE.green, PALETTE.amber, PALETTE.red]
  assert.equal(new Set(series).size, series.length)
})

test('an opaque overlay is built on the colour the translucent overlays already paint', () => {
  assert.equal(OPAQUE_OVERLAY_BG, PALETTE.bg)
})
