// preload/discordApi.ts — POSTING A CHARACTER CARD TO A DISCORD CHANNEL, as one spread into `api`
// (owner, 2026-09-10 and 2026-09-11; docs/plans/discord-connect.md).
//
// Split out the way characterApi.ts and plannerApi.ts are: index.ts sits at its max-lines ceiling,
// and a feature with a dozen doors is a file rather than a dozen more lines there.
//
// NO TOKEN EVER COMES BACK. `setDiscordWebhook` is the only method that carries a webhook URL at
// all, and it carries it ONE WAY: main parses it, stores it, and answers views. Everything else
// here answers a `DiscordChannelsView` (ids, labels, dates), a masked `DiscordWebhookView`, a
// status word or a sentence - so nothing in the renderer, and therefore nothing in the DOM, a
// devtools panel or a crash report, can ever hold the secret that posts to somebody's channel.
//
// AND NOTHING HERE FETCHES, INCLUDING THE CONNECT POLL. The renderer performs no network
// (`connect-src 'self'`); `connectStatus` asks MAIN how main's own poll is going. The browser is
// opened by main too (src/main/share/discordConnect.ts), against a compiled-in origin that is dark
// under `EQ_E2E`.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CharacterProfileShare } from '../shared/characterShare'
import type { CardMapEntry } from '../shared/shareCardMap'
import type { DiscordWebhookView } from '../shared/discordWebhook'
import type { DiscordChannelsView } from '../shared/discordChannels'
import type { FightShare } from '../shared/fightShare'
import type { SessionShare } from '../shared/sessionShare'
import type { CharacterShareImageResult, ShareCardRect } from './characterApi'

/** What main says about the stored channels. Labels and ids, never a token. */
export type { DiscordWebhookView, DiscordChannelsView }

/** How a connect attempt is going. `label` is the channel that just arrived; never a webhook. */
export interface DiscordConnectStatus {
  state: 'idle' | 'waiting' | 'done' | 'failed' | 'cancelled'
  label?: string
  error?: string
}

/** What `discord:setWebhook` answers: both views, or the reason the paste was refused. */
export type DiscordSetResult =
  | { ok: true; view: DiscordWebhookView; channels: DiscordChannelsView }
  | { ok: false; error: string }

/** What `discord:postFight` answers. Nothing to say on success - the fight is in the channel. */
export type DiscordPostFightResult = { ok: true } | { ok: false; error: string }

/** …and what `discord:postSession` answers, for the same reason and in the same shape. */
export type DiscordPostSessionResult = { ok: true } | { ok: false; error: string }

/** What `discord:postProfile` answers. `url` is the link the posted message points at. */
export type DiscordPostResult = { ok: true; url: string } | { ok: false; error: string }

