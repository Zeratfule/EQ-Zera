// ============================================================================
// shared/awayAlerts.ts — AN ALERT THAT REACHES YOU WHEN YOU ARE NOT AT THE KEYBOARD.
// ============================================================================
//
// THE ASK: a raid target going up, or a tell arriving, while you are away from the machine. The
// app already knows both — the engine fires the alert and this process plays a sound at an empty
// chair. What it cannot do is reach a phone, so the answer is the one outbound channel this app
// already has: the user's own connected Discord channel (docs/plans/discord-connect.md). Discord's
// own mobile notifications do the rest, which is why this feature ships no push service, no
// account and no second server — it posts a message and stops.
//
// THIS FILE IS PURE, and it is where every decision the feature makes lives:
//
//   1. `sanitizeAwayAlertsPrefs` — the store filter. A settings file is a file somebody else can
//      also write to, so the minute ladder is a CLOSED SET, the channel id goes through the same
//      closed class a webhook id goes through, and the alert list is bounded.
//   2. `isAway` — the whole definition of "away", as a function of two measurements and the
//      preference. It reads no clock and asks nothing of the machine, so the matrix is a table in
//      a node test rather than a thing you have to leave your desk to check.
//   3. `awayAlertBody` — what lands in the channel, cut to Discord's ceilings and escaped for its
//      markdown.
//   4. `AwayBatcher` — the rate discipline. It holds a clock and a post function as INJECTED
//      dependencies and owns no timer of its own, which is what makes ten seconds of batching and
//      a twenty-post ceiling testable with a fake clock instead of a stopwatch.
//
// WHY BATCHING AT ALL. Alerts arrive in bursts — a pull is four buffs fading inside a second — and
// a Discord channel that buzzes a phone four times for one pull is a channel the user mutes, which
// silently un-ships the feature. So the post rate is bounded twice: a batch waits `BATCH_MS` for
// company (or fills up at `BATCH_MAX` items), and the process will not exceed `RATE_MAX` posts in
// any `RATE_WINDOW_MS`. The ceiling DROPS rather than queues, and says how much it dropped: a
// message about an alert from twenty minutes ago is not an alert, it is a log.
//
// NOTHING HERE KNOWS A WEBHOOK. The channel is named by ID only, and every token stays main-side
// (src/main/storeDiscord.ts) — this file could not compose a request if it wanted to.

import { discordPostBody, type DiscordWebhookBody } from './discordWebhook'

// ------------------------------------------------------------------------------- the preference

/** How long without keyboard or mouse counts as away. A CLOSED LADDER — see `sanitizeIdleMinutes`. */
export type AwayIdleMinutes = 2 | 5 | 10 | 15

/** The ladder itself, in the order the Preferences select draws it. */
export const AWAY_IDLE_CHOICES: readonly AwayIdleMinutes[] = [2, 5, 10, 15]

/** The stored preference. */
export interface AwayAlertsPrefs {
  /** Is anything posted at all? OFF until somebody asks for it. */
  enabled: boolean
  /**
   * WHICH connected channel, by its webhook id. Absent means "whichever main would pick" — the
   * install's default channel, or its only one (shared/discordChannels.ts `pickChannel`), which is
   * the same rule every other post in this app follows.
   */
  channelId?: string
  /** Seconds of no input, expressed as the minutes a person would say. */
  idleMinutes: AwayIdleMinutes
  /** Which alerts travel. EMPTY MEANS NONE, deliberately: a feature that posted every alert by
   *  default would put a raid's worth of buff fades in somebody's phone on the day they enabled it. */
  alertIds: string[]
  /** Count me away while EverQuest is not running at all, whatever the keyboard says. */
  alsoWhenGameClosed: boolean
}

/**
 * OFF, five minutes, nothing selected, and "the game is closed" counts.
 *
 * The last field defaults ON because it is the case the feature is FOR: somebody who shut the
 * client down and walked off is as away as a person can be, and asking them to also idle five
 * minutes first would delay the one message they actually wanted.
 */
export const DEFAULT_AWAY_ALERTS: AwayAlertsPrefs = {
  enabled: false,
  idleMinutes: 5,
  alertIds: [],
  alsoWhenGameClosed: true
}

/** How many alerts one install may select. A bound against a corrupt file, not a product limit. */
export const MAX_AWAY_ALERT_IDS = 500

/** Longest alert id this will even look at. Alert ids are app-minted; this is the file filter. */
const MAX_ALERT_ID_LEN = 64

/** A Discord snowflake, which is what a webhook id is. Same class `shared/discordWebhook.ts` uses;
 *  spelled here rather than imported so this module's filter cannot drift out from under a rename. */
const CHANNEL_ID = /^[0-9]{17,20}$/

