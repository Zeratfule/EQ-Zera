// factionSources.ts — the generated "how to raise a faction" dataset's shape, and the one key it is
// joined on.
//
// The data is `src/renderer/src/data/eqlegends/factionSources.json`, written by
// `scripts/gen-faction-sources.mts` from the committed wiki caches (mob pages' `| factions =` and
// `| opposing_factions =` blocks, quest pages' "Your faction standing with X ..." lines). It is
// keyed by `factionKey`, and so is every reader, because the three spellings of one faction (the
// achievements dump, the log, the wiki) differ in case and in the backtick EQ uses for an
// apostrophe.
//
// WHAT A NUMBER MEANS HERE. `gain` is what the WIKI states one kill or one turn-in moves the
// faction by. `null` is "the wiki names the faction and states no amount" and is never read as 0.
// Nothing in this file is a standing.

/** One faction a kill or turn-in LOWERS, with the stated amount (negative) or null when unstated. */
export interface FactionLoss {
  faction: string
  delta: number | null
}

/** A mob whose death raises the faction. */
export interface FactionSourceMob {
  /** wiki page title */
  page: string
  /** the in-game name */
  name: string
  /** the page's level text, verbatim (`26`, `45 - 50`) */
  level?: string
  zones?: string[]
  /** stated gain per kill, or null when the wiki states none */
  gain: number | null
  /** tracked factions the same kill lowers */
  lowers: FactionLoss[]
}

/** A quest whose turn-in raises the faction. */
export interface FactionSourceQuest {
  /** wiki page title, also the quest's name */
  page: string
  zone?: string
  giver?: string
  /** the page's minimum or recommended level, when it states a number */
  level?: number
  /** the largest stated gain on the page, or null when every raising line is unstated */
  gain: number | null
  /** tracked factions the same turn-in lowers */
  lowers: FactionLoss[]
}

/** Everything known about raising one faction. */
export interface FactionSourceEntry {
  /** the spelling the achievements dump uses */
  name: string
  mobs: FactionSourceMob[]
  quests: FactionSourceQuest[]
}

export interface FactionSourcesData {
  source: string
  /** keyed by `factionKey` */
  factions: Record<string, FactionSourceEntry>
}

/**
 * One faction, two names: a spelling seen on the wiki or in the log (squashed, see `factionKey`)
 * → the achievements dump's spelling (squashed). Every row is MEASURED:
 *   `Coalition of Tradefolk`   the log's and the wiki's spelling of the dump's `Coalition of Tradesfolk`
 *                              (the owner's log prints `Tradefolk`; the dump says `Tradesfolk`)
 *   `Corrupt Qeynos Guards`    the wiki's page for the dump's `Corrupt Qeynos Guard`
 *   `King Ak'Anon (Faction)`   the wiki's faction page, disambiguated from the NPC of that name
 */
const ALIASES: Record<string, string> = {
  coalitionoftradefolk: 'coalitionoftradesfolk',
  corruptqeynosguards: 'corruptqeynosguard',
  kingakanonfaction: 'kingakanon'
}

/**
 * The join key for a faction name. Squashed to lowercase letters and digits, because the three
 * sources disagree on case, on the backtick EQ uses for an apostrophe (`King Ak\`Anon`), and the
 * wiki sometimes on spaces (`DaBashers`); then mapped through the measured `ALIASES`.
 */
export function factionKey(name: string): string {
  const squashed = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  return ALIASES[squashed] ?? squashed
}
