// zoneScope.ts — WHICH SPELLINGS OF A ZONE THE SLICE ADMITS (JOS-291).
//
// THIS FILE OWNS A VOCABULARY AND ONE PREDICATE, NOT AN ARITHMETIC. `shared/timeslice.ts` decides
// WHICH STRETCH the numbers are about, `shared/rateBasis.ts` decides WHICH HOUR they are divided
// by, and this decides WHICH VISITS of the current camp count as being in it. Nothing here
// measures anything.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE ARGUMENT, AND WHY THE OPTION EXISTS AT ALL (owner directive 2026-08-13: *there should be an
// option to differentiate between levels of the zone, d0 -> d4, vs not*).
//
// EQ Legends spells instance difficulty and selection straight into the zone name — `Befallen`,
// `Befallen 2 (Adaptive)`, `Nagafen's Lair - Solo 4 (Refined)` — and this app has always carried
// TWO folds of that name, doing two different jobs (`progressionStats.zoneIdKey`'s header states
// the pair):
//
//   • `zones.zoneKey`      strips the tier and the instance selector: `befallen`. It is what
//                          MEMBERSHIP has meant since JOS-130 — "the PLACE I am standing in", so a
//                          re-entry that changed the ordinal stays in the slice.
//   • `zoneIdKey`          keeps every byte of the name (trim + lowercase): `befallen 2 (adaptive)`.
//                          It is what the zone ROWS are keyed by, and what `lootRates` joins drops
//                          onto.
//
// The place fold is the right default and it is also a real loss of resolution: the tiers of one
// camp do NOT pay alike, so a `Zone` slice that admits `Befallen` beside `Befallen 2 (Adaptive)`
// answers "how is this camp doing" when the reader meant "how is THIS TIER doing". The Befallen
// audit measured exactly that — the tier-stripped key admitted the plain interval alongside the
// tiered one. So membership becomes a CHOICE between the two folds this app already carried, and
// the choice is stated in the caption rather than implied by the zone's own name.
//
//   `allTiers`  (THE DEFAULT) — membership is `zones.zoneKey`. Byte-identical to every answer this
//                app has given since JOS-130; a reader who never touches the control sees the
//                numbers they saw before it existed.
//   `exactTier` — membership additionally requires the ROW fold to match the current zone's own
//                spelling. Only the tier you are standing in is admitted.
//
// EXACT IS A NARROWING OF ALL, NEVER A DIFFERENT QUESTION: both keys are derived from ONE name (the
// zone the log last stated), and `zoneIdKey(n) === exact` implies `zoneKey(n) === key` for that
// name, so the two tests compose as an AND and the exact answer is dominated by the coarse one,
// count for count. That is what keeps the partition identity meaningful under either setting.
//
// Pure: no React, no DOM, no Electron, no clock read. The one VALUE import is relative, so the node
// tests can import this file straight under tsx.

import { zoneKey } from './zones'

/**
 * The two memberships. A CLOSED UNION because it is persisted (the XP overlay remembers its own) —
 * the same rule and the same reason as `XpRowId` and `RateBasis`.
 */
export const ZONE_SCOPES = ['allTiers', 'exactTier'] as const
export type ZoneScope = (typeof ZONE_SCOPES)[number]

/**
 * ABSENT MEANS THIS — the behaviour every surface had before this option existed.
 *
 * IT IS NOT WHAT THE SURFACES OPEN ON ANY MORE (see `ZONE_SCOPE_OPENING`), and the two must not be
 * collapsed into one constant. This one answers a MODEL question — "a caller handed me no
 * membership, what did they mean?" — and its answer has to stay `allTiers` forever, because that is
 * what makes `resolveSlice({…})` and `rangeStats({…})` byte-identical to the reads this app gave
 * before JOS-291. Dozens of call sites and golden windows lean on that identity.
 */
export const ZONE_SCOPE_DEFAULT: ZoneScope = 'allTiers'

/**
 * WHAT THE EXP SURFACES OPEN ON, before anybody has touched the control (owner ruling, JOS-332).
 *
 * A PRODUCT ruling, not a model default, which is exactly why it is a second constant. The owner's
 * reproduced scenario is the argument in one sentence: he logged in to open-world `Befallen`, moved
 * to `Befallen 2 (Adaptive)` and asked how the tier he was standing in was paying — and the honest
 * answer to that question is the tier, not the camp. Opening on `allTiers` made the FIRST read a
 * reader ever sees the wrong one, and the only way to the right one was a two-word toggle he had to
 * know to look for.
 *
 * IT DEGRADES TO NOTHING WHEN THERE IS NOTHING TO NARROW, and that is why it is safe as an opening:
 *   • a slice with no zone in it (`All`, `Session`, a rung, a custom range) resolves to `allTiers`
 *     with a null exact key whatever is picked — `timeslice.zoneHalfOf` enforces it — so the
 *     opening cannot change a single number on those slices, and no control is drawn for it;
 *   • a camp the record spells exactly ONE way admits the same intervals under either membership,
 *     because `zoneIdKey(n) === exact` and `zoneKey(n) === key` then select the same rows. The
 *     numbers are identical; only the caption's clause differs, and it is TRUE either way.
 * So the degenerate cases are quiet by construction rather than by a special case.
 */
