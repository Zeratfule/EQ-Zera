// ============================================================================
// itemOverrides.ts — A HAND-STATED HELD COUNT: what it is, and what it may never become.
// ============================================================================
//
// JOS-186, owner ruling 2026-08-14 (the gate on this ticket had stood since 2026-08-10). Two
// reports, one hole. 01KZZ51GNHKFNFC082CVGQQ9N8: *when I know I don't have an item, but it thinks
// I do based on the log, then I have no way of "manually" correcting this*. 01M0089H6NCBES55RTYHXDT05R:
// an accidentally destroyed quest item, and the Ready tab nagging forever with no way to clear it.
// Both are the ACCEPTED COST that reconcile.ts states out loud — a deletion is invisible, because
// the log records the loot and never records the destruction (world-model law 6) and a dump that
// omits an item cannot be told apart from a dump that never looked. The cost was accepted; the
// silence was not meant to be permanent.
//
// SO THIS IS A CORRECTION MECHANISM, NOT A PARALLEL TRUTH. The distinction is the whole design:
//
//   * It corrects ONE NUMBER — the held count for one counting key — and it corrects it wherever
//     that number is read. There is no second "manual" model of your bags running beside the real
//     one, no hand-marked quest state, no hand-marked ready flag. A quest leaves the Ready tab
//     because the item it needed is no longer counted, which is the same reason it would leave if
//     you handed it in.
//   * It NEVER edits the evidence. Nothing here touches the loot ledger, the turn-in ledger or the
//     dump. Clearing the statement restores exactly the number the witnesses were reporting before
//     it was made, which is what makes it reversible in the only sense that matters.
//   * It is VISIBLY manual (a chip on the row, and a count on the tab's status line) and per-item
//     reversible, which is the shape the ticket asked for and the shape the class-combo corrections
//     (JOS-87) and the roster edits already have here.
//
// IT IS A STATEMENT AT AN INSTANT, AND THAT IS WHY IT CARRIES `setAt`.
//
// A pinned absolute would be a lie the moment you looted the item again: state "I have 0 Sphinx
// Claws", farm three, and a pin still reads 0 until you remember to come back and re-state it. So
// the count is what you held AT `setAt`, and the log is trusted FORWARD from there — every drop
// after the statement adds, and every turn-in recorded after it subtracts. That is the same rule
// the `rebaseline` count source applies to a whole dump (renderer/features/inventory/reconcile.ts
// argues the arithmetic), applied to one item; the two shipped together on purpose, because they
// are one idea at two scales.
//
// AND ONLY ANOTHER STATEMENT CAN MOVE IT — the provenance ladder `RosterEdit` already climbs
// (shared/progressState.ts). A dump loaded after the statement does NOT quietly overrule it: the
// user told us a thing about an item, and a file that only reports what a window happened to be
// showing is not the rebuttal that earns the right to erase it silently. What the user gets
// instead is the chip, saying the number is theirs, with the date on it.
//
// PURE, so both sides of the IPC share one definition of what a statement is (the `applyTurnIns`
// precedent): main's store sanitizes on the way in, the renderer folds the same list on the way
// out, and neither can invent a rule the other does not have.

/** ONE hand-made statement about how many of an item you are holding. */
export interface ItemCountOverride {
  /** The normalized counting key — `itemCountKey(name)`. Lowercased, ` +N` stripped. */
  key: string
  /** Display name as the surface that recorded it spelled the item. Never a join key. */
  name: string
  /** How many you said you hold. A whole count, never negative. */
  count: number
  /** Epoch ms the statement was made. Loot after this instant still adds (see the header). */
  setAt: number
}

/**
 * Most statements one character can hold. A guard on renderer-supplied input reaching the store
 * (the `isSafePackId` rule: validate at the boundary, never trust today's only caller), not a
 * claim about the game — the whole Sky set is ~50 quests over ~150 distinct items.
 */
export const MAX_ITEM_OVERRIDES = 500

/**
 * Most any one statement may claim. Same kind of guard: a count is a bag count, and six figures of
 * Sphinx Claws is a hand-edited store or a bad caller rather than a player.
 */
export const MAX_OVERRIDE_COUNT = 99999

/** A whole non-negative number, or null for anything that is not one. Deliberately UNBOUNDED —
 *  it reads both a bag count and an epoch instant, and only the caller knows which is which. */
function whole(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.floor(value)
}

/** Clean one statement, or reject it. Anything unusable is dropped rather than thrown over — a
 *  hand-edited store must not take the character's whole progress record down with it. */
export function sanitizeItemOverride(value: unknown): ItemCountOverride | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Partial<Record<keyof ItemCountOverride, unknown>>
  const key = typeof v.key === 'string' ? v.key.trim() : ''
  const count = whole(v.count)
  if (!key || count === null || count > MAX_OVERRIDE_COUNT) return null
  // An unreadable instant becomes 0 rather than rejecting the statement: the COUNT is the thing
  // the user said, and a baseline at the epoch simply means every loot line counts forward from it.
  const name = typeof v.name === 'string' && v.name ? v.name : key
  return { key, name, count, setAt: whole(v.setAt) ?? 0 }
}

/**
 * Clean a whole list: usable statements only, ONE per key (the last one written wins, which is
 * what makes "correct it, then correct it again" one statement rather than two), oldest first,
 * capped. Same shape as `sanitizeTurnInLedger` next door, and for the same reasons.
 */
export function sanitizeItemOverrides(value: unknown): ItemCountOverride[] {
  if (!Array.isArray(value)) return []
  const byKey = new Map<string, ItemCountOverride>()
  for (const raw of value) {
    const o = sanitizeItemOverride(raw)
    if (o) byKey.set(o.key, o)
  }
  return [...byKey.values()].sort((a, b) => a.setAt - b.setAt || a.key.localeCompare(b.key)).slice(0, MAX_ITEM_OVERRIDES)
}

/**
 * State a count for one key, REPLACING whatever that key said before. Replace rather than append
 * for the reason `setComboCorrection` gives: two statements about one item are one statement, the
 * later one.
 */
export function applyItemOverride(
  list: readonly ItemCountOverride[],
  next: ItemCountOverride
): ItemCountOverride[] {
  return sanitizeItemOverrides([...list.filter((o) => o.key !== next.key), next])
}

/** Take the statement back. The witnesses answer for that key again, exactly as they did before. */
export function clearItemOverride(
  list: readonly ItemCountOverride[],
  key: string
): ItemCountOverride[] {
  return sanitizeItemOverrides(list.filter((o) => o.key !== key))
}

/** The list as the counting path wants it: key → statement. */
export function itemOverridesByKey(
  list: readonly ItemCountOverride[]
): Record<string, ItemCountOverride> {
  const out: Record<string, ItemCountOverride> = {}
  for (const o of list) out[o.key] = o
  return out
}

/** key → the instant its statement was made — the windows the loot fold and the turn-in fold use. */
export function itemOverrideInstants(
  list: readonly ItemCountOverride[]
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const o of list) out[o.key] = o.setAt
  return out
}
