// ---- sharing a PLAY SESSION: the card, and the Discord post ----
//
// The Overview's "Last session" card answers what last night was worth; these two handlers are how
// that answer leaves the app. They are deliberately the FIGHT feature's two handlers again
// (./combatShare.ts), line for line where the logic is the same:
//
//   `session:shareImage`   photograph the session card and copy or save it
//   `discord:postSession`  photograph it and post it INTO a channel, with the numbers beside it
//
// ---------------------------------------------------------------------------
// IT REUSES THE CAPTURE PATH; IT DOES NOT REIMPLEMENT IT
// ---------------------------------------------------------------------------
// Both handlers reach `capturePage` through `./cardCapture.ts` - one validation of a
// renderer-supplied rectangle, one zoom multiply, one clamp, one pair of sentences. A third
// screenshot would have been a third opinion about how a CSS rectangle becomes device-independent
// pixels, and the copy nobody was looking at is the one that would ship cropped.
//
// WHAT IS NOT SHARED IS THE FILE NAME, and that is the whole reason `session:shareImage` exists
// beside `combat:shareImage`: a night's play saved as `eq-zera-fight-…png` is a file the user has
// to rename, and the name is the caller's by `shareCardImage`'s own design.
//
// ---------------------------------------------------------------------------
// THE SESSION IS UNTRUSTED INPUT, AND IT IS RE-VALIDATED HERE
// ---------------------------------------------------------------------------
// `SessionShare` is composed in the RENDERER (it is the same object the card drew, so what is
// posted is what was shown) and every number and string in it is re-checked at this handler by
// `sanitizeSessionShare` before a byte reaches a socket.
//
// ---------------------------------------------------------------------------
// A CAPTURE THAT FAILED STILL POSTS
// ---------------------------------------------------------------------------
// The picture is the garnish; the numbers are the message. A dialog that scrolled away, a window
// that is not there, a capture that came back empty - all of those post the EMBED ALONE rather than
// refusing, and the embed is built knowing which of the two it is (`discordSessionEmbed`'s
// `cardAttached`), so it never names an attachment that did not travel.
//
// NOTHING HERE LOGS A WEBHOOK. Same rule as its siblings: the `catch` logs a FIXED string, never
// the thrown value, because a thrown value can carry a URL.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  SESSION_CARD_FILE,
  SESSION_CARD_TYPE,
  discordSessionEmbed,
  sanitizeSessionShare,
  type SessionShare
} from '../../shared/sessionShare'
import { logError } from '../errorLog'
import {
  DISCORD_ERR,
  discordEndpointConfigured,
  isPostableFile,
  postDiscordWebhook,
  postDiscordWebhookWithFile,
  type DiscordPostFile
} from '../share/discord'
import { pickDiscordChannel } from '../storeDiscord'
import { CARD_NOT_CAPTURED, captureCard, shareCardImage, type CardImageResult } from './cardCapture'

/** What `discord:postSession` answers. There is nothing to say on success - it is in the channel. */
export type DiscordPostSessionResult = { ok: true } | { ok: false; error: string }

/** The one sentence a request carrying no readable session gets. */
const NOTHING_TO_SHARE = 'There is nothing in that session to share.'

/**
 * The save dialog's default file name for a session card.
 *
 * `fightImageName`'s twin and deliberately the same shape: anything that is not a plain name
 * character becomes a dash, because this string reaches a save dialog's default path and the
 * renderer supplied it.
 */
export function sessionImageName(name: string): string {
  const day = new Date().toISOString().slice(0, 10)
  const stem = name
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `eq-zera-session-${stem || 'play'}-${day}.png`
}

/** The captured card as the file a post attaches, or null when there is nothing postable. */
function sessionCardFile(image: Electron.NativeImage | null): DiscordPostFile | null {
  if (!image || image.isEmpty()) return null
  const file: DiscordPostFile = {
    name: SESSION_CARD_FILE,
    bytes: new Uint8Array(image.toPNG()),
    type: SESSION_CARD_TYPE
  }
  // ASKED BEFORE THE EMBED IS BUILT: the decision to attach and the decision to SAY the message has
  // an attachment are one decision, made once, here.
  return isPostableFile(file) ? file : null
}

/** Post one session, with its card when there is one and without it when there is not. */
function sendSession(
  channel: Parameters<typeof postDiscordWebhook>[0],
  session: SessionShare,
  file: DiscordPostFile | null
): Promise<{ ok: boolean; error?: string }> {
  const deps = { fetch: globalThis.fetch }
  const body = discordSessionEmbed(session, file !== null)
  if (file === null) return postDiscordWebhook(channel, body, deps)
  return postDiscordWebhookWithFile(channel, body, file, deps)
}

/**
 * Photograph the session card and post it, or say in one sentence why not.
 *
 * THE DARK GATE IS FIRST, before anything is photographed: under `EQ_E2E` there is no Discord
 * endpoint at all, and a build that cannot deliver the message must not do the work of building
 * one. WHICH CHANNEL is `storeDiscord.ts`'s decision from the id the dialog named, the default, or
 * the fact that there is only one.
 */
async function postSession(req: unknown): Promise<DiscordPostSessionResult> {
  if (!discordEndpointConfigured()) return { ok: false, error: DISCORD_ERR.dark }
  const request = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>
  const wanted = typeof request.channelId === 'string' ? request.channelId : undefined
  const channel = pickDiscordChannel(wanted)
  if (channel === null) return { ok: false, error: DISCORD_ERR.unset }
  const session = sanitizeSessionShare(request.session)
  if (session === null) return { ok: false, error: NOTHING_TO_SHARE }
  const file = sessionCardFile(await captureCard(request.rect))
  const posted = await sendSession(channel, session, file)
  return posted.ok ? { ok: true } : { ok: false, error: posted.error ?? DISCORD_ERR.refused }
}

export function registerSessionShareIpc(): void {
  ipcMain.handle(IPC.sessionShareImage, async (_e, req: unknown) => {
    try {
      return await shareCardImage(req, sessionImageName)
    } catch (err) {
      logError('main:sessionShareImage', err)
      return { ok: false, error: CARD_NOT_CAPTURED } satisfies CardImageResult
    }
  })
  ipcMain.handle(IPC.discordPostSession, async (_e, req: unknown) => {
    try {
      return await postSession(req)
    } catch {
      // A FIXED string: the thrown value could carry the webhook URL, and that is a secret.
      logError('main:discordWebhook', 'the Discord session post failed')
      return { ok: false, error: DISCORD_ERR.offline } satisfies DiscordPostSessionResult
    }
  })
}
