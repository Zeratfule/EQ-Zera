// storeShareLinks.ts — the PUBLISHED SHARE LINKS, main-process side (docs/plans/share-links.md).
//
// The settings-accessor half of the feature: read through `sanitizeShareLink`, written through the
// SAME sanitizer, over the one open store. It lives here rather than beside the other accessors
// because `src/main/store.ts` is AT the repo's 400-code-line factoring ceiling and the house
// answer to that is a split, not a widened threshold (uiScale.ts, storeRespawn.ts and
// storeAchievements.ts all came through this door). What stayed behind is the only thing that
// could not move: `shareLinks`' place in `StoreShape`.
//
// NO SCHEMA BUMP. The key is additive and optional, and an absent one reads as the shipped
// behaviour: this install has published nothing. That is the `respawn` / `buffAllow` carve-out
// stated on the field itself - a store written by an older build loads here unchanged, and one
// written here still opens in a build that predates the feature, because electron-store rewrites
// the whole parsed object and every reader defaults on a missing key.
//
// THE DELETE TOKEN IS THE REASON THIS FILE HAS A `View` FUNCTION AT ALL. It is the only thing that
// can stop a link serving (ruling 4), so it is stored, and it is stripped at the one place a list
// is handed to anybody: `listShareLinkViews`. Nothing else in main should read `.deleteToken`
// except the revoke path, which is why `findShareLink` is separate from the list.

import { settingsStore } from './store'
import {
  sanitizeShareLink,
  shareLinkKey,
  shareLinkView,
  type ShareLinkOwner,
  type ShareLinkRecord,
  type ShareLinkView
} from '../shared/shareLinks'

/** Every stored record, re-validated on the way out. A record that does not survive is dropped. */
export function getShareLinks(): ShareLinkRecord[] {
  const raw = settingsStore.get('shareLinks')
  if (!Array.isArray(raw)) return []
  const out: ShareLinkRecord[] = []
  for (const entry of raw) {
    const rec = sanitizeShareLink(entry)
    if (rec) out.push(rec)
  }
  return out
}

/** The list a renderer may hold: the same records with the delete token removed. */
export function listShareLinkViews(owner?: ShareLinkOwner): ShareLinkView[] {
  const all = getShareLinks()
  if (!owner) return all.map(shareLinkView)
  const key = shareLinkKey(owner)
  const out: ShareLinkView[] = []
  for (const rec of all) {
    if (shareLinkKey(rec) === key) out.push(shareLinkView(rec))
  }
  return out
}

/** The record for one character, or undefined - what decides a publish between PUT and POST. */
export function findShareLink(owner: ShareLinkOwner): ShareLinkRecord | undefined {
  const key = shareLinkKey(owner)
  for (const rec of getShareLinks()) {
    if (shareLinkKey(rec) === key) return rec
  }
  return undefined
}

/** The record with `id`, or undefined - what the revoke path needs the token out of. */
export function findShareLinkById(id: string): ShareLinkRecord | undefined {
  for (const rec of getShareLinks()) {
    if (rec.id === id) return rec
  }
  return undefined
}

/**
 * Store one record, REPLACING any existing statement about the same character or the same id.
 * Both, because a re-share can move a character onto a fresh id (the service refused the old
 * token, links.ts `updateShare`) and leaving the stale row behind would show the user a link that
 * no longer serves their card.
 */
export function saveShareLink(rec: ShareLinkRecord): ShareLinkRecord[] {
  const clean = sanitizeShareLink(rec)
  if (!clean) return getShareLinks()
  const key = shareLinkKey(clean)
  const next: ShareLinkRecord[] = []
  for (const old of getShareLinks()) {
    if (old.id !== clean.id && shareLinkKey(old) !== key) next.push(old)
  }
  next.push(clean)
  settingsStore.set('shareLinks', next)
  return next
}

/** Forget one record. Called after a revoke succeeded, never instead of one. */
export function deleteShareLink(id: string): ShareLinkRecord[] {
  const next: ShareLinkRecord[] = []
  for (const rec of getShareLinks()) {
    if (rec.id !== id) next.push(rec)
  }
  settingsStore.set('shareLinks', next)
  return next
}
