// lootRateText.ts — THE LEDGER'S LOOT-PER-HOUR LINE, as words (JOS-261).
//
// The arithmetic is `shared/lootRates.windowLootRates`; this file is the other half, and it is a
// SEPARATE FILE for the reason `rangeStatsRows.ts` is one: every honesty rule this feature has is a
// formatting decision — whether a rate prints or an em-dash prints, which denominator a number is
// standing on, whether a span is stated at all — and those are exactly the things that rot silently
// inside JSX. Here they are functions with return values and `tests/lootRateText.test.mts` pins them.
//
// Pure: no React, no DOM, no MUI, and every VALUE import is relative, so the node runner (which has
// no `@shared/*` alias) can import it straight under tsx — the `rangeStatsRows.ts` precedent.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE THREE RULES
//
//   1. BOTH DENOMINATORS OR NEITHER, AND NEITHER MAY READ AS THE OTHER. A 0.23.0 reporter asked
//      for "motes per hour for this grind session"; another said in a P.S. that active-time rates
//      read INFLATED, because the regen sit between pulls is under the idle threshold and stays in
//      the denominator. Both are right about their own question, so the line answers both and
//      names each one out loud — `active` and `elapsed`, never a bare "per hour".
//
//   2. A RATE NEVER APPEARS WITHOUT THE SPAN IT WAS MEASURED OVER. One drop in five minutes is a
//      true 12 drops/hr and a very small sample, and the only thing separating the two on screen is
//      the span printed beside it (`ItemZoneTable`'s Active column made the same claim first).
//
//   3. A NULL RATE IS AN EM-DASH, NEVER 0.00 — `NONE`, the app's one spelling of unknown. A window
//      with no active time did not measure zero drops an hour; it measured nothing.
//
// THE WORD IS "ELAPSED", NOT "LOGGED IN" (deliberate, and it is rule 4 of `rangeStatsRows.ts`
// applied here): the wall denominator carves out only the logouts the log CLOSED with a login line,
// so with no such line the number is simply the clock and must not claim to know you were sitting
// at it. What it DOES claim is stated in the hover sentence, once.

import type { WindowLootRates } from '@shared/lootRates'
import { formatDropRate } from '../../lib/formatRate'
import { fmtDuration } from '../leveling/levelChartGeometry'
// ONE SPELLING OF "ACTIVE TIME", ON EVERY SURFACE THAT DIVIDES BY IT (JOS-249) — imported, never
// re-worded. `NONE` is the same em-dash for the same reason.
import { ACTIVE_TIME_TITLE, ELAPSED_TIME_TITLE, NONE } from '../leveling/rangeStatsRows'

/**
 * WHAT THE WALL DENOMINATOR IS, in one clause, wherever it is shown.
 *
 * THE STRING MOVED, THE SPELLING DID NOT (JOS-288). It was defined here when this line was the only
 * surface showing both denominators; three more now do, and it lives beside `ACTIVE_TIME_TITLE` —
 * which this file already imports — so the pair cannot be separated and this file importing that one
 * while that one imported this one is not a cycle waiting to be discovered. Re-exported so every
 * existing importer of `ELAPSED_TIME_TITLE` is untouched.
 */
export { ELAPSED_TIME_TITLE }

/** The hover sentence for the whole line: both denominators, and what the numerator counts. */
export const LOOT_RATE_TITLE =
  `Loot per hour over BOTH denominators, so neither reading can pass for the other. ${ACTIVE_TIME_TITLE} ` +
  `${ELAPSED_TIME_TITLE} Drops count stack sizes, so one "2 Bone Chips" line is two drops.`

/**
 * One half of the pair: the rate, then the span it was measured over, then which hour that is.
 *
 * Rules 2 and 3 together — a null rate keeps its WORD (so the reader still sees which denominator
 * came up empty) and loses its span, because there was no span to state.
 */
function half(rate: number | null, ms: number, word: string): string {
  return rate == null ? `${NONE} drops/hr ${word}` : `${formatDropRate(rate)} over ${fmtDuration(ms)} ${word}`
}

/**
 * The ledger caption's rate line, or null when there is nothing to state.
 *
 * NULL WHEN THE WINDOW HOLDS NO DROPS, and that is not rule 3 in disguise: a slice you looted
 * nothing in already says so above (the summary's count, and the slice-empty notice), and a line
 * reading "0.00 drops/hr active · 0.00 drops/hr elapsed" would be three ways of saying one thing.
 * A window with drops but no time still renders — with em-dashes, which is rule 3 exactly.
 */
export function lootRateText(rates: WindowLootRates): string | null {
  if (rates.drops === 0) return null
  const active = half(rates.dropsPerHourActive, rates.activeMs, 'active')
  const wall = half(rates.dropsPerHourWall, rates.wallMs, 'elapsed')
  const drops = `${rates.drops.toLocaleString()} drop${rates.drops === 1 ? '' : 's'}`
  return `${drops} · ${active} · ${wall}`
}
