// handler.ts — the whole service, as ONE PURE FUNCTION.
//
// `handleRequest(request, env, now)` takes a `Request`, the bindings and a clock and answers a
// `Response`. It imports nothing Cloudflare-only (see env.ts for why the bindings are declared
// structurally) and it reads no ambient time, which is what lets `tests/shareServer.test.mts` drive
// every route — including the 180-day TTL and the 30-day read-refresh window — under plain
// node:test with an in-memory KV fake and an injected clock, instead of a workerd emulator that
// would make the suite slow, platform-specific and optional. `index.ts` is the three-line adapter.
//
// THE ROUTES (docs/plans/share-links.md, "Service — share-server/"):
//
//   POST   /api/v1/shares       {envelope, card?, cardMap?}  -> 201 {id, url, deleteToken, expiresAt}
//   PUT    /api/v1/shares/:id   same body + Bearer token     -> 200 {id, url, expiresAt}
//   DELETE /api/v1/shares/:id   Bearer token                 -> 204
//   GET    /p/:id               -                            -> 200 {envelope, cardMap?, createdAt, updatedAt, expiresAt}
//   GET    /c/:id.png           -                            -> the card image, PNG/JPEG/WebP (404 when absent)
//   GET    /s/:id               -                            -> the HTML page
//   GET    /                    -                            -> 302 https://eqzera.com/
//   anything else                                            -> 404 JSON
//
// NO CORS HEADERS ON /api, deliberately: the app calls these from its MAIN process, never from a
// renderer, so a browser has no business reaching them and the absent header is what says so.
// A wrong METHOD on a real path answers 404 rather than 405 — the spec's error table has no 405,
// and "there is nothing here" is the truthful answer to `GET /api/v1/shares/x` anyway.

import { fromBase64, newDeleteToken, newId, newNonce, sha256Hex, digestsMatch } from './codec'
import {
  ID_LENGTH,
  KEY_CARD,
  MAX_CARD_BYTES,
  type CardHotspot,
  type Env,
  type ShareRecord
} from './env'
import {
  bearerToken,
  clientIp,
  errorResponse,
  htmlResponse,
  jsonResponse,
  logoResponse,
  noContentResponse,
  imageResponse,
  rateLimited,
  redirectResponse
} from './http'
import { logoPng } from './logo'
import { renderPage } from './page'
import {
  acceptEnvelope,
  deleteShare,
  expiresAt,
  readRecord,
  sanitizeCardMap,
  shareStringFor,
  touch,
  writeCard,
  writeRecord,
  type Accepted,
  type Refusal
} from './store'
import { SHARE_LIMITS, type ShareEnvelope } from '../../src/shared/shareSchema'
import type { CharacterProfileShare } from '../../src/shared/characterShare'

/** Where an unknown path (and `/`) sends a browser. */
const HOME = 'https://eqzera.com/'

/** Ids are ours, so the shape is known; the bound exists because an id becomes a KV key. */
const ID_PATTERN = '[A-Za-z0-9]{1,32}'
const API_PREFIX = '/api/v1/shares'

const PROFILE_ROUTE = new RegExp(`^/p/(${ID_PATTERN})$`)
const CARD_ROUTE = new RegExp(`^/c/(${ID_PATTERN})\\.png$`)
const PAGE_ROUTE = new RegExp(`^/s/(${ID_PATTERN})$`)
const ID_ONLY = new RegExp(`^${ID_PATTERN}$`)

/** base64 of MAX_CARD_BYTES, plus room for padding and a stray newline. */
const MAX_CARD_B64 = Math.ceil(MAX_CARD_BYTES / 3) * 4 + 8
/** The whole POST/PUT body: the 64 KB envelope, the encoded card, and slack for the JSON around them. */
const MAX_BODY_BYTES = SHARE_LIMITS.maxStringChars + MAX_CARD_B64 + 2048

/** One request's world. An object rather than four positional arguments, per the repo's ceiling. */
interface Ctx {
  request: Request
  env: Env
  now: () => number
  /** the compiled-in public origin; the request's own origin only when the var is unset */
  origin: string
}

interface WriteBody {
  ok: true
  envelope: ShareEnvelope
  profile: CharacterProfileShare
  card: Uint8Array | null
  /** the card's hotspots; empty when none were sent, when no card came with them, or none survived */
  cardMap: CardHotspot[]
}

