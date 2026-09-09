// env.ts — THE BINDINGS, DECLARED HERE RATHER THAN IMPORTED FROM CLOUDFLARE.
//
// This worker is type-checked and unit-tested from the ROOT repo (`tests/shareServer.test.mts`
// drives `handleRequest` under plain node:test, no workerd). Depending on `@cloudflare/workers-types`
// would drag a second, conflicting set of global DOM/Fetch declarations into a tree whose two
// tsconfigs already decide what `Request` and `Response` mean — and it would make the root install
// carry a dependency for a directory the app never imports. So the three shapes the handler
// actually touches are written out here, structurally: KV as this code uses it, the rate limiter's
// one method, and the record we keep under `share:<id>`.
//
// STRUCTURAL, NOT NOMINAL, is the point. The real `KVNamespace` and `RateLimit` satisfy these
// interfaces at the `export default` seam in index.ts, and the test's in-memory fake satisfies
// them too — one contract, two implementations, no cast in the handler.

/** The subset of `KVNamespace.put` options this service uses. */
export interface KvPutOptions {
  /** seconds from now; the ONE expiry mechanism here (ruling 2's 180 days) */
  expirationTtl?: number
  metadata?: Record<string, unknown>
}

/**
 * Workers KV, as this handler reads and writes it. Three read shapes because the two values have
 * different natures: the record is JSON, the card is bytes, and `text` is what a fake is easiest
 * to write against.
 */
export interface KvLike {
  get(key: string, type: 'json'): Promise<unknown>
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  get(key: string, type: 'text'): Promise<string | null>
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: KvPutOptions
  ): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * The Workers rate-limiting binding. ABSENT MEANS ALLOWED, on purpose: `wrangler dev` without the
 * unsafe binding, and the unit suite, must exercise the same code path the deployed worker runs
 * rather than a second "no limiter" branch that nothing tests.
 */
export interface RateLimiterLike {
  limit(opts: { key: string }): Promise<{ success: boolean }>
}

export interface Env {
  SHARES: KvLike
  CREATE_LIMIT?: RateLimiterLike
  READ_LIMIT?: RateLimiterLike
  /** the origin every URL this service hands out is built from (`[vars]` in wrangler.toml) */
  PUBLIC_ORIGIN?: string
}

/**
 * What `share:<id>` holds.
 *
 * `tokenHash` is the SHA-256 of the delete token and the token itself is NEVER stored: a reader of
 * this namespace can delete nothing. `hasCard` is a fact about the sibling `card:<id>` key, kept
 * here so the HTML page does not have to fetch the PNG to find out whether to draw an `<img>`.
 * `lastSeenAt` is the clock ruling 2's 30-day read-refresh window is measured against.
 */
export interface ShareRecord {
  envelope: unknown
  createdAt: number
  updatedAt: number
  lastSeenAt: number
  tokenHash: string
  hasCard: boolean
}

/** 180 days, in seconds — the KV TTL every write of both keys carries (owner ruling 2). */
export const SHARE_TTL_SECONDS = 180 * 24 * 60 * 60

/** A view older than this rewrites the record to push the expiry out; a fresher one does not. */
export const VIEW_REFRESH_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Decoded card ceiling (PNG, JPEG or WebP). Raised from 400 KB on 2026-09-09 so a full-resolution
 * high-DPI capture fits as JPEG; the app still steps its width down until the bytes fit, so this
 * is the room it has, not a target. KV allows 25 MB a value; the free tier's 1 GB is the real limit.
 */
export const MAX_CARD_BYTES = 1024 * 1024

/** Ids are 10 chars of `[A-Za-z0-9]` — 62^10 ≈ 2^59.5, unguessable and still double-clickable. */
export const ID_LENGTH = 10

export const KEY_SHARE = (id: string): string => `share:${id}`
export const KEY_CARD = (id: string): string => `card:${id}`
