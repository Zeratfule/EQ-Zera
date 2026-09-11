// discordConnect.ts — ONE CONNECT ATTEMPT AT A TIME, and what the renderer is told about it.
//
// The session half of Discord's channel picker (docs/plans/discord-connect.md). `share/discordConnect.ts`
// owns the URLs, the contract and the poll; THIS file owns the fact that a connect takes minutes,
// happens in another program, and has to survive the user closing Preferences in the middle of it.
//
// WHY THE POLL LIVES IN MAIN AND THE RENDERER POLLS MAIN. The renderer performs no network at all
// (`connect-src 'self'`), so the loop has to be here whatever else is true. But the shape is also
// the right one: Preferences is a TAB, a tab unmounts when the user looks at their meters, and a
// loop owned by a React effect would die with it, halfway through somebody's authorize. So main
// runs the attempt to its end and the renderer asks what happened - which also means the answer is
// still here when they come back.
//
// ONE AT A TIME, ON PURPOSE. A second Connect cancels the first: two browser tabs both waiting on
// two states is a user watching two spinners and a store that could gain a channel they had
// stopped expecting. `session` is the live attempt's identity, and a poll whose session is no
// longer the live one writes NOTHING - that is what stops a slow, cancelled attempt from landing a
// channel on top of a newer one.
//
// THE TOKEN NEVER REACHES THE RENDERER. What crosses is `{ state, label?, error? }`: a word for
// the spinner, the new channel's LABEL so the card can say what it got, and a sentence when it
// failed. The webhook goes straight from the claim into the store (src/main/storeDiscord.ts).

import { logError } from './errorLog'
import {
  CONNECT_ERR,
  connectEndpointConfigured,
  mintConnectState,
  openConnectPage,
  pollForClaim,
  type ConnectOutcome
} from './share/discordConnect'
import { channelFromClaim, CHANNELS_FULL, type DiscordClaim } from '../shared/discordChannels'
import { addDiscordChannel } from './storeDiscord'

/**
 * WHAT THE RENDERER ASKS FOR, AND ALL IT IS TOLD.
 *
 * `idle` is "nothing has been tried this session", which is deliberately distinct from
 * `cancelled`: the card draws its Connect button in both, but a user who just pressed Cancel has
 * earned an acknowledgement rather than a screen that pretends they never pressed anything.
 */
export interface DiscordConnectStatus {
  state: 'idle' | 'waiting' | 'done' | 'failed' | 'cancelled'
  /** the label of the channel that was just connected - `done` only */
  label?: string
  /** the one sentence that says what went wrong - `failed` only */
  error?: string
}

/** What `discord:connectStart` answers. The waiting itself is read from the status channel. */
export interface DiscordConnectStart {
  ok: boolean
  error?: string
}

/** The live attempt. `cancelled` is read by the poll on every pass, so Cancel lands mid-wait. */
interface Session {
  state: string
  cancelled: boolean
}

let session: Session | null = null
let status: DiscordConnectStatus = { state: 'idle' }

/** What the renderer's poll reads. A plain value: nothing here computes on being asked. */
export function discordConnectStatus(): DiscordConnectStatus {
  return status
}

/**
 * Stop waiting. The browser tab is the user's own business - we cannot close it and do not try -
 * but nothing that comes back is stored and the card goes back to offering Connect.
 */
export function cancelDiscordConnect(): DiscordConnectStatus {
  if (session !== null) session.cancelled = true
  session = null
  if (status.state === 'waiting') status = { state: 'cancelled' }
  return status
}

/** The claim -> a stored channel, and the status that says so. The one writer in this file. */
function keepClaim(claim: DiscordClaim): DiscordConnectStatus {
  const channel = channelFromClaim(claim, Date.now())
  if (!addDiscordChannel(channel)) return { state: 'failed', error: CHANNELS_FULL }
  return { state: 'done', label: channel.label }
}

/** An outcome -> the status. Split out so `runAttempt` stays one readable paragraph. */
function statusFor(outcome: ConnectOutcome): DiscordConnectStatus {
  if (outcome.kind === 'cancelled') return { state: 'cancelled' }
  if (outcome.kind === 'failed') return { state: 'failed', error: outcome.error }
  return keepClaim(outcome.claim)
}

/**
 * Run one attempt to its end.
 *
 * `session !== mine` is the guard that makes "one at a time" true rather than hoped: a cancelled
 * or superseded attempt that finishes late drops its result on the floor instead of writing over
 * whatever the user is doing now.
 */
async function runAttempt(mine: Session): Promise<void> {
  const outcome = await pollForClaim(
    {
      fetch: globalThis.fetch,
      now: () => Date.now(),
      sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      cancelled: () => mine.cancelled
    },
    mine.state
  )
  if (session !== mine) return
  session = null
  status = statusFor(outcome)
}

/**
 * Mint a state, open the user's browser on the service, and start waiting.
 *
 * THE BROWSER IS OPENED BEFORE THE POLL STARTS, and the poll is not started at all if it would not
 * open: a spinner waiting on a page nobody was shown is the app lying about what it is doing.
 */
export async function startDiscordConnect(): Promise<DiscordConnectStart> {
  if (!connectEndpointConfigured()) {
    status = { state: 'failed', error: CONNECT_ERR.dark }
    return { ok: false, error: CONNECT_ERR.dark }
  }
  cancelDiscordConnect()
  const mine: Session = { state: mintConnectState(), cancelled: false }
  if (!(await openConnectPage(mine.state))) {
    status = { state: 'failed', error: CONNECT_ERR.browser }
    return { ok: false, error: CONNECT_ERR.browser }
  }
  session = mine
  status = { state: 'waiting' }
  void runAttempt(mine).catch(() => {
    // A FIXED string: nothing about a claim reaches the log, because a claim carries a token.
    logError('main:discordConnect', 'the Discord connect attempt failed')
    if (session !== mine) return
    session = null
    status = { state: 'failed', error: CONNECT_ERR.offline }
  })
  return { ok: true }
}
