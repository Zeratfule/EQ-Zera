// sync.ts — "send my settings to another PC", as an opaque parcel with a code on it.
//
// ---------------------------------------------------------------------------
// ZERO KNOWLEDGE, AND THAT IS THE WHOLE DESIGN
// ---------------------------------------------------------------------------
// A settings bundle is the most personal thing this app holds: alert regexes with guild and
// character names in them, a Discord webhook URL, window layouts, file paths. It must not sit on
// anybody's server in the clear, and the cheapest way to guarantee that is to make it impossible:
// THE APP ENCRYPTS THE BUNDLE BEFORE IT LEAVES THE MACHINE (AES-GCM, a key derived and shown to
// the user, never sent) and this service stores the ciphertext base64 verbatim. There is no
// decrypt path here and no key to leak: `sync:<code>` is bytes with an expiry.
//
// The full contract, the app-side flow and what the key segment is: docs/plans/settings-sync.md.
//
// ---------------------------------------------------------------------------
// THE CODE IS THE ONLY KEY — deliberately, with the trade-off stated
// ---------------------------------------------------------------------------
// There is no delete token here, unlike a share (`store.ts`). The code IS the secret: whoever can
// read the parcel can also delete it, and that is the right shape for a thing whose entire life
// is "type ten characters into the other PC and be done". What it costs is that a code the user
// pasted somewhere public can be deleted by a stranger — an annoyance ("that code no longer
// works, make another"), never a disclosure, because deleting is all it buys them. What it buys
// is one secret to move between two machines instead of two.
//
// Ten characters of `[A-Za-z0-9]` is 62^10 ≈ 2^59.5 (codec.ts `newId`, rejection-sampled off
// `crypto.getRandomValues`). That is not brute-forceable through `READ_LIMIT` — 300 reads a
// minute per IP against a 2^59.5 space whose rows live 24 hours — and it stays short enough to
// read aloud, which is the point of a sync code. The ciphertext underneath is the second lock:
// a guessed code without the key segment is an AES-GCM blob nobody can open.
//
// NO CORS, like the rest of this service: the app calls these from its MAIN process, never from a
// renderer, so a browser has no business reaching them and the absent header is what says so.

import { fromBase64, newId } from './codec'
import {
  KEY_SYNC,
  MAX_SYNC_BYTES,
  SYNC_CODE_LENGTH,
  SYNC_TTL_SECONDS,
  type Env
} from './env'
import {
  clientIp,
  errorResponse,
  jsonResponse,
  noContentResponse,
  rateLimited
} from './http'
import type { Refusal } from './store'

/** What the routes need. Structurally satisfied by the handler's own `Ctx`. */
export interface SyncCtx {
  request: Request
  env: Env
  now: () => number
}

/** The prefix the handler dispatches on. */
export const SYNC_PREFIX = '/api/v1/sync'

/** A code is what `newId(SYNC_CODE_LENGTH)` writes, and nothing else is even looked up. */
const CODE = new RegExp(`^[A-Za-z0-9]{${String(SYNC_CODE_LENGTH)}}$`)

/** base64 of MAX_SYNC_BYTES, plus room for padding, the JSON around it and a stray newline. */
const MAX_BODY_BYTES = Math.ceil(MAX_SYNC_BYTES / 3) * 4 + 1024

/** What `sync:<code>` holds: the ciphertext as it arrived, and when it was parked. */
interface SyncRow {
  blob: string
  /** epoch millis of the POST — what `expiresAt` is measured from on the way back out */
  at: number
}

function tooMany(): Response {
  return errorResponse(429, 'rate-limited', 'Too many requests. Try again in a minute.')
}

/** The same two helpers the share routes use, so every refusal on this service has one shape. */
function refuse(status: number, error: string, message: string): Refusal {
  return { ok: false, status, error, message }
}
function refusalResponse(refusal: Refusal): Response {
  return errorResponse(refusal.status, refusal.error, refusal.message)
}

/**
 * One answer for "no such code" and for "that is not a code at all".
 *
 * A malformed code and an unknown one are the SAME reply on purpose: a distinguishable 400 would
 * tell someone walking the space which of their guesses were well-formed, and there is nothing
 * for the app to do differently about either.
 */
function notFound(): Response {
  return errorResponse(404, 'not-found', 'No settings are waiting under that code.')
}

function expiresAt(at: number): string {
  return new Date(at + SYNC_TTL_SECONDS * 1000).toISOString()
}

