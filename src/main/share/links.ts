// share/links.ts — publish a character profile as a link, revoke it, and read one back.
//
// THE APP NEVER TRUSTS THE SERVICE, AND THE SERVICE NEVER TRUSTS THE APP (docs/plans/share-links.md).
// This file is the app's half of that sentence, and it is the whole reason the read path exists
// here rather than as a `fetch` beside the paste box:
//
//   * ON THE WAY OUT the profile is re-sanitized before it is wrapped, exactly as
//     `encodeCharacterShare` does. The renderer built it, and a renderer value is untrusted at the
//     handler whether or not today's only caller is this app's own UI.
//   * ON THE WAY IN a fetched envelope goes through `validateEnvelope` + `sanitizeCharacterShare`
//     through the SAME function a pasted string uses (`readCharacterEnvelope`). A profile served
//     by a host is exactly as untrusted as one pasted out of a chat window — more so, because
//     nobody looked at it first.
//   * THE ID AND THE URL ARE OURS, NOT THE REPLY'S. The service answers a `url`, and this file
//     ignores it: the id is re-checked against a closed character class and the link is rebuilt
//     with `shareUrlFor`. A reply that could name the link would be a reply that could name a
//     different host, and that string ends up on a user's clipboard.
//
// NOTHING HERE THROWS. Every failure is a short plain sentence in `{ ok: false, error }` — an IPC
// handler that rejects gives the renderer an Error with a stack in it, and there is nothing a
// reader can do with "TypeError: fetch failed".
//
// `fetch` IS INJECTED so this module is drivable under plain node with no network at all
// (tests/shareLinks.test.mts); the IPC layer passes the global.

import { makeEnvelope, validateEnvelope, type ShareValidation } from '../../shared/profiles'
import { sanitizeCharacterShare } from '../../shared/characterShare'
import type { CardMapEntry } from '../../shared/shareCardMap'
import { readCharacterEnvelope, type CharacterShareRead } from '../characterShare'
import {
  createUrl,
  isDeleteToken,
  isShareId,
  parseShareLink,
  profileUrlFor,
  recordUrl,
  shareEndpointConfigured,
  shareRequest,
  shareUrlFor,
  type ShareFetch
} from './net'

export { parseShareLink }

/** The record this app already holds for a character, when it is re-sharing rather than sharing. */
export interface ShareTarget {
  id: string
  deleteToken: string
}

/** Everything a publish needs. One object because four loose arguments is three too many. */
export interface PublishRequest {
  /** the renderer's profile, re-sanitized here before it is wrapped */
  profile: unknown
  /** the card's image bytes (JPEG since 1.22.1; the service accepts PNG, JPEG or WebP), or null when the capture produced nothing worth sending */
  card: Buffer | null
  /** `app.getVersion()`, passed in so this module stays Electron-free and node-testable */
  appVersion: string
  /** the existing record for this character, when there is one */
  existing?: ShareTarget | undefined
  /**
   * where each drawn gear cell sits on THAT card, in fractions of it (shared/shareCardMap.ts), so
   * the page can hover an armour piece and name it. Already sanitized by the caller against the
   * profile's own slots (`src/main/ipc/characterShare.ts`); it travels only with a card, because
   * fractions of a picture that was not sent describe nothing.
   */
  cardMap?: CardMapEntry[] | undefined
}

/**
 * What a publish answers. `deleteToken` is present only when a record was CREATED, and it is the
 * one value in this feature that must never reach the renderer — the caller stores it and drops
 * it (`src/main/ipc/characterShare.ts`).
 */
export type PublishResult =
  | { ok: true; id: string; url: string; updated: boolean; deleteToken?: string }
  | { ok: false; error: string }

/** What a revoke answers. There is nothing to say on success. */
export type RevokeResult = { ok: true } | { ok: false; error: string }

// ---------------------------------------------------------------------------------- the sentences
//
// SHORT, PLAIN, AND ABOUT THE READER'S SITUATION (AGENTS.md UI conventions: state, never process).
// None of them names a status code, a host or a verb — those are facts about our plumbing, and a
// player holding a share card cannot act on any of them.

const ERR = {
  dark: 'This build has no share service.',
  empty: 'There is nothing in that profile to share.',
  offline: 'The share service could not be reached.',
  busy: 'Too many shares just now - try again in a minute.',
  tooBig: 'That profile is too large to share.',
  refused: 'The share service would not store that profile.',
  badReply: 'The share service answered something this app could not read.',
  gone: 'That link has expired or was revoked.',
  notALink: 'That is not a share.eqzera.com link.',
  revoke: 'That link could not be revoked.'
} as const

/** A failed HTTP attempt → the one sentence that describes it. */
function sentenceFor(status: number, fallback: string): string {
  if (status === 0) return ERR.offline
  if (status === 429) return ERR.busy
  if (status === 413) return ERR.tooBig
  return fallback
}

// ------------------------------------------------------------------------------------- publishing

/** What a create or an update sends. `card` is omitted when there was nothing to photograph. */
interface PublishBody {
  envelope: unknown
  card?: string
  cardMap?: CardMapEntry[]
}

