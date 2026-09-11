// ---- posting a character card to Discord (docs/plans/discord-connect.md) ----
//
// The owner's ask, 2026-09-10: *"we should also develope a way to export your character profile
// directly to a chat in Discord."* And, 2026-09-11, the part that had been a chore: *"There's got
// to be a better way to share to Discord instead of having people input webhooks for each channel
// they want to send to."* There is - Discord's own picker - so this file now has two doors into
// the same list: CONNECT (mint a state, open the browser, poll in main) and the old PASTE.
//
// It stays small on purpose: the URL rules are in `shared/discordWebhook.ts`, the channel
// vocabulary and the service contract in `shared/discordChannels.ts`, the outbound origins in
// `share/discord.ts` and `share/discordConnect.ts`, the attempt in `../discordConnect.ts`, the
// storage in `../storeDiscord.ts`. What is left here is the doors and the one post.
//
// ---------------------------------------------------------------------------
// THE POST REUSES THE COPY-LINK PATH; IT DOES NOT REIMPLEMENT IT
// ---------------------------------------------------------------------------
// `discord:postProfile` takes the SAME arguments `character:shareLink` takes (the card's DOM
// rectangle, the profile, the hotspot map) and hands them to the SAME function
// (`publishCharacterLink`), which measures, photographs, PUTs-or-POSTs and records exactly as
// pressing Copy link does. A second publish path would be a second opinion about which record a
// character re-uses and which card bytes travel, and the one nobody was looking at would drift.
// So posting to Discord IS sharing a link, plus a message about it.
//
// THE EMBED IS THE LINK, WRAPPED. The share page already unfurls in Discord with the card and the
// score line; the embed gives that link a title, the two summary lines
// (`shared/discordWebhook.ts` takes them out of `characterShareText`'s own output, so the wording
// lives in one place), the four score tiles and the card picture by URL.
//
// ---------------------------------------------------------------------------
// NO TOKEN REACHES THE RENDERER, IN EITHER DIRECTION
// ---------------------------------------------------------------------------
// One arrives as text on `discord:setWebhook` or out of the service's claim, is parsed here (or in
// the connect session) and stored main-side. Every reply on every channel in this file is a
// channels VIEW, a masked `DiscordWebhookView`, a status word, a boolean or a sentence. Nothing
// here logs a webhook - see `share/discord.ts` header item 6 - which is also why the `catch`
// blocks below log a FIXED string and never the thrown value's message.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { discordEmbedFor, parseDiscordWebhook } from '../../shared/discordWebhook'
import { sanitizeCharacterShare } from '../../shared/characterShare'
import { CHANNELS_FULL } from '../../shared/discordChannels'
import { logError } from '../errorLog'
import {
  DISCORD_ERR,
  discordEndpointConfigured,
  postDiscordWebhook,
  testDiscordWebhook
} from '../share/discord'
import { cardUrlFor } from '../share/net'
import {
  cancelDiscordConnect,
  discordConnectStatus,
  startDiscordConnect,
  type DiscordConnectStart,
  type DiscordConnectStatus
} from '../discordConnect'
import {
  clearDiscordWebhook,
  discordChannelsView,
  discordWebhookView,
  pickDiscordChannel,
  removeDiscordChannel,
  renameDiscordChannel,
  setDefaultDiscordChannel,
  setDiscordWebhook,
  type DiscordChannelsView,
  type DiscordWebhookView
} from '../storeDiscord'
import { publishCharacterLink } from './characterShare'

/** What `discord:setWebhook` answers: both views, or the reason the paste was refused. */
export type DiscordSetResult =
  | { ok: true; view: DiscordWebhookView; channels: DiscordChannelsView }
  | { ok: false; error: string }

/** What `discord:postProfile` answers. `url` is the link the message points at. */
export type DiscordPostProfileResult = { ok: true; url: string } | { ok: false; error: string }

export type { DiscordConnectStart, DiscordConnectStatus }

/** The one sentence a badly pasted URL gets. It says what a GOOD one looks like, in one clause. */
const BAD_URL =
  'That is not a Discord webhook URL. In Discord: channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL.'

/** Store a pasted URL, or refuse it in words. The renderer never decides whether one is legal. */
function saveWebhook(raw: unknown): DiscordSetResult {
  const parsed = parseDiscordWebhook(raw)
  if (parsed === null) return { ok: false, error: BAD_URL }
  if (!setDiscordWebhook(parsed)) return { ok: false, error: CHANNELS_FULL }
  return { ok: true, view: discordWebhookView(), channels: discordChannelsView() }
}

