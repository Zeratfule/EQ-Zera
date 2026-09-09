// store.ts — what this service will accept, and how it keeps it.
//
// ---------------------------------------------------------------------------
// THE SERVICE NEVER TRUSTS THE APP
// ---------------------------------------------------------------------------
// docs/plans/share-links.md states the symmetry: the app runs `validateEnvelope` +
// `sanitizeCharacterShare` on everything it fetches, and the service runs the SAME TWO FUNCTIONS
// on everything it is handed, storing only what survives. `acceptEnvelope` is that gate, and it
// imports the app's own modules rather than re-describing them — one schema, two runtimes.
//
// AND IT STORES THE SANITIZED BODY, NOT THE POSTED ONE. A body that reaches KV is echoed back to
// every reader and rendered into a page, so an extra key a stranger smuggled past `validateEnvelope`
// (which checks the envelope's shape, not the body's) must not be what we keep. Because the
// sanitized body is a different object, its `sum` is RECOMPUTED — otherwise the envelope we serve
// would fail its own checksum in `decodeShareString`. For a body the app actually built this is a
// no-op: `sanitizeCharacterShare(buildCharacterShare(x))` is `buildCharacterShare(x)`, so a
// legitimate share round-trips with a byte-identical `sum`, which the test suite pins.
//
// ---------------------------------------------------------------------------
// THE CLOCK (owner ruling 2)
// ---------------------------------------------------------------------------
// Every write of both keys carries `expirationTtl = 180 days`. An UPDATE always rewrites, so it
// always refreshes. A VIEW rewrites only when `lastSeenAt` is more than 30 days old — reads are
// the common case and a KV write per view would be both slower and, on the free tier, the thing
// that runs out. The cost of the window is bounded and stated: a share is guaranteed at least 180
// days from its last write and at most 210 from its last read.

import {
  canonicalJson,
  checksum,
  SHARE_LIMITS,
  SHARE_PREFIX,
  validateEnvelope,
  type ShareEnvelope
} from '../../src/shared/shareSchema'
import {
  sanitizeCharacterShare,
  type CharacterProfileShare
} from '../../src/shared/characterShare'
import { deflateRawBase64Url } from './codec'
import {
  KEY_CARD,
  KEY_SHARE,
  SHARE_TTL_SECONDS,
  VIEW_REFRESH_MS,
  type CardHotspot,
  type Env,
  type ShareRecord
} from './env'

/** A refusal `acceptEnvelope` can hand back, in the shape `errorResponse` takes. */
export interface Refusal {
  ok: false
  status: number
  error: string
  message: string
}

export type Accepted =
  | { ok: true; envelope: ShareEnvelope; profile: CharacterProfileShare }
  | Refusal

/** Message per `ShareDecodeError`, said the way a SERVICE says it (the app has its own wording). */
const DECODE_MESSAGE: Record<string, string> = {
  corrupt: 'The envelope is not a well-formed EQC1 envelope.',
  checksum: 'The envelope body does not match its checksum.',
  'newer-version': 'The envelope was written by a newer schema than this service understands.',
  'unknown-kind': 'That envelope kind is not something this service stores.'
}

/**
 * An arbitrary object -> the envelope this service is willing to keep, or a refusal.
 *
 * The size check comes FIRST and is measured in UTF-8 bytes of the re-serialized envelope, not in
 * characters: a 64 KB cap that a body of astral-plane characters can walk through twice over is
 * not a cap. `SHARE_LIMITS.maxStringChars` is the app's own 64 KB ceiling for a share string, so
 * both ends refuse at the same number rather than at two numbers that drift.
 */
export function acceptEnvelope(raw: unknown): Accepted {
  const bytes = new TextEncoder().encode(JSON.stringify(raw ?? null)).length
  if (bytes > SHARE_LIMITS.maxStringChars) {
    return { ok: false, status: 413, error: 'too-large', message: 'The envelope is over 64 KB.' }
  }
  const validation = validateEnvelope(raw)
  if (!validation.ok) {
    const message = DECODE_MESSAGE[validation.error] ?? 'The envelope could not be read.'
    return { ok: false, status: 400, error: validation.error, message }
  }
  const envelope = validation.envelope
  if (envelope.kind !== 'character') {
    return {
      ok: false,
      status: 400,
      error: 'unsupported-kind',
      message: `This service stores character profiles only, not "${envelope.kind}".`
    }
  }
  const profile = sanitizeCharacterShare(envelope.body)
  if (!profile) {
    return {
      ok: false,
      status: 400,
      error: 'unreadable-profile',
      message: 'The body carries no worn gear this service can read.'
    }
  }
  return { ok: true, envelope: reseal(envelope, profile), profile }
}