/** Is this one of the four? Anything else — a number a hand-edit invented, a string, a float — is
 *  not on the ladder and reads as the default rather than as an arbitrary interval. */
function sanitizeIdleMinutes(raw: unknown): AwayIdleMinutes {
  return AWAY_IDLE_CHOICES.find((m) => m === raw) ?? DEFAULT_AWAY_ALERTS.idleMinutes
}

/** The selected alerts, de-duplicated and bounded. Order is preserved so a list a user built stays
 *  the list they built. */
function sanitizeAlertIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    if (out.length >= MAX_AWAY_ALERT_IDS) break
    if (typeof item !== 'string' || item === '' || item.length > MAX_ALERT_ID_LEN) continue
    if (!out.includes(item)) out.push(item)
  }
  return out
}

/**
 * The stored blob, defaulted field by field — the repo's store discipline (read through the
 * normalizer, write back through the SAME one), so the file, an IPC patch and a future migration
 * cannot end up with three ideas of what this setting is.
 *
 * `channelId` is OMITTED rather than set to undefined when it is not a snowflake: an absent key is
 * the honest encoding of "nobody named a channel", and it is what makes an untouched store
 * byte-identical to one written here.
 */
export function sanitizeAwayAlertsPrefs(raw: unknown): AwayAlertsPrefs {
  const v =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const channelId = typeof v.channelId === 'string' && CHANNEL_ID.test(v.channelId) ? v.channelId : undefined
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_AWAY_ALERTS.enabled,
    ...(channelId === undefined ? {} : { channelId }),
    idleMinutes: sanitizeIdleMinutes(v.idleMinutes),
    alertIds: sanitizeAlertIds(v.alertIds),
    alsoWhenGameClosed:
      typeof v.alsoWhenGameClosed === 'boolean'
        ? v.alsoWhenGameClosed
        : DEFAULT_AWAY_ALERTS.alsoWhenGameClosed
  }
}

// ------------------------------------------------------------------------------------ "away"

/** The two measurements a verdict is made from, plus the preference that judges them. */
export interface AwayInput {
  /** Seconds since the machine last saw keyboard or mouse input (Electron's `powerMonitor`). */
  idleSeconds: number
  /** Is the game running at all? */
  eqRunning: boolean
  prefs: AwayAlertsPrefs
}

/**
 * ARE YOU AWAY?
 *
 * TWO WAYS TO BE, and they are an OR rather than an AND on purpose. Idle at the keyboard is the
 * ordinary one; the game not running at all is the other, and somebody who closed the client and
 * left is not going to start typing on this machine to prove it. A user who does not want the
 * second reading turns `alsoWhenGameClosed` off and is then judged on input alone.
 *
 * IT DOES NOT ASK WHETHER THE FEATURE IS ON. That is the caller's gate (src/main/awayAlerts.ts),
 * because "is this person away" is a fact about the machine and stays answerable in a test that
 * has nothing switched on.
 */
export function isAway({ idleSeconds, eqRunning, prefs }: AwayInput): boolean {
  if (prefs.alsoWhenGameClosed && !eqRunning) return true
  return idleSeconds >= prefs.idleMinutes * 60
}

// ------------------------------------------------------------------------------------ the post

/** One alert, as the channel will read it. */
export interface AwayItem {
  /** The alert's own name, as the user wrote it. */
  name: string
  /** The log text that matched, as the engine reported it. */
  matchedText: string
  /** The log's clock for the firing, epoch ms. */
  ts: number
}

/** The embed's colour: the app's warm "look at this" amber. */
export const AWAY_EMBED_COLOR = 0xffc857

/** What the message is called. */
const AWAY_TITLE = 'EQ Zera · while you were away'

/** The same footer every embed this app posts carries. */
const AWAY_FOOTER = 'EQ Zera · eqzera.com'

/** How many firings one message spells out before it starts counting instead. */
export const AWAY_MAX_LINES = 10

/** How much of a matched line travels. A log line is not a paragraph, and a phone notification
 *  shows about this much of one anyway. */
export const AWAY_MATCHED_MAX = 160

/** …and how much of an alert's own name. */
const AWAY_NAME_MAX = 80

/** Discord's own ceiling on an embed description. */
const DESCRIPTION_MAX = 4096

/**
 * The characters Discord reads as markup, escaped so a log line is printed rather than performed.
 *
 * A mob called `**Innoruuk**` must not bold half the message, and a line carrying a `|` must not
 * become a spoiler. Control characters (a newline above all) become spaces first: the layout is one
 * firing per line, and a value that carried its own newline would be two rows claiming one name.
 *
 * The set is the marks that act MID-LINE. `-` and `#` are markup only at the start of a line, and
 * no line here starts with a value — every one opens with the alert's own bolded name — so
 * escaping them would litter ordinary log text with backslashes for nothing.
 */
