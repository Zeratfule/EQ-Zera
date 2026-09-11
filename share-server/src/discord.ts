// discord.ts — "connect a channel" with Discord's OWN picker, the service half.
//
// The app posts character cards to a Discord channel through a channel WEBHOOK
// (docs/plans/discord-webhook.md). The first cut had the user make the webhook by hand and paste
// its URL in; this is the second cut, where Discord's `webhook.incoming` OAuth scope makes the
// webhook FOR them: the app opens a browser on Discord's server-and-channel picker, the user
// clicks Authorize, and Discord hands the webhook to a redirect URL. That redirect must be a
// server, because the exchange that follows needs the application's CLIENT SECRET, and a secret
// compiled into an Electron app is not a secret. So this worker is the redirect, and this file is
// three routes: `/discord/start` sends the browser to Discord, `/discord/callback` receives the
// code, trades it for the webhook and parks the result, and `/discord/claim/<state>` hands the
// result to the app exactly once. It still grants NOTHING beyond a webhook — no bot, no scope
// that reads the user's servers, no token of ours that outlives the exchange.
//
// ---------------------------------------------------------------------------
// THE STATE IS THE ONLY KEY
// ---------------------------------------------------------------------------
// The app mints `state` (32 random bytes, base64url, 43 chars) and it is the only thing the
// three routes have in common: `/start` records it as pending, Discord echoes it to `/callback`,
// and `/claim` reads the result under it. Nothing else authenticates the app to this service, and
// nothing needs to:
//
//   * A stranger who guesses a pending state within its ten minutes can, at most, complete THEIR
//     OWN authorization under it — which parks THEIR webhook where the app that minted the state
//     will claim it. That is a webhook to a channel they control, handed to a victim who will
//     see the wrong channel name and disconnect it. It cannot reach a channel of the victim's.
//   * The result — and the token in it — is returned ONCE and deleted; the second read is 404.
//     A stranger polling a guessed state races the app for one read of a 43-character secret.
//   * The client secret never leaves the Worker: it is a Worker secret (`wrangler secret put`),
//     read here, sent to discord.com over TLS, and never echoed, logged or stored.
//   * `redirect_uri` is built from `PUBLIC_ORIGIN`, never from the request's Host header, so a
//     request that arrives under some other name cannot steer Discord's redirect anywhere else —
//     and Discord rejects any redirect_uri that is not registered on the application anyway.
//
// NO LOGGING, on purpose. Nothing here `console.log`s (the repo's lint forbids it), and the
// webhook token appears in exactly two places: the token endpoint's reply and the KV row the app
// claims. The HTML pages a browser sees carry the CHANNEL NAME and nothing else from the reply.
//
// ---------------------------------------------------------------------------
// WHY THE APP POLLS
// ---------------------------------------------------------------------------
// The browser that finishes the flow is the system browser, not the app; the app never sees the
// redirect. A custom URL scheme would hand the token to the OS's URL dispatcher (and to any
// program that registered the same scheme); a loopback listener would put the token on a local
// HTTP hop. Parking it here for ten minutes under an unguessable key and letting the app poll
// `/claim` every two seconds is simpler and keeps the token on TLS the whole way.

import { newNonce } from './codec'
import { DISCORD_TTL_SECONDS, KEY_DISCORD_PENDING, KEY_DISCORD_RESULT, type Env } from './env'
import {
  clientIp,
  errorResponse,
  htmlResponse,
  jsonResponse,
  rateLimited,
  redirectResponse
} from './http'
import { esc } from './page'
import { isWebhookId, isWebhookToken } from '../../src/shared/discordWebhook'

/** What the routes need. `fetchImpl` is injected so the unit suite never touches discord.com. */
export interface DiscordCtx {
  request: Request
  env: Env
  now: () => number
  /** the compiled-in public origin; where `redirect_uri` is built from */
  origin: string
  fetchImpl: typeof fetch
}

/** The row `/claim` hands the app, once. Names are optional: Discord's reply may omit both. */
export interface DiscordConnection {
  webhookId: string
  webhookToken: string
  channelId: string
  guildId: string
  channelName?: string
  guildName?: string
  /** ISO-8601, the moment the callback stored it */
  connectedAt: string
}

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize'
const TOKEN_URL = 'https://discord.com/api/oauth2/token'
/** The one scope: an incoming webhook to one channel the user picks. No bot, no identity. */
const SCOPE = 'webhook.incoming'
/** One JSON round trip to discord.com; the same budget the app gives its own posts. */
const TOKEN_TIMEOUT_MS = 15_000

