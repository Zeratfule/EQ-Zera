// quests/useQuestPins.ts — the quest tracker in the renderer: load it, edit it, persist it, and
// hold it in ONE place so every surface that draws a tracker control reads the same document at the
// same instant.
//
// THE `useWishlist.ts` SHAPE, AND FOR ITS REASONS (JOS-346). Four surfaces mount this — the tracked
// list at the top of the Quests tab, the quest page's Pin button, its step checklist, and the
// always-mounted completion watch — and three of them carry a control whose DIRECTION depends on
// the reading ("Track this quest" vs "Tracking"). A per-mount copy of a document four callers share
// is one edit behind on every surface but the one that made the edit, and a control that is one
// edit behind does not merely look stale: its click goes the wrong way. So the document lives in
// module scope and the hook is a window onto it, with `useSyncExternalStore` handing out one
// snapshot.
//
// WRITES ARE IMMEDIATE. Every edit here is a discrete click — pin, unpin, tick a step, record a
// completion — so there is nothing to coalesce and debouncing would buy nothing while costing the
// two things it costs: a flush-on-unmount to remember, and a window in which the store disagrees
// with the screen.
//
// TWO REFRESH SIGNALS, WHICH ARE NOT THE SAME EVENT.
//   * `onCharacter` means "this is a different character's everything now": the document is DROPPED
//     and re-read, and `ready` goes back to false, because an empty tracker under a character whose
//     store has not been read is a default and not an answer.
//   * `onProgress` means "this character's stored record moved" — which is what main pushes after
//     every write, including ours. It re-reads rather than clearing, so a tick made in one window
//     (or by the completion watch, which writes `markDone` without any surface being open) lands
//     everywhere without a refetch race.
//
// A RE-READ NEVER BEATS A LOCAL EDIT. `writes` counts the edits made since a read left; a reply
// that comes back under an older count is answering a question about a document the user has since
// changed, so it is dropped. That is the `superseded` latch of useWishlist made a COUNTER rather
// than a boolean, because unlike a wish list this document is also written by main's own push loop
// and a permanent latch would freeze it after the first click.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  clearDone as clearDoneOf,
  markDone as markDoneOf,
  setTick as setTickOf,
  togglePin as togglePinOf,
  type QuestPins
} from '../../../../shared/questPins'

const EMPTY: QuestPins = []

/** The document and its readiness as ONE object — `useSyncExternalStore` compares by identity. */
interface Snapshot {
  pins: QuestPins
  /** false until the first load settles. A data-availability flag, never an error. */
  ready: boolean
}

let snapshot: Snapshot = { pins: EMPTY, ready: false }
const listeners = new Set<() => void>()

/** Bumped by a character switch: a read still in flight is answering about somebody else. */
let generation = 0
/** Bumped by every local edit: a read that left before it is answering about an older document. */
let writes = 0
let loading = false
let watching = false

function emit(next: Snapshot): void {
  snapshot = next
  // A copy: a listener that unmounts in response would otherwise mutate the set mid-iteration.
  for (const listener of [...listeners]) listener()
}

/** Read the store. `force` is the push path — an `onProgress` re-read, which has no first-load gate. */
function load(force: boolean): void {
  if (loading || (!force && snapshot.ready)) return
  loading = true
  const mine = generation
  const seenWrites = writes
  void window.eq
    .getQuestPins()
    .then((loaded) => {
      if (mine !== generation || seenWrites !== writes) return
      emit({ pins: loaded, ready: true })
    })
    .catch(() => {
      /* main never rejects; an unreadable store yields an empty tracker, not a crash */
    })
    .finally(() => {
      if (mine !== generation) return
      loading = false
      // READY EVEN WHEN THE ANSWER WAS DISCARDED: the flag says the first load SETTLED, and a
      // superseded read settled — the document a caller would draw is the newer one either way.
      if (!snapshot.ready) emit({ pins: snapshot.pins, ready: true })
    })
}

/** Subscribed once for the life of the window: the store outlives every mount. */
function watch(): void {
  if (watching) return
  watching = true
  window.eq.onCharacter(() => {
    generation += 1
    loading = false
    emit({ pins: EMPTY, ready: false })
    load(false)
  })
  window.eq.onProgress(() => {
    load(true)
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
 * ONE WRITE PATH. Every edit is a pure fold over the current document (shared/questPins.ts owns all
 * four), applied OPTIMISTICALLY and then written; main hands back what it actually stored, and that
 * answer replaces the optimistic one unless a later click has already moved on.
 *
 * The fold reads the module's document rather than a React state updater's `prev`, for the reason
 * `useWishlist` does: StrictMode double-invokes those, and an IPC write is not a thing to do twice.
 */
function apply(edit: (prev: QuestPins) => QuestPins): void {
  const next = edit(snapshot.pins)
  writes += 1
  const mine = writes
  const gen = generation
  emit({ pins: next, ready: snapshot.ready })
  void window.eq
    .setQuestPins(next)
    .then((stored) => {
      if (gen !== generation || mine !== writes) return
      emit({ pins: stored, ready: true })
    })
    .catch(() => {
      /* main never rejects; the optimistic document stands and the next read reconciles it */
    })
}

// THE FOUR DOORS, AT MODULE SCOPE, so their identity is fixed for the life of the window — a row
// handler passed down through a `memo`'d row cannot be got wrong by a missing dependency.
function toggle(page: string): void {
  apply((prev) => togglePinOf(prev, page, Date.now()))
}

function tick(page: string, step: number, on: boolean): void {
  apply((prev) => setTickOf(prev, page, step, on))
}

function markDone(page: string, ts: number): void {
  apply((prev) => markDoneOf(prev, page, ts))
}

function clearDone(page: string): void {
  apply((prev) => clearDoneOf(prev, page))
}

export interface QuestPinsApi {
  /** Track a quest, or stop tracking it. */
  toggle: (page: string) => void
  /** Tick (or un-tick) one step BY HAND. Steps the log satisfies are never written. */
  tick: (page: string, step: number, on: boolean) => void
  /** Note the instant a completion was recorded. Re-recording keeps the first instant. */
  markDone: (page: string, ts: number) => void
  clearDone: (page: string) => void
  /** false until the first load settles */
  ready: boolean
}

const API_BASE = { toggle, tick, markDone, clearDone }

/** The character's tracked quests. Mount it wherever a surface needs it: there is one document. */
export function useQuestPins(): [QuestPins, QuestPinsApi] {
  const snap = useSyncExternalStore(subscribe, getSnapshot)
  useEffect(() => {
    watch()
    load(false)
  }, [])
  return useMemo(() => [snap.pins, { ...API_BASE, ready: snap.ready }], [snap])
}

/** The hand ticks for one page, or the empty list. A loop: `QuestPin` is a shared domain type. */
export function ticksFor(pins: QuestPins, page: string): number[] {
  for (const pin of pins) if (pin.page === page) return pin.ticks
  return []
}

/** Is this page tracked? */
export function isPinned(pins: QuestPins, page: string): boolean {
  for (const pin of pins) if (pin.page === page) return true
  return false
}
