// aaPace.ts — how fast AA is coming in, when the next point lands, and what the item-shop
// potion is doing to the points. PURE: two snapshots in, one object out, no clock read, no
// React, no I/O — so tests/aaPace.test.mts drives every rule under plain node.
//
// WHY THIS EXISTS. The level bar stops at the cap; the AA bar does not. Every rate on the
// Leveling tab is built on `expGain` percentages, and at max level the game stops stating them
// (the at-cap shape, `expUnstated`), so the tab's headline numbers go to em-dashes exactly when
// the character starts caring about AA. These are the numbers that keep working.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// WHAT THE LOG STATES, AND WHAT IT DOES NOT (law 1, said once here rather than in six captions)
//
//   STATED — a completed AA:  `You have gained 2 ability point(s)!  You now have 5 ability
//     point(s).`  One line per completion, carrying the POINTS it paid and the resulting
//     unspent balance. So AA-per-hour and POINTS-per-hour are both MEASUREMENTS, and they are
//     different measurements — the potion moves the second and cannot move the first.
//
//   NOT STATED — where you are in the AA bar. There is no AA-experience line, no percentage,
//     no "N% into your next point": a full-log sweep (1.36M lines) finds nothing of the kind.
//     The levels ETA can sum stated percentages since the last ding; this one CANNOT, so
//     "time to next AA" is INFERRED from the rhythm of recent completions and is labeled
//     inferred at every surface that prints it.
//
//   STATED — the potion quaff:  `You are filled with the spirit of alternate adventure.`
//     (Bottle of Alternate Adventure, the 500-Iridium marketplace item). One line, no numbers.
//
//   NOT STATED — the potion's charges. The log never prints "5", never counts down, and prints
//     nothing when the last charge burns. The five-completion rule below is therefore a MODEL
//     — but a model measured against the whole log, and one the stated points re-verify on
//     every single completion (see AA_POTION_CHARGES).
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// THE POTION DOES NOT SPEED AA UP. It doubles the POINTS each of the next five completions
// pays; the AA experience needed for a completion is untouched. So `aaPerHour` and the ETA are
// the same numbers with a bottle running as without one, and `pointsPerHour` is the one that
// moves. Any surface that lets the potion touch the first two would be describing a different
// game.

import type { AAEvent, AAPotionEvent, LevelingSnap, ProgressionSnap } from './types'
import { offlineMsIn, wallMs, type RangeStats } from './progressionStats'

/**
 * Completions one bottle pays double for.
 *
 * NOT a log fact — see the header. It is a MEASUREMENT of the real log, and an exact one:
 * over 1.36M lines there are 32 quaffs and 210 completions, of which 160 stated 2 points and
 * 50 stated 1. Assigning five completions to each quaff in log order partitions those 160
 * doubled lines PERFECTLY — 32 runs of exactly [2,2,2,2,2], zero completions mis-predicted in
 * either direction, across runs that span deaths, zone lines and a 13-hour logout (the bottle
 * survived all three, exactly as the item claims).
 *
 * The stated points keep re-checking it: `AaPotionState.burnedPoints` carries what each
 * charge-covered completion actually paid, so a surface can show the model and its evidence
 * side by side instead of asking to be believed.
 */
export const AA_POTION_CHARGES = 5

/**
 * Fewest completions a window must hold before its mean gap is quoted as a rhythm.
 *
 * With ONE completion the "mean gap" is just the window's own length wearing a different name
 * — it says how long the window is, not how long a completion takes. Two is the smallest count
 * that measures a gap at all.
 */
export const AA_ETA_MIN_EVENTS = 2

/**
 * How far past the mean gap the last completion may sit before the ETA is REFUSED.
 *
 * The estimate is "the usual wait, minus the wait already served", floored at 0 — which is
 * honest while you are still killing things and becomes a lie the moment you stop: an hour
 * after the last kill it would read "due now" forever. Three means is the line: comfortably
 * past ordinary variance (a bad pull, a corpse run) and well short of an afternoon away.
 */
export const AA_ETA_STALE_FACTOR = 3

/** WHY there is no estimate. Each is a hole in the evidence, and each is shown on hover. */
export type AaEtaBlocked = 'no-pace' | 'stale'

