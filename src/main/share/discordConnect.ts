// share/discordConnect.ts — CONNECTING A DISCORD CHANNEL WITHOUT ANYBODY SEEING A URL.
//
// OWNER RULING, 2026-09-11: *"There's got to be a better way to share to Discord instead of having
// people input webhooks for each channel they want to send to."* The better way is Discord's own
// picker. The app opens the user's browser on OUR service, the service redirects to Discord's
// authorize page (which carries a server dropdown and a channel dropdown for the `webhook.incoming`
// scope), and after Authorize the service exchanges the code for that channel's webhook and parks
// it under a one-time STATE. The app polls, takes the webhook, and stores it exactly as a pasted
// one is stored. The user copies nothing.
//
// ---------------------------------------------------------------------------------------------
// THIS IS `share/net.ts`'S ORIGIN, NOT A THIRD ONE
// ---------------------------------------------------------------------------------------------
// Both routes below are on `SHARE_ORIGIN` - the SAME origin the share links use, imported from the
// one module that is allowed to name it - and both go through `shareRequest`, so the 15 s deadline,
// the User-Agent, the never-throws contract and the JSON reading are that module's, once. This
// feature adds NO outbound origin to the app. The app still has exactly two (AGENTS.md, Cloud):
// the share service and discord.com.
//
//   GET {SHARE_ORIGIN}/discord/start?state=<state>   302 -> Discord's authorize page. Opened in
//                                                    the user's BROWSER, never fetched here.
//   GET {SHARE_ORIGIN}/discord/claim/<state>         200 with the claim, exactly ONCE - the record
//                                                    is deleted as it answers, so the caller stores
//                                                    it there and then. Otherwise a 404 whose own
//                                                    `error` word says whether to keep waiting
//                                                    (`not-ready`) or stop (`not-found`: taken,
//                                                    cancelled, failed, or ten minutes gone). See
//                                                    `claimOnce` for the whole contract.
//
// GET ONLY, AND FROM MAIN. The renderer performs no fetch (`connect-src 'self'`) and this feature
// widens no CSP. Nothing here POSTs, and nothing here sends the user's data anywhere: the only
// thing that travels outbound is a state THIS APP MINTED, which names nothing about them.
//
// DARK UNDER `EQ_E2E`, exactly like the share origin and the Discord origin, and for the sharper
// of the two reasons: a connect that reached the real service would park a real OAuth state and
// open a real browser window on somebody's machine in the middle of a headless run. With no origin
// there is no URL, so `connectStartUrl` answers '' and the button says so in words.
//
// NOTHING THROWS. Every failure is a short plain sentence, because these outcomes cross an IPC
// boundary and there is nothing a reader can do with a stack.
//
// THE BROWSER IS OPENED THE WAY `feedback/mail.ts` OPENS A MAIL CLIENT, and for its argument
// exactly: `security.ts`'s `allowedExternalUrl` governs URLs BUILT FROM WORLD DATA (wiki page
// titles, a renderer's `window.open`), and it is deliberately not widened here. The URL below is
// built in main from a COMPILED-IN origin, a FIXED path and a state this process minted from
// `crypto.randomBytes`; no renderer string reaches it, and it is asserted to start with exactly
// that origin and path before the OS is asked to open anything. The set of things this door can
// open has one member, whatever anybody sends. (Widening the allowlist instead would ALSO let
// renderer-supplied text through `/discord/start`, which is strictly more than this needs.)

import { randomBytes } from 'node:crypto'
import {
  SHARE_ORIGIN,
  shareEndpointConfigured,
  shareRequest,
  SHARE_TIMEOUT_MS,
  type ShareFetch
} from './net'
import {
  CONNECT_STATE_BYTES,
  isConnectState,
  parseDiscordClaim,
  type DiscordClaim
} from '../../shared/discordChannels'

/**
 * MINT ONE ATTEMPT'S STATE: 32 random bytes, base64url, which is 43 characters of the closed
 * class `shared/discordChannels.ts` will accept back.
 *
 * It is the service's handle on this attempt and the only thing this app sends outbound during a
 * connect, so it is CSPRNG bytes rather than a counter or a timestamp: a guessable state is a
 * state somebody else could claim the webhook under.
 */
export function mintConnectState(): string {
  return randomBytes(CONNECT_STATE_BYTES).toString('base64url')
}

