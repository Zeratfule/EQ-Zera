// aaCatalog.ts — the shape of the generated Alternate Advancement catalog, and the one key it is
// joined on.
//
// The data is `src/renderer/src/data/eqlegends/aaCatalog.json`, written by
// `scripts/gen-aa-catalog.mts` from ONE wiki page (eqlwiki.com `Alternate_Advancement`, raw
// wikitext cached under scripts/sources/cache/aa). Names are the CLIENT's spelling: where the wiki
// and `dbstr_us.txt` disagree the client wins and the wiki's spelling is kept in `wikiName`
// (tests/aaCatalogClient.test.mts reads the installed client to prove it).
//
// WHAT A NULL MEANS HERE. A `null` cost is a rank the wiki writes as `?` — unknown, never 0. A
// `null` requirement field is "the wiki states none we could read", and `unparsed` carries the
// text we could not read rather than dropping it.

import type { ClassAbbr } from './classCombo'

export type AaSection = 'general' | 'archetype' | 'class' | 'special'

/** How an AA is obtained when it is not bought with points. */
export type AaGrant = 'reincarnation' | 'achievement'

/** Another AA that must be held first, per rank of THIS AA. */
export interface AaPrereq {
  name: string
  /** the prerequisite's rank needed for each rank of this AA; length 1 = the same for every rank */
  ranks: number[]
}

export interface AaRequirements {
  /** the character level each rank needs; length 1 = the same for every rank. Empty = none read. */
  levels: number[]
  prereqs: AaPrereq[]
  /** "Must spend N ability points" gates, when the wiki states one */
  pointsSpent: number | null
  /** the requirement text verbatim (markup stripped), or null when the row states none */
  raw: string | null
  /** pieces of `raw` the parser could not read, verbatim */
  unparsed: string[]
}

export interface AaCatalogEntry {
  /** the client's name for the AA */
  name: string
  /** the wiki's spelling, only when it differs from the client's */
  wikiName?: string
  section: AaSection
  /** class AAs only: the classes whose list names it */
  classes?: ClassAbbr[]
  maxRank: number
  /** points per rank, length `maxRank`; null = unknown. Empty for granted (Special) AAs. */
  costs: (number | null)[]
  description: string
  req: AaRequirements
  /** set for Special AAs, which are granted, never bought */
  granted?: AaGrant
  /** Special AAs: what each rank gives, verbatim from the rank columns */
  rankValues?: string[]
  /** Special AAs: the activated ability the row names beside the passive */
  activated?: string
  /** the wiki strikes the row through and says it was removed */
  removed?: boolean
  /** why this row is not fully read; absent when it is */
  issues?: string[]
}

export interface AaCatalogData {
  source: string
  /** the page revision the catalog was built from, when the fetch reported one */
  revision: number | null
  entries: AaCatalogEntry[]
}

/** The join key: case-folded, backticks as apostrophes, whitespace collapsed. */
export function aaKey(name: string): string {
  return name.toLowerCase().replace(/`/g, "'").replace(/\s+/g, ' ').trim()
}

/** Cost of rank `rank` (1-based), or null when unknown or out of range. */
export function rankCost(entry: AaCatalogEntry, rank: number): number | null {
  return entry.costs[rank - 1] ?? null
}

/** The level rank `rank` needs, or null when the wiki states none. */
export function rankLevel(entry: AaCatalogEntry, rank: number): number | null {
  const { levels } = entry.req
  if (levels.length === 0) return null
  return levels[Math.min(rank, levels.length) - 1]
}

/** The prerequisite's rank needed for rank `rank` of this AA. */
export function prereqRank(p: AaPrereq, rank: number): number {
  return p.ranks[Math.min(rank, p.ranks.length) - 1]
}