export const discordApi = {
  /**
   * CONNECT A CHANNEL: main mints a state, opens the user's browser on the share service, and
   * starts polling. Discord's own page asks which server and which channel; nothing is pasted.
   */
  connectDiscordChannel: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.discordConnectStart),
  /** How that is going. The card polls this while it waits, and main keeps waiting either way. */
  discordConnectStatus: (): Promise<DiscordConnectStatus> =>
    ipcRenderer.invoke(IPC.discordConnectStatus),
  /** Stop waiting. Whatever arrives afterwards is not stored. */
  cancelDiscordConnect: (): Promise<DiscordConnectStatus> =>
    ipcRenderer.invoke(IPC.discordConnectCancel),
  /** The channels this install holds - ids, labels, dates, and which one is the default. */
  listDiscordChannels: (): Promise<DiscordChannelsView> => ipcRenderer.invoke(IPC.discordListChannels),
  /** Forget one, and hand back what is left. */
  removeDiscordChannel: (id: string): Promise<DiscordChannelsView> =>
    ipcRenderer.invoke(IPC.discordRemoveChannel, id),
  /** Rename one. CLAMPED IN MAIN, so the reply is what was stored rather than what was asked. */
  renameDiscordChannel: (id: string, label: string): Promise<DiscordChannelsView> =>
    ipcRenderer.invoke(IPC.discordRenameChannel, id, label),
  /** Which channel a post with no channel named goes to. */
  setDefaultDiscordChannel: (id: string): Promise<DiscordChannelsView> =>
    ipcRenderer.invoke(IPC.discordSetDefaultChannel, id),
  /** The masked view of where a post would go. `{set:false}` when this install has nowhere. */
  getDiscordWebhook: (): Promise<DiscordWebhookView> => ipcRenderer.invoke(IPC.discordGetWebhook),
  /** Advanced: store a pasted webhook URL as one more channel. PARSED IN MAIN - a string that is
   *  not one is refused in words. */
  setDiscordWebhook: (text: string): Promise<DiscordSetResult> =>
    ipcRenderer.invoke(IPC.discordSetWebhook, text),
  /** Forget every PASTED webhook. A connected channel is removed by its own row. */
  clearDiscordWebhook: (): Promise<DiscordChannelsView> => ipcRenderer.invoke(IPC.discordClearWebhook),
  /** Post one plain line to one channel, so a freshly connected one can be watched landing. */
  testDiscordChannel: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.discordTestChannel, id),
  /**
   * Publish the card at `rect` as a share link - the same publish Copy link performs, same
   * arguments, same main-side function - and post an embed wrapping it to `channelId`, or to the
   * default when the dialog does not name one.
   */
  postCharacterToDiscord: (
    rect: ShareCardRect,
    profile: CharacterProfileShare,
    cardMap?: readonly CardMapEntry[],
    channelId?: string
  ): Promise<DiscordPostResult> =>
    ipcRenderer.invoke(IPC.discordPostProfile, { rect, profile, cardMap, channelId }),
  /**
   * Post ONE FIGHT to a channel: the fight card at `rect`, photographed by main and ATTACHED to
   * the message, plus an embed carrying the same numbers as text (owner, 2026-09-11).
   *
   * NOTHING IS PUBLISHED. Unlike a character card there is no share page behind this, no link and
   * nothing left serving afterwards - the bytes ride inside the post and Discord keeps them as
   * that message's own attachment. `fight` is re-validated at the handler like every other body
   * the renderer composes.
   */
  postFightToDiscord: (rect: ShareCardRect, fight: FightShare, channelId?: string): Promise<DiscordPostFightResult> =>
    ipcRenderer.invoke(IPC.discordPostFight, { rect, fight, channelId }),
  /** Photograph the fight card at `rect` and either copy it or save it. `name` seeds the file name. */
  shareFightImage: (rect: ShareCardRect, op: 'copy' | 'save', name?: string): Promise<CharacterShareImageResult> =>
    ipcRenderer.invoke(IPC.combatShareImage, { rect, op, name }),
  /**
   * Post ONE PLAY SESSION to a channel: the session card at `rect`, photographed by main and
   * ATTACHED to the message, plus an embed carrying the same numbers as text.
   *
   * `postFightToDiscord`'s twin in every respect that matters - nothing is published, there is no
   * link and nothing is left serving afterwards, and `session` is re-validated at the handler like
   * every other body the renderer composes.
   */
  postSessionToDiscord: (
    rect: ShareCardRect,
    session: SessionShare,
    channelId?: string
  ): Promise<DiscordPostSessionResult> =>
    ipcRenderer.invoke(IPC.discordPostSession, { rect, session, channelId }),
  /** Photograph the session card at `rect` and either copy it or save it. Its own channel rather
   *  than the fight's for one reason: the default FILE NAME (src/main/ipc/sessionShare.ts). */
  shareSessionImage: (rect: ShareCardRect, op: 'copy' | 'save', name?: string): Promise<CharacterShareImageResult> =>
    ipcRenderer.invoke(IPC.sessionShareImage, { rect, op, name })
}