/** The route the BROWSER is sent to. A 302 to Discord; this process never fetches it. */
const START_PATH = '/discord/start'

/** …and the route this process polls for the result. */
const CLAIM_PATH = '/discord/claim'

/** How often the claim is asked for. Two seconds: a person is clicking through Discord's UI. */
export const CONNECT_POLL_MS = 2_000

/** …and how long it waits after the service said it is rate limiting this poll (429). */
export const CONNECT_BUSY_MS = 5_000

/** How long the whole attempt may take. The service parks a state for ten minutes; so do we. */
export const CONNECT_WINDOW_MS = 600_000

/** Re-exported so the one deadline number has one name at both ends of the feature. */
export { SHARE_TIMEOUT_MS }

/** Can this build connect a channel at all? The button gates on it, and answers in words. */
export function connectEndpointConfigured(): boolean {
  return shareEndpointConfigured()
}

/**
 * The URL the user's BROWSER is opened on, or '' when this build is dark or the state is not one.
 *
 * The state is in the query rather than the path because it is the service's own handle on an
 * OAuth attempt, and because `URLSearchParams` is not needed for a value out of a closed class -
 * `CONNECT_STATE` is base64url, which has nothing in it that needs escaping.
 */
export function connectStartUrl(state: string): string {
  if (!connectEndpointConfigured() || !isConnectState(state)) return ''
  return `${SHARE_ORIGIN}${START_PATH}?state=${state}`
}

/** The route the claim is read from, or '' for the same two reasons. */
export function claimUrl(state: string): string {
  if (!connectEndpointConfigured() || !isConnectState(state)) return ''
  return `${SHARE_ORIGIN}${CLAIM_PATH}/${state}`
}

// ---------------------------------------------------------------------------------- the sentences
//
// SHORT, PLAIN, AND ABOUT THE READER'S SITUATION (AGENTS.md UI conventions: state, never process).
// None of them names a status code, a host or a route.

const ERR = {
  dark: 'This build cannot connect a Discord channel.',
  /** The service says that state is not a live attempt: taken, cancelled, failed, or timed out. */
  refused: 'Discord did not complete the connection. Try again.',
  /** The service is up but has no Discord app configured. Nothing the reader can do about it. */
  off: 'The share service is not set up for Discord yet.',
  /** 400: the state this app minted was not one the service would look at. That is OUR defect. */
  internal: 'EQ Zera could not connect that channel. Try again.',
  offline: 'Could not reach the EQ Zera service.',
  timeout: 'Nothing came back from Discord. Press Connect a Discord channel again.',
  browser: 'Your browser could not be opened.'
} as const

export { ERR as CONNECT_ERR }

// ------------------------------------------------------------------------------------- the poll

/** One look at the claim route, as data. Nothing here throws; see the header. */
export type ClaimLook =
  | { kind: 'claimed'; claim: DiscordClaim }
  /** Not yet: the user is still in Discord. `waitMs` is how long before asking again. */
  | { kind: 'pending'; waitMs: number }
  /** the attempt is over, and this is the sentence that says why */
  | { kind: 'failed'; error: string }

/**
 * The service's own `error` word out of a JSON body, or '' when there was not one.
 *
 * THIS IS PART OF THE CONTRACT SURFACE, and it is here beside the parser for that reason: the two
 * 404s mean opposite things (`not-ready` = keep going, `not-found` = stop) and the only thing
 * that tells them apart is this field. A 404 whose body did not parse is read as NOT-READY, which
 * is the safe half: waiting two more seconds costs a poll, and giving up on a live attempt costs
 * the user their connection.
 */
function errorCodeOf(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const code = (body as Record<string, unknown>).error
  return typeof code === 'string' ? code : ''
}

/** The one 404 word that means "stop". Every other 404 body, and none at all, means keep going. */
const NOT_FOUND = 'not-found'

/** A 404, read. See `errorCodeOf`. */
function look404(body: unknown): ClaimLook {
  return errorCodeOf(body) === NOT_FOUND
    ? { kind: 'failed', error: ERR.refused }
    : { kind: 'pending', waitMs: CONNECT_POLL_MS }
}

