// currentLevel.ts — WHAT LEVEL AM I, and who said so (JOS-192, the level half).
//
// THE PROBLEM THIS FILE EXISTS FOR. EQ Legends runs up to three classes at once, the displayed
// level is the MINIMUM of their levels, and a loadout swap is NEVER logged. So the level series —
// `You have gained a level! Welcome to level N!` — states your level only at the instant it
// CHANGES, and the instant it changes most is the one instant it says nothing about. Swap a
// level-11 class into a capped loadout and the log's last word remains "50" until the new loadout
// dings, which can be a whole evening away.
//
// Four surfaces read that tail and each did its own `levelValue[n-1]` / `latestLevel(sorted)`:
// the character header, the Overview leveling card, the Leveling tab's hero + "New at this level"
// stepper, and the XP overlay's header. They agreed with each other and were wrong together.
//
// THE SECOND STATEMENT NOBODY WAS READING. The character's own `/who` row prints the level
// outright — `[50 PAL/MNK/ENC] Primitive (Dark Elf)` — one number, three classes. It is exactly
// the line the combo model already treats as ground truth for the CLASSES, and it carries the
// LEVEL in the same brackets. Typing `/who` on yourself after a swap is the one move a player can
// make to tell this app what happened, and until now it corrected the trio and left the number.
//
// SO THERE IS ONE FACT, WITH PROVENANCE:
//
//   * LATEST TIMESTAMP WINS. Both statements are the game speaking; neither is inference. The
//     newer one describes the world now.
//   * A TIE GOES TO `/who`. EQ timestamps are whole seconds, so a `/who` typed in the same second
//     as a ding is not ambiguous in the way the numbers make it look: the ding announces the level
//     you just reached and the row RE-STATES it after the fact, so on equal stamps the row is at
//     worst identical and at best later.
//   * IT NEVER ENTERS THE DING SERIES. `LevelingModule.levels` / `ProgressionSnap.levelTs` stay
//     DINGS ONLY — they are a record of level-ups, the anchor of the next-level projection and the
//     x-axis of the level chart, and a `/who` is none of those things. Injecting rows there would
//     manufacture level-ups that never happened and put fake "time to level" spans on the chart.
//
// AND THE FACT IS SHOWN WITH ITS AGE, never as a bare assertion. The whole defect is that a level
// can be true-when-stated and stale now, and the log cannot tell you which. So every surface that
// prints the number can say where it came from and how long ago — `currentLevelRead` words that
// once, so four surfaces cannot word it four ways.
//
// Pure and dependency-free (a type import only): the XP overlay is a second renderer bundle whose
// contract is to be cheap to paint over the game, and the same sentence has to reach it.

import type { ProgressionSnap } from './progressionTypes'

/** Who stated the level. Both are the game speaking — neither is inference. */
export type LevelSource =
  /** the character's own `/who` row: `[50 PAL/MNK/ENC] Primitive` */
  | 'who'
  /** `You have gained a level! Welcome to level N!` */
  | 'ding'

/** The level, the instant the log stated it, and which line did. */
export interface LevelStatement {
  level: number
  /** LOG timestamp of the line that stated it (not a wall clock). */
  ts: number
  source: LevelSource
}

/**
 * Beyond this age a surface HEDGES instead of asserting.
 *
 * It is a CHOICE, not a fact, and is surfaced as one (the hover always states the actual age).
 * Six hours is longer than any single camp in this log and short enough that a level stated
 * before the last time the player logged out is flagged — which is the window a loadout swap
 * hides in. Nothing branches on it except wording.
 */
export const LEVEL_STALE_MS = 6 * 3_600_000

/** The level fact, resolved, with everything a surface needs to be honest about it. */
export interface CurrentLevelRead {
  level: number
  source: LevelSource
  /** log timestamp of the statement */
  ts: number
  /** how much log time has passed since it was stated; never negative */
  ageMs: number
  /** `ageMs >= LEVEL_STALE_MS` — say WHEN rather than asserting */
  stale: boolean
  /** short provenance for a chip: `/who` or `level-up` */
  from: string
  /**
   * The VISIBLE cue beside the number, or '' when the bare number says everything.
   *
   * It is deliberately quiet in the ordinary case — a level you dinged to an hour ago is simply
   * your level, and decorating it would train the eye to skip the decoration. It speaks in the
   * two cases where the number alone is not the whole fact: when your own `/who` is what stated
   * it (so the player can see their correction landed), and when the last thing that stated it
   * is old enough for an unlogged swap to be hiding behind it.
   *
   * AND THE TWO CASES COMPOSE (JOS-288). Until then a `/who` cue was the bare word whatever its
   * age, so a 25-hour-old `/who` rendered exactly like a 4-second-old one while a 7-hour-old ding
   * said `7h 0m ago` — the STALER statement looked the FRESHER of the two. Provenance and age are
   * different facts about the same statement and staleness is a property of the statement, not of
   * the source that made it: an old `/who` is behind an unlogged loadout swap for precisely the
   * reason an old ding is. So a stale `/who` now wears both, `/who 25h 0m ago`.
   */
  cue: string
  /** the hover sentence — provenance, age, and the caveat when there is one */
  title: string
}