const MARKDOWN_MARKS = '\\*_~`|>[]()'

function escapeMarkdown(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      out += ' '
      continue
    }
    out += MARKDOWN_MARKS.includes(ch) ? `\\${ch}` : ch
  }
  return out
}

/**
 * Cut to `max` CHARACTERS, without splitting a surrogate pair — `String.slice` counts UTF-16 code
 * units and would leave half a character at the boundary. `Array.from` rather than a spread, which
 * the repo's lint config refuses for exactly the decomposition hazard this is avoiding.
 */
function cut(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('')
}

/** One firing, as one line. The name is bold so a phone's preview leads with WHAT fired. */
function lineFor(item: AwayItem): string {
  const name = escapeMarkdown(cut(item.name, AWAY_NAME_MAX))
  const matched = escapeMarkdown(cut(item.matchedText, AWAY_MATCHED_MAX))
  return matched === '' ? `**${name}**` : `**${name}** - ${matched}`
}

/**
 * THE WHOLE POST for one batch: one embed, one line per firing, capped.
 *
 * PAST THE CAP IT COUNTS RATHER THAN LISTS. Ten lines is already more than a notification shows,
 * and the honest ending for the eleventh is a number — the user is being told to come back, not
 * being sent a transcript.
 *
 * THE TIMESTAMP IS THE LAST ITEM'S, which is the LOG's clock rather than this host's wall clock
 * (the same value `FiredAlert.ts` carries), so a message says when the thing happened rather than
 * when the batch happened to drain.
 */
export function awayAlertBody(items: readonly AwayItem[]): DiscordWebhookBody {
  const shown = items.slice(0, AWAY_MAX_LINES)
  const lines = shown.map(lineFor)
  const extra = items.length - shown.length
  if (extra > 0) lines.push(`+${String(extra)} more`)
  const last = items[items.length - 1]
  return discordPostBody({
    title: AWAY_TITLE,
    description: cut(lines.join('\n'), DESCRIPTION_MAX),
    color: AWAY_EMBED_COLOR,
    fields: [],
    footer: { text: AWAY_FOOTER },
    timestamp: new Date(last === undefined ? 0 : last.ts).toISOString()
  })
}

// --------------------------------------------------------------------------------- the delivery
//
// THE ATTEMPT IS PURE TOO, AND THAT IS THE POINT. Everything about posting a batch that can be
// WRONG — no channel connected, a refusal from Discord, a transport that threw — is a decision
// about what the user is then told, and none of it needs Electron, a store or a socket. So the
// attempt takes its channel, its transport and its clock as arguments, `src/main/awayAlerts.ts`
// supplies the real ones, and `tests/awayAlerts.test.mts` supplies fakes. Nothing in this file
// learns a webhook, a host or a token.

/** What the Preferences card and the IPC view say about the last attempt. */
export interface AwayHealth {
  /** The last failure's sentence, or absent when the last attempt succeeded. */
  lastError?: string
  /** …and when it happened, epoch ms. */
  lastErrorAt?: number
  /** When a batch last reached the channel, epoch ms. Survives a later failure. */
  lastSentAt?: number
}

/** A post's outcome, as `src/main/share/discord.ts` answers one. Spelled STRUCTURALLY rather than
 *  imported, so this pure file never reaches into the transport. */
export type AwayPostResult = { ok: true } | { ok: false; error: string }

/** What one attempt needs from the outside world. `C` is whatever the caller calls a channel. */
export interface AwayDeliveryDeps<C> {
  now: () => number
  /** The channel a post would go to, or null when this install has none connected. */
  channel: () => C | null
  post: (channel: C, body: DiscordWebhookBody) => Promise<AwayPostResult>
  /** The two sentences this file must not invent: they belong to the transport that knows why. */
  sentences: { unset: string; failed: string }
}

/**
 * POST ONE BATCH, and say what to tell the user afterwards.
 *
 * NEVER THROWS, and never merely swallows either. A transport that rejects (which the Discord post
 * path is contracted not to do, so this is the belt to its braces) is reported as the failure
 * sentence the caller supplied, because this runs downstream of the audio path and an exception
 * there would cost somebody a sound.
 *
 * A SUCCESS CLEARS THE COMPLAINT; A FAILURE KEEPS THE LAST SUCCESS. "It last worked an hour ago and
 * has been failing since" is two facts, and a card that dropped either one would be answering a
 * different question than the one a person standing in front of it is asking.
 */
