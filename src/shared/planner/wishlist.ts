// planner/wishlist.ts — THE FLAT WISH LIST: the things this character has decided they want
// (JOS-326), and the pure edits that shape it.
//
// WHAT A WISH IS, AND WHAT IT DELIBERATELY IS NOT. A wish is one line: "I want this item." That is
// the whole model. It names no equipment cell, no socket and no host, and that absence is an OWNER
// RULING rather than a v1 shortcut — targeting a host item for an exaltation is an explicitly LATER
// addition. The plan board that used to carry that structure is gone with this ticket, and a wish
// list that quietly re-grew a cell map would be the same feature under a friendlier name.
//
// TWO KINDS, BECAUSE THE CORPUS HAS TWO SHAPES OF ANSWER. A `gear` wish is an item you want to
// WEAR — it comes from the gear index, which is every equippable item described in numbers. A
// `donor` wish is an item you want FOR AN EFFECT it carries — it comes from the donor corpus, which
// is one row per (item, effect), and it carries that effect and its socket as CONTEXT so the list
// can state what the item is wanted for and what merge tier the effect extracts at. Both are
// keyed the same way (`itemKey(name)`, the join key every index in this app shares), so the list
// dedupes across them: one item, one wish.
//
// SOURCE IS PROVENANCE, NOT PRIORITY. `user` is a line someone typed; `planImport` is a line the
// one-time seed lifted out of an exaltation set's unmet sockets. The distinction is on screen
// (the imported rows say where they came from) and it is deletable like anything else — the seed
// is an offer, never a lock.
//
// PURE AND NODE-TESTABLE (`tests/wishlist.test.mts`), the `gearSet.ts` precedent: types plus folds,
// relative value imports, nothing here touches React, storage, IPC or the corpus. The persistence
// door is src/main/planner/validate.ts on the way in and out, exactly as it is for the other two
// planner documents.

import type { SocketType } from './types'

/** Where the wish came from in the corpus — and therefore what the row can say about it. */
export type WishKind = 'gear' | 'donor'

/** Who put the line there. `planImport` rows say so on screen and are deletable like any other. */
export type WishSource = 'user' | 'planImport'

/**
 * ONE THING SOMEONE WANTS.
 *
 * `itemKey` is the identity — `itemKey(name)`, the corpus's canonical, `+N`-stripped, case-folded
 * key — and it is also the React key, the dedupe key and the remove handle. There is deliberately
 * no separate uuid: two wishes for the same item are one wish, so the item IS the id.
 *
 * `name` rides beside it for the same reason `GearAssignment.name` does: the list must still read
 * as a list on a machine whose corpus no longer carries the row, and the Loot drill-down is
 * reached BY NAME (`onOpenLoot`), never by key.
 */
export interface WishEntry {
  /** `itemKey(name)` — the corpus join key, and this entry's whole identity */
  itemKey: string
  /** the item's display name, as the corpus spells it */
  name: string
  kind: WishKind
  /**
   * THE EFFECT CONTEXT, carried only when the wish is a donor: the effect as the wiki wrote it
   * ("Improved Healing III") and the socket it occupies. Both absent on a `gear` wish, which is
   * not a gap — a gear wish was never about an effect (law 1: silence, never a guessed value).
   *
   * The socket is what lets the row state a merge cost without the corpus in hand
   * (`extractionTier(socket)`), which is exactly the case a store written on another machine, or
   * before a rescrape, puts the reader in.
   */
  effect?: string
  socket?: SocketType
  /** wall-clock instant the line was added — recorded for the reader, never for expiry */
  addedAt: number
  source: WishSource
}

/**
 * THE WHOLE PERSISTED DOCUMENT — one `ProgressState` key rather than three.
 *
 * The entries are the list. The other two fields are things the list needs to REMEMBER about
 * itself, and they are stored beside it rather than as sibling `ProgressState` keys because they
 * mean nothing without it: a cleared-done id is a statement about a wish, and the seed flag is a
 * statement about this list having been seeded once. Three top-level keys would be three chances
 * for a partial write to leave the three disagreeing.
 */
export interface WishList {
  entries: WishEntry[]
  /**
   * THE DONE STRIP'S DISMISSALS. A wish the progress join says is FULFILLED moves to the done
   * strip; clearing the strip files its ids here and they stop rendering anywhere.
   *
   * It is a DISMISSAL and not a deletion, deliberately: the entry stays in `entries`, so the list
   * still remembers that this item was wanted and got. A user who wants the record gone as well
   * uses the row's own remove, which drops both (`removeWish` below).
   */
  clearedDone: string[]
  /**
   * HAS THE ONE-TIME EXALTATION-PLAN SEED RUN? Absent means never. Once true it stays true even if
   * the user deletes every imported row, which is the entire point: re-offering rows somebody
   * declined is the failure mode a "seed when the list is empty" rule walks straight into.
   */
  seededFromPlans?: boolean
}

/** The document a character who has never opened the tab has. A constant, so no reader allocates. */
export const EMPTY_WISHLIST: WishList = { entries: [], clearedDone: [] }