/**
 * The `{ blob }` body, or the refusal to send back.
 *
 * The size ceiling is measured in UTF-8 BYTES before `JSON.parse`, exactly as the share body's is
 * (handler.ts), so a hostile length never becomes a hostile allocation. The base64 is DECODED
 * rather than pattern-matched: "it decodes" is the only claim this service can make about bytes
 * it cannot read, and the decoded length is the cap that actually matters.
 */
async function readBlob(request: Request): Promise<{ ok: true; blob: string } | Refusal> {
  const type = (request.headers.get('Content-Type') ?? '').toLowerCase()
  if (!type.includes('application/json')) {
    return refuse(415, 'not-json', 'Send the body as application/json.')
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return refuse(413, 'too-large', 'That settings bundle is larger than 512 KB.')
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
  const blob = (parsed as Record<string, unknown>).blob
  if (typeof blob !== 'string' || blob.length === 0) {
    return refuse(400, 'bad-blob', 'Send the encrypted bundle as base64 in "blob".')
  }
  const bytes = fromBase64(blob)
  if (!bytes) return refuse(400, 'bad-blob', 'The bundle is not valid base64.')
  if (bytes.length > MAX_SYNC_BYTES) {
    return refuse(413, 'too-large', 'That settings bundle is larger than 512 KB.')
  }
  return { ok: true, blob }
}

/**
 * POST /api/v1/sync — park one encrypted bundle, get a code.
 *
 * `CREATE_LIMIT` guards it (the same limiter a share create uses): this is the write that costs
 * KV, and it is also the one an abuser would use to park half a gigabyte of other people's bytes
 * in somebody's free tier.
 */
async function createSync(ctx: SyncCtx): Promise<Response> {
  if (await rateLimited(ctx.env.CREATE_LIMIT, clientIp(ctx.request))) return tooMany()
  const body = await readBlob(ctx.request)
  if (!body.ok) return refusalResponse(body)
  const at = ctx.now()
  const code = newId(SYNC_CODE_LENGTH)
  const row: SyncRow = { blob: body.blob, at }
  await ctx.env.SHARES.put(KEY_SYNC(code), JSON.stringify(row), {
    expirationTtl: SYNC_TTL_SECONDS
  })
  return jsonResponse({ code, expiresAt: expiresAt(at) }, 201, { 'Cache-Control': 'no-store' })
}

/** The stored row, re-checked on the way out. KV is a place, not a type (store.ts says the same). */
function rowOf(raw: unknown): SyncRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.blob !== 'string' || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  return { blob: r.blob, at: r.at }
}

/**
 * GET /api/v1/sync/<code> — the bundle back, as many times as it takes.
 *
 * READING DOES NOT DELETE. A one-shot read would mean a decrypt that failed because the user
 * mistyped the key segment, or an import the app refused halfway, had burned the only copy and
 * the user has to walk back to the first PC. The expiry is what ends the parcel's life, not the
 * first reader; `DELETE` is there for the user who wants it gone sooner.
 */
async function readSync(ctx: SyncCtx, code: string): Promise<Response> {
  if (await rateLimited(ctx.env.READ_LIMIT, clientIp(ctx.request))) return tooMany()
  if (!CODE.test(code)) return notFound()
  const row = rowOf(await ctx.env.SHARES.get(KEY_SYNC(code), 'json'))
  if (!row) return notFound()
  return jsonResponse({ blob: row.blob, expiresAt: expiresAt(row.at) }, 200, {
    'Cache-Control': 'no-store'
  })
}

/**
 * DELETE /api/v1/sync/<code> — 204, whether or not anything was there.
 *
 * No token: the code is the secret (see the header). Idempotent and silent about existence,
 * because "204" and "404" here would be a membership oracle for a code somebody is guessing, and
 * the app has nothing different to do with the two answers.
 */
async function removeSync(ctx: SyncCtx, code: string): Promise<Response> {
  if (await rateLimited(ctx.env.CREATE_LIMIT, clientIp(ctx.request))) return tooMany()
  if (!CODE.test(code)) return notFound()
  await ctx.env.SHARES.delete(KEY_SYNC(code))
  return noContentResponse()
}

/**
 * The three routes under `/api/v1/sync`. A wrong method on a real path answers 404 rather than
 * 405, exactly as the share routes do: the spec's error table has no 405.
 */
export async function syncRoute(ctx: SyncCtx, path: string): Promise<Response> {
  const rest = path.slice(SYNC_PREFIX.length)
  const method = ctx.request.method
  if (rest === '' || rest === '/') {
    return method === 'POST' ? createSync(ctx) : notFound()
  }
  const code = rest.slice(1)
  if (method === 'GET' || method === 'HEAD') return readSync(ctx, code)
  if (method === 'DELETE') return removeSync(ctx, code)
  return notFound()
}
