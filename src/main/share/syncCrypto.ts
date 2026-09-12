// share/syncCrypto.ts — THE KEY NEVER LEAVES THE TWO MACHINES, and this file is the whole reason
// that sentence is true (docs/plans/settings-sync.md).
//
// The service stores a blob it cannot read. What makes that more than a claim:
//
//  1. THE KEY IS MINTED HERE AND TRAVELS IN THE CODE, NOT IN THE REQUEST. `sendSettings` uploads
//     the ciphertext alone; the key is base64url'd onto the end of the service's own code, and the
//     resulting TRANSFER CODE is shown to the user. Nothing carrying the key is ever sent.
//  2. THE SHOWN KEY IS SHORT AND THE CIPHER KEY IS NOT. 12 random bytes is 16 characters a person
//     can retype without hating this app; the AES key is `SHA-256(keyBytes)`, so the cipher is
//     256-bit regardless of how short the thing on screen looks. (96 bits of entropy against a
//     one-shot 24-hour record whose id must also be guessed is the trade, stated so it can be
//     re-judged rather than rediscovered.)
//  3. AES-256-GCM WITH AN AAD, SO A TAMPERED BLOB FAILS CLEANLY. `decryptSyncBlob` answers null -
//     it never throws and never returns half a payload - and the AAD (`eqzera-sync-v1`) means a
//     blob minted for some other purpose cannot be replayed into this one even with the right key.
//  4. AND THE PLAINTEXT IS STILL PARSED, NOT READ. GCM proves the bytes came from somebody holding
//     the key; it proves nothing about their SHAPE, and this payload can carry Discord webhook
//     tokens. So every field goes through the same closed classes a stored record does
//     (`sanitizeChannel`), and anything else is dropped.
//
// Node-testable with no Electron and no network (tests/syncCrypto.test.mts): everything here is
// `node:crypto` over strings.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { sanitizeChannel, MAX_CHANNELS, type DiscordChannel } from '../../shared/discordChannels'
import { MAX_SYNC_BLOB_BYTES, SYNC_PAYLOAD_VERSION } from '../../shared/settingsSync'

/** How many random bytes the shown key is. 12 -> exactly 16 base64url characters, no padding. */
export const SYNC_KEY_BYTES = 12

/** AES-GCM's nonce, its own 12 random bytes. Never derived from the key, never reused. */
const IV_BYTES = 12

/** GCM's authentication tag, which is what makes a flipped byte a REFUSAL rather than garbage. */
const TAG_BYTES = 16

/** Bound to this feature and this generation, so a blob from elsewhere cannot be replayed in. */
const AAD = Buffer.from('eqzera-sync-v1', 'utf8')

const ALGO = 'aes-256-gcm'

/**
 * A service code, as this app is willing to spell one: the service mints ten characters out of
 * `[A-Za-z0-9]`. Generous rather than exact so a future length is not a silent refusal, and CLOSED
 * because the value is concatenated into a request path - the argument `share/net.ts SHARE_ID`
 * makes, for the same reason.
 */
const SERVICE_CODE = /^[A-Za-z0-9]{6,32}$/

/** …and the key half: base64url, bounded so a decode cannot be handed a megabyte of text. */
const KEY_CHARS = /^[A-Za-z0-9_-]{12,64}$/

/** The settings bundle is one `EQC1-` line; the cap is the codec's own, not a new opinion. */
const MAX_SETTINGS_CHARS = 200_000

/**
 * THE PLAINTEXT. `settings` is the `EQC1-` string `exportSettingsString` produces, which already
 * carries the whitelist argument (src/shared/profiles.ts) - this feature adds no new exportable
 * state. `discordChannels` is present ONLY when the user ticked the box, because a webhook id and
 * token are credentials and the intended destination is their own second machine.
 */
export interface SyncPayload {
  v: number
  settings: string
  discordChannels?: DiscordChannel[]
}

/** A transfer code, taken apart: the service's record id, and the key that opens it. */
export interface TransferCode {
  code: string
  key: Buffer
}

// ------------------------------------------------------------------------------ the code format

/** Is this a service code this app will put in a URL? See `SERVICE_CODE`. */
export function isServiceCode(raw: unknown): raw is string {
  return typeof raw === 'string' && SERVICE_CODE.test(raw)
}

/**
 * THE CODE THE USER CARRIES: `<service code>-<base64url(key)>`, e.g. `Ab3dE9fGh1-K7xYpQr2sTu9v`.
 *
 * One separator, and it is the FIRST hyphen: a service code cannot contain one (closed class
 * above) while base64url can, so "split at the first hyphen" is unambiguous in a way "the last"
 * would not be.
 */
