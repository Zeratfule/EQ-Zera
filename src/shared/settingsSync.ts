// shared/settingsSync.ts — "send my settings to my other PC", as a CONTRACT both sides can read.
//
// The feature: PC A encrypts its own settings bundle, uploads only the ciphertext, and shows a
// TRANSFER CODE; PC B types the code, downloads, decrypts locally, and imports through the
// existing additive merge (src/shared/profiles.ts). The service stores bytes it cannot read - the
// key never leaves the two machines, because it rides in the code the user carries across the room.
//
// THIS FILE IS PURE AND HOLDS THE THREE THINGS BOTH SURFACES NEED:
//
//  1. THE SENTENCES, IN ONE PLACE. Every failure a user can meet is a short plain sentence here
//     rather than at each call site - the reason `share/links.ts` keeps its own `ERR` table, and
//     the reason this one is SHARED rather than main-private: the Sync card shows the dark-build
//     sentence without asking main anything, so the two spellings cannot drift.
//  2. THE RESULT SHAPES THAT CROSS IPC. They are named here so the preload, the handler and the
//     card are all typed against the same object, and so it is visible in one place that NOTHING
//     secret is in any of them: a receive answers a `SharePreview` plus a COUNT of Discord
//     channels, never the channels themselves (their webhook tokens are credentials).
//  3. THE ONE SIZE BOUND the service states, so the app refuses an oversized bundle before it
//     spends a request on it.
//
// It is NOT where the crypto lives (src/main/share/syncCrypto.ts needs node:crypto) and not where
// the round trips live (src/main/share/sync.ts). The renderer bundles this module, so nothing here
// may import a Node built-in.

import type { SharePreview } from './profiles'

/** The plaintext envelope's version. A receiver refuses anything else rather than guessing. */
export const SYNC_PAYLOAD_VERSION = 1

/**
 * Longest ciphertext the service will store, DECODED (the server contract's 512 KB). Checked
 * app-side too: a bundle that cannot possibly be stored should cost nobody a round trip, and the
 * user gets the same sentence either way.
 */
export const MAX_SYNC_BLOB_BYTES = 512 * 1024

/**
 * How long a code lives, as the service states it. A NUMBER here and a sentence below, because the
 * two must agree and only one of them can be read by a person.
 */
export const SYNC_CODE_HOURS = 24

// ------------------------------------------------------------------------------- the sentences
//
// SHORT, PLAIN, AND ABOUT THE READER'S SITUATION (AGENTS.md UI conventions: state, never process).
// None of them names a status code, a host or a verb. `expired` carries the lifetime because "not
// valid any more" invites exactly one question and answering it costs four words.

export const SYNC_ERROR = {
  dark: 'This build cannot sync settings.',
  offline: 'The sync service could not be reached.',
  busy: 'Too many transfers just now - try again in a minute.',
  tooBig: 'Those settings are too large to send.',
  refused: 'The sync service would not store those settings.',
  badReply: 'The sync service answered something this app could not read.',
  expired: `That code is not valid any more. Codes work for ${String(SYNC_CODE_HOURS)} hours.`,
  badCode: 'That does not look like a transfer code.',
  undecryptable: 'That code does not match this transfer.',
  empty: 'There was nothing in that transfer to import.'
} as const

/**
 * What the Send card says under the code. BOTH HALVES ARE LOAD-BEARING: the lifetime, so nobody
 * saves a code for next week, and the warning, because the code IS the key - anyone holding it can
 * read the bundle, which is why the intended audience is the user's own second machine.
 */
export const SYNC_CODE_NOTICE =
  `Codes work for ${String(SYNC_CODE_HOURS)} hours. Anyone with the code can import these settings, ` +
  'so share it only with yourself.'

/** Why the Discord box is off by default, said where the box is. */
export const SYNC_DISCORD_NOTICE =
  'Off by default: a connected channel is a credential, so it travels only when you say so.'

// ------------------------------------------------------------------- what crosses the boundary

/** A successful send: the code the user carries, and when it stops working. */
export interface SyncSendOk {
  ok: true
  /** `<service code>-<key>` - see `formatTransferCode`. The KEY half never reaches the service. */
  code: string
  /** ISO instant, as the service stated it. Provenance for the card's caption, never trusted. */
  expiresAt: string
}

export type SyncSendResult = SyncSendOk | { ok: false; error: string }

/**
 * A successful receive, AS THE RENDERER SEES IT: the same preview the paste-box import renders,
 * plus how many Discord channels rode along. A COUNT rather than the channels, because a channel
 * carries the webhook token that posts to somebody's server (src/main/storeDiscord.ts's law) and
 * nothing about drawing "2 Discord channels" needs one.
 */
export interface SyncReceiveOk {
  ok: true
  preview: SharePreview
  /** absent when the sender did not include them */
  discordChannels?: number
}

export type SyncReceiveResult = SyncReceiveOk | { ok: false; error: string }

/** What an apply did. `ui` is the localStorage writes the renderer must perform (share.ts's law). */
export interface SyncApplyOk {
  ok: true
  added: number
  skipped: number
  rekeyed: number
  scalarsApplied: number
  ui: Record<string, string>
  /** how many Discord channels were actually stored - never more than the user confirmed */
  channelsAdded: number
}

export type SyncApplyResult = SyncApplyOk | { ok: false; error: string }