export const ZONE_SCOPE_OPENING: ZoneScope = 'exactTier'

/** Is `v` one of the memberships this build knows? The store's gate. */
export function isZoneScope(v: unknown): v is ZoneScope {
  return typeof v === 'string' && (ZONE_SCOPES as readonly string[]).includes(v)
}

/** The stored membership, rebuilt: anything this build does not know becomes "nothing stored". */
export function normalizeZoneScope(raw: unknown): ZoneScope | undefined {
  return isZoneScope(raw) ? raw : undefined
}

/** Which membership is in force. Absent ⇒ `ZONE_SCOPE_DEFAULT`. */
export function resolveZoneScope(stored: ZoneScope | undefined | null): ZoneScope {
  return stored ?? ZONE_SCOPE_DEFAULT
}

/** The other one — the flip a two-state control performs. */
export function toggleZoneScope(stored: ZoneScope | undefined | null): ZoneScope {
  return resolveZoneScope(stored) === 'allTiers' ? 'exactTier' : 'allTiers'
}

/** The BUTTON label for each membership. Short, because it sits in a compact bar and in a floating
 *  window's footer; the caption beside it is where the sentence lives. */
export const ZONE_SCOPE_LABEL: Record<ZoneScope, string> = {
  allTiers: 'every tier',
  exactTier: 'this tier'
}

/**
 * WHAT PICKING A MEMBERSHIP DOES TO THE NUMBERS, on the button that picks it (JOS-304).
 *
 * Owner feedback 2026-08-13: *the every tier/this tier toggle is hard to understand*. The two
 * LABELS above are two words each and the caption beside them only names which of the two is in
 * force — neither says what the numbers then admit, and a reader who has never read this file's
 * header has no way to find out. So each membership gets one plain sentence, worded as an effect on
 * the reads rather than as a definition of a fold, and it is the hover of the button that selects
 * it.
 *
 * IT LIVES HERE WITH THE LABEL AND THE PHRASE because they are the same vocabulary and must move
 * together: a label reworded without its sentence is a button that promises one thing and does
 * another. It is deliberately ZONE-NAME FREE — the caption sitting under the row prints the zone
 * and the clause already, so interpolating it here would be the second copy of a fact the line
 * below owns. (The XP overlay's own toggle DOES name the zone, because that window has no caption
 * to carry it; that is a different surface answering the same question, not a drift.)
 */
export const ZONE_SCOPE_TITLE: Record<ZoneScope, string> = {
  allTiers:
    'The numbers count every visit to this camp, at any tier - the difficulty and instance spelled ' +
    'into the zone name are folded away.',
  exactTier:
    'The numbers count only the tier you are standing in - visits to the same camp under any other ' +
    'spelling of the zone name are left out.'
}

/**
 * How the membership is worded INSIDE the slice's caption — the clause appended after the zone's
 * own name (`Befallen 2 (Adaptive), every tier`).
 *
 * `every tier` rather than nothing, EVEN THOUGH IT IS THE DEFAULT: the caption's job is to name
 * what membership admitted (JOS-288's honesty rule — the span line IS the denominator), and the
 * default admits visits whose names the caption does not print. A zone whose name carries no tier
 * still gets the clause, because the RECORD may spell the same place both ways and the caption
 * cannot know which without scanning history it has no business scanning.
 */
export const ZONE_SCOPE_PHRASE: Record<ZoneScope, string> = {
  allTiers: 'every tier',
  exactTier: 'this tier only'
}

/**
 * Case-insensitive zone key, INSTANCE NOISE AND ALL — `Befallen 2 (Adaptive)` →
 * `befallen 2 (adaptive)`. Mirrors main/log/parseCommon.ts `idKey` for zone names (trim +
 * lowercase); src/shared cannot import from src/main, and idKey's extra 'you'/'yourself' folding
 * is about entity names and can never apply to a zone.
 *
 * IT IS THE ROW FOLD AND THE EXACT-TIER MEMBERSHIP, WHICH IS WHY IT LIVES HERE. `rangeStats` groups
 * its `ZoneRangeRow`s by it and `lootRates.ts` rule 2 joins drops onto them; a second answer THERE
 * would bucket drops under one key and their active time under another (world-model law 12's drift,
 * in miniature). It moved out of `progressionStats.ts` (which re-exports it, so every importer is
 * untouched) the day membership needed it too: one fold, one file, three readers.
 */
export function zoneIdKey(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * THE ONE MEMBERSHIP TEST, for every surface that asks "is this row in the slice?".
 *
 * `key` is the PLACE fold (`zones.zoneKey`) and is the whole test under `allTiers`. `exact` is the
 * ROW fold of the zone the slice names, present ONLY under `exactTier`, and it narrows — never
 * widens — what `key` already admitted. Both absent ⇒ every zone, which is the unfiltered read this
 * app has always done.
 *
 * The pre-first-zone-line remainder arrives here as the literal `unknown` row name, exactly as it
 * does in `zoneSegments` and `lootRates.itemZoneRows`, so a slice for a NAMED zone excludes it
 * under either membership rather than guessing where it happened (law 1).
 */
export function zoneAdmits(name: string, key?: string | null, exact?: string | null): boolean {
  if (key != null && zoneKey(name) !== key) return false
  return exact == null || zoneIdKey(name) === exact
}
