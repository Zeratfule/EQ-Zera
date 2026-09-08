// progressionStatsTypes.ts — WHAT A RANGE QUERY ANSWERS WITH, as types (JOS-288 split it out).
//
// SPLIT, NEVER RATCHET (AGENTS.md). `progressionStats.ts` sat at the measured 400-line ceiling and
// JOS-288 added the elapsed halves of three rates to it; the honest cut is the one this repo has
// made before — the SHAPES move to their own file and the arithmetic keeps the old one. Nothing
// changed inside any interface but the fields the ticket added, and `progressionStats.ts`
// re-exports every one of them, so no importer anywhere moves.
//
// Types only: no value, no import that is not a type, so this file costs a bundle nothing.

import type { ProgressionSnap } from './progressionTypes'

export interface ZoneRangeRow {
  /** RAW display name, first-seen casing (law 2: canonicalize at boundaries, display raw). */
  zone: string
  /** ms of the selection spent in this zone (Σ over every visit inside the range). */
  spanMs: number
  /** spanMs minus idleMs minus offlineMs. */
  activeMs: number
  /** present-but-unproductive silence. EXCLUDES `offlineMs` — a logout is not medding. */
  idleMs: number
  /**
   * ms of this zone's span the log says you were LOGGED OUT.
   *
   * A logout lands INSIDE the zone interval you logged out in — the login writes a fresh zone
   * line, so the old interval stays open until then — which is why this is the zone row's own
   * column rather than a share of its idle. The overnight belongs to the camp you left, and
   * the camp's `activeMs` / rates must not be judged by it.
   */
  offlineMs: number
  visits: number
  kills: number
  killsSelf: number
  killsPet: number
  /** Σ stated level-bar percent, /100. Excludes unstated samples. */
  levelEquiv: number
  /** exp lines whose percentage the log did not state (at cap). */
  expUnstated: number
  expSamples: number
  /** null when activeMs is 0, or when every exp sample here was unstated. */
  levelsPerHourActive: number | null
  /** per hour of ONLINE wall (`spanMs - offlineMs`) — see `RangeStats.levelsPerHourWall`. */
  levelsPerHourWall: number | null
  killsPerHourActive: number | null
  /** kills per hour of ONLINE wall, the sibling of `levelsPerHourWall` (JOS-288). It exists so a
   *  table row can state both of its rates over ONE hour — a levels column on the elapsed
   *  denominator beside a kills column on the active one is two readings wearing one row. */
  killsPerHourWall: number | null
}

export interface ComboInterval {
  startTs: number
  endTs: number
  /** e.g. ['PAL','MNK','ENC'] — display order as stated. */
  classes: string[]
  /** the combo agent's own confidence flag; chipped `inferred` when true. */
  inferred: boolean
}

/**
 * Implemented by the class-combo module (a separate plan). STRUCTURAL — this file declares
 * the shape it needs and never imports the combo implementation, so this feature compiles and
 * ships before that work lands. `rangeStats` calls `intervalsIn` EXACTLY ONCE and stores the
 * result verbatim: zero inference, zero merging, zero gap-filling. Absent ⇒ `combos: []`,
 * which is a first-class state, not an error (the self `/who` row is the only line that ever
 * states a loadout and there are 11 in 1.1M lines, so "unknown" is the COMMON case).
 */
export interface ComboSource {
  /** the loadout active at `ts`, or null when nothing is known at that instant. */
  comboAt(ts: number): ComboInterval | null
  /** every combo interval overlapping [t0,t1), clipped to it, ascending. */
  intervalsIn(t0: number, t1: number): ComboInterval[]
}

export interface RangeStats {
  t0: number
  t1: number
  durationMs: number
  /**
   * THE Σ IDENTITY, pinned by the tests: `activeMs + idleMs + offlineMs === durationMs`.
   * Every instant of the selection is exactly one of playing, present-but-silent, and gone.
   */
  activeMs: number
  /**
   * Present-but-unproductive silence, with any derived offline interval CARVED OUT of it. So
   * an overnight logout adds to `offlineMs`, not here — while the four minutes you spent
   * finding your corpse after logging back in are still idle, because they are.
   */
  idleMs: number
  /**
   * Number of idle spans in the range. Counted AFTER offline is carved out, so one overnight
   * silence can leave a short present-but-idle remainder at either end of it and those
   * remainders are counted (they are real time you were logged in and quiet). With no offline
   * interval in range this is exactly what it always was: the gaps over IDLE_GAP_MS.
   */
  idleGaps: number
  idleThresholdMs: number