export function formatTransferCode(code: string, key: Buffer): string {
  return `${code}-${key.toString('base64url')}`
}

/**
 * A typed or pasted code -> its two halves, or null.
 *
 * LENIENT ABOUT TYPING, STRICT ABOUT CASE. Surrounding whitespace, spaces someone typed inside it,
 * a wrapped line and the quotes or backticks a chat client adds are all stripped (`decodeShareString`
 * strips the same set, for the same reason). What is NOT normalized is CASE: both halves are
 * case-sensitive - the service's id and base64url both are - so folding it would turn a correct
 * code into a refusal for the user who typed it exactly right.
 */
export function parseTransferCode(raw: unknown): TransferCode | null {
  if (typeof raw !== 'string' || raw.length > 512) return null
  const cleaned = raw.replace(/[\s`"'<>]/g, '')
  const at = cleaned.indexOf('-')
  if (at < 0) return null
  const code = cleaned.slice(0, at)
  const keyText = cleaned.slice(at + 1)
  if (!isServiceCode(code) || !KEY_CHARS.test(keyText)) return null
  const key = Buffer.from(keyText, 'base64url')
  // A base64url decode is lenient about length; a key of a few bytes is not one this app minted.
  return key.length < 8 ? null : { code, key }
}

// ----------------------------------------------------------------------------------- the cipher

/** Fresh key material for one transfer. Its own function so the one caller reads as intent. */
export function mintSyncKey(): Buffer {
  return randomBytes(SYNC_KEY_BYTES)
}

/** The 256-bit cipher key behind the short shown one. See header item 2. */
function cipherKey(key: Buffer): Buffer {
  return createHash('sha256').update(key).digest()
}

/**
 * Encrypt a payload. The blob is `base64(iv || tag || ciphertext)` - the tag sits with the nonce at
 * a FIXED OFFSET rather than at the end, so a truncated blob fails the length check instead of
 * silently authenticating a prefix.
 */
export function encryptSyncPayload(payload: SyncPayload, key: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, cipherKey(key), iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(AAD)
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

/**
 * Decrypt one. NULL for every failure - a wrong key, a flipped byte, a truncated blob, a blob that
 * is not base64 at all, and a plaintext that is not this envelope. The caller turns that into one
 * sentence ("That code does not match this transfer."), which is the honest thing to say about all
 * of them: from out here they are the same event.
 */
export function decryptSyncBlob(blob: unknown, key: Buffer): SyncPayload | null {
  if (typeof blob !== 'string' || blob.length === 0) return null
  // A base64 decode is lenient, so the SIZE check is on the bytes rather than the characters.
  const raw = Buffer.from(blob, 'base64')
  if (raw.length <= IV_BYTES + TAG_BYTES || raw.length > MAX_SYNC_BLOB_BYTES) return null
  try {
    const decipher = createDecipheriv(ALGO, cipherKey(key), raw.subarray(0, IV_BYTES), {
      authTagLength: TAG_BYTES
    })
    decipher.setAAD(AAD)
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    const json = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final()
    ]).toString('utf8')
    return sanitizeSyncPayload(JSON.parse(json))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------- the payload

/** The channels a payload carries, re-validated and de-duplicated exactly as the store's are. */
function payloadChannels(raw: unknown, now: number): DiscordChannel[] {
  if (!Array.isArray(raw)) return []
  const out: DiscordChannel[] = []
  for (const item of raw) {
    if (out.length >= MAX_CHANNELS) break
    const channel = sanitizeChannel(item, now)
    if (channel !== null && !out.some((c) => c.id === channel.id)) out.push(channel)
  }
  return out
}

/**
 * A decrypted object -> the payload it names, or null. See header item 4: authenticity is not
 * shape, and this one can carry credentials.
 *
 * A payload of a version this build does not know is REFUSED rather than read for the fields it
 * recognizes: the settings string has its own forward-compatible envelope already, so a bump here
 * would mean the wrapper itself changed shape.
 */
export function sanitizeSyncPayload(raw: unknown, now = Date.now()): SyncPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (r.v !== SYNC_PAYLOAD_VERSION) return null
  if (typeof r.settings !== 'string' || r.settings === '' || r.settings.length > MAX_SETTINGS_CHARS) {
    return null
  }
  const channels = payloadChannels(r.discordChannels, now)
  return {
    v: SYNC_PAYLOAD_VERSION,
    settings: r.settings,
    ...(channels.length === 0 ? {} : { discordChannels: channels })
  }
}