function refuse(status: number, error: string, message: string): Refusal {
  return { ok: false, status, error, message }
}
function refusalResponse(refusal: Refusal): Response {
  return errorResponse(refusal.status, refusal.error, refusal.message)
}
function notFound(): Response {
  return errorResponse(404, 'not-found', 'No share lives at that address.')
}
function tooMany(): Response {
  return errorResponse(429, 'rate-limited', 'Too many requests. Try again in a minute.')
}

// ------------------------------------------------------------------------------- the write body

/** The card's image type, read off its first bytes, or null when it is none of the three. */
export type CardKind = 'png' | 'jpeg' | 'webp'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const RIFF = [0x52, 0x49, 0x46, 0x46] // 'RIFF'
const WEBP = [0x57, 0x45, 0x42, 0x50] // 'WEBP', at offset 8

function startsWith(bytes: Uint8Array, magic: readonly number[], at = 0): boolean {
  return bytes.length > at + magic.length && magic.every((b, i) => bytes[at + i] === b)
}

/**
 * PNG, JPEG or WebP, by signature - the three encoders a card can arrive from (the app's
 * NativeImage writes PNG and JPEG; WebP is admitted so a future encoder needs no server change).
 * Anything else is refused: the bytes come back out under an image Content-Type with `nosniff`,
 * so an unrecognised file could only ever be a failed render or a parked upload.
 */
export function cardKind(bytes: Uint8Array): CardKind | null {
  if (startsWith(bytes, PNG_MAGIC)) return 'png'
  if (startsWith(bytes, JPEG_MAGIC)) return 'jpeg'
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'webp'
  return null
}

const CARD_CONTENT_TYPE: Record<CardKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}

/**
 * The optional `card` field: a base64 PNG, JPEG or WebP, absent, or a refusal.
 *
 * The SIGNATURE is checked, not just the size (`cardKind`). JPEG and WebP were admitted on
 * 2026-09-09 so the app can send a full-resolution card that stays under the cap: a high-DPI
 * capture as PNG is several MB, as JPEG a few hundred KB, and the page draws it at 2x either way.
 */
function decodeCard(value: unknown): { ok: true; card: Uint8Array | null } | Refusal {
  if (value == null) return { ok: true, card: null }
  if (typeof value !== 'string') {
    return refuse(400, 'bad-card', 'The card must be a base64-encoded PNG, JPEG or WebP string.')
  }
  if (value.length > MAX_CARD_B64) {
    return refuse(413, 'too-large', 'The card image is larger than 1 MB.')
  }
  const bytes = fromBase64(value)
  if (!bytes) return refuse(400, 'bad-card', 'The card is not valid base64.')
  if (bytes.length > MAX_CARD_BYTES) {
    return refuse(413, 'too-large', 'The card image is larger than 1 MB.')
  }
  if (cardKind(bytes) === null) return refuse(400, 'bad-card', 'The card is not a PNG, JPEG or WebP.')
  return { ok: true, card: bytes }
}

/**
 * `{ envelope, card? }` off the wire, through both trust gates, or the refusal to send back.
 *
 * The size ceiling is measured in UTF-8 BYTES rather than characters — a character cap is not a
 * cap on a body written in astral-plane text — and it is checked before `JSON.parse`, so a
 * hostile length never becomes a hostile allocation of parsed objects.
 */
