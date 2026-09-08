// rateBasis.ts — WHICH HOUR A PER-HOUR NUMBER IS PER, and when there is not enough of it to
// divide by at all (JOS-288).
//
// THIS FILE OWNS A VOCABULARY, NOT AN ARITHMETIC. Every rate in this app is already computed twice
// by the modules that compute it once per denominator — `RangeStats.levelsPerHourActive` /
// `levelsPerHourWall`, `aaPerHourActive` / `aaPerHourWall`, `WindowItemRow.dropsPerHourActive` /
// `dropsPerHourWall`, `WindowLootRates`' pair — and nothing here divides anything by anything. What
// it decides is which of the two a surface is currently SHOWING, in one spelling, so the Leveling
// tab, the AA panel, the in-window drops and the floating XP overlay cannot end up describing the
// same hour with four different words.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE TWO WORDS ARE THE LOOT LEDGER'S (JOS-261), AND THEY ARE NOT NEGOTIABLE HERE.
//
//   `active`  — the span minus every gap over IDLE_GAP_MS and minus every stated logout. It answers
//               "how fast is this camp paying while I am working it".
//   `elapsed` — `wallMs(...)` = `durationMs - offlineMs`. Medding, banking and travelling stay in,
//               because you spent them. It answers "how fast is this paying per hour of my evening".
//
// The two SENTENCES that define them (`ACTIVE_TIME_TITLE`, `ELAPSED_TIME_TITLE`) live in
// `features/leveling/rangeStatsRows.ts`, which is where the first of them was written and where
// every renderer surface already imports it from. They are not restated here: this module is
// imported by the SHARED half of the app and a sentence in two files is a sentence that will
// eventually say two things.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// WHY `elapsed` IS THE DEFAULT (owner ruling, JOS-288).
//
// Active time was the SOLE denominator of every leveling rate this app has ever shown. It is a real
// answer to a real question and it is not the question a glance is usually asking — "how am I doing
// this evening" is the elapsed hour. It is also the denominator the next-level projection has always
// divided by (`levelEta` reads `levelsPerHourWall`), so a row reading 7.03 lvl/hr active beside an
// ETA computed from the wall rate was two different hours on one line. Defaulting to elapsed makes
// them agree for the first time, and the toggle keeps the other reading one click away.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE JUST-ARRIVED GATE, AND WHERE IT IS NOT.
//
// A rate one second into a zone is arithmetic over a denominator of nothing: the audit's own case is
// a confident `0.00 AA/hr` printed the instant you zone in, which is the loudest version of it
// because the AA row is drawn unconditionally (JOS-202's owner ruling, which stands — see
// `rateMeasurable` for why this gate does not overturn it).
//
// THE GATE IS A DISPLAY RULE AND LIVES ONLY IN SHAPING CODE. `rangeStats` and `windowItemRows` keep
// measuring and keep answering: the golden-window tests pin those as MEASURED FACTS, and a floor
// pushed down into the derivation would change what this repo believes happened rather than what it
// is willing to say out loud.

import { IDLE_GAP_MS } from './progressionStats'

/**
 * The two honest denominators. A CLOSED UNION because it is persisted (the XP overlay remembers its
 * own) — same rule and same reason as `XpRowId`.
 */
export const RATE_BASES = ['elapsed', 'active'] as const
export type RateBasis = (typeof RATE_BASES)[number]

/** ABSENT MEANS THIS — see the header for the ruling behind it. */
export const RATE_BASIS_DEFAULT: RateBasis = 'elapsed'

/**
 * WHAT THE EXP SURFACES OPEN ON, before anybody has touched the control (owner ruling, JOS-332).
 *
 * IT IS THE SAME VALUE AS THE MODEL DEFAULT TODAY, and it is still written down separately — for
 * `zoneScope.ts ZONE_SCOPE_OPENING`'s reason, where the two genuinely differ. The pair of knobs is
 * now ONE app-wide selection (`shared/scopeSelection.ts`), so its opening has to be composed from
 * two constants of the same kind; spelling one of them as "the default, which happens to also be
 * the opening" would leave the next ruling about the hour with nowhere to land but a call site.
 */
export const RATE_BASIS_OPENING: RateBasis = RATE_BASIS_DEFAULT

/** Is `v` one of the bases this build knows? The store's gate. */
export function isRateBasis(v: unknown): v is RateBasis {
  return typeof v === 'string' && (RATE_BASES as readonly string[]).includes(v)
}