  /**
   * ms of the range the log says you were LOGGED OUT — Σ of the derived `offlineGap` intervals
   * clipped to the selection. 0 when the log stated no logout, which is not the same fact as
   * "you were online" (see the file header's live-edge limit) and must never be worded as one.
   */
  offlineMs: number
  /** how many derived offline intervals intersect the range. 0 ⇒ say nothing about offline. */
  offlineGaps: number

  kills: number
  killsSelf: number
  killsPet: number
  killsWitnessed: number

  expSamples: number
  expParty: number
  expUnstated: number
  /** Σ stated percent / 100 — "levels of progress", NOT experience points. */
  levelEquiv: number
  levelsPerHourActive: number | null
  /**
   * Levels of progress per hour of ONLINE WALL time — `durationMs - offlineMs`, NOT the
   * selection's raw wall clock.
   *
   * The name is kept for its callers; the honest reading is "per online hour". A rate whose
   * denominator counted a logout would be arithmetic about an empty chair: an overnight in the
   * window drove this toward zero and made every ETA built on it meaningless, which is the
   * whole reason offline exists. WALL still means "including the idle time you actually spent
   * in the game" — medding and looting stay in the denominator, deliberately, because you will
   * experience the projection in that same wall time. Null when the online wall is 0 (a range
   * that is entirely offline), or when every exp sample in range was unstated.
   *
   * With no offline interval in range this is EXACTLY the old wall rate — same denominator,
   * same number, byte for byte.
   */
  levelsPerHourWall: number | null
  killsPerHourActive: number | null
  /** Kills per hour of ONLINE WALL time (`wallMs`) — the elapsed half of the pair above,
   *  added with the AA halves in JOS-288 so a surface can put every rate it shows on one hour. */
  killsPerHourWall: number | null

  /** dings inside the range, in order. */
  levelUps: { ts: number; level: number }[]
  /**
   * Disjoint level runs — a loadout swap opens a NEW run, never a negative span. EQ Legends
   * gives a character ONE level shared by a three-class loadout, and swapping a class in
   * drops that level with NO log line of any kind; the same rule as `buildLevelSegments`
   * (renderer levelSeries.ts): a value below the previous one starts a new run.
   */
  levelRuns: { fromLevel: number; toLevel: number; startTs: number; endTs: number }[]

  /** Σ of the gain LINES in range. NOT the AA identity — a respec re-logs purchases and
   *  refunds nothing, so this over-reports re-earned points. Label it at every surface,
   *  exactly like the existing "AA gained over time" caption. (law 5) */
  aaGained: number
  aaGainEvents: number
  /**
   * AA COMPLETIONS per hour of ACTIVE time — the sibling of `levelsPerHourActive`, over the
   * same denominator, and the number that still measures something once the level bar stops
   * moving. It counts gain LINES, so it is the rate at which the AA bar filled, and it is
   * unaffected by the item-shop potion (which multiplies POINTS, never experience).
   *
   * Null when the range has no active time. Never 0.0 for "unknown": unlike the levels rate
   * this one has no unstated-sample failure mode — a gain line always states its amount — so a
   * measured 0 over real active time is a fact and prints as one.
   */
  aaPerHourActive: number | null
  /**
   * ABILITY POINTS per hour of ACTIVE time. Σ of the amounts the gain lines STATED, so the AA
   * potion's doubling is already inside this number — measured, not modelled: the doubled line
   * reads `You have gained 2 ability point(s)!` and this adds the 2 the log printed.
   *
   * It carries the same respec reservation as `aaGained` (see that field).
   */
  aaPointsPerHourActive: number | null
  /**
   * AA COMPLETIONS per hour of ONLINE WALL time — `wallMs(...)`, the sibling of
   * `levelsPerHourWall` and the exact denominator the loot ledger calls "elapsed" (JOS-288).
   *
   * It exists because the XP overlay now defaults every rate to the wall reading and the AA row was
   * the one pace with no wall half to switch to. Same numerator as `aaPerHourActive` — gain LINES,
   * so the item-shop bottle cannot move it — divided by the hours the slice actually covered rather
   * than by the hours it classified as play. Null when the slice is entirely offline.
   */
  aaPerHourWall: number | null
  /**
   * ABILITY POINTS per hour of ONLINE WALL time. The wall half of `aaPointsPerHourActive`, with
   * that field's respec reservation and its potion note carried over verbatim: the doubling is
   * inside the numerator because the log printed it.
   */
  aaPointsPerHourWall: number | null

