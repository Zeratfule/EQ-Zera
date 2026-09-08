// THE grouped-loot sort orders, pure — the same shape questSort.ts has for the Quests tab.
// `groupLootRows` tallies and then calls exactly one comparator from here, so a new order is a
// case in this file and a line in LOOT_SORT_OPTIONS, and nothing else moves.
//
// THERE IS NO SECOND PASS ANY MORE (JOS-345). The grouped table used to re-sort the comparator's
// output by a favorited flag, pinning starred items into a block on top; the star column left the
// loot window with the owner's ruling, and its ordering rule went with the control that set it —
// a pin nobody can see or toggle from this window is just an order the reader cannot explain.
// What the table shows now is EXACTLY what the chosen comparator says, which is what the Sort
// control has always claimed it was.
//
// WHY THIS IS ITS OWN MODULE and not a few lines inside lootGrouping.ts: lootGrouping imports
// lootItemData → data/index → `@shared/profiles`, a VALUE import that does not resolve outside
// the bundler, so a node test can never load it (measured — the import throws MODULE_NOT_FOUND).
// The orders are the part worth pinning, so they live where `npm test` can reach them. Same
// reasoning questSort.test.mts records for the quest orders.
//
// EVERY COMPARATOR IS TOTAL. Each one bottoms out in the item name, so the table has one
// deterministic order per key and never shuffles on re-render. That matters more here than it
// looks: EQ log timestamps are SECOND-resolution, so a corpse that yields three items writes
// three lines with the SAME `ts` — ties under "last looted" are the common case, not the corner.
// Before this the count order fell through to Map insertion order on a full tie; now it does not.

/**
 * The part of a grouped row every comparator reads — structural, like questSort's ItemWhere, so
 * the sort takes `GroupRow` without this module importing (and dragging in) lootGrouping.
 */
export interface SortableLootRow {
  item: string
  /** Times looted — stacked loots count their stack size. */
  count: number
  /** Epoch ms of the newest loot in the group. */
  last: number
}

export type LootSortKey = 'count' | 'recent'

/**
 * Times looted stays the default: the grouped table's headline question is "what do I keep
 * picking up", and JOS-91 added recency beside it rather than in front of it.
 */
export const DEFAULT_LOOT_SORT: LootSortKey = 'count'

export const LOOT_SORT_OPTIONS: readonly { value: LootSortKey; label: string }[] = [
  { value: 'count', label: 'Times looted' },
  { value: 'recent', label: 'Last looted' }
]

export function isLootSortKey(v: unknown): v is LootSortKey {
  return LOOT_SORT_OPTIONS.some((o) => o.value === v)
}

/** The universal last resort. Item names are the group identity, so this is total. */
function byItem(a: SortableLootRow, b: SortableLootRow): number {
  return a.item.localeCompare(b.item)
}

export function compareLootRows(sort: LootSortKey): (a: SortableLootRow, b: SortableLootRow) => number {
  switch (sort) {
    // The order this table always had, now with a name tiebreak underneath it.
    case 'count':
      return (a, b) => b.count - a.count || b.last - a.last || byItem(a, b)
    // "What did I just pick up" — newest group first. Count breaks the second-resolution ties
    // before the name does, so a corpse's three simultaneous drops read most-looted first.
    case 'recent':
      return (a, b) => b.last - a.last || b.count - a.count || byItem(a, b)
  }
}

/** Non-mutating sort — the caller's array is tally output it may still be holding. */
export function sortLootRows<T extends SortableLootRow>(rows: readonly T[], sort: LootSortKey): T[] {
  return [...rows].sort(compareLootRows(sort))
}