/** The stored basis, rebuilt: anything this build does not know becomes "nothing stored". */
export function normalizeRateBasis(raw: unknown): RateBasis | undefined {
  return isRateBasis(raw) ? raw : undefined
}

/** Which basis is in force. Absent ⇒ `RATE_BASIS_DEFAULT`. */
export function resolveRateBasis(stored: RateBasis | undefined | null): RateBasis {
  return stored ?? RATE_BASIS_DEFAULT
}

/** The other one — the toggle's whole operation. Two states, so it is a flip and not a menu. */
export function toggleRateBasis(stored: RateBasis | undefined | null): RateBasis {
  return resolveRateBasis(stored) === 'elapsed' ? 'active' : 'elapsed'
}

/**
 * FEWEST MILLISECONDS IN A DENOMINATOR BEFORE A PER-HOUR RATE IS QUOTED AT ALL.
 *
 * It is `IDLE_GAP_MS` — the repo's one measured "a silence this long is not play" — imported rather
 * than chosen, and the argument for reusing it is arithmetic rather than taste:
 *
 *   BELOW ONE IDLE THRESHOLD THE TWO DENOMINATORS ARE THE SAME NUMBER, always. `idleMs` counts only
 *   gaps LONGER than `IDLE_GAP_MS`, so a slice shorter than one cannot contain a qualifying gap; its
 *   active time therefore equals its elapsed time by construction, whether the player was fighting
 *   or staring at the wall. Nothing has been measured yet — the "rate" is just the clock since you
 *   arrived, wearing a per-hour suffix. Extrapolating it to an hour is the defect, in one sentence.
 *
 * It is deliberately WELL UNDER the projection floor beside it (`ETA_MIN_ONLINE_MS`, 15 minutes): a
 * rate is a weaker claim than a prediction and earns its number sooner. Like every threshold in this
 * repo it is a CHOICE and is surfaced as one — the refusal states the number out loud.
 */
export const RATE_MIN_MS = IDLE_GAP_MS

/**
 * Is there enough of the denominator in force to state a per-hour number?
 *
 * IT GATES ON THE SPAN AND NEVER ON THE COUNT, which is what keeps JOS-202's owner ruling intact: a
 * slice holding no AA completion over a real hour still reads a measured `0.00`, because the hour is
 * the evidence and the zero is the measurement. What it refuses is the OTHER zero — the one printed
 * forty seconds after you zoned in, where there is no hour to have measured anything over.
 */
export function rateMeasurable(denominatorMs: number): boolean {
  return denominatorMs >= RATE_MIN_MS
}

/** The refusal, in one clause, wherever a rate is withheld for it (AGENTS.md tooltip diet). */
export const RATE_TOO_SHORT_TITLE =
  `This stretch is under ${String(RATE_MIN_MS / 60_000)} minutes long, which is too little to state ` +
  'as a rate per hour - the number would be the clock since you arrived, extrapolated.'

/** The three time columns every basis decision reads. `RangeStats` is assignable verbatim. */
export interface BasisSpans {
  durationMs: number
  activeMs: number
  offlineMs: number
}

/** The denominator `basis` divides by, in ms. The elapsed half is `wallMs`, never a second one. */
export function basisMs(basis: RateBasis, spans: BasisSpans): number {
  return basis === 'active' ? spans.activeMs : Math.max(0, spans.durationMs - spans.offlineMs)
}

/**
 * The reading in force: which word, how long it is, and whether it has earned a number yet.
 *
 * Resolved ONCE per surface and handed to every row on it, so a window cannot state its span over
 * one denominator and its rates over another.
 */
export interface BasisRead {
  basis: RateBasis
  /** the word the surface prints — `active` or `elapsed`, never a synonym. */
  word: RateBasis
  /** the denominator in force, in ms. */
  ms: number
  /** false ⇒ every rate on this surface is an em-dash with `RATE_TOO_SHORT_TITLE` on hover. */
  measurable: boolean
}

export function basisRead(basis: RateBasis, spans: BasisSpans): BasisRead {
  const ms = basisMs(basis, spans)
  return { basis, word: basis, ms, measurable: rateMeasurable(ms) }
}

/**
 * The half of a pre-computed pair that `basis` selects. Both arguments are already-divided rates —
 * this is a pick, not a division.
 */
export function pickRate(read: BasisRead, active: number | null, elapsed: number | null): number | null {
  if (!read.measurable) return null
  return read.basis === 'active' ? active : elapsed
}