  zones: ZoneRangeRow[]
  combos: ComboInterval[]

  /** true when t0 < snapshot.windowStart — the panel must say the range is clipped. */
  clipped: boolean
}

export interface RangeStatsArgs {
  snap: ProgressionSnap
  range: { t0: number; t1: number }
  /** OPTIONAL seam. Absent ⇒ `combos: []`. */
  combo?: ComboSource
  /**
   * RESTRICT EVERY NUMBER TO ONE ZONE (JOS-130) — a `shared/zones.zoneKey` fold, or null/absent
   * for every zone, which is byte-identical to what this function has always done.
   *
   * TWO FOLDS, ON PURPOSE, AND THEY DO DIFFERENT JOBS. The `zones` ROWS are still grouped by
   * `zoneIdKey` (trim + lowercase), because that is the identity `lootRates.ts` joins drops onto
   * and a second answer there would orphan rows (rule 2). MEMBERSHIP is the coarser
   * `zones.zoneKey`, which additionally strips the instance noise EQ Legends spells into the zone
   * name (`Najena 4 (Refined)`, `The Ruins of Old Paineel - Solo 4`). That is not a loosening: a
   * player asking for "this zone" means the PLACE, and a re-entry that changes the instance
   * ordinal is the same camp — the leveling tab's band strip has merged exactly those bounces
   * since JOS-71 for the same reason. So a filtered range can still hand back MORE THAN ONE row
   * when the log spelled the place two ways, and each of those rows still joins by its own
   * spelling, which is what keeps both contracts true at once.
   *
   * It is a filter on the range's zone SEGMENTS, applied before anything is folded, so the answer
   * is the same shape of answer over a smaller, non-contiguous stretch of the same instants:
   * `durationMs` becomes Σ of the visits inside `[t0,t1)`, idle and offline are clipped to them,
   * and a sample outside them is not counted at all (never clamped into the nearest visit, which
   * is what the unfiltered `segAt` used to do at the edges).
   *
   * THE Σ IDENTITY SURVIVES: `activeMs + idleMs + offlineMs === durationMs` still holds, over the
   * visits rather than over the wall clock. `t0`/`t1` keep reporting the ENVELOPE the caller
   * asked for — the slice's own range — because that is what the surface's caption says.
   *
   * SINCE JOS-291 IT IS THE `allTiers` HALF OF A CHOICE, and it is still the default and still
   * exactly this — see `zoneExactKey` below for the other half.
   */
  zoneKey?: string | null
  /**
   * …AND ADMIT ONLY THE TIER THE CURRENT ZONE NAMES (JOS-291) — a `zoneScope.zoneIdKey` fold of
   * that zone's RAW name, or null/absent for every tier of the place.
   *
   * ABSENT IS THE DEFAULT AND THE DEFAULT IS `allTiers`: with this null the query is byte-identical
   * to the one this function has answered since JOS-130, which the golden windows pin field by
   * field. Present, it NARROWS `zoneKey` rather than replacing it — both keys are folds of ONE
   * name, so `zoneIdKey(n) === zoneExactKey` implies `zoneKey(n) === zoneKey`, and the two compose
   * as an AND (`shared/zoneScope.ts zoneAdmits` is the one predicate; nothing here re-spells it).
   *
   * WHY THE OPTION EXISTS: EQ Legends spells difficulty into the name, and the tiers of one camp do
   * not pay alike — the Befallen audit measured the place fold admitting the plain `Befallen`
   * interval alongside `Befallen 2 (Adaptive)`. The `zones` rows are UNCHANGED by this (they are
   * grouped by `zoneIdKey` either way); what changes is how many of them there are, because an
   * exact-tier query admits exactly one spelling and therefore hands back exactly one row.
   */
  zoneExactKey?: string | null
}
