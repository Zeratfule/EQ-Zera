// ============================================================================
// shared/discordChannels.ts — A DISCORD CHANNEL, AS A THING THE USER PICKED IN DISCORD.
// ============================================================================
//
// The owner's direction (2026-09-11): *"There's got to be a better way to share to Discord instead
// of having people input webhooks for each channel they want to send to."* There is: Discord's own
// authorize page carries a SERVER AND CHANNEL DROPDOWN when an app asks for the `webhook.incoming`
// scope, and what it hands back at the end is a webhook for the channel the user chose. So the
// user picks a channel in Discord's UI, and this app never shows them a URL at all.
//
// WHAT CHANGED IN THE DATA, AND WHAT DID NOT. A connected channel is stored EXACTLY as a pasted
// one was — `{ id, token }` under `shared/discordWebhook.ts`'s closed character classes, because
// those two values are still what a request path is rebuilt from. What is new is that there is a
// LIST of them (people are in more than one server), each with the channel's own identity and a
// LABEL to tell them apart in a dropdown.
//
// THIS FILE IS PURE, and it holds the two boundaries this feature adds:
//
//   1. `parseDiscordClaim` — THE ONE PLACE THE SERVICE CONTRACT IS ASSUMED. The share service's
//      `/discord/claim/<state>` reply is JSON from a network socket, and the two values in it are
//      about to be concatenated into a request path at discord.com. So it is parsed, not read: an
//      object that does not carry a webhook id and token IN THE CLASSES is not a claim, and a
//      field rename on the service side is a one-line fix in one function rather than a hunt.
//   2. `sanitizeChannel` — the same filter on the way OUT OF THE STORE, for `storeDiscord.ts`'s
//      stated reason: a store file is a file on a disk somebody else can also write to.
//
// THE TOKEN IS STILL A SECRET AND IS STILL TREATED AS ONE. `DiscordChannel` carries it because
// main needs it to post; `DiscordChannelView` is what crosses IPC, and it has an id, a label and a
// date in it. Nothing in this file writes a token anywhere.

import { isWebhookId, isWebhookToken, type DiscordWebhook } from './discordWebhook'

/** One connected channel, main-side. The token is in here; the view below is what the UI gets. */
export interface DiscordChannel extends DiscordWebhook {
  /** Discord's id for the channel the webhook posts into. '' when nobody told us (a paste). */
  channelId: string
  /** …and for the server it lives in. '' for the same reason. */
  guildId: string
  /** What the dropdown says. Derived from Discord's names, and renameable - see `channelLabelFor`. */
  label: string
  /** When this install connected it, epoch ms. Orders the list; shown as a date by nobody yet. */
  addedAt: number
}

/** ONE CHANNEL AS THE RENDERER SEES IT. No token, ever - see the header. */
export interface DiscordChannelView {
  id: string
  label: string
  addedAt: number
}

/** THE ONLY SHAPE THAT CROSSES IPC: the channels, and which one a post uses when nobody says. */
export interface DiscordChannelsView {
  channels: DiscordChannelView[]
  defaultId?: string
}

/**
 * WHAT THE SERVICE HANDS BACK at `/discord/claim/<state>`, once, after the user pressed Authorize.
 *
 * The names are the SERVICE'S wire spelling, not ours, and they are spelled out here so the one
 * function that reads them (`parseDiscordClaim`) is the one place a rename has to be made.
 */
export interface DiscordClaim {
  webhookId: string
  webhookToken: string
  channelId: string
  guildId: string
  channelName?: string
  guildName?: string
}

// ------------------------------------------------------------------------------ closed classes

/**
 * A Discord snowflake: decimal digits. Generous rather than exact (17 today, 18 and 19 in the
 * wild, 20 before the epoch runs out) so a future length is not a silent refusal - the same bound
 * `shared/discordWebhook.ts` puts on a webhook id, for the same reason.
 */
const SNOWFLAKE = /^[0-9]{17,20}$/

/**
 * THE CONNECT STATE: base64url of 32 random bytes, which is exactly 43 characters. Closed and
 * exact, because the value is concatenated into a request path on the share service AND into the
 * query of a URL handed to the user's browser.
 */
const CONNECT_STATE = /^[A-Za-z0-9_-]{43}$/

/** How many random bytes a state is minted from. Main mints it; this is the number it uses. */
export const CONNECT_STATE_BYTES = 32

