// storeDiscord.ts — THE DISCORD CHANNELS THIS INSTALL POSTS TO, main-process side
// (docs/plans/discord-webhook.md, docs/plans/discord-connect.md).
//
// The settings-accessor half of the feature, over the one open store. It lives here rather than
// beside the other accessors because `src/main/store.ts` is AT the repo's 400-code-line factoring
// ceiling and the house answer to that is a split, not a widened threshold (uiScale.ts,
// storeRespawn.ts, storeAchievements.ts and storeShareLinks.ts all came through this door).
//
// ---------------------------------------------------------------------------------------------
// IT IS A LIST NOW, AND THE OLD SINGLE WEBHOOK FOLDS INTO IT
// ---------------------------------------------------------------------------------------------
// 2026-09-10 shipped ONE webhook per install, because pasting one was already a chore and pasting
// three was unthinkable. 2026-09-11 replaced the pasting with Discord's own channel picker (owner:
// *"There's got to be a better way…"*), and the moment connecting a channel is two clicks, people
// have several: a guild channel, a friends channel, one of their own.
//
// SO NOBODY LOSES A WORKING SETUP. `foldLegacy` moves an existing `discordWebhook` record into the
// list the first time the list is read, labelled `Connected channel` (nobody ever told us which
// channel it is - inventing a name would be exactly the made-up value world-model law 1 forbids),
// and deletes the old key. It is idempotent by id, so it cannot double-add.
//
// NO SCHEMA BUMP. Both keys are additive and optional, and an absent one reads as the shipped
// behaviour: this install posts nowhere. That is the `shareLinks` / `discordWebhook` carve-out
// stated on the fields themselves - a store written by an older build loads here unchanged, and
// one written here still opens in a build that predates the feature.
//
// THE TOKENS ARE THE REASON THIS FILE HAS `View` FUNCTIONS AT ALL. Anyone holding one can post to
// that channel forever, so they are stored, read by exactly one caller (the post path), and
// stripped at the one place anything is handed to anybody: `discordChannelsView`. THE VIEW IS THE
// ONLY SHAPE THAT CROSSES IPC.
//
// AND WHAT IS READ BACK IS RE-VALIDATED. A store file is a file on a disk somebody else can also
// write to, so every record goes out through the same closed character classes it came in through
// (`shared/discordChannels.ts sanitizeChannel`) - the values are about to be concatenated into a
// request path, and "we wrote it, so it is fine" is not a property of a JSON file.

import { settingsStore } from './store'
import { isWebhookId, isWebhookToken, maskWebhook, type DiscordWebhookView } from '../shared/discordWebhook'
import {
  channelFromWebhook,
  channelsViewOf,
  clampChannelLabel,
  FOLDED_LABEL,
  MAX_CHANNELS,
  PASTED_LABEL,
  pickChannel,
  sanitizeChannel,
  type DiscordChannel,
  type DiscordChannelsView
} from '../shared/discordChannels'

export type { DiscordWebhookView, DiscordChannelsView }

/** The list. */
const CHANNELS_KEY = 'discordChannels'

/** …and which of them a post uses when the caller does not say. */
const DEFAULT_KEY = 'discordDefaultChannelId'

/** The key 2026-09-10 wrote. Read once, folded into the list, and deleted. */
const LEGACY_KEY = 'discordWebhook'

/** The stored list, RE-VALIDATED and de-duplicated by webhook id. See the header. */
function storedChannels(): DiscordChannel[] {
  const raw: unknown = settingsStore.get(CHANNELS_KEY)
  if (!Array.isArray(raw)) return []
  const now = Date.now()
  const out: DiscordChannel[] = []
  for (const item of raw) {
    if (out.length >= MAX_CHANNELS) break
    const channel = sanitizeChannel(item, now)
    if (channel !== null && !out.some((c) => c.id === channel.id)) out.push(channel)
  }
  return out
}

/** Write it, bounded. The one place the list leaves this process for the disk. */
function writeChannels(channels: readonly DiscordChannel[]): void {
  settingsStore.set(CHANNELS_KEY, channels.slice(0, MAX_CHANNELS))
}

/**
 * THE ONE-TIME FOLD of 2026-09-10's single webhook into the list (see the header).
 *
 * The legacy key is deleted whether or not anything was added, so this runs once in the life of an
 * install; adding is guarded by id, so a store where both existed cannot produce a duplicate.
 */
function foldLegacy(channels: DiscordChannel[]): DiscordChannel[] {
  const raw: unknown = settingsStore.get(LEGACY_KEY)
  if (!raw || typeof raw !== 'object') return channels
  const r = raw as Record<string, unknown>
  settingsStore.delete(LEGACY_KEY)
  if (!isWebhookId(r.id) || !isWebhookToken(r.token)) return channels
  if (channels.some((c) => c.id === r.id)) return channels
  const next = [...channels, channelFromWebhook({ id: r.id, token: r.token }, FOLDED_LABEL, Date.now())]
  writeChannels(next)
  return next
}

/** Every channel this install holds, tokens included. Main-side readers only. */
export function listDiscordChannels(): DiscordChannel[] {
  return foldLegacy(storedChannels())
}

/** The stored default's id, or undefined when there is none or it is not an id at all. */
function storedDefaultId(): string | undefined {
  const raw: unknown = settingsStore.get(DEFAULT_KEY)
  return isWebhookId(raw) ? raw : undefined
}