/**
 * Publish the card as a link the way Copy link does, then post an embed wrapping it.
 *
 * THE DARK GATE IS FIRST, before anything is photographed or published: under `EQ_E2E` there is no
 * Discord endpoint at all, and a build that cannot deliver the message must not do the work of
 * building one - least of all publish a real share record on the way to not sending it.
 *
 * WHICH CHANNEL is decided in `storeDiscord.ts` from the id the dialog named, the default, or the
 * fact that there is only one. A request that names a channel this install does not hold reads as
 * "not connected" rather than falling back to another server's channel.
 */
async function postProfile(req: unknown): Promise<DiscordPostProfileResult> {
  if (!discordEndpointConfigured()) return { ok: false, error: DISCORD_ERR.dark }
  const request = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>
  const wanted = typeof request.channelId === 'string' ? request.channelId : undefined
  const channel = pickDiscordChannel(wanted)
  if (channel === null) return { ok: false, error: DISCORD_ERR.unset }
  // The renderer's profile is untrusted at the handler like every other one (this file's
  // siblings say so at length), and the embed reads NAME, LEVEL, CLASSES and SCORES off it.
  const profile = sanitizeCharacterShare(request.profile)
  if (profile === null) return { ok: false, error: 'There is nothing in that profile to share.' }
  const published = await publishCharacterLink(req)
  if (!published.ok) return { ok: false, error: published.error }
  const body = discordEmbedFor(profile, published.url, cardUrlFor(published.id, Date.now()))
  const posted = await postDiscordWebhook(channel, body, { fetch: globalThis.fetch })
  if (!posted.ok) return { ok: false, error: posted.error }
  return { ok: true, url: published.url }
}

/** The Test button. Refuses in words when that row is gone, rather than answering `false`. */
async function testChannel(id: unknown): Promise<{ ok: boolean; error?: string }> {
  const channel = pickDiscordChannel(typeof id === 'string' ? id : undefined)
  if (channel === null) return { ok: false, error: DISCORD_ERR.unset }
  return testDiscordWebhook(channel, { fetch: globalThis.fetch })
}

/** The four list doors, which all answer the same thing: what the list looks like NOW. */
function registerChannelIpc(): void {
  ipcMain.handle(IPC.discordListChannels, (): DiscordChannelsView => discordChannelsView())
  ipcMain.handle(IPC.discordRemoveChannel, (_e, id: unknown): DiscordChannelsView => {
    removeDiscordChannel(id)
    return discordChannelsView()
  })
  ipcMain.handle(IPC.discordRenameChannel, (_e, id: unknown, label: unknown): DiscordChannelsView => {
    // The CLAMP is main's (60 characters, `shared/discordChannels.ts`), so what comes back is what
    // was stored rather than what the renderer asked for.
    renameDiscordChannel(id, label)
    return discordChannelsView()
  })
  ipcMain.handle(IPC.discordSetDefaultChannel, (_e, id: unknown): DiscordChannelsView => {
    setDefaultDiscordChannel(id)
    return discordChannelsView()
  })
}

/** The connect attempt's three doors. The poll itself lives in main; see ../discordConnect.ts. */
function registerConnectIpc(): void {
  ipcMain.handle(IPC.discordConnectStart, async (): Promise<DiscordConnectStart> => {
    try {
      return await startDiscordConnect()
    } catch {
      logError('main:discordConnect', 'the Discord connect could not be started')
      return { ok: false, error: 'That could not be started. Try again.' }
    }
  })
  ipcMain.handle(IPC.discordConnectStatus, (): DiscordConnectStatus => discordConnectStatus())
  ipcMain.handle(IPC.discordConnectCancel, (): DiscordConnectStatus => cancelDiscordConnect())
}

export function registerDiscordIpc(): void {
  registerChannelIpc()
  registerConnectIpc()
  ipcMain.handle(IPC.discordGetWebhook, (): DiscordWebhookView => discordWebhookView())
  ipcMain.handle(IPC.discordSetWebhook, (_e, text: unknown): DiscordSetResult => saveWebhook(text))
  ipcMain.handle(IPC.discordClearWebhook, (): DiscordChannelsView => {
    clearDiscordWebhook()
    return discordChannelsView()
  })
  ipcMain.handle(IPC.discordTestChannel, async (_e, id: unknown) => {
    try {
      return await testChannel(id)
    } catch {
      // A FIXED string: the thrown value could carry the URL, and the URL is a secret.
      logError('main:discordWebhook', 'the webhook test failed')
      return { ok: false, error: DISCORD_ERR.offline }
    }
  })
  ipcMain.handle(IPC.discordPostProfile, async (_e, req: unknown) => {
    try {
      return await postProfile(req)
    } catch {
      logError('main:discordWebhook', 'the Discord post failed')
      return { ok: false, error: DISCORD_ERR.offline } satisfies DiscordPostProfileResult
    }
  })
}
