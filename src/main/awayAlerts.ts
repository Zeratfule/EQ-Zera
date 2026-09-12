// ============================================================================
// awayAlerts.ts — the WIRED half of away alerts (shared/awayAlerts.ts holds every decision).
// ============================================================================
//
// WHAT IT DOES: when a chosen alert fires while nobody is at this keyboard, it also goes to the
// user's own connected Discord channel, in small batches. Discord's mobile notification is the
// part that reaches the phone, which is why this app ships no push service of its own.
//
// ── THE ONE CALL IN THE AUDIO PATH, AND WHY IT IS SHAPED LIKE THAT ─────────────────────────────
//
// `dataServer/alertsAudio.ts playEngineFire` is the ONE place a fired alert reaches this process
// (its header says so at length), so this feature attaches there and nowhere else: one call, AFTER
// the `sendToMain(IPC.onAlertFired, …)` that makes the sound, inside a `try`. The order is the
// whole contract. The sound is the product; this is a courtesy on top of it, and a courtesy that
// could delay or break a raid alert would be a defect however well it posted. Everything below is
// therefore synchronous and cheap — a store read, a list membership test, one `getSystemIdleTime`
// — and the network happens later, on this module's own timer, on a batch.
//
// ── "AWAY" IS MEASURED, NOT GUESSED ────────────────────────────────────────────────────────────
//
// Two facts: `powerMonitor.getSystemIdleTime()` (seconds since this machine last saw keyboard or
// mouse input — a main-process reading that costs nothing and had no reader in this app before
// now), and whether EverQuest is running at all (`presenceSnapshot`). `isAway` judges them.
//
// THE PRESENCE READ IS PASSIVE, and that is a deliberate limit rather than an oversight. This
// module never subscribes, so it never starts the watcher thread — the auto-hide preference does
// that, and it ships on, so a default install is observed. When NOBODY is watching, `presenceSnapshot`
// answers `observed:false` with the birth assumption `eqRunning:true`, and the code below reads an
// unobserved world as RUNNING. That is the safe direction: "the game is closed" is the reading that
// makes this app post, and posting on a fact nobody measured is how a feature earns a mute.
//
// ── IT NEVER LOGS A WEBHOOK ────────────────────────────────────────────────────────────────────
//
// `share/discord.ts` header item 6 is the law and this module obeys it structurally: it holds a
// CHANNEL, hands it to the post function, and the only thing it ever writes down is one of that
// module's own failure SENTENCES. There is no path from here to an errors.log line carrying a URL.

import { powerMonitor } from 'electron'
import { E2E } from './e2e'
import { logError } from './errorLog'
import { getAlerts } from './store'
import { getAwayAlerts, setAwayAlerts } from './storeAwayAlerts'
import { pickDiscordChannel } from './storeDiscord'
import { presenceSnapshot } from './presence'
import { DISCORD_ERR, postDiscordWebhook } from './share/discord'
import {
  AwayBatcher,
  awayAlertBody,
  deliverAwayBatch,
  isAway,
  type AwayAlertsPrefs,
  type AwayHealth,
  type AwayItem
} from '../shared/awayAlerts'
import type { DiscordChannel } from '../shared/discordChannels'
import type { FiredAlert } from '../shared/types'

/** How often the pending batch is asked whether it is due. One second: the batch window is ten. */
const TICK_MS = 1000

/** What the sample post says, so a person can watch one land before they walk away. */
const TEST_ITEM: AwayItem = {
  name: 'Away alerts',
  matchedText: 'This is what an alert looks like while you are away.',
  ts: 0
}

/** The last attempt's outcome, in memory only. Nothing here is persisted: it describes THIS launch,
 *  and a stale complaint restored from a store file would be a lie about the current state. */
let health: AwayHealth = {}

/** The drain timer, alive only while the feature is on. */
let timer: NodeJS.Timeout | null = null

/** The sentences this module may attribute a failure to. Both are the transport's own words. */
const SENTENCES = { unset: DISCORD_ERR.unset, failed: DISCORD_ERR.offline }

const batcher = new AwayBatcher({
  now: () => Date.now(),
  post: (items) => {
    void sendBatch(items)
  }
})

/** Seconds since this machine last saw input. 0 when the platform will not say, which reads as
 *  "somebody is here" — the direction that posts LESS on an unknown. */
function idleSeconds(): number {
  try {
    return powerMonitor.getSystemIdleTime()
  } catch {
    return 0
  }
}

/** Is the game running? An UNOBSERVED world reads as running — see the header. */
function gameRunning(): boolean {
  const presence = presenceSnapshot()
  return !presence.observed || presence.eqRunning
}

/** The away verdict for the preference as it stands right now. */
function awayNow(prefs: AwayAlertsPrefs): boolean {
  return isAway({ idleSeconds: idleSeconds(), eqRunning: gameRunning(), prefs })
}