/** 32 random bytes, base64url, unpadded — exactly 43 characters, and the app mints them. */
const STATE = /^[A-Za-z0-9_-]{43}$/
const START_ROUTE = /^\/discord\/start$/
const CALLBACK_ROUTE = /^\/discord\/callback$/
const CLAIM_ROUTE = /^\/discord\/claim\/([^/]{1,64})$/

/** Discord's snowflakes are 17–20 digits; Discord's own cap on a channel or guild name is 100. */
const SNOWFLAKE = /^[0-9]{17,20}$/
const MAX_NAME = 100

// ------------------------------------------------------------------------------------ pages

/**
 * One notice page: a title, a sentence, and nothing to click. The same palette as the share
 * page (page.ts), the same nonce'd `<style>` under the same CSP, and NO script — the page has
 * nothing to do. `status` is threaded through because `htmlResponse` always answers 200 and a
 * failed callback is a 4xx/5xx a browser should see as one.
 */
function noticePage(title: string, body: string, status = 200): Response {
  const nonce = newNonce()
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)} · EQ Zera</title>` +
    `<style nonce="${esc(nonce)}">` +
    `body{margin:0;background:#0c0a1f;color:#efeaff;font-family:'Source Sans 3','Segoe UI',system-ui,sans-serif;font-size:17px;line-height:1.55}` +
    `.wrap{max-width:560px;margin:0 auto;padding:64px 20px}` +
    `h1{font-family:'Chakra Petch','Bahnschrift','Segoe UI',sans-serif;font-size:32px;margin:0 0 12px;` +
    `background:linear-gradient(180deg,#fff 0%,#c7a2ff 60%,#ff5fb8 100%);-webkit-background-clip:text;background-clip:text;color:transparent}` +
    `p{margin:0 0 10px}.muted{color:#7d75a6;font-size:15px}` +
    `</style></head><body><div class="wrap"><h1>${esc(title)}</h1><p>${body}</p>` +
    `<p class="muted">EQ Zera</p></div></body></html>`
  const base = htmlResponse(html, nonce)
  return new Response(html, { status, headers: base.headers })
}

function expiredPage(): Response {
  return noticePage(
    'This link has expired',
    'The connection request is no longer open. Close this tab and start again from EQ Zera.',
    400
  )
}

function cancelledPage(): Response {
  return noticePage('Cancelled', 'Nothing was connected. You can close this tab.')
}

function failedPage(): Response {
  return noticePage(
    'Not connected',
    'Discord did not complete the connection. Close this tab and try again in EQ Zera.',
    502
  )
}

function connectedPage(channelName: string | undefined): Response {
  const where = channelName !== undefined ? ` to <strong>#${esc(channelName)}</strong>` : ''
  return noticePage(
    'Connected',
    `EQ Zera can now post${where}. You can close this tab and go back to EQ Zera.`
  )
}

// --------------------------------------------------------------------------------- helpers

function tooMany(): Response {
  return errorResponse(429, 'rate-limited', 'Too many requests. Try again in a minute.')
}

function badState(): Response {
  return errorResponse(400, 'bad-state', 'The state must be 32 random bytes as base64url (43 characters).')
}

/** `wrangler secret put DISCORD_CLIENT_SECRET` has not happened (or the client id var is unset). */
function discordOff(): Response {
  return errorResponse(503, 'discord-off', 'Discord connection is not configured on this service.')
}

function configured(env: Env): env is Env & { DISCORD_CLIENT_ID: string; DISCORD_CLIENT_SECRET: string } {
  return Boolean(env.DISCORD_CLIENT_ID) && Boolean(env.DISCORD_CLIENT_SECRET)
}

/** The `state` query parameter, or null unless it is exactly the shape the app mints. */
function stateOf(url: URL): string | null {
  const s = url.searchParams.get('state') ?? ''
  return STATE.test(s) ? s : null
}

function redirectUri(origin: string): string {
  return `${origin}/discord/callback`
}

/** A bounded, trimmed name, or undefined when Discord sent none (or sent something else). */
function nameOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim().slice(0, MAX_NAME)
  return trimmed.length ? trimmed : undefined
}

