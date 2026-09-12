// storeCelebrationPost.ts — the persisted half of "post celebrations to Discord".
//
// ANOTHER MODULE THROUGH THE `settingsStore` DOOR (uiScale.ts was the first, then storeRespawn.ts,
// storeSoundPacks.ts, storeOverlaySnap.ts, storeCloseToTray.ts, storeDiscord.ts): `src/main/store.ts`
// sits at the repo's 400-code-line factoring ceiling and the house answer to that is a split rather
// than a widened threshold. It owes the same discipline every accessor in store.ts follows and pays
// it — read through the normalizer, write back through the SAME normalizer.
//
// ADDITIVE + OPTIONAL ⇒ NO SCHEMA BUMP, NO MIGRATION — the `shareLinks` / `discordChannels` /
// `closeToTray` carve-out storeShape.ts documents on the fields themselves. An absent key reads as
// the shipped behaviour (OFF, posting nowhere), which is exactly the state every store written
// before this key existed was in; a store written here still opens in a build that predates the
// feature, where the extra key is carried through untouched. Nothing downstream ever needs to tell
// "the user chose the default" from "the user inherited it" — the `processPriority` distinction that
// forced a migration for that key does not exist here.
//
// THE MEANING lives in shared/celebrationPost.ts beside the pure functions, with the kinds, the
// embed and the queue. This file is storage and nothing else.
//
// NO SECRET IS IN THIS KEY. `channelId` is a WEBHOOK ID — the same value the renderer already holds
// and draws in a dropdown (src/main/storeDiscord.ts `discordChannelsView`); the token it resolves to
// stays in `discordChannels` and never comes near this record.

import { settingsStore } from './store'
import {
  mergeCelebrationPostPrefs,
  sanitizeCelebrationPostPrefs,
  type CelebrationPostPrefs
} from '../shared/celebrationPost'

/** The one key. */
const KEY = 'celebrationPost'

/** The stored blob, defaulted and re-validated. Never throws, never returns a partial. */
export function getCelebrationPost(): CelebrationPostPrefs {
  return sanitizeCelebrationPostPrefs(settingsStore.get(KEY))
}

/**
 * Merge-patch the blob; returns what was ACTUALLY stored, so the Preferences card renders main's
 * answer rather than assuming its request landed.
 *
 * The patch is `unknown` because it arrives over IPC (the `graphicsPrefs:set` rule): the per-field
 * decision about what a value may be is made once, in `shared/celebrationPost.ts`, by the same
 * normalizer the read above uses — so a renderer, a hand-edited file and a future migration cannot
 * end up with three ideas of what a valid preference is.
 */
export function setCelebrationPost(patch: unknown): CelebrationPostPrefs {
  const next = mergeCelebrationPostPrefs(patch, getCelebrationPost())
  settingsStore.set(KEY, next)
  return next
}
