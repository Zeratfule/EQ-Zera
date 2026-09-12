// crawlRoster.ts — AN ESTIMATE OF DUNGEON CRAWL COMPLETION, and every word of that is load-bearing.
//
// The game shows the real number in its own in-instance window and prints it in NO log line. So
// this file does not read the crawl meter; it reconstructs an approximation of it from a committed
// community table (`src/renderer/src/data/eqlegends/crawlRosters.json`) and the run the log can be
// folded into (`runTracker.ts`). Every reading it produces carries `estimated: true` and the
// surface that draws it says so out loud. World-model law 1 is not suspended here - it is the
// reason the shape below has three ways to refuse.
//
// PURE. No React, no DOM, no Electron, no clock, and NO import of the table: the caller loads the
// JSON once and passes a roster in, which is what lets tests/crawlRoster.test.mts read the
// committed file itself and lets the overlay bundle own the import.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// WHAT A DENOMINATOR IS ALLOWED TO BE, per row (`confidence`):
//
//   `stated on wiki`   a number or a labelled "Rare NPCs" row published on eqlwiki.com. The game's
//                      own rare flag is what that row claims to list, so its LENGTH may be a
//                      denominator when no explicit count exists.
//   `player report`    a blog or a patch note, read as a measurement somebody made once. Same
//                      standing as above for counting purposes, and said to be weaker in the doc.
//   `inferred`         a NAMED-MOB LIST ("Notable NPCs", the zone map's labels) - NOT the game's
//                      rare flag. A named mob may be trash to the crawl and a rare may be missing
//                      from the list entirely, so an inferred row gives NO `rareTotal`: it can say
//                      how many of its names you killed and must not pretend that is "of Y".
//
// `rareCount` and `killsToComplete` are separate fields on purpose - a zone whose totals are
// published (Lower Guk: 25 rares, ~124 kills at D0/L50) states them even where its name list is
// short by one, and `null` in either is "nobody has published this", never a zero.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// TWO HONEST LIMITS, MEASURED ON THE COMMITTED FIXTURE (tests/crawlRoster.test.mts pins both):
//
//   1. THE LOG'S SPELLING AND THE WIKI'S DISAGREE ABOUT APOSTROPHES. The owner's Befallen run
//      prints `skeleton L`rodd`; the wiki row says `Skeleton Lrodd`. Unifying the backtick and the
//      typographic apostrophe onto `'` is not enough for that pair, so the MATCH KEY drops the
//      mark entirely (`mobMatchKey`). A name that differs only by an apostrophe is the same mob in
//      every case this repo has seen, and an estimate that misses a rare it killed is worse than
//      one that folds two punctuation spellings together.
//   2. A RARE THE LOG SPELLS WITH A LEADING ARTICLE CANNOT BE COUNTED. `runTracker`'s named test
//      IS "the log spelled it without an article" (its header states that law), so `The Prophet`,
//      `The Goblin King` and the six other `The …` rares in the table are invisible to this fold -
//      they never reach `run.named` in the first place. That understates progress in those zones
//      and is stated rather than papered over; changing it would mean changing what a named mob IS,
//      which this feature is explicitly not allowed to do.

import { zoneKey } from './zones'
import type { RunState } from './runTracker'

/** How much weight the row's numbers carry. See the header - `inferred` is the one that refuses a
 *  denominator, because a named-mob list is not the game's rare flag. */
export type CrawlConfidence = 'stated on wiki' | 'player report' | 'inferred'

/** One zone's crawl knowledge, as the community published it. Keyed in the table by the zone name
 *  the log prints in `You have entered <Zone>.` */
export interface CrawlRoster {
  /** Other names the same place is known by - the wiki's short name, the pre-launch name. Folded
   *  the same way the key is, so an alias that folds onto the key is redundant. */
  aliases?: string[]
  /** The rare names, leading article stripped where the source carried one. May be EMPTY: the devs
   *  said Fear labels no rare creatures, and `[]` with `rareCount: 0` is that statement. */
  rares: string[]
  /** How many rares the zone has, where a source states it. `null` = unpublished. It can exceed
   *  `rares.length` (Lower Guk's row lists 24 of its 25). */
  rareCount: number | null
  /** Roughly how many kills fill the meter, where a source states it. `null` = unpublished. */
  killsToComplete: number | null
  confidence: CrawlConfidence
  /** The URLs the row came from, ` ; ` separated - provenance travels with the data. */
  source: string
  /** What the source actually said, including what it did NOT say. */
  notes: string
}

/** The committed table: zone name (as the log prints it) -> that zone's roster. */
export type CrawlRosterTable = Record<string, CrawlRoster>

/** What a surface may draw about crawl progress. `estimated` is a literal `true` so no consumer can
 *  hold one of these without the word being in the type. */
export interface CrawlProgress {
  /** DISTINCT roster rares this run killed. A rare killed twice is one rare - the meter counts the
   *  creature, and `run.named` carries a row per kill. */
  raresKilled: number
  /** The denominator, or `null` when no source published one (and always `null` for `inferred`). */
  rareTotal: number | null
  /** The ROSTER's spelling of each matched rare, in the order they went down. */
  rareNames: string[]
  /** kills / killsToComplete as a percentage, capped at 100 and rounded. `null` when the zone's
   *  kill total is unpublished - there is nothing to divide by. */
  killsPct: number | null
  confidence: CrawlConfidence
  estimated: true
}

