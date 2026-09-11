// share/discord.ts — THE APP'S SECOND OUTBOUND ORIGIN, and the boundary that decides which URLs
// this process will POST a character card to.
//
// OWNER RULING, 2026-09-10: *"we should also develope a way to export your character profile
// directly to a chat in Discord. that would be cool."* The agreed shape is a CHANNEL WEBHOOK —
// the user makes one in their own Discord channel and pastes the URL in. No bot, no OAuth, no
// server of ours, no slash commands, and therefore no account of theirs that this app can touch.
//
// IT IS `share/net.ts`'S LAW, NOT ITS CODE, for the reason that file gives about feedback/net.ts:
// two copies of a security predicate is two predicates, and only one of them gets fixed. What is
// the SAME, clause by clause:
//
//  1. THE HOSTS ARE COMPILED IN and there is no override, ever. `discord.com` and
//     `discordapp.com`, exact hostname compares, never `endsWith` — `discord.com.evil.com` fails.
//     There is no dev-loopback carve-out here at all, and there should not be: net.ts's carve-out
//     exists so a developer can run the SHARE SERVICE locally, and nobody runs Discord locally.
//
//  2. THE PATH IS PART OF THE ORIGIN DECISION. Only `/api/webhooks/<id>/<token>` is reachable,
//     and the id and the token come from `shared/discordWebhook.ts`'s CLOSED CHARACTER CLASSES.
//     The URL is REBUILT from those two values rather than replayed from what the user pasted, so
//     a query, a fragment, a port, credentials or a deeper path cannot survive the round trip
//     into a request. POST only: nothing here reads, lists, edits or deletes anything at Discord.
//
//  3. MAIN-PROCESS ONLY. The renderer performs no fetch (`connect-src 'self'` makes it
//     structurally impossible) and this feature widens NO CSP. The renderer never even sees the
//     token — it crosses IPC as a masked view (src/main/storeDiscord.ts).
//
//  4. DARK UNDER `EQ_E2E`, exactly like the share origin, and for a sharper version of the same
//     reason. `share.eqzera.com` merely might be live; a webhook URL a developer pasted while
//     testing is DEFINITELY live and points at a real channel with real people in it. So an
//     `EQ_E2E` build has no Discord endpoint at all: `discordEndpointConfigured()` is false, every
//     post answers the dark sentence, and a suite can never put a message in somebody's server.
//     The harness still gets what it is there to assert — the button reporting an outcome, in
//     words.
//
//  5. NOTHING THROWS. Every failure is a short plain sentence in `{ ok: false, error }`, because
//     these results cross an IPC boundary and there is nothing a reader can do with a stack.
//
// AND ONE CLAUSE THAT IS THIS FILE'S OWN:
//
//  6. THE WEBHOOK URL IS A SECRET AND IS NEVER LOGGED. Anyone holding it can post to that channel
//     forever, so it does not reach `errorLog`, `console`, a breadcrumb, a telemetry event or an
//     error message — not even truncated. Nothing in this module writes it anywhere; the failure
//     sentences below name the SITUATION and never the URL, and the caller logs the sentence.
//
// `fetch` IS INJECTED so this module is drivable under plain node with no network at all
// (tests/discordPost.test.mts); the IPC layer passes the global.

import { randomUUID } from 'node:crypto'
import { E2E } from '../e2e'
import {
  isWebhookId,
  isWebhookToken,
  type DiscordWebhook,
  discordTestBody
} from '../../shared/discordWebhook'

/** The webhook API as COMPILED IN. The only host this app ever posts a card to. */
const COMPILED_DISCORD_ORIGIN = 'https://discord.com'

/** The one path prefix a request may address. Concatenated with two closed-class values. */
const WEBHOOK_PATH = '/api/webhooks'

/** Post budget. The share POST's number, for the same reason: one JSON round trip. */
export const DISCORD_TIMEOUT_MS = 15_000

/** Shared with every other outbound request this app makes (feedback, share, the wikis). */
const UA = 'eq-zera/0.1 (discord)'

/**
 * The origin this process will actually talk to — EMPTY UNDER `EQ_E2E`, where the build is DARK
 * and no request is possible at all. See header item 4.
 *
 * Exported as a function of its input the way `shareOriginFor` is, so the decision itself is a
 * thing a test can watch being made rather than a constant it has to trust.
 */
export function discordOriginFor(e2e: boolean): string {
  return e2e ? '' : COMPILED_DISCORD_ORIGIN
}

export const DISCORD_ORIGIN: string = discordOriginFor(E2E)