/**
 * Which of two statements is current: LATEST WINS, `/who` breaks a tie. See the header for why
 * the tie-break is not arbitrary. Exported because the module folds with it and the tests pin it.
 */
export function laterStatement(a: LevelStatement, b: LevelStatement): LevelStatement {
  if (b.ts > a.ts) return b
  if (b.ts < a.ts) return a
  return b.source === 'who' ? b : a
}

/**
 * The DING TAIL as a statement — the level series' last word, which is what every surface used to
 * read on its own.
 *
 * This is NOT a second source of truth: the character module folds the very same `level` events,
 * so for a log that contains only dings the two answers are identical by construction. It exists
 * because the module snapshots hydrate independently (a surface can hold a progression snapshot
 * for a frame before the character one lands) and because the pure view models are driven by
 * fixtures in tests that carry no character module at all. When the stated fact is present it
 * always wins — it is the same thing plus `/who`.
 */
export function dingStatement(snap: ProgressionSnap): LevelStatement | null {
  const n = snap.levelValue.length
  if (n === 0) return null
  return { level: snap.levelValue[n - 1], ts: snap.levelTs[n - 1], source: 'ding' }
}

/** `3d 4h` / `2h 10m` / `14m` / `31s` — the vocabulary the leveling surfaces already speak. */
function agoText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hrs = Math.floor(total / 3600)
  if (hrs >= 48) return `${String(Math.floor(hrs / 24))}d ${String(hrs % 24)}h`
  const mins = Math.floor((total % 3600) / 60)
  if (hrs > 0) return `${String(hrs)}h ${String(mins)}m`
  return mins > 0 ? `${String(mins)}m` : `${String(total % 60)}s`
}

/** The words for each source, in the two places they are needed. */
const SOURCE_WORDS: Record<LevelSource, { from: string; said: string }> = {
  who: { from: '/who', said: 'Your own /who row stated this level' },
  ding: { from: 'level-up', said: 'Your last level-up reported this level' }
}

/**
 * THE CAVEAT, and it is the whole ticket in one sentence. A loadout swap re-reports the level of
 * the class you swapped in and prints NOTHING, so any statement old enough to have a swap behind
 * it is a level that WAS true. The escape is the one the player can act on.
 */
const STALE_CAVEAT =
  'A loadout swap since then would have printed nothing - type /who on yourself to restate it.'

/**
 * The current level, worded. `fact` is `CharacterSnap.level` (the stated truth); `snap` supplies
 * the ding-tail fallback and, in `lastTs`, the LOG clock the age is measured against — wall time
 * would call a fixture replay three weeks stale the moment it loaded.
 *
 * Null when nothing has ever stated a level: the surfaces omit the chip rather than guess one.
 */
export function currentLevelRead(
  fact: LevelStatement | null | undefined,
  snap: ProgressionSnap
): CurrentLevelRead | null {
  const statement = fact ?? dingStatement(snap)
  if (!statement) return null
  const ageMs = Math.max(0, snap.lastTs - statement.ts)
  const stale = ageMs >= LEVEL_STALE_MS
  const words = SOURCE_WORDS[statement.source]
  const age = `${agoText(ageMs)} ago`
  const title = `${words.said}, ${age}.${stale ? ` ${STALE_CAVEAT}` : ''}`
  // AGE AND PROVENANCE COMPOSE — see `CurrentLevelRead.cue`. The ding's cue is the age alone
  // because "level-up" is what a bare level already implies; the `/who` cue keeps its word because
  // a correction the player typed is worth seeing land, and gains the age once it is old enough to
  // have a swap hiding behind it.
  const who = statement.source === 'who'
  const cue = who ? (stale ? `/who ${age}` : '/who') : stale ? age : ''
  return {
    level: statement.level,
    source: statement.source,
    ts: statement.ts,
    ageMs,
    stale,
    from: words.from,
    cue,
    title
  }
}
