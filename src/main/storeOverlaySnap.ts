// storeOverlaySnap.ts — the persisted half of "magnetize my overlay drags" (JOS-217).
//
// A FOURTH MODULE THROUGH THE `settingsStore` DOOR (uiScale.ts was the first, storeRespawn.ts the
// second, storeSoundPacks.ts the third): store.ts sits at the repo's 400-code-line factoring
// ceiling and the stated answer to that is a split rather than a widened threshold. It owes the
// same discipline every accessor in store.ts follows and pays it — read through
// `normalizeOverlaySnap`, write back through the SAME normalizer.
//
// ADDITIVE + OPTIONAL ⇒ NO SCHEMA BUMP, NO MIGRATION — the `lastSeenNotesVersion` /
// `eqDiscoveredRoot` / `buffTrust` / `soundPacks` carve-out storeShape.ts already documents. An
// absent `overlaySnap` key normalizes to OFF, which is exactly the behaviour every build before
// this one had, so a store written by an older build loads here unchanged and one written here
// still opens in a build that predates the feature. That is also the owner's ruling made
// structural: there is no upgrade path on which anybody's overlays start behaving differently.
//
// THE MEANING of the setting, the snap distance, and the geometry it drives all live in
// shared/overlaySnap.ts beside the pure functions. This file is storage and nothing else.

import { settingsStore } from './store'
import { mergeOverlaySnap, normalizeOverlaySnap, type OverlaySnapPrefs } from '../shared/overlaySnap'

/** The stored blob, defaulted — and, while the release hold stands, false whatever it says
 *  (JOS-359; the clamp is in `normalizeOverlaySnap`). Never throws, never returns a partial. */
export function getOverlaySnap(): OverlaySnapPrefs {
  return normalizeOverlaySnap(settingsStore.get('overlaySnap'))
}

/**
 * Merge-patch the blob; returns what the feature will ACTUALLY do, so the Preferences switch
 * renders the answer rather than assuming its request landed.
 *
 * The patch is `unknown` because it arrives over IPC. The second argument is the merge: fields the
 * patch does not name (or names with the wrong type) fall back to what is stored right now, so a
 * renderer, a hand-edited file and a share import all go through one door.
 *
 * WHAT IS WRITTEN IS THE USER'S OWN VALUE, unclamped — the release hold is applied on READ and
 * never by rewriting somebody's store (JOS-359). A patch under the hold therefore cannot silently
 * erase the `true` a tester left behind, while the value this function RETURNS is what the app
 * will do, which is nothing.
 */
export function setOverlaySnap(patch: unknown): OverlaySnapPrefs {
  const next = mergeOverlaySnap(patch, mergeOverlaySnap(settingsStore.get('overlaySnap')))
  settingsStore.set('overlaySnap', next)
  return normalizeOverlaySnap(next)
}
