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
  /** the Discord application's public client id (`[vars]`); absent = the /discord routes are off */
  DISCORD_CLIENT_ID?: string
  /**
   * The Discord application's client secret — a Worker SECRET (`wrangler secret put`), never a
   * var and never in this repo. Absent (as it is under `wrangler dev` and in the unit suite) the
   * /discord routes answer 503 `discord-off`; it is read by discord.ts and sent only to
   * discord.com's token endpoint.
   */
  DISCORD_CLIENT_SECRET?: string
}

/**
 * What `share:<id>` holds.
 *
 * `tokenHash` is the SHA-256 of the delete token and the token itself is NEVER stored: a reader of
 * this namespace can delete nothing. `hasCard` is a fact about the sibling `card:<id>` key, kept
 * here so the HTML page does not have to fetch the PNG to find out whether to draw an `<img>`.
 * `lastSeenAt` is the clock ruling 2's 30-day read-refresh window is measured against.
 */
/**
 * Where one gear cell sits on the card image, in FRACTIONS of the image (0..1): `x`/`y` the
 * top-left corner, `w`/`h` the size. Measured by the app at capture time, so it is only ever
 * meaningful alongside the card from the same capture; `slot` is the envelope cell's slot id.
 */
export interface CardHotspot {
  slot: string
  x: number
  y: number
  w: number
  h: number
}

export interface ShareRecord {
  envelope: unknown
  createdAt: number
  updatedAt: number
  lastSeenAt: number
  tokenHash: string
  hasCard: boolean
  /** the card's hotspots (2026-09-09); absent on records written before, and when none were sent */
  cardMap?: CardHotspot[]
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

/**
 * The gear history (history.ts): the states this id has been RE-PUBLISHED over, newest first.
 *
 * A third key rather than a field on the record because it is read by exactly two callers and
 * written by exactly one: a PUT pushes the state it replaces onto it, `touch` rewrites it beside
 * the other two so all three expire together, and a delete removes it. Keeping it out of
 * `share:<id>` also means the common read — the app's `/p/:id` and the page — never pays to parse
 * thirty old states it is only sometimes going to show.
 */
export const KEY_HISTORY = (id: string): string => `hist:${id}`

/**
 * How many past states one share keeps. Thirty is a re-share a day for a month; past that the
 * oldest falls off the end, because a share is a picture of a character, not an audit log, and
 * the row is one somebody pays for.
 */
export const HISTORY_CAP = 30

/**
 * Settings sync (sync.ts): one CLIENT-ENCRYPTED settings bundle, parked under its code.
 *
 * The value is ciphertext this service cannot read — the key never leaves the two PCs
 * (docs/plans/settings-sync.md) — so the row is opaque bytes with an expiry, nothing more.
 */
export const KEY_SYNC = (code: string): string => `sync:${code}`

/** 24 hours: long enough to walk to the other PC, short enough that a leaked code is stale. */
export const SYNC_TTL_SECONDS = 24 * 60 * 60

/**
 * A sync code is 10 chars of the id alphabet — 62^10 ≈ 2^59.5, the same draw as a share id. It is
 * a BEARER SECRET (there is no second token), so the unguessability has to come from the length
 * and from `CREATE_LIMIT`/`READ_LIMIT`: 300 reads a minute per IP against 2^59.5 codes that live
 * one day is not a search anybody finishes.
 */
export const SYNC_CODE_LENGTH = 10

/** Decoded ceiling for one settings bundle. The app's own settings JSON is tens of kilobytes. */
export const MAX_SYNC_BYTES = 512 * 1024

/**
 * The Discord connect flow's two rows (discord.ts), in the SAME namespace under their own prefix:
 * a second KV binding would be a second namespace to create per account for two keys that live
 * ten minutes. `pending` says "/discord/start issued a redirect for this state"; `result` is the
 * webhook, parked until the app claims it once.
 */
export const KEY_DISCORD_PENDING = (state: string): string => `discord:pending:${state}`
export const KEY_DISCORD_RESULT = (state: string): string => `discord:result:${state}`

/** Ten minutes: a pending state, and an unclaimed result, live this long and no longer. */
export const DISCORD_TTL_SECONDS = 600