/** Can this build post to Discord at all? The dialog and the settings card gate on it. */
export function discordEndpointConfigured(): boolean {
  return DISCORD_ORIGIN.length > 0
}

/**
 * The request URL for one webhook, REBUILT from its two closed-class values (header item 2), or
 * '' when either of them is not one. `discordapp.com` is accepted on the way IN
 * (`parseDiscordWebhook`) and canonicalized to `discord.com` here: there is one host this app
 * posts to, and it is the one compiled in above.
 */
export function webhookUrl(webhook: DiscordWebhook): string {
  if (DISCORD_ORIGIN === '') return ''
  if (!isWebhookId(webhook.id) || !isWebhookToken(webhook.token)) return ''
  return `${DISCORD_ORIGIN}${WEBHOOK_PATH}/${webhook.id}/${webhook.token}`
}

/** What a request needs from the outside world. Injected so the tests never touch a network. */
export interface DiscordFetch {
  fetch: typeof globalThis.fetch
}

/** What a post answers. There is nothing to say on success - the message is in the channel. */
export type DiscordPostResult = { ok: true } | { ok: false; error: string }

// ---------------------------------------------------------------------------------- the sentences
//
// SHORT, PLAIN, AND ABOUT THE READER'S SITUATION (AGENTS.md UI conventions: state, never process).
// None of them names a status code, a host, a verb or - see header item 6 - the URL.

const ERR = {
  dark: 'This build cannot post to Discord.',
  unset: 'Connect a Discord channel in Preferences, Sharing.',
  gone: 'That webhook no longer exists or the URL is wrong. Check Preferences, Sharing.',
  busy: 'Discord is rate limiting this webhook. Try again in a moment.',
  refused: 'Discord refused the message.',
  offline: 'Could not reach Discord.'
} as const

export { ERR as DISCORD_ERR }

/** A finished HTTP attempt -> the one sentence that describes it, or null when it succeeded. */
function sentenceFor(status: number): string | null {
  // Discord answers 204 to a plain webhook post and 200 when it was asked to wait for the
  // message; both are "it is in the channel".
  if (status === 200 || status === 204) return null
  if (status === 0) return ERR.offline
  if (status === 401 || status === 403 || status === 404) return ERR.gone
  if (status === 429) return ERR.busy
  return ERR.refused
}

/**
 * POST one JSON body to one webhook. Never throws; see header item 5.
 *
 * The body is whatever the caller built (`discordEmbedFor`, `discordTestBody`) — this function
 * owns the TRANSPORT and the sentences, not the message.
 */
export function postDiscordWebhook(
  webhook: DiscordWebhook,
  body: unknown,
  deps: DiscordFetch
): Promise<DiscordPostResult> {
  return sendToWebhook(webhook, { type: 'application/json', body: JSON.stringify(body) }, deps)
}

/**
 * THE ONE REQUEST, for both body shapes. Never throws; see header item 5.
 *
 * Split out when the FIGHT card arrived (2026-09-11) so the JSON path and the multipart path are
 * one transport with one deadline, one User-Agent and one table of sentences. Two `fetch` calls
 * would be two chances for a post to grow a second opinion about what a 429 means - and the one
 * nobody was looking at would be the one that started throwing at an IPC boundary.
 */
async function sendToWebhook(
  webhook: DiscordWebhook,
  payload: { type: string; body: string | Uint8Array },
  deps: DiscordFetch
): Promise<DiscordPostResult> {
  if (!discordEndpointConfigured()) return { ok: false, error: ERR.dark }
  const url = webhookUrl(webhook)
  if (url === '') return { ok: false, error: ERR.unset }
  let status = 0
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': payload.type, 'User-Agent': UA },
      body: payload.body as BodyInit,
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS)
    })
    status = res.status
  } catch {
    // DNS, offline, TLS and the timeout all land here and are all one situation to the reader.
    status = 0
  }
  const error = sentenceFor(status)
  return error === null ? { ok: true } : { ok: false, error }
}

