// storeSoundPacks.ts — the persisted half of "which sound pack is yours" (JOS-273).
//
// A THIRD MODULE THROUGH THE `settingsStore` DOOR (uiScale.ts was the first, storeRespawn.ts the
// second): store.ts sits at the repo's 400-code-line factoring ceiling and the stated answer to
// that is a split rather than a widened threshold. It owes the same discipline every accessor in
// store.ts follows and pays it — read through `normalizeSoundPackPrefs`, write back through the
// SAME normalizer, so a hand-edited file, an old renderer and a future migration cannot end up
// with three ideas of what this setting is.
//
// ADDITIVE + OPTIONAL ⇒ NO SCHEMA BUMP, NO MIGRATION — the `lastSeenNotesVersion` /
// `eqDiscoveredRoot` / `buffTrust` carve-out storeShape.ts already documents. An absent
// `soundPacks` key normalizes to "no preference, nothing deleted", which is precisely the
// behaviour every build before this one had, so a store written by an older build loads here
// unchanged and one written here still opens in a build that predates the feature. A migration is
// also the one thing that could CHANGE somebody's shipped behaviour, and the ruling this
// implements is explicit that fresh installs are unchanged.
//
// THE MEANING of each field, and the rules about it, live in shared/soundPacks.ts beside the pure
// functions that read them. This file is storage and policy: whose ids may be tombstoned, and what
// a seeded alert's sound ref becomes.

import { settingsStore } from './store'
import {
  normalizeSoundPackPrefs,
  withDefaultPack,
  withTombstone,
  type SoundPackPrefs
} from '../shared/soundPacks'
import { DEFAULT_PACK_IDS } from './data/defaultPacks'

/** The stored blob, defaulted + validated. Never throws, never returns a partial. */
export function getSoundPackPrefs(): SoundPackPrefs {
  return normalizeSoundPackPrefs(settingsStore.get('soundPacks'))
}

/** Write the blob through the same normalizer the read uses; returns what was stored. */
function put(next: SoundPackPrefs): SoundPackPrefs {
  const clean = normalizeSoundPackPrefs(next)
  settingsStore.set('soundPacks', clean)
  return clean
}

/**
 * The user's default pack id, or undefined when they have expressed no preference.
 *
 * It answers the id whether or not that pack is currently INSTALLED, deliberately: "the pack I
 * chose is not here" is a thing the surfaces have to be able to say, and an accessor that quietly
 * healed the value would delete the user's statement to make the code's life easier.
 */
export function getDefaultSoundPackId(): string | undefined {
  return getSoundPackPrefs().defaultPackId
}

/** Set (or clear, with null) the default pack — "make this pack my default". */
export function setDefaultSoundPack(packId: string | null): SoundPackPrefs {
  return put(withDefaultPack(getSoundPackPrefs(), packId))
}

/**
 * Remember that a SHIPPED pack was deleted, so startup provisioning stops putting it back.
 *
 * Only shipped ids are recorded: provisioning is the only reader, it only ever considers shipped
 * ids, and a row per registry pack somebody tried and discarded would be a growing list nothing
 * ever asks about. Called from the uninstall handler on SUCCESS only — a failed removal is not a
 * statement about anything.
 */
export function recordPackRemoved(packId: string): SoundPackPrefs {
  if (!DEFAULT_PACK_IDS.includes(packId)) return getSoundPackPrefs()
  return put(withTombstone(getSoundPackPrefs(), packId, true))
}

/**
 * Forget that deletion — what installing the pack again from the registry browser means.
 *
 * Unconditional (no shipped-id gate): clearing a stone that was never set is a no-op, and gating
 * it would be one more place that has to agree about which ids are shipped.
 */
export function clearPackRemoved(packId: string): SoundPackPrefs {
  return put(withTombstone(getSoundPackPrefs(), packId, false))
}

/** The shipped ids this user has deleted — what provisioning must skip. */
export function removedPackIds(): Set<string> {
  return new Set(getSoundPackPrefs().removedPackIds ?? [])
}

// THE SEEDS READ THIS PREFERENCE TOO, AND THEY READ IT IN store.ts (`seedAlerts`), not here.
// This module imports `settingsStore` FROM store.ts, so an import in the other direction would
// make the settings store a cycle — the same hazard STORE_READY_MS documents about the perf
// module. The pure rule lives in shared/soundPacks.ts (`seedSoundRef`), which is what both ends
// call, so there is one definition of it and no cycle.
