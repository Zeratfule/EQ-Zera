// preload/discordApi.ts — POSTING A CHARACTER CARD TO A DISCORD CHANNEL, as one spread into `api`
// (owner, 2026-09-10; docs/plans/discord-webhook.md).
//
// Split out the way characterApi.ts and plannerApi.ts are: index.ts sits at its max-lines ceiling,
// and a feature with five doors is a file rather than five more lines there.
//
// THE TOKEN NEVER COMES BACK. `setWebhook` is the only method that carries the URL at all, and it
// carries it ONE WAY: main parses it, stores it, and answers a masked `DiscordWebhookView`. Every
// other method here answers a view, a boolean or a sentence, so nothing in the renderer - and
// therefore nothing in the DOM, a devtools panel or a crash report - can ever hold the secret that
// posts to somebody's channel.
//
// AND NOTHING HERE FETCHES. The renderer performs no network (`connect-src 'self'`); the post is
// main's, against a compiled-in origin that is dark under `EQ_E2E` (src/main/share/discord.ts).

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CharacterProfileShare } from '../shared/characterShare'
import type { CardMapEntry } from '../shared/shareCardMap'
import type { DiscordWebhookView } from '../shared/discordWebhook'
import type { ShareCardRect } from './characterApi'

/** What main says about the stored webhook. `masked` is for showing, never for using. */
export type { DiscordWebhookView }

/** What `discord:setWebhook` answers: the new view, or the reason the paste was refused. */
export type DiscordSetResult = { ok: true; view: DiscordWebhookView } | { ok: false; error: string }

/** What `discord:postProfile` answers. `url` is the link the posted message points at. */
export type DiscordPostResult = { ok: true; url: string } | { ok: false; error: string }

export const discordApi = {
  /** The masked view of the stored channel webhook. `{set:false}` when this install has none. */
  getDiscordWebhook: (): Promise<DiscordWebhookView> => ipcRenderer.invoke(IPC.discordGetWebhook),
  /** Store a pasted webhook URL. PARSED IN MAIN - a string that is not one is refused in words. */
  setDiscordWebhook: (text: string): Promise<DiscordSetResult> =>
    ipcRenderer.invoke(IPC.discordSetWebhook, text),
  /** Forget it, and hand back the now-empty view. */
  clearDiscordWebhook: (): Promise<DiscordWebhookView> => ipcRenderer.invoke(IPC.discordClearWebhook),
  /** Post one plain line to the channel, so a freshly pasted URL can be watched landing. */
  testDiscordWebhook: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.discordTestWebhook),
  /**
   * Publish the card at `rect` as a share link - the same publish Copy link performs, same
   * arguments, same main-side function - and post an embed wrapping it to the stored webhook.
   */
  postCharacterToDiscord: (
    rect: ShareCardRect,
    profile: CharacterProfileShare,
    cardMap?: readonly CardMapEntry[]
  ): Promise<DiscordPostResult> =>
    ipcRenderer.invoke(IPC.discordPostProfile, { rect, profile, cardMap })
}