/** THE SHAPE THAT CROSSES IPC: labels and ids, never a token. See the header. */
export function discordChannelsView(): DiscordChannelsView {
  return channelsViewOf(listDiscordChannels(), storedDefaultId())
}

/**
 * WHICH CHANNEL A POST GOES TO: the one it named, else the default, else the only one, else none.
 * The decision itself is pure and lives in `shared/discordChannels.ts`, so a test can make it
 * without a store.
 */
export function pickDiscordChannel(wanted?: string): DiscordChannel | null {
  return pickChannel(listDiscordChannels(), storedDefaultId(), wanted)
}

/** Is this id one of ours? Guards the setters below, so a renderer string cannot invent a row. */
function hasChannel(channels: readonly DiscordChannel[], id: unknown): id is string {
  return typeof id === 'string' && channels.some((c) => c.id === id)
}

/**
 * Store one, REPLACING any row with the same webhook id (reconnecting the same channel is an
 * update, not a second row). The FIRST channel an install gets becomes the default, so somebody
 * who connects exactly one never meets the idea of a default at all.
 *
 * Answers false when the list is full: a silent drop would leave the user looking for a row that
 * is not there, and the caller turns this into a sentence.
 */
export function addDiscordChannel(channel: DiscordChannel): boolean {
  const channels = listDiscordChannels()
  const without = channels.filter((c) => c.id !== channel.id)
  if (without.length >= MAX_CHANNELS) return false
  const next = [...without, channel]
  writeChannels(next)
  if (storedDefaultId() === undefined) settingsStore.set(DEFAULT_KEY, channel.id)
  return true
}

/**
 * Forget one. The only way a token leaves this machine's store.
 *
 * If it was the default, the FIRST remaining channel takes over rather than the key being left
 * dangling: "no default, two channels" is the one state `pickChannel` refuses to guess at, and
 * arriving there by deleting a row would be this file's doing rather than the user's.
 */
export function removeDiscordChannel(id: unknown): boolean {
  const channels = listDiscordChannels()
  if (!hasChannel(channels, id)) return false
  const next = channels.filter((c) => c.id !== id)
  writeChannels(next)
  if (storedDefaultId() !== id) return true
  const heir = next[0]
  if (heir === undefined) settingsStore.delete(DEFAULT_KEY)
  else settingsStore.set(DEFAULT_KEY, heir.id)
  return true
}

/**
 * Rename one, clamped to what a row can hold. An empty or unusable label is REFUSED rather than
 * stored: a channel with no name at all is a dropdown row nobody can pick on purpose.
 */
export function renameDiscordChannel(id: unknown, label: unknown): boolean {
  const channels = listDiscordChannels()
  if (!hasChannel(channels, id)) return false
  const clamped = clampChannelLabel(label)
  if (clamped === '') return false
  writeChannels(channels.map((c) => (c.id === id ? { ...c, label: clamped } : c)))
  return true
}

/** Which channel a post uses when nobody says. Only an id this install actually holds. */
export function setDefaultDiscordChannel(id: unknown): boolean {
  if (!hasChannel(listDiscordChannels(), id)) return false
  settingsStore.set(DEFAULT_KEY, id)
  return true
}

// ------------------------------------------------------------ the manual door, folded in

/**
 * A pasted webhook is A CHANNEL LIKE ANY OTHER, labelled for what it is. Advanced keeps working
 * (a server where the user cannot authorize an app still has a webhook they can copy), and what it
 * produces lands in the same list, gets the same Test, Rename, Remove and Default, and posts the
 * same way. There is exactly one storage shape for "where this app can post".
 */
export function setDiscordWebhook(webhook: { id: string; token: string }): boolean {
  if (!isWebhookId(webhook.id) || !isWebhookToken(webhook.token)) return false
  return addDiscordChannel(channelFromWebhook(webhook, PASTED_LABEL, Date.now()))
}

/**
 * The compatibility door for 2026-09-10's Remove button: forget every channel that came from a
 * PASTE rather than from Discord's picker (they are the ones with no channel id, because nobody
 * ever told us which channel they point at). A connected channel is removed by its own row.
 */
export function clearDiscordWebhook(): void {
  settingsStore.delete(LEGACY_KEY)
  const channels = listDiscordChannels()
  const kept = channels.filter((c) => c.channelId !== '')
  if (kept.length === channels.length) return
  writeChannels(kept)
  if (!hasChannel(kept, storedDefaultId())) {
    const heir = kept[0]
    if (heir === undefined) settingsStore.delete(DEFAULT_KEY)
    else settingsStore.set(DEFAULT_KEY, heir.id)
  }
}

/**
 * THE LEGACY VIEW, still answered because two callers want exactly this one boolean: the share
 * dialog's button (`can this install post at all`) and the Preferences hydration snapshot. It is
 * derived from the LIST now - `set` is "there is somewhere to post", and `masked` describes the
 * channel a post with no channel named would actually go to.
 */
export function discordWebhookView(): DiscordWebhookView {
  const channel = pickDiscordChannel() ?? listDiscordChannels()[0]
  if (channel === undefined || channel === null) return { set: false }
  return { set: true, masked: maskWebhook(channel.id, channel.token) }
}
