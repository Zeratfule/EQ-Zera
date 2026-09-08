// factionTypes.ts — the `faction` module's transport: how far each faction moved, and how often it
// could not move at all.
//
// Its own file on the characterTypes.ts precedent — `shared/types.ts` is at its measured ceiling —
// and re-exported from `shared/types`, so no importer moved.
//
// ── THE ONE LAW THIS FILE EXISTS TO STATE ─────────────────────────────────────────────────────
//
// THE TWO FACTION SENTENCES ARE NOT THE SAME KIND OF FACT.
//
//   `has been adjusted by -3.`             states a MAGNITUDE  → summed into `delta`
//   `could not possibly get any worse.`    states a RAIL       → counted into `bottomed`
//   `could not possibly get any better.`   states a RAIL       → counted into `maxed`
//
// A saturation line says the standing DID NOT MOVE, because it is already against the rail. Folding
// one in as a delta of 0 is a lie a chart would draw; folding it in as "the usual hit" is an
// invention (law 1). So the two live in different fields and neither is derived from the other.
//
// AND `delta` IS NOT YOUR STANDING. No line the client prints states an absolute standing, so this
// is the sum of the moves THIS FOLD WATCHED and nothing more. A surface that labels it "standing"
// is claiming a number the game never said.

import type { LogEventBase } from './logEvents'

/**
 * YOUR STANDING WITH A FACTION MOVED — or hit a rail and could not.
 *
 * TWO SENTENCES, ONE KIND, AND `delta` AND `cap` ARE MUTUALLY EXCLUSIVE:
 *   `Your faction standing with <F> has been adjusted by -3.`            → delta: -3
 *   `Your faction standing with <F> could not possibly get any worse.`   → cap: 'min'
 *   `Your faction standing with <F> could not possibly get any better.`  → cap: 'max'
 *
 * THE SATURATION FORMS CARRY NO MAGNITUDE AND MUST NEVER BE SUMMED (law 1). The standing did not
 * move, because it is already at the rail. Reading one as a delta of 0 is a lie a chart would draw;
 * reading it as the usual hit is an invention. A consumer COUNTS the caps and SUMS the deltas.
 *
 * AND NO LINE EVER STATES AN ABSOLUTE STANDING. A running sum of deltas is the moves you watched,
 * never your standing — nothing in the log can supply the starting number.
 */
export interface FactionHitEvent extends LogEventBase {
  kind: 'factionHit'
  /** the faction, as the line spelled it. */
  faction: string
  /** the stated adjustment. Absent on the two saturation forms, which state no number. */
  delta?: number
  /** which rail the standing is against. Absent whenever `delta` is present, and vice versa. */
  cap?: FactionCap
}

/** Which end of the faction ladder a saturation line named. */
export type FactionCap = 'max' | 'min'

/**
 * One faction's whole history, as far as this fold watched it.
 *
 * Keyed in the snapshot by the LOWERCASED name (law 2); `display` is the FIRST spelling the log
 * used, so the surface prints what the game printed rather than what the fold normalized. A later
 * line in different casing folds to the same key and does not rewrite the label.
 */
export interface FactionTotals {
  /** the first spelling the log used — display, never a key. */
  display: string
  /** Σ of every STATED adjustment. Not your standing; see the header. */
  delta: number
  /** how many lines stated a magnitude. `delta` is the sum of exactly these. */
  hits: number
  /** how many said the standing could not get any BETTER. Counted, never summed. */
  maxed: number
  /** how many said it could not get any WORSE. Counted, never summed. */
  bottomed: number
  /** LOG timestamp of the first line naming this faction. */
  firstTs: number
  /** LOG timestamp of the most recent one. */
  lastTs: number
}

/**
 * One line, for the recent strip. `delta` and `cap` are MUTUALLY EXCLUSIVE — exactly one is
 * present, and which one says what kind of sentence it was.
 */
export interface FactionHitRow {
  /** the faction, as THIS line spelled it (not the display spelling). */
  faction: string
  /** the stated adjustment, when the line stated one. */
  delta?: number
  /** which rail the standing is against, when the line named one instead. */
  cap?: FactionCap
  ts: number
}

/** The `faction` module's published state. `recent` is newest last, capped at 100. */
export interface FactionSnap {
  /** shape version. */
  v: number
  /** keyed by the lowercased faction name. */
  factions: Record<string, FactionTotals>
  recent: FactionHitRow[]
}

/** The delta is a WHOLE snapshot — the `RespawnDelta` posture; see hailTypes.ts. */
export type FactionDelta = FactionSnap

/** What a consumer holds before the fold has said anything. */
export const EMPTY_FACTION_SNAP: FactionSnap = { v: 1, factions: {}, recent: [] }
