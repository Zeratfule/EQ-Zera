// aaRankCaps.ts — AAs whose reachable rank depends on the character's classes.
//
// The catalog states every AA's max rank, but one General AA is capped BELOW it per class, and the
// cap is only written in its description (eqlwiki `Alternate_Advancement`, Steadfast Will row):
//   "Only tanks (WAR/PAL/SHD) can train the full 8/8, Rangers and Monks can reach 7/8 and all
//    other classes are capped at 6/8."
// A hand table rather than a description parser: one sentence is evidence, a parser would be a
// matcher waiting to misread the next one. `tests/aaRankCaps.test.mts` re-reads the catalog and
// fails when the sentence (or the max rank) moves, so the table cannot rot silently.
//
// A LOADOUT REACHES THE BEST CAP ANY OF ITS CLASSES HAS. The wiki names the cap per class, not per
// trio; reading a WAR/MNK/BRD as "a tank" is the inference here, and it is the generous one (a
// trio holding a tank class trains what that class trains). With a class slot still unknown the
// cap is UNCERTAIN — the missing class could raise it — so nothing is enforced and the surface says
// the range instead.

import { aaKey, type AaCatalogEntry } from './aaCatalog'
import type { ClassAbbr } from './classCombo'

export interface AaClassCapRule {
  /** the catalog name */
  name: string
  /** the description sentence the table was read from, verbatim */
  evidence: string
  /** per-class caps; a class not listed gets `otherwise` */
  byClass: Partial<Record<ClassAbbr, number>>
  otherwise: number
}

export const AA_CLASS_CAPS: readonly AaClassCapRule[] = [
  {
    name: 'Steadfast Will',
    evidence: 'Only tanks (WAR/PAL/SHD) can train the full 8/8, Rangers and Monks can reach 7/8 and all other classes are capped at 6/8.',
    byClass: { WAR: 8, PAL: 8, SHD: 8, RNG: 7, MNK: 7 },
    otherwise: 6
  }
]

const RULES = new Map(AA_CLASS_CAPS.map((r) => [aaKey(r.name), r]))

export interface AaRankCap {
  /** the highest rank this loadout can train; the catalog max when no rule applies */
  cap: number
  /** true when a class rule cut the cap below the catalog max for a fully known loadout */
  limited: boolean
  /** false when a class slot is unknown and the rule could still raise the cap */
  certain: boolean
  /** the lowest and highest cap the rule hands out, for the "depends on class" wording */
  range: [number, number] | null
  /** the rule's own sentence, when one applies */
  evidence: string | null
}

function capOf(rule: AaClassCapRule, c: ClassAbbr): number {
  return rule.byClass[c] ?? rule.otherwise
}

/**
 * The rank this loadout can reach. `slots` is how many class slots the loadout has (0 = not yet
 * known); a loadout with fewer resolved classes than slots is uncertain and enforces nothing.
 */
export function rankCapFor(entry: AaCatalogEntry, classes: readonly ClassAbbr[], slots: number): AaRankCap {
  const rule = RULES.get(aaKey(entry.name))
  if (!rule) return { cap: entry.maxRank, limited: false, certain: true, range: null, evidence: null }
  const all = [rule.otherwise, ...Object.values(rule.byClass)]
  const range: [number, number] = [Math.min(...all), Math.min(entry.maxRank, Math.max(...all))]
  const known = classes.length > 0 && classes.length >= slots
  if (!known) return { cap: entry.maxRank, limited: false, certain: false, range, evidence: rule.evidence }
  const cap = Math.min(entry.maxRank, Math.max(...classes.map((c) => capOf(rule, c))))
  return { cap, limited: cap < entry.maxRank, certain: true, range, evidence: rule.evidence }
}
