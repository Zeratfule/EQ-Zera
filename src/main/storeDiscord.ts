// storeDiscord.ts — THE DISCORD CHANNEL WEBHOOK, main-process side (docs/plans/discord-webhook.md).
//
// The settings-accessor half of the feature, over the one open store. It lives here rather than
// beside the other accessors because `src/main/store.ts` is AT the repo's 400-code-line factoring
// ceiling and the house answer to that is a split, not a widened threshold (uiScale.ts,
// storeRespawn.ts, storeAchievements.ts and storeShareLinks.ts all came through this door). What
// stayed behind is the only thing that could not move: `discordWebhook`'s place in `StoreShape`.
//
// NO SCHEMA BUMP. The key is additive and optional, and an absent one reads as the shipped
// behaviour: this install posts nowhere. That is the `shareLinks` / `respawn` carve-out stated on
// the field itself - a store written by an older build loads here unchanged, and one written here
// still opens in a build that predates the feature, because electron-store rewrites the whole
// parsed object and every reader defaults on a missing key.
//
// THE TOKEN IS THE REASON THIS FILE HAS A `View` FUNCTION AT ALL. Anyone holding it can post to
// that channel forever, so it is stored, it is read by exactly one caller (the post path), and it
// is stripped at the one place anything is handed to anybody: `discordWebhookView`. THE VIEW IS
// THE ONLY SHAPE THAT CROSSES IPC. Nothing else in main should read `.token` except
// `src/main/ipc/discord.ts`, which is why the getter is separate from the view.
//
// AND WHAT IS READ BACK IS RE-VALIDATED. A store file is a file on a disk somebody else can also
// write to, so the record goes out through the same closed character classes it came in through
// (`shared/discordWebhook.ts`) - the value is about to be concatenated into a request path, and
// "we wrote it, so it is fine" is not a property of a JSON file.

import { settingsStore } from './store'
import {
  isWebhookId,
  isWebhookToken,
  maskWebhook,
  type DiscordWebhook,
  type DiscordWebhookView
} from '../shared/discordWebhook'

export type { DiscordWebhookView }

/** The stored webhook, re-validated on the way out. A record that does not survive is `null`. */
export function getDiscordWebhook(): DiscordWebhook | null {
  const raw: unknown = settingsStore.get('discordWebhook')
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isWebhookId(r.id) || !isWebhookToken(r.token)) return null
  return { id: r.id, token: r.token }
}

/** Store one, REPLACING whatever was there. One webhook per install: one channel to post to. */
export function setDiscordWebhook(webhook: DiscordWebhook): void {
  if (!isWebhookId(webhook.id) || !isWebhookToken(webhook.token)) return
  settingsStore.set('discordWebhook', { id: webhook.id, token: webhook.token })
}

/** Forget it. What the Remove button does, and the only way the token leaves this machine's store. */
export function clearDiscordWebhook(): void {
  settingsStore.delete('discordWebhook')
}

/** The one shape that crosses IPC. See the header. */
export function discordWebhookView(): DiscordWebhookView {
  const hook = getDiscordWebhook()
  if (hook === null) return { set: false }
  return { set: true, masked: maskWebhook(hook.id, hook.token) }
}