/** Longest label this app will hold. A dropdown row, not a paragraph. */
export const LABEL_MAX = 60

/** Longest name from the service this app will even look at before cutting it. */
const NAME_MAX = 100

/** How many channels one install may hold. A bound, not a product limit anybody will meet. */
export const MAX_CHANNELS = 20

/**
 * What a FULL list says, in one sentence. It lives here beside the bound rather than in either
 * caller, because both doors into the list (Connect, and the Advanced paste) can meet it, and two
 * spellings of the same refusal is two sentences to keep in step.
 */
export const CHANNELS_FULL = `You can keep up to ${String(MAX_CHANNELS)} Discord channels. Remove one first.`

/** What a channel is called when nothing else is known - a fold of an older single webhook. */
export const FOLDED_LABEL = 'Connected channel'

/** …and what a webhook somebody pasted under Advanced is called. */
export const PASTED_LABEL = 'Pasted webhook'

/** Is this a state this app will put in a URL? See `CONNECT_STATE`. */
export function isConnectState(raw: unknown): raw is string {
  return typeof raw === 'string' && CONNECT_STATE.test(raw)
}

/** Is this a snowflake? Used for the channel and server ids, which are stored and displayed. */
export function isSnowflake(raw: unknown): raw is string {
  return typeof raw === 'string' && SNOWFLAKE.test(raw)
}

/** A snowflake, or '' for anything else. '' is the honest value for a pasted webhook. */
function snowflakeOrEmpty(raw: unknown): string {
  return isSnowflake(raw) ? raw : ''
}

/**
 * A name from the service, made safe to draw: control characters (newlines included) become
 * spaces, it is trimmed, and it is cut. `undefined` for anything that is not a name.
 *
 * A server name is text somebody else typed into Discord. It is drawn in a MUI label, so there is
 * no markup hazard here at all - what this defends is the LAYOUT (a name with a newline in it is
 * a row that is suddenly two rows tall) and the store (a megabyte of name is not a label).
 */
function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  // Walked rather than regexed: a control-character CLASS in a regex is exactly what
  // `no-control-regex` exists to complain about, and the loop says the same thing in the open.
  let flat = ''
  for (const ch of raw.slice(0, NAME_MAX * 2)) {
    const code = ch.codePointAt(0) ?? 0
    flat += code < 0x20 || code === 0x7f ? ' ' : ch
  }
  const text = flat.trim().slice(0, NAME_MAX).trim()
  return text === '' ? undefined : text
}

/** Cut a label to what a row can hold. Empty for anything that is not one; callers decide. */
export function clampChannelLabel(raw: unknown): string {
  return cleanName(raw)?.slice(0, LABEL_MAX).trim() ?? ''
}

// -------------------------------------------------------------------------------- the parser

/** The two optional names, cleaned. Split out so the parser below stays one readable decision. */
function claimNames(r: Record<string, unknown>): Pick<DiscordClaim, 'channelName' | 'guildName'> {
  const channelName = cleanName(r.channelName)
  const guildName = cleanName(r.guildName)
  return {
    ...(channelName === undefined ? {} : { channelName }),
    ...(guildName === undefined ? {} : { guildName })
  }
}

/**
 * THE SERVICE'S REPLY -> the claim it names, or null for anything that is not one.
 *
 * ACCEPTED, and exactly this object:
 *
 *   { webhookId: string, webhookToken: string, channelId: string, guildId: string,
 *     channelName?: string, guildName?: string }
 *
 * with `webhookId` and `webhookToken` in `shared/discordWebhook.ts`'s closed classes and the two
 * snowflakes in `SNOWFLAKE`. Extra fields are IGNORED rather than refused - the service may grow
 * one, and a stricter reading would turn that into an outage. The two names are optional because
 * Discord does not always send them, and the label falls back accordingly.
 *
 * REFUSED: a non-object, a null, an array of one, a missing or malformed webhook id or token, a
 * channel or server id that is not a snowflake. A refusal produces NO channel and therefore no
 * request: a reply that does not parse never becomes something this app posts to.
 */
export function parseDiscordClaim(body: unknown): DiscordClaim | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const r = body as Record<string, unknown>
  if (!isWebhookId(r.webhookId) || !isWebhookToken(r.webhookToken)) return null
  if (!isSnowflake(r.channelId) || !isSnowflake(r.guildId)) return null
  return {
    webhookId: r.webhookId,
    webhookToken: r.webhookToken,
    channelId: r.channelId,
    guildId: r.guildId,
    ...claimNames(r)
  }
}

