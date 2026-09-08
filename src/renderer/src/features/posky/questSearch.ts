// questSearch.ts — what the Sky tab's search box actually searches (JOS-207).
//
// The box matched three things: the quest name, the reward, and the required item names. The two
// facts a player standing in the zone is most likely to type were NOT among them — the BOSS he is
// about to pull and the ISLAND he is standing on were reachable only through the two facet
// dropdowns. So typing "Gorgalosk" into a box that already knew which quests Gorgalosk stands in
// front of returned nothing, and the owner reported exactly that.
//
// ONE TRUTH FOR WHAT A QUEST'S BOSSES AND ISLANDS ARE. The added fields are read through
// `questBosses` / `questIslands` (questFacets.ts), which is the same derivation the dropdowns
// offer their options from and the same one `filterByFacets` narrows by — not a second mapping
// that could drift from it. Everything questFacets.ts argues in its header therefore holds here
// too, and holds for free: the facets read EVERY required item rather than only the still-needed
// ones (so a quest does not fall out of your search the instant its drop lands), and law 1's
// refusal to guess means a wind-rune quest is findable by neither a boss nor an island name,
// because the data states neither.
//
// THE MATCH RULE IS THE ONE THE OTHER THREE FIELDS ALREADY USED, unchanged: lowercased substring,
// no tokenising, no fuzzing, no per-field special cases. Five fields, one rule, OR across them —
// which is what makes the box explainable in a sentence and what keeps this module three lines of
// code under a page of reasoning.
//
// THE ONE CONSEQUENCE WORTH STATING OUT LOUD: islands are spelled "Island N", so a bare "7" now
// matches every quest on island 7 as well as every item with a 7 in its name. That is substring
// matching doing what substring matching does, it is the same thing "3" already did to item
// names, and the alternative — a field-aware rule that only accepts "island 7" whole — would make
// the box's behaviour depend on which field it is about to search, which is precisely the
// property this file exists to avoid.
//
// Pure + React-free, node-tested in `tests/questSearch.test.mts` against the committed data.

import { questBosses, questIslands, type FacetItem, type FacetQuest } from './questFacets'

/**
 * A required-item row as the search reads it: the facet half (`where` + `droppers`, so
 * `questIslands`/`questBosses` can be handed the same quest) plus the name the box has always
 * matched. `ItemProgress` (useProgress.ts) satisfies it structurally — spelling the shape out
 * here is what keeps this module free of React and of the `@shared/*` alias, the questFacets.ts
 * and questSort.ts precedent.
 */
export interface SearchItem extends FacetItem {
  name: string
}

/** A quest as the search reads it. `QuestProgress` satisfies it structurally. */
export interface SearchQuest extends FacetQuest {
  name: string
  /** the turn-in's reward, when the scrape states one; a quest without one matches on the rest */
  reward?: string
  items: readonly SearchItem[]
}

/**
 * Does this quest match the typed query?
 *
 * `needle` is expected ALREADY TRIMMED AND LOWERCASED — `filterByQuery` below is what does that,
 * once per keystroke rather than once per quest. An empty needle matches everything, which is the
 * same thing "no search" has always meant.
 *
 * Ordered cheapest-first: the three original fields are plain string reads, while the two new ones
 * build a deduped set per quest, so a query that lands on a quest's own name never pays for the
 * facet derivation at all.
 */
export function questMatchesQuery(q: SearchQuest, needle: string): boolean {
  if (!needle) return true
  if (q.name.toLowerCase().includes(needle)) return true
  // `?? false` only so the expression is a boolean; a quest with no reward matched nothing here
  // before either.
  if (q.reward?.toLowerCase().includes(needle) ?? false) return true
  if (q.items.some((i) => i.name.toLowerCase().includes(needle))) return true
  // JOS-207, through the facets' own derivations — see the header.
  if (questBosses(q).some((b) => b.toLowerCase().includes(needle))) return true
  return questIslands(q).some((i) => i.toLowerCase().includes(needle))
}

/**
 * Narrow a list by the typed query, folding the query ONCE. An empty (or whitespace-only) query
 * returns the SAME array untouched, so the default path costs one comparison and allocates
 * nothing — the `filterByFacets` contract, restated for the other half of the filter bar.
 */
export function filterByQuery<T extends SearchQuest>(quests: readonly T[], query: string): readonly T[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return quests
  return quests.filter((q) => questMatchesQuery(q, needle))
}
