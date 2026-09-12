// share/net.ts — the ONLY place the share service's origin is named, and the boundary that
// decides which URLs this app will speak to about a shared profile.
//
// IT IS feedback/net.ts's LAW, NOT ITS CODE. The two features have the same shape (main-process
// HTTP to one compiled-in host) and therefore the same rules, but the gate itself is IMPORTED
// (`devUnlocked`, `RuntimeFacts`) rather than copied: two copies of a security predicate is two
// predicates, and only one of them gets fixed.
//
//  1. `COMPILED_SHARE_ORIGIN` is compiled in and there is NO user-configurable override, ever. A
//     settable share host turns "publish my character card" into "publish my character card to a
//     host of somebody else's choosing" — the same exfiltration argument feedback/net.ts makes
//     about a log slice, and it does not get weaker because the payload is smaller.
//
//  2. The one exception is the DEV-CHANNEL LOCAL STACK: `EQ_SHARE_URL`, read only when
//     `devUnlocked` says this is an unpackaged Electron dev run that is not an `EQ_E2E` run, and
//     only when it names a LOOPBACK host. A value that can only ever name this machine cannot
//     exfiltrate anything, which is the whole reason it is safe; widening it to arbitrary https
//     would NOT be. It is an env var read from a developer's own shell — never a setting, never
//     persisted, never reachable from the renderer or from a server reply.
//
//  3. THE ORIGIN IS ALSO THE READ FILTER. `parseShareLink` is what stands between a pasted string
//     and a `fetch` from the main process, so it accepts EXACTLY the two link shapes this service
//     publishes (`/s/<id>`, `/p/<id>`) on EXACTLY this origin — an exact `URL.origin` compare,
//     never `endsWith`, so `share.eqzera.com.evil.com` and `http://share.eqzera.com` both fail.
//     The id it answers is re-checked against a closed character class, because it is about to be
//     concatenated into a request path.
//
// All network here is MAIN-PROCESS ONLY. The renderer performs no fetch — `connect-src 'self'`
// makes that structurally impossible — and this feature requires ZERO CSP changes.

import { E2E } from '../e2e'
import { devUnlocked, type RuntimeFacts } from '../feedback/net'

/** The share service as COMPILED IN. The only origin a packaged build can ever use. */
const COMPILED_SHARE_ORIGIN = 'https://share.eqzera.com'

/** The env var a DEV build reads for a local share service. Never read in a packaged build. */
export const DEV_SHARE_ENV = 'EQ_SHARE_URL'

/** Publish/revoke budget. The feedback POST's number, for the same reason: one JSON round trip. */
export const SHARE_TIMEOUT_MS = 15_000

/** Shared with every other outbound request this app makes. */
const UA = 'eq-zera/0.1 (share)'

/** Longest URL we will even look at, matching security.ts's MAX_LINK_LEN reasoning. */
const MAX_URL_LEN = 2048

/**
 * The only hosts a dev origin may name — numeric on purpose. `localhost` is a NAME and resolves
 * through whatever the machine's resolver says today; a numeric loopback literal cannot be
 * pointed anywhere else. `new URL().hostname` spells IPv6 WITH the brackets.
 */
const DEV_LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]'])

/**
 * A share id, as this app is willing to spell one: the service mints ten characters out of
 * `[A-Za-z0-9]`, and the bound is generous rather than exact so a future id length is not a
 * silent refusal. It is a CLOSED CLASS because the value is concatenated into a request path —
 * no dots, no slashes, no percent escapes, so an id can never address another route.
 */
const SHARE_ID = /^[A-Za-z0-9]{1,32}$/

/**
 * A delete token, as the service mints one: base64url of 32 random bytes (43 chars). Bounded and
 * closed for the same reason as the id — it is about to travel in an `Authorization` header.
 */
const DELETE_TOKEN = /^[A-Za-z0-9_-]{16,256}$/