/** The envelope as we keep it: the sender's provenance, OUR body, and a checksum over that body. */
function reseal(envelope: ShareEnvelope, profile: CharacterProfileShare): ShareEnvelope {
  return {
    v: envelope.v,
    kind: envelope.kind,
    app: envelope.app,
    at: envelope.at,
    sum: checksum(canonicalJson(profile)),
    body: profile
  }
}

/** The `EQC1-` string the page offers — the app's format, built on the web compression API. */
export async function shareStringFor(envelope: ShareEnvelope): Promise<string> {
  return SHARE_PREFIX + (await deflateRawBase64Url(canonicalJson(envelope)))
}

/** At most this many hotspots: the card draws at most this many cells (SHARE_LIMITS.maxCharacterCells). */
export const MAX_HOTSPOTS = 40

function fraction(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null
}

/**
 * Untrusted → hotspots: each rebuilt field by field, a slot that is not a string (or not in
 * `slots`, when the caller knows them) or a number outside 0..1 drops the entry, `w`/`h` must be
 * positive, and the list is capped. Rounded to four places: a fraction of a card needs no more,
 * and the record is a JSON row somebody pays for.
 */
export function sanitizeCardMap(raw: unknown, slots?: ReadonlySet<string>): CardHotspot[] {
  if (!Array.isArray(raw)) return []
  const out: CardHotspot[] = []
  for (const one of raw) {
    if (out.length >= MAX_HOTSPOTS) break
    const spot = hotspotOf(one, slots)
    if (spot) out.push(spot)
  }
  return out
}

/** One untrusted entry, rebuilt, or null when any part of it is not a hotspot. */
function hotspotOf(one: unknown, slots?: ReadonlySet<string>): CardHotspot | null {
  if (!one || typeof one !== 'object') return null
  const r = one as Record<string, unknown>
  const slot = typeof r.slot === 'string' ? r.slot.trim().slice(0, 40) : ''
  if (!slot || (slots && !slots.has(slot))) return null
  const parts = [fraction(r.x), fraction(r.y), fraction(r.w), fraction(r.h)]
  if (parts.some((n) => n === null)) return null
  const [x, y, w, h] = parts as [number, number, number, number]
  if (w === 0 || h === 0) return null
  const round = (n: number): number => Math.round(n * 10_000) / 10_000
  return { slot, x: round(x), y: round(y), w: round(w), h: round(h) }
}

/** A stored record, or null. Defensive about its own namespace: KV is a place, not a type. */
export async function readRecord(env: Env, id: string): Promise<ShareRecord | null> {
  const raw = await env.SHARES.get(KEY_SHARE(id), 'json')
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<ShareRecord>
  if (typeof r.tokenHash !== 'string' || r.envelope == null) return null
  const record: ShareRecord = {
    envelope: r.envelope,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
    lastSeenAt: typeof r.lastSeenAt === 'number' ? r.lastSeenAt : 0,
    tokenHash: r.tokenHash,
    hasCard: r.hasCard === true
  }
  const cardMap = sanitizeCardMap(r.cardMap)
  if (cardMap.length) record.cardMap = cardMap
  return record
}

export async function writeRecord(env: Env, id: string, record: ShareRecord): Promise<void> {
  await env.SHARES.put(KEY_SHARE(id), JSON.stringify(record), {
    expirationTtl: SHARE_TTL_SECONDS
  })
}

export async function writeCard(
  env: Env,
  id: string,
  png: ArrayBuffer | ArrayBufferView
): Promise<void> {
  await env.SHARES.put(KEY_CARD(id), png, { expirationTtl: SHARE_TTL_SECONDS })
}

/**
 * A view's effect on the clock. Rewrites BOTH keys — the record and, when there is one, the card —
 * so a share and its image never expire at different moments; returns the record as it now stands
 * so the caller reports the expiry it actually wrote.
 */
export async function touch(env: Env, id: string, record: ShareRecord, at: number): Promise<ShareRecord> {
  if (at - record.lastSeenAt <= VIEW_REFRESH_MS) return record
  const refreshed: ShareRecord = { ...record, lastSeenAt: at }
  await writeRecord(env, id, refreshed)
  if (record.hasCard) {
    const png = await env.SHARES.get(KEY_CARD(id), 'arrayBuffer')
    if (png) await writeCard(env, id, png)
  }
  return refreshed
}

/** When this share stops serving, as ISO-8601: 180 days after whatever last wrote it. */
export function expiresAt(record: ShareRecord): string {
  return new Date(record.lastSeenAt + SHARE_TTL_SECONDS * 1000).toISOString()
}

export async function deleteShare(env: Env, id: string): Promise<void> {
  await env.SHARES.delete(KEY_SHARE(id))
  await env.SHARES.delete(KEY_CARD(id))
}
