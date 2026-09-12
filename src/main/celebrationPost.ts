// celebrationPost.ts — main's half of "post celebrations to Discord": the WIRING, and nothing else.
//
// THE DECISIONS ARE IN `shared/celebrationPost.ts` (which kinds are postable, what the embed says,
// how the queue spaces and deduplicates). This file supplies the four things only main has — the
// store, the channel list, the transport and a real timer — and owns the ONE call site that turns a
// card on screen into a message in a channel.
//
// ONE HOP OFF THE OVERLAY SEND. Every celebration card in this app reaches the overlay through
// `sendToToastOverlay` (src/main/toast.ts), so that is where this hangs: renderer-built cards,
// main-built cards and anything added later all pass it, and a second producer-side hook would be a
// second answer to "what counts as a celebration". The hook is FIRE-AND-FORGET and wrapped, because
// the overlay send is the feature the user is actually looking at and a Discord problem must never
// be allowed to cost them a card.
//
// NOTHING HERE THROWS AND NOTHING HERE LOGS A TOKEN. The transport already promises both
// (src/main/share/discord.ts items 5 and 6); what this file adds is that a failure becomes ONE
// SENTENCE held in memory and handed to the Preferences card through the view. It is deliberately
// NOT persisted: a stale error from three sessions ago is not news, and the next card either
// reproduces it or clears it.
//
// A DARK BUILD POSTS NOTHING, SILENTLY. Under `EQ_E2E` `discordEndpointConfigured()` is false, so
// the queue refuses before it looks at a preference at all — a headless run can never put a message
// in somebody's channel, and it does not accumulate a sentence complaining about it either.

import { discordEndpointConfigured, postDiscordWebhook, DISCORD_ERR } from './share/discord'
import { getCelebrationPost, setCelebrationPost } from './storeCelebrationPost'
import { pickDiscordChannel } from './storeDiscord'
import {
  createCelebrationQueue,
  type CelebrationPostOutcome,
  type CelebrationPostPrefs,
  type CelebrationPostView
} from '../shared/celebrationPost'
import type { DiscordWebhookBody } from '../shared/discordWebhook'
import type { ToastPayload } from '../shared/toast'

/**
 * THE ONE QUEUE, created at module scope because there is one of everything it wires: one store,
 * one channel list, one outbound origin. Its state (the spacing slot, the dedupe ledger, the last
 * sentence) is this process's lifetime, which is the same lifetime a session has.
 */
const queue = createCelebrationQueue({
  now: () => Date.now(),
  prefs: () => getCelebrationPost(),
  configured: () => discordEndpointConfigured(),
  // ASKED AS A QUESTION, ANSWERED BY THE SAME FUNCTION THAT WILL PICK IT. `pickDiscordChannel`
  // refuses to guess between two channels when nothing names a default (shared/discordChannels.ts
  // `pickChannel`), so "is there somewhere to post" and "where" are one decision made twice rather
  // than two decisions that could disagree.
  hasChannel: (channelId) => pickDiscordChannel(channelId) !== null,
  post: (body, channelId) => postBody(body, channelId),
  unsetError: DISCORD_ERR.unset,
  schedule: (fn, ms) => {
    // A Windows timer ends at the next 15.6 ms tick edge after the time requested (AGENTS.md), so
    // the spacing this buys is a FLOOR. That is the direction that matters: a gap slightly longer
    // than asked for is still a gap, and the queue's own slot arithmetic never compounds.
    setTimeout(fn, ms).unref()
  }
})

/**
 * The transport, with the channel resolved at SEND time rather than at offer time. A user who
 * removes a channel while a spaced-out card is still waiting should not have it posted to a row
 * that no longer exists — and the sentence for "there is nowhere to post" is already the one the
 * card reads.
 */
async function postBody(body: DiscordWebhookBody, channelId?: string): Promise<CelebrationPostOutcome> {
  const channel = pickDiscordChannel(channelId)
  if (channel === null) return { ok: false, error: DISCORD_ERR.unset }
  return postDiscordWebhook(channel, body, { fetch: globalThis.fetch })
}

/**
 * MIRROR ONE CELEBRATION CARD INTO THE CONNECTED CHANNEL. Called from `sendToToastOverlay` for
 * every payload; returns immediately, and every reason not to post (the switch is off, the kind is
 * not chosen, the kind is not postable at all, the card just said this, nothing is connected) is
 * decided inside the queue.
 *
 * `now` is a parameter so a test can drive the spacing and the dedupe window on a fake clock.
 */
export function postCelebration(payload: ToastPayload, now = Date.now()): void {
  queue.offer(payload, now)
}

/** What Preferences shows: the stored prefs, plus whatever went wrong last. */
export function celebrationPostView(): CelebrationPostView {
  return queue.view()
}

/**
 * Write the prefs and answer the NEW view, so the card renders what was stored rather than what it
 * asked for. The last-error half of the view is untouched by a write — a sentence about a post is a
 * fact about that post, and turning a checkbox off does not unsay it.
 */
export function setCelebrationPostPrefs(patch: unknown): CelebrationPostView {
  const prefs: CelebrationPostPrefs = setCelebrationPost(patch)
  return { ...queue.view(), prefs }
}