export async function deliverAwayBatch<C>(
  items: readonly AwayItem[],
  deps: AwayDeliveryDeps<C>,
  prev: AwayHealth = {}
): Promise<AwayHealth> {
  const kept = prev.lastSentAt === undefined ? {} : { lastSentAt: prev.lastSentAt }
  const channel = deps.channel()
  if (channel === null) return { ...kept, lastError: deps.sentences.unset, lastErrorAt: deps.now() }
  try {
    const result = await deps.post(channel, awayAlertBody(items))
    if (result.ok) return { lastSentAt: deps.now() }
    return { ...kept, lastError: result.error, lastErrorAt: deps.now() }
  } catch {
    return { ...kept, lastError: deps.sentences.failed, lastErrorAt: deps.now() }
  }
}

// ---------------------------------------------------------------------------------- the batcher

/** How long a batch waits for company before it goes. */
export const BATCH_MS = 10_000

/** …and how many firings fill one without waiting. */
export const BATCH_MAX = 10

/** The ceiling's window. */
export const RATE_WINDOW_MS = 600_000

/** …and how many posts may leave inside it. */
export const RATE_MAX = 20

/** What the batcher has done this launch. Read by the Preferences card's own diagnostics and by
 *  the tests; nothing branches on it. */
export interface AwayBatcherStats {
  /** Posts actually handed to `post`. */
  posted: number
  /** ITEMS that never reached a channel because the ceiling was already met. Items rather than
   *  posts, because the thing a user lost is a firing, not an envelope. */
  dropped: number
}

/** What the batcher needs from the outside world. Injected, so the whole thing is a unit test. */
export interface AwayBatcherDeps {
  /** Epoch ms. */
  now: () => number
  /** Send one batch. SYNCHRONOUS AND FIRE-AND-FORGET: this class owns the rate discipline, not the
   *  transport, and a promise here would make "did the batch go" a thing it has to remember. */
  post: (items: AwayItem[]) => void
}

/**
 * THE RATE DISCIPLINE, WITH NO TIMER OF ITS OWN.
 *
 * `offer` collects and `flushDue(now)` drains; the caller owns the one-second tick that asks (see
 * src/main/awayAlerts.ts). That split is deliberate: a class that set its own `setTimeout` would be
 * untestable without a fake timer library AND would keep the process alive, and the main-side timer
 * already has to exist so it can stand down while the feature is off.
 *
 * A FULL BATCH GOES IMMEDIATELY, from inside `offer` — ten firings inside the window is a burst, and
 * making it wait out the remaining seconds would be the batching costing the user the very latency
 * it exists to bound.
 */
export class AwayBatcher {
  private readonly deps: AwayBatcherDeps
  private batch: AwayItem[] = []
  /** When the batch's FIRST item arrived. 0 while there is no batch. */
  private firstAt = 0
  /** When each post inside the current window left, oldest first. */
  private readonly sentAt: number[] = []
  private stats_: AwayBatcherStats = { posted: 0, dropped: 0 }

  constructor(deps: AwayBatcherDeps) {
    this.deps = deps
  }

  /** What this launch has posted and lost. A copy: nobody outside mutates the count. */
  get stats(): AwayBatcherStats {
    return { ...this.stats_ }
  }

  /** How many firings are waiting for a post right now. */
  pending(): number {
    return this.batch.length
  }

  /** Take one firing. Sends immediately when the batch is full; otherwise it waits for `flushDue`. */
  offer(item: AwayItem): void {
    if (this.batch.length === 0) this.firstAt = this.deps.now()
    this.batch.push(item)
    if (this.batch.length >= BATCH_MAX) this.send(this.deps.now())
  }

  /** Send the pending batch if it has waited long enough. Answers whether anything left. */
  flushDue(now: number): boolean {
    if (this.batch.length === 0) return false
    if (now - this.firstAt < BATCH_MS) return false
    return this.send(now)
  }

  /** Send whatever is pending, whatever the clock says. The feature going off, or a quit. */
  flushNow(now: number): boolean {
    return this.batch.length === 0 ? false : this.send(now)
  }

  /**
   * Hand one batch over, or drop it because the ceiling is already met.
   *
   * DROPPED, NOT QUEUED. A held batch would be delivered after the window opened again — minutes
   * later, about an alert that has stopped mattering — and it would arrive in front of whatever
   * fired since. The count is what makes the loss visible instead of silent.
   */
  private send(now: number): boolean {
    const items = this.batch
    this.batch = []
    this.firstAt = 0
    while (this.sentAt.length > 0 && now - (this.sentAt[0] ?? 0) >= RATE_WINDOW_MS) this.sentAt.shift()
    if (this.sentAt.length >= RATE_MAX) {
      this.stats_ = { ...this.stats_, dropped: this.stats_.dropped + items.length }
      return false
    }
    this.sentAt.push(now)
    this.stats_ = { ...this.stats_, posted: this.stats_.posted + 1 }
    this.deps.post(items)
    return true
  }
}