/**
 * Either an inferred projection or the reason there isn't one. A UNION, like `LevelEta`, so a
 * renderer cannot read `ms` without having proven `blocked === null` first.
 */
export type AaEta =
  | { blocked: AaEtaBlocked }
  | {
      blocked: null
      /** the estimate: `meanIntervalMs - sinceLastMs`, floored at 0. INFERRED. */
      ms: number
      /** the window's mean ONLINE gap between completions. */
      meanIntervalMs: number
      /** how many completions that mean is over (>= `AA_ETA_MIN_EVENTS`). */
      samples: number
      /** ONLINE time since the last completion. */
      sinceLastMs: number
      /** the wait is already past the mean — `ms` is 0 and the wording must say "due", not "0s". */
      overdue: boolean
    }

/** What the log says about the bottle, and what the model says on top of it. */
export interface AaPotionState {
  /** quaffs in the retained log. 0 ⇒ say nothing about potions at all. */
  activations: number
  /** the last quaff's instant, or null when there has never been one. */
  lastTs: number | null
  /** completions since that quaff, capped at `AA_POTION_CHARGES` — the charges it burned. */
  burned: number
  /** charges the model says remain, 0…`AA_POTION_CHARGES`. INFERRED (the log never counts). */
  charges: number
  /**
   * MEASURED: the points each burned charge's completion actually stated, oldest first. This
   * is the model's own evidence — a run of 2s is the doubling the bottle promises, printed by
   * the game. Empty while a fresh quaff has paid for nothing yet.
   */
  burnedPoints: number[]
}

export interface AaPace {
  /**
   * The window's ACTIVE span — the denominator both rates below were divided by. MEASURED.
   *
   * Carried rather than left in the caller's `RangeStats` because the window is now the user's
   * to choose (JOS-75): a rate over a scale the character barely played has to be able to say
   * how much play it is over, and a shaper that holds the rate but not its denominator cannot.
   */
  activeMs: number
  /**
   * The window's ELAPSED span — `wallMs(...)`, the other denominator the pair below divides by
   * (JOS-288). MEASURED, and carried for `activeMs`' reason: a rate that cannot state the span it
   * was measured over is a rate the reader cannot size.
   */
  wallMs: number
  /** completions inside the window (gain LINES). MEASURED. */
  events: number
  /** points inside the window — Σ of the stated amounts, doubling included. MEASURED. */
  points: number
  /** completions per hour of ACTIVE time, or null when the window has none. MEASURED. */
  perHourActive: number | null
  /** points per hour of ACTIVE time, or null when the window has none. MEASURED. */
  pointsPerHourActive: number | null
  /** completions per hour of ELAPSED time, or null when the window is entirely offline. MEASURED.
   *  The elapsed half of the pair — the app's default reading since JOS-288. */
  perHourWall: number | null
  /** points per hour of ELAPSED time, or null when the window is entirely offline. MEASURED. */
  pointsPerHourWall: number | null
  /** the next completion, or the reason there is no estimate. INFERRED. */
  eta: AaEta
  potion: AaPotionState
}

export interface AaPaceArgs {
  /** the uncapped AA history — gains and quaffs (`leveling` module). */
  leveling: Pick<LevelingSnap, 'aaGains' | 'aaPotions'>
  /** the capped analytics series — read ONLY for its clock and its derived logouts. */
  prog: ProgressionSnap
  /** the window's stats, already computed — the same object the levels rate came from. */
  window: RangeStats
}

/**
 * ONLINE ms between two instants: wall, minus the intervals the log says you were logged out.
 * The same subtraction `recentLevelSpans` applies to a level's duration, and for the same
 * reason — an overnight between two completions is not evidence that AA comes slowly.
 */
function onlineMs(prog: ProgressionSnap, from: number, to: number): number {
  return Math.max(0, to - from - offlineMsIn(prog, from, to))
}

/**
 * Charge state from the last quaff and the completions after it.
 *
 * STRICTLY AFTER, on purpose: EQ timestamps are whole seconds, and a completion stamped in the
 * same second as the quaff was paid by a kill that landed before the bottle did. (There is no
 * such second anywhere in the real log; the rule is stated so the edge has an answer rather
 * than an accident.) The same conservative direction `statedSinceDing` takes.
 */