/** Every apostrophe EQ, the wiki and a copy-paste produce: backtick, straight, acute, curly pair. */
const APOSTROPHES_RE = /[`'´‘’]/g
/** The three leading articles a mob name can carry, as `runTracker` and world-model law 2 spell it. */
const LEADING_ARTICLE_RE = /^(?:an?|the)\s+/
/** Runs of whitespace, collapsed to one space. */
const WHITESPACE_RE = /\s+/g

/**
 * The comparable form of a mob name: lowercase, apostrophe spellings unified, whitespace collapsed,
 * one leading article stripped.
 *
 * Article stripping is the same fold law 2 uses for boss matching, applied to BOTH sides here: the
 * wiki writes `The Prophet` and the log writes `a froglok crusader` for the same creature family,
 * and neither article says anything about which mob it is.
 */
export function normalizeMobName(name: string): string {
  return name
    .toLowerCase()
    .replace(APOSTROPHES_RE, "'")
    .replace(WHITESPACE_RE, ' ')
    .trim()
    .replace(LEADING_ARTICLE_RE, '')
    .trim()
}

/**
 * The key two names are MATCHED on: `normalizeMobName` with the apostrophe dropped rather than
 * unified. Limit 1 in the header is the measurement behind the extra step (`skeleton L`rodd` vs the
 * wiki's `Skeleton Lrodd`); it is a deliberate widening, and the pair that forced it is pinned.
 */
export function mobMatchKey(name: string): string {
  return normalizeMobName(name).replace(APOSTROPHES_RE, '')
}

/**
 * The key a zone name is looked up on: `zones.ts zoneKey` (instance suffix, tier parenthetical,
 * leading article and separators all folded - THE zone fold this repo already owns) with the
 * apostrophe dropped for the same reason mob names drop it.
 *
 * Folding through `zoneKey` means the RAW zone line works as well as `RunState.base`:
 * `Najena 4 (Refined)` and `Najena` reach the same row.
 */
export function crawlZoneKey(zone: string | undefined | null): string {
  return zoneKey(zone).replace(APOSTROPHES_RE, '')
}

/**
 * The roster for a zone, by key or by alias, case- and spelling-insensitively. `null` when the
 * table has never heard of the place - which is most of EverQuest, and is why the surface draws
 * nothing at all rather than an empty estimate.
 *
 * A linear pass over ~19 rows: an index would be ceremony, and the table is a parameter rather than
 * a module-level import (see the header), so there is nothing stable to cache against.
 */
export function rosterForZone(zoneName: string | undefined | null, table: CrawlRosterTable): CrawlRoster | null {
  const key = crawlZoneKey(zoneName)
  if (key === '') return null
  for (const [name, roster] of Object.entries(table)) {
    if (crawlZoneKey(name) === key) return roster
    if (roster.aliases?.some((a) => crawlZoneKey(a) === key) === true) return roster
  }
  return null
}

/**
 * How far through the crawl this run PROBABLY is.
 *
 * `null` for a zone with no roster - the one refusal a surface reads as "draw nothing".
 *
 * The rares are matched out of `run.named`, which is the log's own list of mobs it spelled without
 * an article; nothing here changes how a named kill is detected (that law lives in runTracker.ts
 * and stands). The kill percentage counts YOUR kills and your GROUP's together, because the
 * instance's meter advances on a dead mob rather than on who got the credit for it.
 */
export function crawlProgress(run: RunState, roster: CrawlRoster | null): CrawlProgress | null {
  if (roster === null) return null
  const byKey = new Map<string, string>()
  for (const rare of roster.rares) byKey.set(mobMatchKey(rare), rare)
  const rareNames: string[] = []
  const hit = new Set<string>()
  for (const named of run.named) {
    const key = mobMatchKey(named.name)
    const rare = byKey.get(key)
    if (rare === undefined || hit.has(key)) continue
    hit.add(key)
    rareNames.push(rare)
  }
  return {
    raresKilled: rareNames.length,
    // An `inferred` list is a named-mob list, not the game's rare flag, so its LENGTH is not a
    // denominator. An explicit `rareCount` always is - including `0`, which is Fear's statement.
    rareTotal: roster.rareCount ?? (roster.confidence === 'inferred' ? null : roster.rares.length),
    rareNames,
    killsPct: crawlKillsPct(run, roster),
    confidence: roster.confidence,
    estimated: true
  }
}

/** The kill percentage, capped at 100 - the published total is a rough one, and a run that passes
 *  it has finished the crawl rather than done 112% of it. */
function crawlKillsPct(run: RunState, roster: CrawlRoster): number | null {
  const goal = roster.killsToComplete
  if (goal === null || goal <= 0) return null
  return Math.min(100, Math.round(((run.kills + run.groupKills) / goal) * 100))
}
