// wishlist/useWishlist.ts — the wish list in the renderer: load it, edit it, persist it (JOS-326),
// and — since JOS-346 — hold it in ONE place, so every surface that draws a wish control is reading
// the same document at the same instant.
//
// ONE STORAGE TIER, UNLIKE THE TWO PLANNER DOCUMENTS BEFORE IT. `usePlans.ts` and `useGearSets.ts`
// each split their state in two — the document in the electron-store, "which one is selected" in
// `localStorage` — because both were LISTS of documents with a selection. A wish list is ONE
// document per character with nothing to select, so there is no machine-class half at all.
//
// WRITES ARE IMMEDIATE, AND THAT IS A DIFFERENCE FROM BOTH PRECEDENTS RATHER THAN AN OVERSIGHT.
// Those two debounce whole-array saves at 500 ms because their edits include TYPING — a rename is
// one keystroke per character, and writing the array per keystroke would be a round trip per
// letter. Every edit here is a discrete click: add one wish, remove one wish, clear the done
// strip. There is nothing to coalesce, so debouncing would buy nothing and cost the two things it
// costs: a flush-on-unmount to remember, and a window in which the store disagrees with the screen.
//
// ---------------------------------------------------------------------------------------------
// ONE LIVE DOCUMENT, NOT ONE PER MOUNT (JOS-346) — AND THE ARGUMENT THIS REPLACES.
//
// What stood here until this ticket: "NO MODULE-SCOPE CACHE, DELIBERATELY … a wish list is
// CHARACTER-SCOPED: App keys every view on the character rebuild counter, so a character switch
// remounts this hook, and a per-mount load is exactly what makes that remount mean something. A
// module cache would serve the previous character's wishes." The CONCERN was right and is kept
// (see `onCharacter` below). The CONCLUSION was wrong, and the owner found the hole on 2026-08-13:
// take a wish off on the Wish list tab, come back to Gear or Exaltations, and the control still
// read ADDED.
//
// WHY A PER-MOUNT READ COULD SAY THAT. Every mount held its own copy and read the store exactly
// once, at mount, and after its first local edit it stopped listening to that read altogether (the
// `edited` ref). So the answer a surface gave was "what the store said the last time THIS view
// mounted, plus whatever I did to it since" — never "what the document is". Three surfaces mount
// this hook (GearView, PlannerView, WishlistView) and JOS-343 gave all three a control whose
// direction depends on the reading, so a copy that is one edit behind does not merely look stale:
// its click goes the wrong way. Making the remount the refresh mechanism also made the refresh
// depend on the exact unmount/mount order of a view switch and on a fire-and-forget write winning
// a race with the next view's read — a lot of load-bearing weight on incidental ordering, for a
// document that four callers share.
//
// SO THE DOCUMENT LIVES HERE, IN MODULE SCOPE, AND THE HOOK IS A WINDOW ONTO IT — the
// `useFavorites.ts` shape (JOS-206), which has held the same promise for the star since it shipped:
// one store, every list reading it, `useSyncExternalStore` handing out one snapshot. A removal on
// any surface is visible on every other surface in the same tick, with no re-read and no race,
// because there is nothing to re-read.
//
// …AND THE CHARACTER CONCERN IS ANSWERED WHERE IT BELONGS. `window.eq.onCharacter` is the event
// that means "this is a different character's everything now", and it is what drops the document
// and re-reads — the same signal `useModule.ts` re-hydrates on. That is strictly better than the
// remount it replaces: the remount only refreshed the views that happened to be on screen, and
// this refreshes THE document.
// ---------------------------------------------------------------------------------------------

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  EMPTY_WISHLIST,
  addWish,
  applySeed,
  clearDone,
  removeWish,
  type WishEntry,
  type WishList
} from '@shared/planner/wishlist'

export interface WishlistApi {
  list: WishList
  /** false until the first load settles — a data-availability flag, not an error */
  ready: boolean
  /** add one wish; already-wished items are a no-op (the model dedupes by `itemKey`) */
  add: (entry: WishEntry) => void
  remove: (itemKey: string) => void
  /** dismiss a batch of fulfilled wishes from the done strip, persistently */
  dismiss: (itemKeys: readonly string[]) => void
  /**
   * Run the one-time exaltation-plan seed. Safe to call repeatedly and from a render effect: the
   * flag lives in the document, so a list that has already been seeded comes back identical and
   * nothing is written.
   */
  seed: (seeds: readonly WishEntry[]) => void
}