/**
 * ASK ONCE. The service contract, 2026-09-11, in one function:
 *
 *   200                      -> claimed, and the record is GONE at the service the moment it
 *                               answers, so the caller stores it immediately. A body that does not
 *                               parse is a failure, not a webhook this app will post to.
 *   404 `not-ready`          -> pending. The user has not finished in Discord yet.
 *   404 `not-found`          -> failed. Claimed already, cancelled, refused, or the ten minutes
 *                               ran out. A fresh state is needed, which is what the sentence says.
 *   429                      -> pending, but backed off to five seconds.
 *   503 `discord-off`        -> failed. The service has no Discord app configured.
 *   400                      -> failed. The state was malformed, which is this app's defect.
 *   anything else, no answer -> failed. A 500 is not something the reader can act on differently.
 */
export async function claimOnce(deps: ShareFetch, state: string): Promise<ClaimLook> {
  const url = claimUrl(state)
  if (url === '') return { kind: 'failed', error: ERR.dark }
  const { status, body } = await shareRequest(deps, 'GET', url)
  if (status === 404) return look404(body)
  if (status === 429) return { kind: 'pending', waitMs: CONNECT_BUSY_MS }
  if (status === 0) return { kind: 'failed', error: ERR.offline }
  if (status === 400) return { kind: 'failed', error: ERR.internal }
  if (status === 503) return { kind: 'failed', error: ERR.off }
  if (status !== 200) return { kind: 'failed', error: ERR.refused }
  const claim = parseDiscordClaim(body)
  return claim === null ? { kind: 'failed', error: ERR.refused } : { kind: 'claimed', claim }
}

/**
 * The world the poll runs against. INJECTED WHOLE so the ten-minute give-up is a claim a test can
 * make in a millisecond with a fake clock, and so `cancelled` is read fresh on every pass rather
 * than captured once - the Cancel button presses while this loop is already waiting.
 */
export interface ConnectPollDeps extends ShareFetch {
  now: () => number
  sleep: (ms: number) => Promise<void>
  cancelled: () => boolean
}

/** How a whole attempt ended. `cancelled` is not a failure and carries no sentence. */
export type ConnectOutcome =
  | { kind: 'done'; claim: DiscordClaim }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: string }

/**
 * POLL UNTIL SOMETHING HAPPENS: the claim, a refusal, the user's Cancel, or ten minutes.
 *
 * The cancel is checked BEFORE each request as well as after it, so a Cancel pressed while a
 * request was in flight cannot be followed by another one. The give-up is computed against the
 * DEADLINE rather than counted in passes, because a slow request - or a 429 backing the interval
 * off to five seconds - makes a pass longer than the interval, and counting passes would quietly
 * stretch the window past the ten minutes the service keeps the state for.
 */
export async function pollForClaim(deps: ConnectPollDeps, state: string): Promise<ConnectOutcome> {
  if (claimUrl(state) === '') return { kind: 'failed', error: ERR.dark }
  const deadline = deps.now() + CONNECT_WINDOW_MS
  for (;;) {
    if (deps.cancelled()) return { kind: 'cancelled' }
    const look = await claimOnce(deps, state)
    if (look.kind === 'claimed') return { kind: 'done', claim: look.claim }
    if (look.kind === 'failed') return { kind: 'failed', error: look.error }
    if (deps.cancelled()) return { kind: 'cancelled' }
    if (deps.now() + look.waitMs > deadline) return { kind: 'failed', error: ERR.timeout }
    await deps.sleep(look.waitMs)
  }
}

// ---------------------------------------------------------------------------------- the browser

/**
 * Ask the OS to open the user's default browser on the start route. Answers whether it accepted,
 * never throws - a machine whose browser will not open is a person who gets a sentence, not an
 * exception for a dialog to render.
 *
 * THE PREFIX IS ASSERTED, not assumed (see the header): the URL is rebuilt from the compiled
 * origin and the fixed path above, and if it ever stops starting with them the OS is not asked.
 * Electron is imported INSIDE the function for `feedback/mail.ts`'s reason - a top-level
 * `import { shell } from 'electron'` makes this module unimportable by the node test runner.
 */
export async function openConnectPage(state: string): Promise<boolean> {
  const url = connectStartUrl(state)
  if (url === '' || !url.startsWith(`${SHARE_ORIGIN}${START_PATH}?state=`)) return false
  try {
    const { shell } = await import('electron')
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}