/**
 * The token endpoint's reply → the row we keep, or null when it is not a webhook grant.
 *
 * The id and token go through the APP'S OWN filters (`src/shared/discordWebhook.ts`), so what the
 * service hands back is by construction what the app would have accepted pasted — and the two
 * values that later land in a request path are held to the same closed classes on both ends.
 */
function connectionOf(raw: unknown, at: number): DiscordConnection | null {
  const reply = objectOf(raw)
  const hook = objectOf(reply?.webhook)
  if (!hook) return null
  const channelId = snowflakeOf(hook.channel_id)
  const guildId = snowflakeOf(hook.guild_id)
  if (!isWebhookId(hook.id) || !isWebhookToken(hook.token) || !channelId || !guildId) return null
  const row: DiscordConnection = {
    webhookId: hook.id,
    webhookToken: hook.token,
    channelId,
    guildId,
    connectedAt: new Date(at).toISOString()
  }
  return withNames(row, hook.name, objectOf(reply?.guild)?.name)
}

function objectOf(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
}

function snowflakeOf(raw: unknown): string | null {
  return typeof raw === 'string' && SNOWFLAKE.test(raw) ? raw : null
}

/** The two optional names onto a row — present only when Discord (or the row) had one. */
function withNames(row: DiscordConnection, channel: unknown, guild: unknown): DiscordConnection {
  const channelName = nameOf(channel)
  const guildName = nameOf(guild)
  if (channelName !== undefined) row.channelName = channelName
  if (guildName !== undefined) row.guildName = guildName
  return row
}

/**
 * `code` → the webhook, by POSTing to Discord's token endpoint with the client secret. Returns
 * null for every way it can fail (network, timeout, a non-2xx, a body that is not a webhook
 * grant): the caller has one page for all of them, and the reason is not the user's to act on.
 */
async function exchangeCode(ctx: DiscordCtx, code: string): Promise<DiscordConnection | null> {
  if (!configured(ctx.env)) return null
  const form = new URLSearchParams({
    client_id: ctx.env.DISCORD_CLIENT_ID,
    client_secret: ctx.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(ctx.origin)
  })
  try {
    const res = await ctx.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
    })
    if (!res.ok) return null
    return connectionOf(await res.json(), ctx.now())
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------- routes

/**
 * GET /discord/start?state=<s> → 302 to Discord's picker.
 *
 * The pending key is written BEFORE the redirect so that `/callback` can refuse any state this
 * service never issued a redirect for — Discord will call back with whatever `state` it was
 * given, and without this a stranger could park a result under a state nobody minted (harmless,
 * but a KV row per request is a budget somebody pays).
 */
async function start(ctx: DiscordCtx, url: URL): Promise<Response> {
  if (!configured(ctx.env)) return discordOff()
  if (await rateLimited(ctx.env.CREATE_LIMIT, clientIp(ctx.request))) return tooMany()
  const state = stateOf(url)
  if (!state) return badState()
  await ctx.env.SHARES.put(KEY_DISCORD_PENDING(state), '1', { expirationTtl: DISCORD_TTL_SECONDS })
  const to = new URL(AUTHORIZE_URL)
  to.searchParams.set('client_id', ctx.env.DISCORD_CLIENT_ID)
  to.searchParams.set('scope', SCOPE)
  to.searchParams.set('response_type', 'code')
  to.searchParams.set('redirect_uri', redirectUri(ctx.origin))
  to.searchParams.set('state', state)
  return redirectResponse(to.toString())
}

/**
 * GET /discord/callback?code=<c>&state=<s> — where Discord sends the browser back.
 *
 * Every answer is an HTML page: the reader is a person in a browser tab, not the app. The pending
 * key is deleted on EVERY terminal outcome (connected, cancelled, failed), so the app's poll
 * turns from `not-ready` into `not-found` and it can say "start over" instead of waiting out the
 * ten minutes. A `state` this service never redirected for is refused before Discord is asked
 * anything — the token endpoint is the expensive, secret-bearing call and it is made only for a
 * flow this service started.
 */