/** Hand one batch to Discord and remember what came back. Never throws - `deliverAwayBatch` is
 *  contracted not to, and this is the only caller of it. */
async function sendBatch(items: readonly AwayItem[]): Promise<void> {
  health = await deliverAwayBatch<DiscordChannel>(
    items,
    {
      now: () => Date.now(),
      channel: () => pickDiscordChannel(getAwayAlerts().channelId),
      post: (channel, body) => postDiscordWebhook(channel, body, { fetch: globalThis.fetch }),
      sentences: SENTENCES
    },
    health
  )
}

/**
 * Start or stop the one-second tick to match the preference.
 *
 * A TIMER ONLY WHILE THE FEATURE IS ON. Off is the shipped state, so the overwhelming majority of
 * launches create nothing at all; and `unref` means a tick can never be the reason this process
 * outlives its last window.
 *
 * NEVER UNDER `EQ_E2E`. The Discord origin is already dark there (share/discord.ts item 4), so a
 * harness could not post if it tried — this simply means it does not also spend a tick a second
 * proving that. A batch offered in a headless run stays pending and dies with the process.
 */
function arm(): void {
  const wanted = getAwayAlerts().enabled && !E2E
  if (wanted === (timer !== null)) return
  if (!wanted) {
    if (timer !== null) clearInterval(timer)
    timer = null
    return
  }
  timer = setInterval(() => {
    try {
      batcher.flushDue(Date.now())
    } catch (err) {
      logError('main:awayAlerts', err)
    }
  }, TICK_MS)
  timer.unref?.()
}

/**
 * ONE FIRED ALERT, OFFERED. The single call `alertsAudio.ts` makes, and every refusal it can meet.
 *
 * IT ANSWERS A BOOLEAN so a test and a reader can see the decision rather than infer it from a
 * silence; nothing branches on the result.
 */
export function noteAlertFired(firing: FiredAlert): boolean {
  const prefs = getAwayAlerts()
  if (!prefs.enabled || !prefs.alertIds.includes(firing.alertId)) return false
  // A selection can outlive the def it names (an alert deleted while it was still ticked). Nothing
  // in a message would be true about it, so it is dropped rather than posted under a made-up name.
  const def = getAlerts().find((a) => a.id === firing.alertId)
  if (def === undefined) return false
  if (!awayNow(prefs)) return false
  batcher.offer({ name: def.name, matchedText: firing.matchedText, ts: firing.ts })
  return true
}

/** What the Preferences card draws. `idleSeconds` rides along so the card can say what this machine
 *  currently thinks, which is the one number a person setting a threshold wants to see. */
export interface AwayAlertsView extends AwayHealth {
  prefs: AwayAlertsPrefs
  idleSeconds: number
}

/** The view, built fresh on every read. */
export function awayAlertsView(): AwayAlertsView {
  return { ...health, prefs: getAwayAlerts(), idleSeconds: idleSeconds() }
}

/** Store the preference and re-arm the timer to match. Answers the view, so the card renders what
 *  was stored rather than what it asked for. */
export function setAwayAlertsPrefs(raw: unknown): AwayAlertsView {
  setAwayAlerts(raw)
  arm()
  return awayAlertsView()
}

/**
 * SEND ONE SAMPLE NOW — the card's "Send a test".
 *
 * It goes straight out rather than through the batcher: a test the user pressed is not a firing to
 * be smoothed, and making somebody wait ten seconds to find out whether their channel works would
 * be the batching serving the code instead of the reader.
 */
export async function sendAwayTest(): Promise<{ ok: boolean; error?: string }> {
  const channel = pickDiscordChannel(getAwayAlerts().channelId)
  if (channel === null) {
    health = { ...health, lastError: SENTENCES.unset, lastErrorAt: Date.now() }
    return { ok: false, error: SENTENCES.unset }
  }
  const body = awayAlertBody([{ ...TEST_ITEM, ts: Date.now() }])
  const result = await postDiscordWebhook(channel, body, { fetch: globalThis.fetch })
  if (result.ok) {
    health = { lastSentAt: Date.now() }
    return { ok: true }
  }
  health = { ...health, lastError: result.error, lastErrorAt: Date.now() }
  return { ok: false, error: result.error }
}

/**
 * WIRE IT UP. Called once from the composition root, after the store is open.
 *
 * All it does is arm the timer if the feature is already on, because everything else about this
 * module is pulled rather than pushed: the fire hook is a call `alertsAudio.ts` makes, and the
 * preference doors are IPC handlers. A launch with the feature off leaves no timer, no subscriber
 * and no state behind it.
 */
export function initAwayAlerts(): void {
  arm()
}

/** Stop the tick (app quit). Idempotent, and a no-op on a launch that never armed. */
export function stopAwayAlerts(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}