export function aaPotionState(
  gains: readonly AAEvent[],
  potions: readonly AAPotionEvent[]
): AaPotionState {
  const last = potions.length > 0 ? potions[potions.length - 1] : null
  if (!last) return { activations: 0, lastTs: null, burned: 0, charges: 0, burnedPoints: [] }
  const after: number[] = []
  // Walk back from the tail and stop at the quaff: the run is at most five long in practice
  // and the array is log-ordered, so this touches a handful of entries on a live snapshot.
  for (let i = gains.length - 1; i >= 0 && gains[i].ts > last.ts; i--) after.push(gains[i].amount)
  after.reverse()
  const burned = Math.min(after.length, AA_POTION_CHARGES)
  return {
    activations: potions.length,
    lastTs: last.ts,
    burned,
    charges: AA_POTION_CHARGES - burned,
    burnedPoints: after.slice(0, burned)
  }
}

/**
 * The inferred wait for the next completion: the WINDOW's mean gap between completions, minus
 * the wait already served.
 *
 * WHY THE WINDOW AND NOT THE LAST N COMPLETIONS. The first cut of this averaged the last ten
 * intervals with derived logouts carved out, and measured against the real log it produced a
 * mean gap of 1.94 HOURS in an hour whose completions were arriving every twelve minutes —
 * because ten completions reach back across breaks, travel and camps the log never closed with
 * a login line, and every one of those hours went into the average at full weight. A rolling
 * mean over an unbounded lookback is a statement about last week, printed beside a number
 * labelled "next".
 *
 * So the evidence is BOUNDED to the window the panel already names, and the denominator is that
 * window's ONLINE WALL (`durationMs - offlineMs`) — the exact divisor `levelEta` uses, chosen
 * for the same reason: the user will experience the wait in wall time, including the same
 * share of medding and looting the window already contained, but not the hours the log says
 * they were logged out.
 *
 * `nowTs` is the LOG'S OWN CLOCK (`ProgressionSnap.lastTs`), never `Date.now()` — this app is
 * read by someone who alt-tabbed out of EverQuest, and a wall-clock "since" would grow while
 * nothing at all was happening.
 */
export function aaEta(
  window: RangeStats,
  lastGainTs: number | null,
  prog: ProgressionSnap,
  nowTs: number
): AaEta {
  const onlineWallMs = window.durationMs - window.offlineMs
  if (lastGainTs == null || window.aaGainEvents < AA_ETA_MIN_EVENTS || onlineWallMs <= 0) {
    return { blocked: 'no-pace' }
  }
  const meanIntervalMs = onlineWallMs / window.aaGainEvents
  const sinceLastMs = onlineMs(prog, lastGainTs, nowTs)
  // The rhythm no longer describes what is happening — refuse rather than read "due now".
  if (sinceLastMs > meanIntervalMs * AA_ETA_STALE_FACTOR) return { blocked: 'stale' }
  return {
    blocked: null,
    ms: Math.max(0, meanIntervalMs - sinceLastMs),
    meanIntervalMs,
    samples: window.aaGainEvents,
    sinceLastMs,
    overdue: sinceLastMs > meanIntervalMs
  }
}

/**
 * The whole AA pace answer. Adds NO sweep of its own: the window's counts come from the
 * `RangeStats` the caller already computed, and the ETA and the charges read the uncapped AA
 * arrays from the tail.
 */
export function aaPace(args: AaPaceArgs): AaPace {
  const { leveling, prog, window } = args
  const gains = leveling.aaGains
  const lastGainTs = gains.length > 0 ? gains[gains.length - 1].ts : null
  return {
    activeMs: window.activeMs,
    wallMs: wallMs(window),
    events: window.aaGainEvents,
    points: window.aaGained,
    perHourActive: window.aaPerHourActive,
    pointsPerHourActive: window.aaPointsPerHourActive,
    perHourWall: window.aaPerHourWall,
    pointsPerHourWall: window.aaPointsPerHourWall,
    eta: aaEta(window, lastGainTs, prog, prog.lastTs),
    potion: aaPotionState(gains, leveling.aaPotions)
  }
}