async function readWriteBody(request: Request): Promise<WriteBody | Refusal> {
  const type = (request.headers.get('Content-Type') ?? '').toLowerCase()
  if (!type.includes('application/json')) {
    return refuse(415, 'not-json', 'Send the body as application/json.')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return refuse(413, 'too-large', 'That request body is too large.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return refuse(400, 'bad-json', 'The body is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object') {
    return refuse(400, 'bad-json', 'The body must be a JSON object.')
  }
  const fields = parsed as Record<string, unknown>
  const accepted: Accepted = acceptEnvelope(fields.envelope)
  if (!accepted.ok) return accepted
  const card = decodeCard(fields.card)
  if (!card.ok) return card
  // The map only means anything next to the card it was measured on, so without a card it is
  // dropped rather than stored against whatever image the record already has.
  const slots = new Set(accepted.profile.cells.map((cell) => cell.slot))
  const cardMap = card.card ? sanitizeCardMap(fields.cardMap, slots) : []
  return { ok: true, envelope: accepted.envelope, profile: accepted.profile, card: card.card, cardMap }
}

// ------------------------------------------------------------------------------- the API routes

async function createShare(ctx: Ctx): Promise<Response> {
  if (await rateLimited(ctx.env.CREATE_LIMIT, clientIp(ctx.request))) return tooMany()
  const body = await readWriteBody(ctx.request)
  if (!body.ok) return refusalResponse(body)
  const at = ctx.now()
  const id = newId(ID_LENGTH)
  const deleteToken = newDeleteToken()
  const record: ShareRecord = {
    envelope: body.envelope,
    createdAt: at,
    updatedAt: at,
    lastSeenAt: at,
    tokenHash: await sha256Hex(deleteToken),
    hasCard: body.card !== null
  }
  if (body.cardMap.length) record.cardMap = body.cardMap
  if (body.card) await writeCard(ctx.env, id, body.card)
  await writeRecord(ctx.env, id, record)
  const reply = { id, url: `${ctx.origin}/s/${id}`, deleteToken, expiresAt: expiresAt(record) }
  return jsonResponse(reply, 201, { 'Cache-Control': 'no-store' })
}

/**
 * The delete token gate. The stored value is a SHA-256 hex digest and the comparison is
 * constant-time (codec.ts `digestsMatch`) — a `===` here would leak the length of a correct guess
 * one character at a time, which is a real attack against a 32-byte secret people paste around.
 */
async function unauthorized(request: Request, record: ShareRecord): Promise<boolean> {
  const token = bearerToken(request)
  if (!token) return true
  return !digestsMatch(await sha256Hex(token), record.tokenHash)
}

function unauthorizedResponse(): Response {
  return errorResponse(401, 'unauthorized', 'That delete token does not open this share.')
}

/**
 * Re-publish under the SAME id and URL (spec: "id and URL unchanged"), which is what makes
 * "re-share this character" update the link already pasted in a Discord channel.
 *
 * An update carrying no card KEEPS the one already stored and rewrites it, because both keys must
 * expire together: refreshing the record while letting the image age out would leave an unfurl
 * pointing at a 404 for the last thirty days of a share's life.
 */
async function updateShare(ctx: Ctx, id: string): Promise<Response> {
  if (await rateLimited(ctx.env.CREATE_LIMIT, clientIp(ctx.request))) return tooMany()
  const record = await readRecord(ctx.env, id)
  if (!record) return notFound()
  if (await unauthorized(ctx.request, record)) return unauthorizedResponse()
  const body = await readWriteBody(ctx.request)
  if (!body.ok) return refusalResponse(body)
  const at = ctx.now()
  if (body.card) {
    await writeCard(ctx.env, id, body.card)
  } else if (record.hasCard) {
    const png = await ctx.env.SHARES.get(KEY_CARD(id), 'arrayBuffer')
    if (png) await writeCard(ctx.env, id, png)
  }
  const next: ShareRecord = {
    ...record,
    envelope: body.envelope,
    updatedAt: at,
    lastSeenAt: at,
    hasCard: body.card !== null || record.hasCard
  }
  if (body.card) {
    // The old map described the old image.
    if (body.cardMap.length) next.cardMap = body.cardMap
    else delete next.cardMap
  }
  await writeRecord(ctx.env, id, next)
  return jsonResponse(
    { id, url: `${ctx.origin}/s/${id}`, expiresAt: expiresAt(next) },
    200,
    { 'Cache-Control': 'no-store' }
  )
}

/** Revoking must actually STOP it serving (ruling 4): both keys go, and every route then 404s. */
async function removeShare(ctx: Ctx, id: string): Promise<Response> {
  if (await rateLimited(ctx.env.CREATE_LIMIT, clientIp(ctx.request))) return tooMany()
  const record = await readRecord(ctx.env, id)
  if (!record) return notFound()
  if (await unauthorized(ctx.request, record)) return unauthorizedResponse()
  await deleteShare(ctx.env, id)
  return noContentResponse()
}

// ------------------------------------------------------------------------------ the view routes

/** The app's read: the envelope exactly as stored, so the client re-validates the same bytes. */
async function readProfile(ctx: Ctx, id: string): Promise<Response> {
  const record = await readRecord(ctx.env, id)
  if (!record) return notFound()
  const fresh = await touch(ctx.env, id, record, ctx.now())
  const reply = {
    envelope: fresh.envelope,
    ...(fresh.cardMap ? { cardMap: fresh.cardMap } : {}),
    createdAt: new Date(fresh.createdAt).toISOString(),
    updatedAt: new Date(fresh.updatedAt).toISOString(),
    expiresAt: expiresAt(fresh)
  }
  return jsonResponse(reply, 200, { 'Cache-Control': 'no-store' })
}

/**
 * The card bytes under the Content-Type their signature says. The path stays `/c/:id.png` for
 * a JPEG or WebP card too: every link and unfurl already out there points at it, and browsers and
 * Discord go by the header, never the extension.
 */
async function readCard(ctx: Ctx, id: string): Promise<Response> {
  const bytes = await ctx.env.SHARES.get(KEY_CARD(id), 'arrayBuffer')
  if (!bytes) return errorResponse(404, 'not-found', 'That share has no card image.')
  const kind = cardKind(new Uint8Array(bytes)) ?? 'png'
  return imageResponse(bytes, CARD_CONTENT_TYPE[kind])
}

/**
 * The page a browser (and Discord's unfurler) sees.
 *
 * The stored envelope goes back through `acceptEnvelope` before it is rendered. It passed on the
 * way in, so this is belt-and-braces — but KV is a place rather than a type, and the alternative
 * is a code path that renders whatever the namespace happens to hold.
 */
async function readPage(ctx: Ctx, id: string): Promise<Response> {
  const record = await readRecord(ctx.env, id)
  if (!record) return notFound()
  const accepted = acceptEnvelope(record.envelope)
  if (!accepted.ok) return notFound()
  const fresh = await touch(ctx.env, id, record, ctx.now())
  const nonce = newNonce()
  const html = renderPage({
    id,
    profile: accepted.profile,
    origin: ctx.origin,
    shareString: await shareStringFor(accepted.envelope),
    hasCard: fresh.hasCard,
    cardMap: fresh.hasCard ? (fresh.cardMap ?? []) : [],
    updatedAt: fresh.updatedAt,
    nonce
  })
  return htmlResponse(html, nonce)
}

// ------------------------------------------------------------------------------------ dispatch

async function apiRoute(ctx: Ctx, path: string): Promise<Response> {
  const rest = path.slice(API_PREFIX.length)
  const method = ctx.request.method
  if (rest === '' || rest === '/') {
    return method === 'POST' ? createShare(ctx) : notFound()
  }
  const id = rest.slice(1)
  if (!ID_ONLY.test(id)) return notFound()
  if (method === 'PUT') return updateShare(ctx, id)
  if (method === 'DELETE') return removeShare(ctx, id)
  return notFound()
}

/** The three public reads, as a table: one method check and one rate-limit check serve them all. */
const VIEW_ROUTES: readonly [RegExp, (ctx: Ctx, id: string) => Promise<Response>][] = [
  [PROFILE_ROUTE, readProfile],
  [CARD_ROUTE, readCard],
  [PAGE_ROUTE, readPage]
]

async function viewRoute(ctx: Ctx, path: string): Promise<Response> {
  for (const [pattern, run] of VIEW_ROUTES) {
    const match = pattern.exec(path)
    if (!match) continue
    if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') return notFound()
    if (await rateLimited(ctx.env.READ_LIMIT, clientIp(ctx.request))) return tooMany()
    return run(ctx, match[1] ?? '')
  }
  return notFound()
}

/** The service. Pure: everything it can observe arrives in its three arguments. */
export async function handleRequest(
  request: Request,
  env: Env,
  now: () => number = Date.now
): Promise<Response> {
  const url = new URL(request.url)
  const ctx: Ctx = { request, env, now, origin: env.PUBLIC_ORIGIN ?? url.origin }
  const path = url.pathname
  if (path === '/') return redirectResponse(HOME)
  // The site mark the page's top bar shows: static bytes, no id, no rate limit worth spending.
  if (path === '/logo.png') {
    return request.method === 'GET' || request.method === 'HEAD' ? logoResponse(logoPng()) : notFound()
  }
  if (path === API_PREFIX || path.startsWith(`${API_PREFIX}/`)) return apiRoute(ctx, path)
  return viewRoute(ctx, path)
}