/** Parse a bounded string as a URL. Non-strings, empty, absurdly long and malformed all → null. */
function parseBoundedUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LEN) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/**
 * A loopback origin, normalized — or '' for anything else. http is allowed HERE and only here:
 * the bytes never leave the machine, so there is nothing for TLS to protect and a local dev
 * server would otherwise need a certificate.
 */
function loopbackOrigin(raw: string | undefined): string {
  const u = parseBoundedUrl(raw)
  if (u === null) return ''
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
  if (!DEV_LOOPBACK_HOSTS.has(u.hostname)) return ''
  if (u.username !== '' || u.password !== '' || u.search !== '' || u.hash !== '') return ''
  return u.origin
}

/**
 * The dev share origin for a given set of process facts. '' means "the gate is closed", which is
 * every packaged build and every non-Electron process, the test runner included.
 *
 * `RuntimeFacts.url` is documented against `EQ_FEEDBACK_URL` because feedback declared the type
 * first; the field is the env value the gate is being asked about, and this feature passes its
 * own. Sharing the TYPE is what keeps the two gates provably identical.
 */
export function devShareOriginFor(facts: RuntimeFacts): string {
  return devUnlocked(facts) ? loopbackOrigin(facts.url) : ''
}

const DEV_SHARE_ORIGIN = devShareOriginFor({
  execPath: process.execPath,
  platform: process.platform,
  electron: process.versions.electron,
  e2e: E2E,
  // Computed key on purpose: `process.env.SOMETHING` is the shape a bundler's `define` can
  // replace, and this value must be read at RUNTIME, in the dev app, from the dev shell.
  url: process.env[DEV_SHARE_ENV]
})

/**
 * The origin this process will actually talk to. In every packaged build — and in every
 * non-Electron process — this is byte-identical to the compiled constant.
 *
 * EXCEPT UNDER `EQ_E2E`, WHERE IT IS EMPTY — the build is DARK and no request is possible at all.
 * That is the feedback stack's own law applied here (`queueFlushEnabled`: "the headless harness
 * never submits, so it must never reach the network behind the test's back"), and this feature
 * needs it more than feedback does: `share.eqzera.com` is a live host, so a suite that merely
 * assumed it was unreachable would publish a real record from every e2e run the moment the
 * service went up. An empty origin makes that structurally impossible instead of unlikely, and
 * the harness still gets what it is there to assert — the button reporting an outcome, in words.
 */
export function shareOriginFor(e2e: boolean, devOrigin: string): string {
  if (e2e) return ''
  return devOrigin === '' ? COMPILED_SHARE_ORIGIN : devOrigin
}

export const SHARE_ORIGIN: string = shareOriginFor(E2E, DEV_SHARE_ORIGIN)

/** Does this build have a share service compiled in? The dialog gates its button on it. */
export function shareEndpointConfigured(): boolean {
  return SHARE_ORIGIN.length > 0
}

/** The link a sharer copies: the HTML page, which is the one route a browser is meant to open. */
export function shareUrlFor(id: string): string {
  return `${SHARE_ORIGIN}/s/${id}`
}

/** The JSON route the app reads a shared profile back from. */
export function profileUrlFor(id: string): string {
  return `${SHARE_ORIGIN}/p/${id}`
}

/**
 * The CARD IMAGE route, for a chat client that needs the picture by URL rather than by unfurl -
 * today the Discord embed (src/main/ipc/discord.ts). Nothing in this app fetches it.
 *
 * `?v=` DEFEATS A CACHE, AND IT IS SAFE TO ADD because the service's route matches the PATHNAME
 * only (share-server `CARD_ROUTE`); the bytes under `/c/<id>.png` genuinely change when a
 * character re-shares, so a message posted after an update must not show last week's gear.
 */
export function cardUrlFor(id: string, version: number): string {
  return `${SHARE_ORIGIN}/c/${id}.png?v=${String(version)}`
}