// ---------------------------------------------------------------------------------- with a file
//
// THE FIGHT CARD RIDES IN THE SAME REQUEST AS ITS NUMBERS (owner, 2026-09-11: *"We should also
// make the Discord sharing be able to have DPS meter sharing also."*).
//
// WHY MULTIPART AND NOT A URL. A character card is PUBLISHED first — it becomes a page on the
// share service, and the embed points Discord at a picture Discord then fetches. A fight is not a
// page: there is nothing to visit, nothing to revoke, and nothing this app wants to keep serving.
// So the bytes travel INSIDE the post, Discord stores them as that message's own attachment, and
// this app publishes nothing at all. It is also the only shape that works while the share service
// is unreachable, which is a state a meter share should survive.
//
// WHY THE BODY IS BUILT BY HAND rather than with `FormData`. Three reasons, in order of weight:
// the `ShareFetch`-style seam this module is built on hands the injected `fetch` a body a TEST CAN
// READ (a `FormData` instance arrives at a fake fetch as an opaque object whose boundary nobody
// chose); the `Content-Type` header — boundary and all — stays this module's own, beside the
// header it already sets; and there is one fewer global to be true about in a main-process bundle.
// The layout below is Discord's documented shape and nothing else: `payload_json`, then `files[0]`.

/** One file riding along with a post. `bytes` are the encoded image, not a data URL. */
export interface DiscordPostFile {
  name: string
  bytes: Uint8Array
  type: string
}

/**
 * The file-name class. CLOSED, because the value is interpolated into a `Content-Disposition`
 * header: a name carrying a quote, a newline or a semicolon would not be a file name, it would be
 * a second header field. Today's only caller sends the constant `fight.png`; the class is what
 * makes that a fact rather than a habit.
 */
const POST_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** …and the content-type class, interpolated into a header for the same reason. */
const POST_FILE_TYPE = /^[a-z]+\/[a-z0-9.+-]{1,32}$/

/**
 * Biggest attachment this app will send. Discord's own free-tier ceiling is 10 MB; this is under
 * it with room to spare, and a PNG of a 720px card is two orders of magnitude smaller — so the
 * bound is a guard against a bug, never something a user meets.
 */
export const MAX_POST_FILE_BYTES = 8 * 1024 * 1024

/**
 * Is this something this module will put in a request? ASKED BY THE CALLER FIRST (see
 * src/main/ipc/combatShare.ts), which is what keeps the embed honest: an embed that names
 * `attachment://fight.png` when the file was refused renders as a broken picture, so the decision
 * to attach and the decision to SAY it is attached are one decision, made once, before either.
 */
export function isPostableFile(file: DiscordPostFile): boolean {
  if (!POST_FILE_NAME.test(file.name) || !POST_FILE_TYPE.test(file.type)) return false
  return file.bytes.length > 0 && file.bytes.length <= MAX_POST_FILE_BYTES
}

/** The multipart boundary: a token nothing in a PNG or a JSON body can contain. */
function multipartBoundary(): string {
  return `eqzera${randomUUID().replace(/-/g, '')}`
}

/**
 * Discord's documented two-part body: the message as `payload_json`, then the picture as
 * `files[0]`. Bytes, not a string — a PNG is not text and `TextEncoder` would mangle it.
 */
function multipartBody(body: unknown, file: DiscordPostFile, boundary: string): Uint8Array {
  const encoder = new TextEncoder()
  const head = encoder.encode(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="payload_json"\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      `${JSON.stringify(body)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="files[0]"; filename="${file.name}"\r\n` +
      `Content-Type: ${file.type}\r\n\r\n`
  )
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
  const out = new Uint8Array(head.length + file.bytes.length + tail.length)
  out.set(head, 0)
  out.set(file.bytes, head.length)
  out.set(tail, head.length + file.bytes.length)
  return out
}

/**
 * POST one body AND one file to one webhook. Never throws; same origin law, same deadline, same
 * sentences as the JSON path — the only thing that differs is the envelope.
 *
 * A file outside the classes above answers `refused` rather than quietly posting the numbers on
 * their own: the caller has already decided whether to SAY there is a picture, so silently
 * dropping one would publish a message pointing at an attachment that never left.
 */
export function postDiscordWebhookWithFile(
  webhook: DiscordWebhook,
  body: unknown,
  file: DiscordPostFile,
  deps: DiscordFetch
): Promise<DiscordPostResult> {
  if (!isPostableFile(file)) return Promise.resolve({ ok: false, error: ERR.refused })
  const boundary = multipartBoundary()
  return sendToWebhook(
    webhook,
    { type: `multipart/form-data; boundary=${boundary}`, body: multipartBody(body, file, boundary) },
    deps
  )
}

/**
 * The Test button: one plain line into the channel, so the person who just pasted a URL can see
 * it land rather than being told it looks well formed. No embed, no profile, nothing about a
 * character - a connection test that also published somebody's gear would be a surprise.
 */
export function testDiscordWebhook(webhook: DiscordWebhook, deps: DiscordFetch): Promise<DiscordPostResult> {
  return postDiscordWebhook(webhook, discordTestBody(), deps)
}
