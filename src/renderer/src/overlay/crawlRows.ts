// crawlRows.ts — the Run window's CRAWL ESTIMATE, as rows (2026-09-12).
//
// The split is farmRows.ts's: the helper owns the data and the words, `RunOverlay.tsx` owns the JSX
// and the styling. Here that split also keeps the one IMPORT of the community table in a single
// place - the JSON is inlined into the overlay bundle at module evaluation and handed to the pure
// fold in `shared/crawlRoster.ts`, which imports no data of its own.
//
// WHAT IT IS NOT. The game's own crawl percentage exists only inside the game's own window; it is
// in no log line, so nothing here reads it. These rows are an approximation from counts and rare
// lists the community published, and the caption below travels with them WHEREVER they are drawn -
// a number a user could mistake for the game's own would be a wrong answer, not a feature.
//
// A ZONE THE TABLE HAS NEVER HEARD OF GETS NO ROWS, not a row of zeroes (world-model law 1). Most
// of EverQuest is such a zone.

import type { RunState } from '@shared/runTracker'
import {
  type CrawlProgress,
  type CrawlRosterTable,
  crawlProgress,
  rosterForZone
} from '@shared/crawlRoster'
import crawlRostersJson from '../data/eqlegends/crawlRosters.json'

/**
 * The committed roster table, loaded ONCE (an ES import, inlined by electron-vite like every other
 * corpus in this app - there is no file at runtime).
 *
 * The assertion is what a JSON import costs: TypeScript widens the file's `confidence` strings to
 * `string`, and the union is the whole point of the field. `tests/crawlRoster.test.mts` re-reads the
 * same bytes off disk and asserts every row against the interface, so the cast is checked rather
 * than trusted.
 */
export const CRAWL_ROSTERS = crawlRostersJson as unknown as CrawlRosterTable

/** The sentence under every crawl block. It says both halves: where the numbers came from, and
 *  which number this is NOT. */
export const CRAWL_ESTIMATE_CAPTION = "Estimate from community counts, not the game's own tracker."

/** The head of the block. The word `estimated` is in the title, not only in the caption. */
export const CRAWL_HEAD_TEXT = 'Crawl (estimated)'

/** One `label · value` line, in the shape `RunOverlay`'s own row component takes. */
export interface CrawlRow {
  id: string
  label: string
  value: string
}

/**
 * The crawl rows for a run, or `[]` when the table knows nothing about the place.
 *
 * TWO SHAPES FOR THE RARE LINE, and the difference is a denominator this app is allowed to print:
 * `Rares · 11 of 25` where a source published a count, `Rares killed · 11` where none did (every
 * `inferred` row, whose list is named mobs rather than the game's rare flag - `crawlRoster.ts`
 * states that law). The kill line exists only where a kill total was published.
 */
export function crawlRows(state: RunState): CrawlRow[] {
  const roster = rosterForZone(state.base, CRAWL_ROSTERS)
  const progress = crawlProgress(state, roster)
  if (roster === null || progress === null) return []
  const rows: CrawlRow[] = [rareRow(progress)]
  const goal = roster.killsToComplete
  if (goal !== null && progress.killsPct !== null) {
    const done = state.kills + state.groupKills
    // `~` is the honest part: the published total is a round number somebody measured once, and the
    // percentage is capped at 100 by the fold rather than running past it.
    rows.push({
      id: 'crawl-kills',
      label: 'Kills',
      value: `${String(done)} of ~${String(goal)} (${String(progress.killsPct)}%)`
    })
  }
  return rows
}

/** The rare line: `X of Y` where there is a Y, and an honest bare count where there is not. */
function rareRow(progress: CrawlProgress): CrawlRow {
  if (progress.rareTotal === null) {
    return { id: 'rares', label: 'Rares killed', value: String(progress.raresKilled) }
  }
  return {
    id: 'rares',
    label: 'Rares',
    value: `${String(progress.raresKilled)} of ${String(progress.rareTotal)}`
  }
}