/**
 * THE DOCUMENT AND ITS READINESS AS ONE OBJECT, replaced whole on every change. One object rather
 * than two stores because `useSyncExternalStore` compares snapshots by identity: two stores would
 * be two subscriptions per caller, and a snapshot rebuilt per render would loop.
 */
interface Snapshot {
  list: WishList
  ready: boolean
}

let snapshot: Snapshot = { list: EMPTY_WISHLIST, ready: false }
const listeners = new Set<() => void>()

/**
 * Bumped by a character switch. A read still in flight under an older generation is answering a
 * question about somebody else's character, so it is discarded rather than applied.
 */
let generation = 0
let loading = false
/**
 * A local edit has produced a document NEWER than any read in flight. The click is authoritative —
 * it was folded from what the screen was showing and it has already been written — so the read it
 * beat is dropped. (This is the old `edited` ref, one tier up, where the document now lives.)
 */
let superseded = false
let watching = false

function emit(next: Snapshot): void {
  snapshot = next
  // A copy: a listener that unmounts in response would otherwise mutate the set mid-iteration.
  for (const listener of [...listeners]) listener()
}

/** The first load, and the only one until a character switch asks for another. */
function load(): void {
  if (loading || snapshot.ready) return
  loading = true
  const mine = generation
  void window.eq
    .getWishlist()
    .then((loaded) => {
      if (mine !== generation || superseded) return
      emit({ list: loaded, ready: true })
    })
    .catch(() => {
      /* main never rejects; an unreadable store yields an empty wish list, not a crash */
    })
    .finally(() => {
      if (mine !== generation) return
      loading = false
      // READY EVEN WHEN THE ANSWER WAS DISCARDED: the flag says the first load has SETTLED, and a
      // superseded read settled — the document the caller would draw is the newer one either way.
      if (!snapshot.ready) emit({ list: snapshot.list, ready: true })
    })
}

/**
 * A DIFFERENT CHARACTER IS A DIFFERENT DOCUMENT. Subscribed once for the life of the window and
 * never torn down: the store outlives every mount, so there is no mount whose unmount should stop
 * it listening. `ready` goes back to false with the list, because an empty list under a character
 * whose store has not been read yet is a default and not an answer — which is exactly the state the
 * wish controls decline to draw themselves in.
 */
function watch(): void {
  if (watching) return
  watching = true
  window.eq.onCharacter(() => {
    generation += 1
    loading = false
    superseded = false
    emit({ list: EMPTY_WISHLIST, ready: false })
    load()
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): Snapshot {
  return snapshot
}

/**
 * ONE WRITE PATH. Every edit is a pure fold over the current document (shared/planner/wishlist.ts
 * owns all four), and a fold that changed nothing returns the SAME OBJECT — so an add of a wish
 * that is already there neither re-renders nor writes.
 *
 * The fold reads the module's document rather than a React state updater's `prev`, for the reason
 * it always did: StrictMode double-invokes those, and an IPC write is not a thing to do twice.
 */
function apply(edit: (prev: WishList) => WishList): void {
  const next = edit(snapshot.list)
  if (next === snapshot.list) return
  superseded = true
  emit({ list: next, ready: snapshot.ready })
  void window.eq.setWishlist(next)
}

// THE FOUR DOORS, AT MODULE SCOPE, so their identity is fixed for the life of the window. Both
// browse surfaces hand a per-row handler down through a `memo`'d row and JOS-343 made those
// handlers depend on `add`/`remove`; a `useCallback` per mount would have been stable too, but a
// constant cannot be got wrong.
function add(entry: WishEntry): void {
  apply((prev) => addWish(prev, entry))
}

function remove(itemKey: string): void {
  apply((prev) => removeWish(prev, itemKey))
}

function dismiss(itemKeys: readonly string[]): void {
  apply((prev) => clearDone(prev, itemKeys))
}

function seed(seeds: readonly WishEntry[]): void {
  apply((prev) => applySeed(prev, seeds))
}

/**
 * The character's wish list. MOUNT IT WHEREVER A SURFACE NEEDS IT — the one-mount-per-view rule
 * this hook carried until JOS-346 is retired with the per-mount copy that made it necessary: two
 * mounts cannot clobber each other's edits when there is one document and both are looking at it.
 */
export function useWishlist(): WishlistApi {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  useEffect(() => {
    watch()
    load()
  }, [])
  return useMemo(
    () => ({ list: snap.list, ready: snap.ready, add, remove, dismiss, seed }),
    [snap]
  )
}
