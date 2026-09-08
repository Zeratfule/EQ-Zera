// skillRows.ts — the `skills` snapshot, as rows the Character tab can draw. Pure, node-tested.
//
// ── `value` AND `ups` ARE DIFFERENT FACTS AND NEITHER DERIVES THE OTHER ───────────────────────
//
// `You have become better at Meditate! (57)` states BOTH that a skill rose and what it rose TO. The
// trailing number is the CLIENT's and counts every tick since the character was made — most of them
// long before any log this app has read. `ups` counts what THIS fold watched. skillTypes.ts states
// the law; this file is what obeying it looks like: the two are separate columns and nothing here
// adds one to the other.
//
// `value` IS 0 UNTIL A LINE STATES ONE, and 0 is the ABSENCE rather than a skill of zero — so a row
// whose value nothing stated prints the refusal instead of the digit. `ups` beside it still says the
// skill is real.
//
// ── "THIS SESSION" IS COUNTED OFF THE HISTORY CURVE, NOT OFF `ups` ────────────────────────────
//
// `ups` is the whole fold; the session is the stretch since the newest login the log states
// (`shared/timeslice.sessionStartOf` — the caller reads it, this file takes the instant). The
// curve holds only ticks that STATED a value and is capped at 200 drop-oldest, so the count is a
// LOWER BOUND on a very long session; that is the honest reading of a capped ring, and it is the
// same reading the leveling tab's `clipped` flag makes elsewhere. No session start (a log with no
// logout in it) means there is no session boundary to count against, and the row says nothing
// rather than restating `ups` under a second name.
//
// ── RULING 4: THE SORT IS OVER *OUR* ROWS ────────────────────────────────────────────────────
//
// `SkillRow` is declared in `src/shared/skillTypes.ts`, so an array of them may not be sorted or
// filtered here. The projection below walks the record with a for-loop into `SkillPanelRow`, which
// is this file's own, and orders that.

import type { SkillSnap } from '../../../../shared/skillTypes'

/** One skill, as the panel draws it. OUR row type — see the header. */
export interface SkillPanelRow {
  /** the lowercased key the snapshot filed it under; the react key. */
  key: string
  /** the CLIENT's spelling, verbatim (`1H Slashing`, `Stringed Instruments`). */
  name: string
  /** the last value a line STATED. 0 means no line ever stated one. */
  value: number
  /** that value, worded — the refusal when nothing stated one. */
  valueText: string
  /** how many ticks THIS FOLD watched. Not the skill's history. */
  ups: number
  lastTs: number
  /**
   * How many of the curve's ticks landed at or after the session start, or null when the log
   * states no session boundary at all. A LOWER BOUND on a very long session — see the header.
   */
  thisSession: number | null
  /** `+3 this session`, or '' when there is nothing honest to say. */
  sessionText: string
  searchKey: string
}

/** What a row prints when no line ever stated this skill's value. */
export const NO_STATED_VALUE = 'no value stated'

/** Ticks in the curve at or after `since`. A for-loop over `[ts, value]` pairs. */
function ticksSince(history: readonly [number, number][], since: number): number {
  let n = 0
  for (const [ts] of history) {
    if (ts >= since) n++
  }
  return n
}

/**
 * Every skill in the snapshot, MOST RECENTLY TICKED FIRST, narrowed by `query`.
 *
 * `sessionStart` is the instant `shared/timeslice.sessionStartOf` answered, or null when the log
 * states no logout. `query` arrives already normalised (trim + lowercase).
 */
export function skillRows(snap: SkillSnap | null, sessionStart: number | null, query = ''): SkillPanelRow[] {
  if (!snap) return []
  const rows: SkillPanelRow[] = []
  for (const [key, skill] of Object.entries(snap.skills)) {
    const searchKey = skill.display.toLowerCase()
    if (query !== '' && !searchKey.includes(query)) continue
    const thisSession = sessionStart === null ? null : ticksSince(skill.history, sessionStart)
    rows.push({
      key,
      name: skill.display,
      value: skill.value,
      valueText: skill.value === 0 ? NO_STATED_VALUE : String(skill.value),
      ups: skill.ups,
      lastTs: skill.lastTs,
      thisSession,
      sessionText: thisSession === null || thisSession === 0 ? '' : `+${String(thisSession)} this session`,
      searchKey
    })
  }
  // OUR rows. The name breaks the tie so the order is a function of the bytes.
  rows.sort((a, b) => b.lastTs - a.lastTs || a.name.localeCompare(b.name))
  return rows
}