/** The create route, and the per-record route the update/delete pair address. */
export function createUrl(): string {
  return `${SHARE_ORIGIN}/api/v1/shares`
}

export function recordUrl(id: string): string {
  return `${SHARE_ORIGIN}/api/v1/shares/${id}`
}

/**
 * The SETTINGS-SYNC routes (docs/plans/settings-sync.md): create a transfer, and the per-record
 * route its read and its delete address.
 *
 * They live beside the share routes rather than in a module of their own because they are the SAME
 * service on the SAME compiled-in origin, and therefore under the same gate: `SHARE_ORIGIN` is
 * empty under `EQ_E2E`, so a headless run cannot post somebody's settings anywhere. There is no
 * token here at all - the code IS the secret (`share/syncCrypto.ts`), so a DELETE carries nothing
 * but the code, and nothing this app stores can revoke somebody else's transfer.
 */
export function syncUrl(): string {
  return `${SHARE_ORIGIN}/api/v1/sync`
}

export function syncRecordUrl(code: string): string {
  return `${SHARE_ORIGIN}/api/v1/sync/${code}`
}

/** Is this an id this app will put in a URL? See `SHARE_ID`. */
export function isShareId(raw: unknown): raw is string {
  return typeof raw === 'string' && SHARE_ID.test(raw)
}

/** Is this a token this app will put in an `Authorization` header? See `DELETE_TOKEN`. */
export function isDeleteToken(raw: unknown): raw is string {
  return typeof raw === 'string' && DELETE_TOKEN.test(raw)
}

/**
 * The id inside a share link, or null for anything that is not one — see header item 3.
 *
 * Accepted: `<origin>/s/<id>` and `<origin>/p/<id>`, with or without a trailing slash, with or
 * without a query or fragment (a chat client that appends `?utm=…` has not changed which share
 * this is). Refused: any other origin, any other path, credentials in the URL, a non-default
 * port, and an id that is not `SHARE_ID`. A bare id is NOT a link and answers null — a pasted
 * word must never become a network request.
 */
export function parseShareLink(text: unknown): string | null {
  const u = parseBoundedUrl(typeof text === 'string' ? text.trim() : text)
  if (u === null) return null
  if (u.origin !== SHARE_ORIGIN) return null
  if (u.username !== '' || u.password !== '') return null
  const parts = u.pathname.split('/').filter((p) => p !== '')
  if (parts.length !== 2) return null
  if (parts[0] !== 's' && parts[0] !== 'p') return null
  const id = parts[1]
  return isShareId(id) ? id : null
}

/**
 * The outcome of an HTTP attempt, as data. NOTHING in this module throws — publishing must never
 * reject across IPC (`links.ts` promises a sentence, not a stack), and the only cheap way to keep
 * that promise is for the transport to report failure instead of raising it.
 *
 * `status: 0` means the request never got an answer (DNS, offline, TLS, timeout).
 */
export interface ShareAttempt {
  status: number
  /** Parsed JSON body when the response carried one, else null. */
  body: unknown
}

/** What a request needs from the outside world. Injected so the tests never touch a network. */
export interface ShareFetch {
  fetch: typeof globalThis.fetch
}

/** Read a response body as JSON, tolerating an empty or non-JSON body (returns null). */
async function readJsonBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (text.length === 0) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** One JSON request against the share service. Never throws. */
export async function shareRequest(
  deps: ShareFetch,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  opts: { body?: unknown; token?: string } = {}
): Promise<ShareAttempt> {
  const headers: Record<string, string> = { 'User-Agent': UA }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token !== undefined) headers.Authorization = `Bearer ${opts.token}`
  try {
    const res = await deps.fetch(url, {
      method,
      headers,
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      signal: AbortSignal.timeout(SHARE_TIMEOUT_MS)
    })
    return { status: res.status, body: await readJsonBody(res) }
  } catch {
    return { status: 0, body: null }
  }
}
