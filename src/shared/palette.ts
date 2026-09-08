/**
 * THE APP'S COLOUR TOKENS, IN ONE PLACE — "Midnight & arcane" (EQ Zera, 2026-09-06).
 *
 * Plain constants rather than an MUI palette, because the MUI theme is not the only consumer:
 * `renderer/src/theme/theme.ts` builds the main window's theme FROM these, but the overlay, tray
 * and cursor bundles deliberately run without a ThemeProvider (overlay/main.tsx), the main
 * process paints every window's background before a renderer has loaded (windows.ts / tray.ts),
 * and scripts/gen-icon.mts draws the brand mark. Each of them used to carry its own literal copy
 * of the old gold; now each carries a reference here, and a rework is one file.
 *
 * RELATIVE IMPORTS ONLY. `@shared/*` is a bundler alias that node-run unit tests do not resolve,
 * and several consumers (tierChip.ts, resistColors.ts) are reached from those tests.
 *
 * One file cannot import this: `src/renderer/tray.html` paints `bg` as a literal for its first
 * frame — keep it equal by hand.
 *
 * Contrast is MEASURED, not assumed: tests/palette.test.mts computes WCAG ratios for every text
 * use (tokens on `paper`, `ink` on every tier chip, the resist axes) and fails under 4.5.
 */
export const PALETTE = {
  /** window / page ground — and what the main process builds every window on */
  bg: '#0b0f1a',
  /** cards, panels, the tray notice's buttons */
  paper: '#131a2b',
  /** near-black foreground on a saturated chip (the tier chips); the theme's ink */
  ink: '#0b0f1a',
  /** body text */
  text: '#e5e9f5',
  /** THE ACCENT: buttons, links, the active tab, the damage meter's chrome, "you" in a meter */
  accent: '#a78bfa',
  /** the accent's highlight — the icon's bright edge */
  accentHi: '#c4b5fd',
  /** secondary actions; "pet", DoTs, the cold axis */
  cyan: '#38bdf8',
  /** a dimmer, cooler wash of `cyan` — somebody ELSE's pet (KIND_COLOR.allyPet) */
  cyanDim: '#3a86ad',
  /** success; healing, quests, the poison axis */
  green: '#4ade80',
  /** warning; the series slot the old purple held (spells, invocations, AA points, D3) */
  amber: '#fbbf24',
  /** error; the enemy, damage shields */
  red: '#f87171',
  /** the retro-wave second neon — gradients and glows only, never a series colour */
  magenta: '#f472b6'
} as const

/**
 * THE THREE TYPEFACES (EQ Zera, 2026-09-06). Orbitron and Share Tech Mono are bundled under
 * renderer/src/assets/fonts (scripts/fetch-fonts.mts); the body stack is whatever the machine has.
 *   display — headings, the nav rail, buttons, tabs, table heads: the geometric retro-wave face.
 *   mono    — the "console readout": big figures (h4), timers, anything a player scans as a number.
 *   body    — prose and dense data rows, unchanged: readability first.
 */
export const FONTS = {
  display: "'Orbitron', 'Segoe UI', Roboto, system-ui, sans-serif",
  mono: "'Share Tech Mono', Consolas, 'Courier New', monospace",
  body: "Inter, 'Segoe UI', Roboto, system-ui, sans-serif"
} as const

/** The signature rule: magenta → violet → cyan. Horizontal unless a surface asks otherwise. */
export const NEON = `linear-gradient(90deg, ${PALETTE.magenta}, ${PALETTE.accent}, ${PALETTE.cyan})`
export const NEON_VERTICAL = `linear-gradient(180deg, ${PALETTE.magenta}, ${PALETTE.accent}, ${PALETTE.cyan})`

/** `hex` at `alpha`, as a CSS `rgba()` — for the bundles that have no MUI `alpha()`. */
export function withAlpha(hex: string, alpha: number | string): string {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`
}