/**
 * The wire body: the envelope, the card as a base64 image when there is one to send, and - only
 * beside that card - where its gear cells were.
 *
 * THE MAP RIDES THE PICTURE OR IT DOES NOT GO. Every number in it is a fraction of the card that
 * was captured, so a map sent without one would be measured against an image the page has to draw
 * from the body instead, at a size nobody here knows. An empty map is simply not a field.
 */
function publishBody(req: PublishRequest): PublishBody | null {
  const body = sanitizeCharacterShare(req.profile)
  if (!body) return null
  const envelope = makeEnvelope('character', body, req.appVersion)
  if (req.card === null) return { envelope }
  const card = req.card.toString('base64')
  const cardMap = req.cardMap ?? []
  return cardMap.length === 0 ? { envelope, card } : { envelope, card, cardMap }
}

/** The `{ id, deleteToken }` a create replies with, or null when the reply was not one. */
function createdRecord(body: unknown): { id: string; deleteToken: string } | null {
  if (!body || typeof body !== 'object') return null
  const r = body as Record<string, unknown>
  if (!isShareId(r.id) || !isDeleteToken(r.deleteToken)) return null
  return { id: r.id, deleteToken: r.deleteToken }
}

/**
 * Replace the record this app already holds for a character.
 *
 * A 401 means the token is no longer the record's (revoked from another install, or the record
 * was recreated), and a 404 means the record is gone (the 180-day expiry, ruling 2). Both answer
 * `null`, which the caller reads as "create a fresh one" — the alternative is a Copy link button
 * that can never work again for a character somebody re-shared six months later.
 */
async function updateShare(
  deps: ShareFetch,
  target: ShareTarget,
  body: unknown
): Promise<PublishResult | null> {
  const res = await shareRequest(deps, 'PUT', recordUrl(target.id), { body, token: target.deleteToken })
  if (res.status === 200) {
    return { ok: true, id: target.id, url: shareUrlFor(target.id), updated: true }
  }
  if (res.status === 401 || res.status === 404) return null
  return { ok: false, error: sentenceFor(res.status, ERR.refused) }
}

/** Create a new record. The only path that ever learns a delete token. */
async function createShare(deps: ShareFetch, body: unknown): Promise<PublishResult> {
  const res = await shareRequest(deps, 'POST', createUrl(), { body })
  if (res.status !== 201 && res.status !== 200) {
    return { ok: false, error: sentenceFor(res.status, ERR.refused) }
  }
  const made = createdRecord(res.body)
  if (!made) return { ok: false, error: ERR.badReply }
  return { ok: true, id: made.id, url: shareUrlFor(made.id), updated: false, deleteToken: made.deleteToken }
}

/**
 * Publish a profile: PUT over the character's existing record when there is one, POST a new one
 * otherwise, and POST after a PUT the service refused as unauthorized or unknown.
 */
export async function publishShare(req: PublishRequest, deps: ShareFetch): Promise<PublishResult> {
  if (!shareEndpointConfigured()) return { ok: false, error: ERR.dark }
  const body = publishBody(req)
  if (body === null) return { ok: false, error: ERR.empty }
  const existing = req.existing
  if (existing && isShareId(existing.id) && isDeleteToken(existing.deleteToken)) {
    const replaced = await updateShare(deps, existing, body)
    if (replaced !== null) return replaced
  }
  return createShare(deps, body)
}

// -------------------------------------------------------------------------------------- revoking

/**
 * Stop a link serving (ruling 4). A 404 is SUCCESS: the record is already gone, which is exactly
 * what was asked for, and refusing would leave the user staring at a link that answers nothing.
 * A 401 is not — the record still serves and the token we hold is not its.
 */
export async function revokeShare(
  id: string,
  deleteToken: string,
  deps: ShareFetch
): Promise<RevokeResult> {
  if (!shareEndpointConfigured()) return { ok: false, error: ERR.dark }
  if (!isShareId(id) || !isDeleteToken(deleteToken)) return { ok: false, error: ERR.revoke }
  const res = await shareRequest(deps, 'DELETE', recordUrl(id), { token: deleteToken })
  if (res.status === 204 || res.status === 200 || res.status === 404) return { ok: true }
  return { ok: false, error: sentenceFor(res.status, ERR.revoke) }
}

// --------------------------------------------------------------------------------------- reading

/** The `{ envelope }` a read replies with, put through the pasted string's own validator. */
function validateReply(body: unknown): ShareValidation {
  if (!body || typeof body !== 'object') return { ok: false, error: 'corrupt' }
  return validateEnvelope((body as Record<string, unknown>).envelope)
}

/**
 * Read a share link back into a profile. Accepts a LINK and nothing else — a bare id is not a
 * link (see `parseShareLink`), so a pasted word never becomes a request.
 *
 * The reply is validated exactly as a pasted string is, which is what makes a served profile no
 * more trusted than a chat-pasted one.
 */
export async function fetchSharedProfile(text: string, deps: ShareFetch): Promise<CharacterShareRead> {
  if (!shareEndpointConfigured()) return { ok: false, error: ERR.dark }
  const id = parseShareLink(text)
  if (id === null) return { ok: false, error: ERR.notALink }
  const res = await shareRequest(deps, 'GET', profileUrlFor(id))
  if (res.status === 404 || res.status === 410) return { ok: false, error: ERR.gone }
  if (res.status !== 200) return { ok: false, error: sentenceFor(res.status, ERR.offline) }
  return readCharacterEnvelope(validateReply(res.body))
}
