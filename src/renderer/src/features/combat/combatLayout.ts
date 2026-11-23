// THE COMBAT TAB'S PANEL SIZES - the vocabulary, with no DOM and no React in it.
//
// A player asked to resize the Combat tab's windows (DPS over time, procs, damage by mob, the
// combat log). There are four splits to remember, and they are the whole layout:
//   * `col`   - the left column's share of the dashboard's width (meter + procs on the left,
//               DPS over time + damage by mob on the right);
//   * `left`  - the meter's share of the left column's height (procs takes the rest);
//   * `right` - the DPS curve's share of the right column's height (damage by mob takes the rest);
//   * `log`   - the combat log card's height in CSS px (the dashboard or timeline takes the rest).
//
// FRACTIONS FOR THE DASHBOARD, PIXELS FOR THE LOG, on purpose. The four panels share one box that
// changes with the window, so a fraction keeps "the chart is two thirds of the column" true at any
// size. The log is a reading strip whose useful height is a number of LINES, which does not grow
// because the window did, so it is stored the way it was always drawn: a fixed height.
//
// SAME RULES AS combatPrefs.ts, which this sits beside for the same reasons (MUI-, JSX- and
// React-free so tests/combatLayout.test.mts can run it under plain node; the storage half is
// `useCombatLayout.ts`, through the same `useRawPref` every combat pref uses): an absent or
// unreadable value is the DEFAULT, never an error, and the default is stored as an ABSENT KEY.
// Each split degrades ON ITS OWN - one hand-edited field never throws away the other three.

export const LAYOUT_KEY = 'eq.combat.layout'

export const SPLIT_KEYS = ['col', 'left', 'right', 'log'] as const
export type SplitKey = (typeof SPLIT_KEYS)[number]
export type CombatLayout = Readonly<Record<SplitKey, number>>

/** Four equal panels and the 220px log the tab has always had - a fresh install, and an upgrade,
 *  see exactly the layout they saw before this existed. */
export const DEFAULT_LAYOUT: CombatLayout = { col: 0.5, left: 0.5, right: 0.5, log: 220 }

/** A fraction never leaves this band, whatever the window: a split dragged to 0 is a panel you can
 *  no longer find the handle for. */
export const FRACTION_MIN = 0.15
export const FRACTION_MAX = 0.85

/** The log's stored bounds. The floor still shows its header and a few lines; the ceiling only
 *  guards the stored value - the live ceiling is whatever leaves the body BODY_MIN_H. */
export const LOG_MIN = 96
export const LOG_MAX = 1200

/** The smallest a dashboard panel may be dragged to, in CSS px. Wide enough for a meter row's name
 *  and number, tall enough for a card header and two rows. */
export const PANEL_MIN_W = 220
export const PANEL_MIN_H = 110
/** …and the least the dashboard/timeline keeps when the log is dragged up. */
export const BODY_MIN_H = 180

/** The handles occupy the gaps the panels always had (MUI spacing 1.5), so the layout's spacing
 *  is unchanged by gaining them. */
export const HANDLE_PX = 12

function isFractionKey(k: SplitKey): boolean {
  return k !== 'log'
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** One stored split, bounded - or its default when it is not a finite number. */
function normalizeSplit(k: SplitKey, v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_LAYOUT[k]
  return isFractionKey(k) ? clamp(v, FRACTION_MIN, FRACTION_MAX) : Math.round(clamp(v, LOG_MIN, LOG_MAX))
}

/** Parse the stored layout. TOTAL: absent, empty, malformed JSON, an array, a string where a number
 *  belongs - each lands on the default, field by field. */
export function parseLayout(raw: string | null): CombatLayout {
  if (raw === null || raw === '') return DEFAULT_LAYOUT
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_LAYOUT
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_LAYOUT
  const o = parsed as Record<string, unknown>
  return { col: normalizeSplit('col', o.col), left: normalizeSplit('left', o.left), right: normalizeSplit('right', o.right), log: normalizeSplit('log', o.log) }
}

export function isDefaultLayout(l: CombatLayout): boolean {
  return SPLIT_KEYS.every((k) => l[k] === DEFAULT_LAYOUT[k])
}

/** …and back, or `null` for "store nothing": the default is an absent key, so Reset layout leaves
 *  the store exactly as a fresh install found it. Fractions keep three decimals - a 0.1% step is
 *  finer than any pixel this window has. */
export function serializeLayout(l: CombatLayout): string | null {
  if (isDefaultLayout(l)) return null
  return JSON.stringify({ col: round3(l.col), left: round3(l.left), right: round3(l.right), log: l.log })
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** Set ONE split (normalized). Returns the SAME object when nothing changed, so a no-op key press
 *  writes nothing. */
export function withSplit(l: CombatLayout, k: SplitKey, v: number): CombatLayout {
  const next = normalizeSplit(k, v)
  return next === l[k] ? l : { ...l, [k]: next }
}

/** Put ONE split back to its default - the handle's double-click. */
export function resetSplit(l: CombatLayout, k: SplitKey): CombatLayout {
  return withSplit(l, k, DEFAULT_LAYOUT[k])
}

/**
 * The band a fraction may occupy in a TRACK of `trackPx` (the box minus its handle) when each side
 * must keep `minPx`. Never wider than the stored band; when the box is too small for both minimums
 * the band collapses to an even split, which is the one answer that favors neither panel.
 */
export function fractionBounds(trackPx: number, minPx: number): { lo: number; hi: number } {
  if (!(trackPx > 0)) return { lo: FRACTION_MIN, hi: FRACTION_MAX }
  const lo = Math.max(FRACTION_MIN, minPx / trackPx)
  const hi = Math.min(FRACTION_MAX, 1 - minPx / trackPx)
  return lo > hi ? { lo: 0.5, hi: 0.5 } : { lo, hi }
}

/** The fraction actually DRAWN at this size. The stored value is not rewritten - widen the window
 *  again and the split you chose comes back. */
export function effectiveFraction(v: number, trackPx: number, minPx: number): number {
  const { lo, hi } = fractionBounds(trackPx, minPx)
  return clamp(v, lo, hi)
}

/** The log's live bounds when the body + handle + log share `framePx`: never below LOG_MIN, and
 *  never so tall the body keeps less than BODY_MIN_H (unless the frame is too short for both, in
 *  which case the log keeps its floor and the body takes what is left). */
export function logBounds(framePx: number): { lo: number; hi: number } {
  const room = framePx > 0 ? framePx - HANDLE_PX - BODY_MIN_H : LOG_MAX
  return { lo: LOG_MIN, hi: clamp(room, LOG_MIN, LOG_MAX) }
}

export function effectiveLog(v: number, framePx: number): number {
  const { lo, hi } = logBounds(framePx)
  return Math.round(clamp(v, lo, hi))
}
