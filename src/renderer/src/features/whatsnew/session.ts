// ============================================================================
// The what's-new SESSION (JOS-73) — one reading of the store key, held for the whole launch.
// ============================================================================
//
// THE PROBLEM THIS SOLVES, because it is not obvious from the outside. Two surfaces render from
// one fact — the teaser strip at the bottom of the app, and the What's new panel in Preferences
// — and one of them MARKS THAT FACT CONSUMED. If each component read the store for itself, the
// panel would stamp "seen" on mount and then re-read a store that now says nothing is new, so
// the release the user just clicked through to read would arrive with its own highlight already
// gone. Reading the store per component is the bug.
//
// So the state is read ONCE per launch and held here. `markSeen()` writes the store and
// deliberately does NOT touch the held state: what the user is looking at keeps its highlights
// for the rest of the session, and the next launch is the one that shows nothing new. That is
// the honest reading of "seen" — you saw it in this session, and this session's UI should not
// rearrange itself underneath you for it.
//
// It is a module-scope store with `useSyncExternalStore` rather than React context because the
// two consumers are in different subtrees (App's teaser, deep inside Preferences' section table)
// and threading a provider between them would put a prop chain through `buildSections`, which is
// already at the parameter ceiling. The snapshot is a CACHED object — `whatsNewState` builds a
// fresh one on every call, and returning that from `getSnapshot` is an infinite render.
//
// EVERY SURFACE RENDERS NOTHING UNTIL MAIN HAS ANSWERED (`null`). A teaser that flashes for one
// frame on a fresh install and then vanishes is worse than one that appears a frame late.

import { useSyncExternalStore } from 'react'
import { latestReleaseVersion, whatsNewState, type WhatsNewState } from '@shared/releaseNotes'

let snapshot: WhatsNewState | null = null
/** What the store held when this launch STARTED — what "reset to real" restores. Captured before
 *  anything can stamp, because the load below happens at App mount. */
let realLastSeen: string | null = null
/** True once the DEV variant control has driven the session. It suppresses the panel's
 *  mount-stamp, so switching to the What's new section cannot silently overwrite the state the
 *  owner just asked for. Set only by `simulateLastSeen`, whose one caller is DEV-gated. */
let simulated = false
let started = false

const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // The first subscriber starts the one read. Later mounts join the answer already held.
  if (!started) {
    started = true
    void window.eq.getReleaseNotesSeen().then((v) => {
      realLastSeen = v
      snapshot = whatsNewState(v)
      emit()
    })
  }
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): WhatsNewState | null {
  return snapshot
}

/** This launch's what's-new state, or null until main has answered. */
export function useWhatsNew(): WhatsNewState | null {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Record that the notes have been shown — the store write, and nothing else.
 *
 * Called from the panel when it opens and from the teaser's dismiss. The held state is untouched
 * on purpose (see the header): this session keeps its highlights, the next one starts clean.
 *
 * A no-op while the DEV variant control owns the session, so hand-testing a simulated upgrade
 * survives a trip through the Preferences rail.
 */
export function markReleaseNotesSeen(): void {
  if (simulated) return
  void window.eq.setReleaseNotesSeen(latestReleaseVersion())
}

/** What the store held at launch — the value "reset to real" puts back. */
export function realLastSeenVersion(): string | null {
  return realLastSeen
}

/**
 * DEV ONLY (the variant control): write the store key AND re-derive the session from it, so both
 * surfaces move in front of the owner without a relaunch. The one call that is allowed to
 * replace the held snapshot, because it is the one that is deliberately changing the past.
 */
export function simulateLastSeen(lastSeen: string | null): void {
  simulated = true
  snapshot = whatsNewState(lastSeen)
  emit()
  void window.eq.setReleaseNotesSeen(lastSeen)
}

/**
 * DEV ONLY: put back the value this launch started with and hand the session back to the app.
 *
 * Its own function rather than `simulateLastSeen(realLastSeenVersion())` because the flag matters:
 * after this the panel may stamp again, which is what "reset to real" has to mean — the app is
 * behaving normally once more, not frozen in the last simulation.
 */
export function resetToRealLastSeen(): void {
  simulated = false
  snapshot = whatsNewState(realLastSeen)
  emit()
  void window.eq.setReleaseNotesSeen(realLastSeen)
}