async function callback(ctx: DiscordCtx, url: URL): Promise<Response> {
  if (!configured(ctx.env)) return discordOff()
  if (await rateLimited(ctx.env.CREATE_LIMIT, clientIp(ctx.request))) return tooMany()
  const state = stateOf(url)
  if (!state) return expiredPage()
  const pendingKey = KEY_DISCORD_PENDING(state)
  if ((await ctx.env.SHARES.get(pendingKey, 'text')) === null) return expiredPage()
  const error = url.searchParams.get('error')
  if (error !== null) {
    await ctx.env.SHARES.delete(pendingKey)
    return error === 'access_denied' ? cancelledPage() : failedPage()
  }
  const code = url.searchParams.get('code') ?? ''
  if (!code || code.length > 512) return expiredPage()
  const connection = await exchangeCode(ctx, code)
  if (!connection) {
    await ctx.env.SHARES.delete(pendingKey)
    return failedPage()
  }
  await ctx.env.SHARES.put(KEY_DISCORD_RESULT(state), JSON.stringify(connection), {
    expirationTtl: DISCORD_TTL_SECONDS
  })
  await ctx.env.SHARES.delete(pendingKey)
  return connectedPage(connection.channelName)
}

/**
 * GET /discord/claim/<state> → the connection, ONCE.
 *
 * Two 404s with different codes, because the app does two different things with them:
 * `not-ready` means the callback has not happened, keep polling; `not-found` means it never
 * will — claimed already, cancelled, failed, or ten minutes have passed — start over. Read then
 * delete rather than the other way round, so a claim that crashes between the two does not lose
 * the row (KV is eventually consistent; the second read of a race is what the delete is for).
 */
async function claim(ctx: DiscordCtx, state: string): Promise<Response> {
  if (await rateLimited(ctx.env.READ_LIMIT, clientIp(ctx.request))) return tooMany()
  if (!STATE.test(state)) return badState()
  const resultKey = KEY_DISCORD_RESULT(state)
  const connection = storedConnection(await ctx.env.SHARES.get(resultKey, 'json'))
  if (connection) {
    await ctx.env.SHARES.delete(resultKey)
    return jsonResponse(connection, 200, { 'Cache-Control': 'no-store' })
  }
  const pending = await ctx.env.SHARES.get(KEY_DISCORD_PENDING(state), 'text')
  if (pending !== null) {
    return errorResponse(404, 'not-ready', 'Discord has not completed the connection yet.')
  }
  return errorResponse(404, 'not-found', 'No connection is waiting under that state.')
}

/**
 * The stored row, re-checked on the way out, or null. KV is a place, not a type (store.ts says
 * the same): a row that does not pass the app's own filters is not handed to the app, whatever
 * the namespace happens to hold. Rebuilt field by field so the reply's shape is exactly
 * `DiscordConnection` and never "whatever was stored, plus".
 */
function storedConnection(raw: unknown): DiscordConnection | null {
  const r = objectOf(raw)
  if (!r || typeof r.connectedAt !== 'string') return null
  const channelId = snowflakeOf(r.channelId)
  const guildId = snowflakeOf(r.guildId)
  if (!isWebhookId(r.webhookId) || !isWebhookToken(r.webhookToken) || !channelId || !guildId) return null
  const row: DiscordConnection = {
    webhookId: r.webhookId,
    webhookToken: r.webhookToken,
    channelId,
    guildId,
    connectedAt: r.connectedAt
  }
  return withNames(row, r.channelName, r.guildName)
}

// -------------------------------------------------------------------------------- dispatch

function notFound(): Response {
  return errorResponse(404, 'not-found', 'No share lives at that address.')
}

/**
 * The three routes, or null when `path` is none of them (the handler then falls through to its
 * own 404). GET and HEAD only, like the view routes; anything else is "nothing here".
 */
export async function discordRoute(ctx: DiscordCtx, path: string): Promise<Response | null> {
  const claimMatch = CLAIM_ROUTE.exec(path)
  if (!START_ROUTE.test(path) && !CALLBACK_ROUTE.test(path) && !claimMatch) return null
  const method = ctx.request.method
  if (method !== 'GET' && method !== 'HEAD') return notFound()
  const url = new URL(ctx.request.url)
  if (claimMatch) return claim(ctx, claimMatch[1] ?? '')
  if (START_ROUTE.test(path)) return start(ctx, url)
  return callback(ctx, url)
}

/** The default `fetch`, bound late so a test-injected global (or none at all) is honoured. */
export function platformFetch(): typeof fetch {
  return (input, init) => globalThis.fetch(input, init)
}
