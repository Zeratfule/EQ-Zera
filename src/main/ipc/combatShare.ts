// ---- sharing a FIGHT: the card, and the Discord post (owner, 2026-09-11) ----
//
// The owner's ask: *"We should also make the Discord sharing be able to have DPS meter sharing
// also."* Two handlers, and they are deliberately the character feature's two handlers again:
//
//   `combat:shareImage`  photograph the fight card and copy or save it
//   `discord:postFight`  photograph it and post it INTO a channel, with the numbers beside it
//
// ---------------------------------------------------------------------------
// IT REUSES THE CAPTURE PATH; IT DOES NOT REIMPLEMENT IT
// ---------------------------------------------------------------------------
// Both handlers reach `capturePage` through `./cardCapture.ts`, which is where the character
// card's screenshot moved when this one arrived. One validation of a renderer-supplied rectangle,
// one zoom multiply, one clamp, one pair of sentences. A second screenshot would have been a
// second opinion about how a CSS rectangle becomes device-independent pixels, and the copy nobody
// was looking at is the one that would have shipped cropped at a non-default text size.
//
// ---------------------------------------------------------------------------
// THE FIGHT IS UNTRUSTED INPUT, AND IT IS RE-VALIDATED HERE
// ---------------------------------------------------------------------------
// `FightShare` is composed in the RENDERER (it is the same object the card drew, so what is posted
// is what was shown) and every number and string in it is re-checked at this handler by
// `sanitizeFightShare` before a byte reaches a socket - the discipline this file's siblings state
// at length, and the reason it is `sanitize*` in `src/shared/` rather than a cast here.
//
// ---------------------------------------------------------------------------
// A CAPTURE THAT FAILED STILL POSTS
// ---------------------------------------------------------------------------
// The picture is the garnish; the numbers are the message. A dialog that scrolled away, a window
// that is not there, a capture that came back empty - all of those post the EMBED ALONE rather
// than refusing, and the embed is built knowing which of the two it is (`discordFightEmbed`'s
// `cardAttached`), so it never names an attachment that did not travel.
//
// NOTHING HERE LOGS A WEBHOOK. Same rule as its sibling (src/main/share/discord.ts header item 6):
// the `catch` logs a FIXED string, never the thrown value, because a thrown value can carry a URL.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  FIGHT_CARD_FILE,
  FIGHT_CARD_TYPE,
  discordFightEmbed,
  sanitizeFightShare,
  type FightShare
} from '../../shared/fightShare'
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

/** What `discord:postFight` answers. There is nothing to say on success - it is in the channel. */
export type DiscordPostFightResult = { ok: true } | { ok: false; error: string }

/** The one sentence a request carrying no readable fight gets. */
const NOTHING_TO_SHARE = 'There is nothing in that fight to share.'

/**
 * The save dialog's default file name for a fight card.
 *
 * `shareImageName`'s twin (src/main/characterShare.ts) and deliberately the same shape: anything
 * that is not a plain name character becomes a dash, because this string reaches a save dialog's
 * default path and the renderer supplied it.
 */
export function fightImageName(name: string): string {
  const day = new Date().toISOString().slice(0, 10)
  const stem = name
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `eq-zera-fight-${stem || 'meter'}-${day}.png`
}

/** The captured card as the file a post attaches, or null when there is nothing postable. */
function fightCardFile(image: Electron.NativeImage | null): DiscordPostFile | null {
  if (!image || image.isEmpty()) return null
  const file: DiscordPostFile = {
    name: FIGHT_CARD_FILE,
    bytes: new Uint8Array(image.toPNG()),
    type: FIGHT_CARD_TYPE
  }
  // ASKED BEFORE THE EMBED IS BUILT, which is the whole point of the predicate living in the
  // transport: the decision to attach and the decision to SAY the message has an attachment are
  // one decision, made once, here.
  return isPostableFile(file) ? file : null
}

/** Post one fight, with its card when there is one and without it when there is not. */
function sendFight(
  channel: Parameters<typeof postDiscordWebhook>[0],
  fight: FightShare,
  file: DiscordPostFile | null
): Promise<{ ok: boolean; error?: string }> {
  const deps = { fetch: globalThis.fetch }
  const body = discordFightEmbed(fight, file !== null)
  if (file === null) return postDiscordWebhook(channel, body, deps)
  return postDiscordWebhookWithFile(channel, body, file, deps)
}

/**
 * Photograph the fight card and post it, or say in one sentence why not.
 *
 * THE DARK GATE IS FIRST, before anything is photographed: under `EQ_E2E` there is no Discord
 * endpoint at all, and a build that cannot deliver the message must not do the work of building
 * one. WHICH CHANNEL is `storeDiscord.ts`'s decision from the id the dialog named, the default, or
 * the fact that there is only one - a request naming a channel this install does not hold reads as
 * "not connected" rather than falling back to another server's channel.
 */
async function postFight(req: unknown): Promise<DiscordPostFightResult> {
  if (!discordEndpointConfigured()) return { ok: false, error: DISCORD_ERR.dark }
  const request = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>
  const wanted = typeof request.channelId === 'string' ? request.channelId : undefined
  const channel = pickDiscordChannel(wanted)
  if (channel === null) return { ok: false, error: DISCORD_ERR.unset }
  const fight = sanitizeFightShare(request.fight)
  if (fight === null) return { ok: false, error: NOTHING_TO_SHARE }
  const file = fightCardFile(await captureCard(request.rect))
  const posted = await sendFight(channel, fight, file)
  return posted.ok ? { ok: true } : { ok: false, error: posted.error ?? DISCORD_ERR.refused }
}

export function registerCombatShareIpc(): void {
  ipcMain.handle(IPC.combatShareImage, async (_e, req: unknown) => {
    try {
      return await shareCardImage(req, fightImageName)
    } catch (err) {
      logError('main:combatShareImage', err)
      return { ok: false, error: CARD_NOT_CAPTURED } satisfies CardImageResult
    }
  })
  ipcMain.handle(IPC.discordPostFight, async (_e, req: unknown) => {
    try {
      return await postFight(req)
    } catch {
      // A FIXED string: the thrown value could carry the webhook URL, and that is a secret.
      logError('main:discordWebhook', 'the Discord fight post failed')
      return { ok: false, error: DISCORD_ERR.offline } satisfies DiscordPostFightResult
    }
  })
}