/** Generous bounds — they exist to stop a runaway write, not to tell anyone how much to want. */
export const MAX_WISHES = 500

// ---- reads --------------------------------------------------------------------------------

/** Is this item already wished for? The dedupe question, asked in one place. */
export function hasWish(list: WishList, itemKey: string): boolean {
  return list.entries.some((e) => e.itemKey === itemKey)
}

/** The keys the done strip has been told to stop showing. */
export function isCleared(list: WishList, itemKey: string): boolean {
  return list.clearedDone.includes(itemKey)
}

// ---- edits --------------------------------------------------------------------------------

/**
 * Add one wish. ALREADY THERE ⇒ UNCHANGED, and the same object identity comes back, so a React
 * memo downstream does not re-run over a write that changed nothing.
 *
 * The first line wins rather than the last: someone who adds "Blade of Light" as a gear wish and
 * then meets it again as a donor row has not changed their mind about anything, and silently
 * rewriting the earlier line's `addedAt` and `source` would lose the only two facts it carried.
 */
export function addWish(list: WishList, entry: WishEntry): WishList {
  if (hasWish(list, entry.itemKey) || list.entries.length >= MAX_WISHES) return list
  return { ...list, entries: [...list.entries, entry] }
}

/**
 * Drop one wish, and forget the dismissal with it. Removing the entry and leaving its id in
 * `clearedDone` would leave a tombstone that silently swallowed the row if it were ever added
 * again — the list would accept the wish and then refuse to draw it.
 */
export function removeWish(list: WishList, itemKey: string): WishList {
  return {
    ...list,
    entries: list.entries.filter((e) => e.itemKey !== itemKey),
    clearedDone: list.clearedDone.filter((k) => k !== itemKey)
  }
}

/** Dismiss a batch of fulfilled wishes from the done strip. Idempotent, and order is preserved. */
export function clearDone(list: WishList, itemKeys: readonly string[]): WishList {
  const next = [...list.clearedDone]
  for (const key of itemKeys) if (!next.includes(key)) next.push(key)
  return next.length === list.clearedDone.length ? list : { ...list, clearedDone: next }
}

// ---- the one-time seed from the exaltation plans -------------------------------------------
//
// THE PLAN BOARD IS GONE AND THE WORK IT HELD IS NOT (JOS-326). Every socket a user planned names
// a donor they decided to farm, which is exactly what a wish is — so the first time the wish list
// opens it offers those rows, labelled with where they came from and deletable one by one.
//
// SEEDING RUNS EXACTLY ONCE, on the flag and never on emptiness. "Seed when the list is empty"
// re-offers rows somebody has already deleted, forever; the flag makes a deletion mean what a
// deletion means. It is set even when the seed produced NOTHING, because "we looked" is the fact
// worth remembering — a user who plans a set afterwards should not find it silently imported.

/** One planned socket, flattened out of an `ExaltPlan` and decorated by the caller. */
export interface PlannedWish {
  /** `PlanSocket.donorKey` */
  donorKey: string
  /** the donor's display name — the corpus's when it has the row, else the key itself */
  name: string
  effect: string
  socket: SocketType
  /**
   * THE PROGRESS JOIN'S VERDICT AT SEED TIME. A socket whose donor the log has already seen merged
   * to its extraction tier is finished work, not a wish, so it is not imported. Decided by the
   * caller because the join lives in the renderer; passed in rather than recomputed so this stays
   * pure and the rule stays one line.
   */
  met: boolean
}

/**
 * Planned sockets → the wishes they would become: unmet only, deduped by item, in first-seen
 * order.
 *
 * DEDUPED BY `itemKey`, which is the same rule the list itself enforces — one donor socketed into
 * three cells is one item to go and get. The FIRST occurrence keeps its effect context; the plans
 * are walked in the order the store holds them, so this is stable across runs.
 */
export function seedWishes(planned: readonly PlannedWish[], now: number): WishEntry[] {
  const out: WishEntry[] = []
  const seen = new Set<string>()
  for (const p of planned) {
    if (p.met || seen.has(p.donorKey) || out.length >= MAX_WISHES) continue
    seen.add(p.donorKey)
    out.push({
      itemKey: p.donorKey,
      name: p.name,
      kind: 'donor',
      effect: p.effect,
      socket: p.socket,
      addedAt: now,
      source: 'planImport'
    })
  }
  return out
}

/**
 * Run the seed, once. A list that has already been seeded comes back UNCHANGED and with the same
 * identity; one that has not gains the entries it does not already carry and the flag.
 *
 * The append respects the list's own dedupe (`addWish`), so a wish the user typed by hand before
 * the seed ever ran keeps its `user` label and its own `addedAt`.
 */
export function applySeed(list: WishList, seeds: readonly WishEntry[]): WishList {
  if (list.seededFromPlans === true) return list
  let next: WishList = { ...list, seededFromPlans: true }
  for (const seed of seeds) next = addWish(next, seed)
  return next
}