// --------------------------------------------------------------------------------- the label

/**
 * WHAT A CONNECTED CHANNEL IS CALLED, from whatever Discord told the service:
 *
 *   both names   ->  `#general · Guild of Thieves`
 *   channel only ->  `#general`
 *   server only  ->  `Guild of Thieves channel`
 *   neither      ->  `Channel 4821` (the last four of the channel id)
 *
 * The last case is why `discord:renameChannel` exists: "Channel 4821" tells nobody anything, and
 * the person who connected it knows perfectly well that it is the guild's gear channel.
 */
export function channelLabelFor(claim: DiscordClaim): string {
  const channel = claim.channelName
  const guild = claim.guildName
  if (channel !== undefined && guild !== undefined) return clampChannelLabel(`#${channel} · ${guild}`)
  if (channel !== undefined) return clampChannelLabel(`#${channel}`)
  if (guild !== undefined) return clampChannelLabel(`${guild} channel`)
  return `Channel ${claim.channelId.slice(-4)}`
}

// -------------------------------------------------------------------------------- the records

/** A timestamp a store can be trusted to have written, or now. */
function stampOf(raw: unknown, now: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : now
}

/** A claim -> the record this install keeps. The one place a connected channel is born. */
export function channelFromClaim(claim: DiscordClaim, now: number): DiscordChannel {
  return {
    id: claim.webhookId,
    token: claim.webhookToken,
    channelId: claim.channelId,
    guildId: claim.guildId,
    label: channelLabelFor(claim),
    addedAt: now
  }
}

/**
 * A pasted (or folded) webhook -> the same record, with the two ids honestly EMPTY.
 *
 * Nobody told us which channel this is; an invented id would be exactly the kind of made-up value
 * the repo's first world-model law forbids, and '' is a thing the label code already handles.
 */
export function channelFromWebhook(hook: DiscordWebhook, label: string, now: number): DiscordChannel {
  return { id: hook.id, token: hook.token, channelId: '', guildId: '', label, addedAt: now }
}

/**
 * One stored record, RE-VALIDATED on the way out of the store file - see the header.
 *
 * A record whose id or token has stopped being in the class is dropped entirely (it could not
 * produce a request anyway); everything else degrades rather than refusing, because a label that
 * somehow became a number is not a reason to lose a working channel.
 */
export function sanitizeChannel(raw: unknown, now: number): DiscordChannel | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isWebhookId(r.id) || !isWebhookToken(r.token)) return null
  const label = clampChannelLabel(r.label)
  return {
    id: r.id,
    token: r.token,
    channelId: snowflakeOrEmpty(r.channelId),
    guildId: snowflakeOrEmpty(r.guildId),
    label: label === '' ? FOLDED_LABEL : label,
    addedAt: stampOf(r.addedAt, now)
  }
}

// --------------------------------------------------------------------------------- the views

/** The list as the renderer sees it. The tokens do not survive this function. */
export function channelsViewOf(
  channels: readonly DiscordChannel[],
  defaultId: string | undefined
): DiscordChannelsView {
  const view: DiscordChannelView[] = channels.map((c) => ({
    id: c.id,
    label: c.label,
    addedAt: c.addedAt
  }))
  const known = defaultId !== undefined && channels.some((c) => c.id === defaultId)
  return known ? { channels: view, defaultId } : { channels: view }
}

/**
 * WHICH CHANNEL A POST GOES TO: the one it named, else the default, else the only one, else none.
 *
 * The last clause is deliberate rather than "else the first". With two channels and no default,
 * picking one of them would be this app guessing which of somebody's servers gets their character
 * card - so it refuses in words instead, and the share dialog's selector is how they say.
 */
export function pickChannel(
  channels: readonly DiscordChannel[],
  defaultId: string | undefined,
  wanted?: string
): DiscordChannel | null {
  if (typeof wanted === 'string' && wanted !== '') {
    return channels.find((c) => c.id === wanted) ?? null
  }
  const byDefault = defaultId === undefined ? undefined : channels.find((c) => c.id === defaultId)
  if (byDefault !== undefined) return byDefault
  return channels.length === 1 ? (channels[0] ?? null) : null
}
