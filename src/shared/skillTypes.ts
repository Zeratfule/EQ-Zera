// skillTypes.ts — the `skills` module's transport: what the client last said each of your skills
// is worth, and how many ticks this fold watched.
//
// Its own file on the characterTypes.ts precedent — `shared/types.ts` is at its measured ceiling.
//
// ── `value` AND `ups` ARE DIFFERENT FACTS, AND NEITHER DERIVES THE OTHER ──────────────────────
//
// `You have become better at Meditate! (57)` states BOTH that a skill rose and what it rose TO. The
// trailing number is the CLIENT's, and it counts every tick since the character was made — most of
// which happened before any log this app has read. `ups` counts what THIS fold watched. A surface
// that adds `ups` to anything to get a skill value is inventing history (law 5: aggregates lie,
// derive from identities).
//
// `value` IS 0 UNTIL A LINE STATES ONE. The trailing `(n)` is optional in the event's shape, so a
// skill known only from a value-less tick honestly has no number — 0 is the absence, and `ups`
// beside it says the skill is real. Nothing ever fills one in from a neighbour.
//
// ── THE SPELLING IS THE CLIENT'S, VERBATIM ────────────────────────────────────────────────────
//
// `1H Slashing`, `Channeling`, `Stringed Instruments` — which is NOT how the wiki spells several of
// them. `data/classes.json`'s skills table is keyed by the CLIENT name and carries the alias
// mapping, so a pre-translated name here would drift from the table's key (`SkillUpEvent`'s own
// law). Keys are lowercased for lookup; `display` is what the client printed.

import type { LogEventBase } from './logEvents'

/**
 * A SKILL TICKED — `You have become better at Meditate! (57)`.
 *
 * `skill` is the string EXACTLY as the CLIENT prints it (`1H Slashing`, `Channeling`, `Stringed
 * Instruments`), which is NOT how the wiki spells several of them. `data/classes.json`'s `skills`
 * table is keyed by the client name and carries the alias mapping, so the event must never
 * pre-translate or the table's key and the log's word drift apart.
 *
 * `value` is optional so a value-less shape stays expressible: the trailing `(n)` is what the
 * client prints today on every one of them, and an absent value is honest about a line that did
 * not.
 */
export interface SkillUpEvent extends LogEventBase {
  kind: 'skillUp'
  /** client spelling, verbatim ('Flying Kick', '1H Piercing'). */
  skill: string
  /** the new skill value from the trailing `(n)`; absent when the line printed none. */
  value?: number
}

/** One skill's history, as far as this fold watched it. */
export interface SkillRow {
  /** the client's spelling, verbatim. */
  display: string
  /** the last value a line STATED. 0 means no line ever stated one — see the header. */
  value: number
  /** how many ticks THIS FOLD watched. Not the skill's history. */
  ups: number
  /** LOG timestamp of the first tick this fold saw. */
  firstTs: number
  /** LOG timestamp of the most recent one. */
  lastTs: number
  /**
   * `[ts, value]` pairs, oldest first — the climb curve. Only ticks that STATED a value appear,
   * so the curve has no invented points. Capped at 200, drop-oldest: it is a curve rather than a
   * ledger, and nothing is summed over it.
   */
  history: [number, number][]
}

/** The `skills` module's published state, keyed by the lowercased skill name. */
export interface SkillSnap {
  /** shape version. */
  v: number
  skills: Record<string, SkillRow>
}

/** The delta is a WHOLE snapshot — the `RespawnDelta` posture; see hailTypes.ts. */
export type SkillDelta = SkillSnap

/** What a consumer holds before the fold has said anything. */
export const EMPTY_SKILL_SNAP: SkillSnap = { v: 1, skills: {} }
