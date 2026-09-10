// ---- posting a character card to Discord (docs/plans/discord-webhook.md) ----
//
// The owner's ask, 2026-09-10: *"we should also develope a way to export your character profile
// directly to a chat in Discord."* The agreed shape is a CHANNEL WEBHOOK the user makes and
// pastes in — no bot, no OAuth, no server of ours — so this file is small on purpose: the URL
// rules are in `shared/discordWebhook.ts`, the outbound origin is `share/discord.ts`, the storage
// is `storeDiscord.ts`, and what is left here is the four settings doors and the one post.
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
// THE TOKEN NEVER REACHES THE RENDERER, IN EITHER DIRECTION
// ---------------------------------------------------------------------------
// It arrives once, as text on `discord:setWebhook`, is parsed here and stored main-side. Every
// reply on every channel in this file is a `DiscordWebhookView` (`{set, masked?}`), a boolean or
// a sentence. Nothing here logs the URL — see `share/discord.ts` header item 6 — which is also
// why the `catch` blocks below log a FIXED string and never the thrown value's message.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { discordEmbedFor, parseDiscordWebhook } from '../../shared/discordWebhook'
import { sanitizeCharacterShare } from '../../shared/characterShare'
import { logError } from '../errorLog'
import {
  DISCORD_ERR,
  discordEndpointConfigured,
  postDiscordWebhook,
  testDiscordWebhook
} from '../share/discord'
import { cardUrlFor } from '../share/net'
import {
  clearDiscordWebhook,
  discordWebhookView,
  getDiscordWebhook,
  setDiscordWebhook,
  type DiscordWebhookView
} from '../storeDiscord'
import { publishCharacterLink } from './characterShare'

/** What `discord:setWebhook` answers: the new view, or the reason it was refused. */
export type DiscordSetResult = { ok: true; view: DiscordWebhookView } | { ok: false; error: string }

/** What `discord:postProfile` answers. `url` is the link the message points at. */
export type DiscordPostProfileResult = { ok: true; url: string } | { ok: false; error: string }

/** The one sentence a badly pasted URL gets. It says what a GOOD one looks like, in one clause. */
const BAD_URL =
  'That is not a Discord webhook URL. In Discord: channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL.'

/** Store a pasted URL, or refuse it in words. The renderer never decides whether one is legal. */
function saveWebhook(raw: unknown): DiscordSetResult {
  const parsed = parseDiscordWebhook(raw)
  if (parsed === null) return { ok: false, error: BAD_URL }
  setDiscordWebhook(parsed)
  return { ok: true, view: discordWebhookView() }
}

/**
 * Publish the card as a link the way Copy link does, then post an embed wrapping it.
 *
 * THE DARK GATE IS FIRST, before anything is photographed or published: under `EQ_E2E` there is no
 * Discord endpoint at all, and a build that cannot deliver the message must not do the work of
 * building one - least of all publish a real share record on the way to not sending it.
 */
async function postProfile(req: unknown): Promise<DiscordPostProfileResult> {
  if (!discordEndpointConfigured()) return { ok: false, error: DISCORD_ERR.dark }
  const webhook = getDiscordWebhook()
  if (webhook === null) return { ok: false, error: DISCORD_ERR.unset }
  const request = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>
  // The renderer's profile is untrusted at the handler like every other one (this file's
  // siblings say so at length), and the embed reads NAME, LEVEL, CLASSES and SCORES off it.
  const profile = sanitizeCharacterShare(request.profile)
  if (profile === null) return { ok: false, error: 'There is nothing in that profile to share.' }
  const published = await publishCharacterLink(req)
  if (!published.ok) return { ok: false, error: published.error }
  const body = discordEmbedFor(profile, published.url, cardUrlFor(published.id, Date.now()))
  const posted = await postDiscordWebhook(webhook, body, { fetch: globalThis.fetch })
  if (!posted.ok) return { ok: false, error: posted.error }
  return { ok: true, url: published.url }
}

/** The Test button. Refuses in words when there is nothing stored, rather than answering `false`. */
async function testWebhook(): Promise<{ ok: boolean; error?: string }> {
  const webhook = getDiscordWebhook()
  if (webhook === null) return { ok: false, error: DISCORD_ERR.unset }
  return testDiscordWebhook(webhook, { fetch: globalThis.fetch })
}

export function registerDiscordIpc(): void {
  ipcMain.handle(IPC.discordGetWebhook, (): DiscordWebhookView => discordWebhookView())
  ipcMain.handle(IPC.discordSetWebhook, (_e, text: unknown): DiscordSetResult => saveWebhook(text))
  ipcMain.handle(IPC.discordClearWebhook, (): DiscordWebhookView => {
    clearDiscordWebhook()
    return discordWebhookView()
  })
  ipcMain.handle(IPC.discordTestWebhook, async () => {
    try {
      return await testWebhook()
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
