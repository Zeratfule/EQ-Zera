// ============================================================================
// shared/celebrationPost.ts — MIRRORING THE CELEBRATION OVERLAY INTO A DISCORD CHANNEL.
// ============================================================================
//
// The celebration overlay already says the things worth saying out loud: a level, a boss, a Sky
// quest, a wish-list drop. This is a switch that sends the SAME cards to a channel the user has
// already connected (docs/plans/celebration-toasts.md, docs/plans/discord-connect.md), so a guild
// watches a night happen instead of hearing about it afterwards.
//
// THE CARD IS THE MESSAGE, AND ONLY THE TEXT OF IT. An item icon in this app is an `eqimg://` URL
// resolved out of a permanent local cache; Discord cannot fetch it, and there is nothing on the
// share service to point at for a level-up. So the embed carries the title, the subtitle, the
// reward's NAME and the quest names - never an `image`, because an embed naming a picture nobody
// can load renders as a broken one (`shared/fightShare.ts` learned that about attachments).
//
// THIS FILE IS PURE, and it holds three things that must not be spread across the two processes:
//
//   1. WHICH KINDS ARE POSTABLE. `ToastKind` has nine members and only six of them are a
//      celebration (see `CelebrationPostKind`). A second opinion about that list, in main or in
//      the Preferences card, is how a zone-entry nag ends up in somebody's guild chat.
//   2. THE EMBED. One builder, cut to `DISCORD_LIMIT` like every other embed this app sends.
//   3. THE QUEUE. Spacing and duplicate-dropping are the whole difference between a feature and a
//      way to get a webhook rate limited, and both are decisions a node test can watch being made
//      - so the clock, the transport and the channel lookup are INJECTED (`createCelebrationQueue`)
//      and main does nothing but supply them (src/main/celebrationPost.ts).
//
// NO TOKEN IS IN HERE, not even by type. The queue's `post` dep takes a body and an optional
// channel ID (a webhook id, which the renderer already holds); which secret that resolves to is
// `src/main/storeDiscord.ts`'s business and stays there.
//
// Value imports are RELATIVE (the mobSearch.ts rule), so `tests/celebrationPost.test.mts` runs
// this under plain node with no alias resolution and no Electron.

import {
  cutToDiscordLimit,
  discordPostBody,
  DISCORD_LIMIT,
  isWebhookId,
  type DiscordEmbed,
  type DiscordWebhookBody
} from './discordWebhook'
import type { ToastPayload } from './toast'

const cut = cutToDiscordLimit

// ------------------------------------------------------------------------------- the kinds

/**
 * The `ToastKind`s a celebration post may carry. THREE MEMBERS OF THE UNION ARE MISSING, each for
 * its own reason:
 *
 *   'intro'   - the overlay introducing itself to a new user. It is about this app's window, not
 *               about the player, and it is drawn by the overlay for itself (JOS-83) rather than
 *               ever crossing a wire.
 *   'update'  - the updater speaking. A message in a guild channel saying a stranger's desktop app
 *               has a new version is noise to everyone who reads it.
 *   'wishZone' - a NAG, not a celebration: it counts what drops where you are standing, which is a
 *               thing to do next rather than a thing that happened. Nothing was achieved, so there
 *               is nothing to tell a channel.
 */
export type CelebrationPostKind =
  | 'levelUp'
  | 'bossKill'
  | 'skyQuestComplete'
  | 'questItem'
  | 'wishDrop'
  | 'death'

/** The six, in the order the Preferences card draws their checkboxes. */
export const CELEBRATION_POST_KINDS: readonly CelebrationPostKind[] = [
  'levelUp',
  'bossKill',
  'skyQuestComplete',
  'questItem',
  'wishDrop',
  'death'
]

/** What each one is called on the card. Here rather than in the .tsx so the list and its labels
 *  cannot come apart when a seventh kind arrives. */
export const CELEBRATION_KIND_LABEL: Record<CelebrationPostKind, string> = {
  levelUp: 'Level ups',
  bossKill: 'Boss kills',
  skyQuestComplete: 'Quest completions',
  questItem: 'Quest items',
  wishDrop: 'Wish-list drops',
  death: 'Deaths'
}

/** Is this a kind this app will put in somebody's channel? The one admission test. */
export function isCelebrationPostKind(v: unknown): v is CelebrationPostKind {
  return typeof v === 'string' && (CELEBRATION_POST_KINDS as readonly string[]).includes(v)
}

// ---------------------------------------------------------------------------- the preferences

/** What the switch, the picker and the six checkboxes add up to. */
export interface CelebrationPostPrefs {
  enabled: boolean
  /** the webhook id of the channel to post to; absent means the Discord default channel */
  channelId?: string
  /** which kinds are posted. An empty list is a valid answer and posts nothing. */
  kinds: CelebrationPostKind[]
}

/**
 * OFF, and four of the six kinds on for when it is switched on.
 *
 * DEATHS AND QUEST ITEMS ARE OPT-IN, and the two omissions are different arguments. A death is a
 * private thing: somebody may well want their guild to see it, but nobody should discover that
 * their corpse runs are being announced because they turned on a feature about level-ups. A quest
 * item is simply FREQUENT - a stack of Bone Chips is forty loot lines in an hour (the quest toast's
 * own repeat window exists for that), and forty messages is how a channel mutes this app.
 *
 * The whole feature being off by default is the same reasoning one level up: this posts to a place
 * other people are reading, so it waits to be asked.
 */
export const DEFAULT_CELEBRATION_POST: CelebrationPostPrefs = {
  enabled: false,
  kinds: ['levelUp', 'bossKill', 'skyQuestComplete', 'wishDrop']
}

/** A fresh copy of the shipped answer. The constant above is exported for reading, and an array
 *  handed out by reference is an array a caller can push into. */
function defaultPrefs(): CelebrationPostPrefs {
  return { enabled: DEFAULT_CELEBRATION_POST.enabled, kinds: [...DEFAULT_CELEBRATION_POST.kinds] }
}

/**
 * The kinds a stored (or renderer-sent) list actually names, deduplicated and in the card's own
 * order. Built by FILTERING the closed list rather than by walking the input, so an unknown string
 * cannot survive and a list that names the same kind twice draws one checkbox.
 *
 * A non-array is the DEFAULT rather than the empty list: an absent key means "never chose", and
 * "chose nothing" is a different statement that only the checkboxes can make.
 */
function sanitizeKinds(raw: unknown): CelebrationPostKind[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CELEBRATION_POST.kinds]
  const wanted = new Set(raw.filter(isCelebrationPostKind))
  return CELEBRATION_POST_KINDS.filter((k) => wanted.has(k))
}

/**
 * A stored blob -> prefs this app can run on. Never throws, never returns a partial.
 *
 * `channelId` goes through `isWebhookId`'s CLOSED CLASS on the way out of the store for
 * storeDiscord.ts's stated reason: a store file is a file on a disk somebody else can also write
 * to, and this value is about to be compared against ids that a request path is rebuilt from. An
 * id that is not in the class is DROPPED, which degrades to "the default channel" rather than to
 * an error.
 */
export function sanitizeCelebrationPostPrefs(raw: unknown): CelebrationPostPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultPrefs()
  const r = raw as Record<string, unknown>
  return {
    enabled: r.enabled === true,
    ...(isWebhookId(r.channelId) ? { channelId: r.channelId } : {}),
    kinds: sanitizeKinds(r.kinds)
  }
}

/**
 * Merge-patch, the `shared/closeToTray.ts` idiom: a field the patch does not name keeps what is
 * stored right now. That is what lets the switch write `{ enabled }`, the picker write
 * `{ channelId }` and one checkbox write `{ kinds }` through one door.
 *
 * A patch that NAMES `channelId` with anything unusable clears it back to "the default channel" -
 * which is how the card unsets a selection - while a patch that does not mention it keeps it.
 */
export function mergeCelebrationPostPrefs(patch: unknown, base: CelebrationPostPrefs): CelebrationPostPrefs {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return sanitizeCelebrationPostPrefs(base)
  const p = patch as Record<string, unknown>
  return sanitizeCelebrationPostPrefs({
    enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
    channelId: 'channelId' in p ? p.channelId : base.channelId,
    kinds: Array.isArray(p.kinds) ? p.kinds : base.kinds
  })
}

/** Does this card go to the channel? Enabled, postable, and chosen - in that order. */
export function shouldPostCelebration(prefs: CelebrationPostPrefs, payload: ToastPayload): boolean {
  if (!prefs.enabled) return false
  if (!isCelebrationPostKind(payload.kind)) return false
  return prefs.kinds.includes(payload.kind)
}

// -------------------------------------------------------------------------------- the embed

/**
 * ONE COLOUR PER KIND, so a channel can be read at a glance by the stripe down the left of the
 * embed. Gold for a level, red for a boss, violet for Sky, cyan for a quest item (the app's own
 * accent, which is what the character card already wears), pink for a wish-list drop, and grey for
 * a death - the one card that is not good news, and the only one that should not shout.
 */
export const CELEBRATION_EMBED_COLOR: Record<CelebrationPostKind, number> = {
  levelUp: 0xffc857,
  bossKill: 0xff6b6b,
  skyQuestComplete: 0xa98fe0,
  questItem: 0x5ee6ff,
  wishDrop: 0xff5fb8,
  death: 0x7d75a6
}

/** What a kind this file does not colour would get. Unreachable through `shouldPostCelebration`,
 *  which is the gate every caller runs first; a number is still cheaper than a throw at a boundary
 *  whose whole contract is that it never throws. */
const FALLBACK_COLOR = 0x5ee6ff

/** The footer every EQ Zera embed wears. Matched to `discordFightEmbed`'s, deliberately: two
 *  spellings would be two products as far as anybody scrolling the channel is concerned. */
const FOOTER = 'EQ Zera · eqzera.com'

/**
 * The lines under the title: the card's own subtitle, then the reward's NAME, then one line per
 * quest the card named.
 *
 * Everything here is a string the app already put on screen. Nothing is computed, joined or looked
 * up - if the overlay could not say it, neither can the message (world-model law 1).
 */
function embedDescription(payload: ToastPayload): string {
  const lines: string[] = []
  if (payload.subtitle !== undefined && payload.subtitle !== '') lines.push(payload.subtitle)
  if (payload.item !== undefined) lines.push(payload.item.name)
  for (const quest of payload.quests ?? []) lines.push(`Quest: ${quest.name}`)
  return lines.join('\n')
}

/**
 * ONE CELEBRATION CARD, AS A DISCORD POST. `at` is the moment the card happened, which is what the
 * embed is stamped with - not the moment the queue below got round to sending it, because a
 * message that says a level-up happened two seconds late is saying the wrong thing about the log.
 *
 * NO `image` AND NO `url`. See the file header: the icons are `eqimg://` and there is no page to
 * link to. `fields` is empty for the same reason `content` is - there are no tiles worth drawing on
 * a card whose whole content is two lines the app already wrote.
 */
export function celebrationEmbed(payload: ToastPayload, at: number): DiscordWebhookBody {
  const color = isCelebrationPostKind(payload.kind)
    ? CELEBRATION_EMBED_COLOR[payload.kind]
    : FALLBACK_COLOR
  const embed: DiscordEmbed = {
    title: cut(payload.title, DISCORD_LIMIT.title),
    description: cut(embedDescription(payload), DISCORD_LIMIT.description),
    color,
    fields: [],
    footer: { text: cut(FOOTER, DISCORD_LIMIT.footer) },
    timestamp: new Date(at).toISOString()
  }
  return discordPostBody(embed)
}

// -------------------------------------------------------------------------------- the queue

/** What a post answered. Structurally `DiscordPostResult` (src/main/share/discord.ts); spelled
 *  here so this file owes main nothing - `shared` importing from `main` would be the wrong edge. */
export type CelebrationPostOutcome = { ok: true } | { ok: false; error: string }

/** THE SHAPE THAT CROSSES IPC: what is set, and whatever went wrong last. */
export interface CelebrationPostView {
  prefs: CelebrationPostPrefs
  /** the last failure's sentence, already user-facing. Cleared by the next post that lands. */
  lastError?: string
  /** …and when it happened, epoch ms, so the card can say how long ago. */
  lastErrorAt?: number
}

/**
 * THE SMALLEST GAP BETWEEN TWO MESSAGES. Discord rate limits a webhook per channel; a Sky
 * completion that fires a quest card, an item card and a level-up inside one tick is three posts
 * this app asked for at once, and spacing them is what keeps the third one from being refused.
 */
export const CELEBRATION_POST_SPACING_MS = 2000

/**
 * …AND HOW LONG THE SAME CARD STAYS QUIET. The overlay refreshes a card in place on a repeat id;
 * a channel has no such thing, so the second identical message is just the same message again.
 * Keyed on what a reader would see (kind, title, subtitle) rather than on the payload id, because
 * two different ids saying the same words are one thing to everybody reading the channel.
 */
export const CELEBRATION_DEDUPE_MS = 60_000

/** A bound on the dedupe ledger, so a long session cannot grow one entry per card forever.
 *  Entries age out on their own; this only matters for a session that never repeats anything. */
const MAX_DEDUPE_KEYS = 200

/** What the queue needs from the world. All of it injected, so the tests run with a fake clock,
 *  a fake transport and no store at all. */
export interface CelebrationQueueDeps {
  /** the clock. Called at offer time and again when a post finishes. */
  now: () => number
  /** the prefs as they are RIGHT NOW - read per card, so switching a kind off takes effect at once */
  prefs: () => CelebrationPostPrefs
  /** can this build post to Discord at all (dark under `EQ_E2E`)? */
  configured: () => boolean
  /** is there a channel to post to, for this preference? */
  hasChannel: (channelId?: string) => boolean
  /** the transport. Must never throw - `postDiscordWebhook`'s own law. */
  post: (body: DiscordWebhookBody, channelId?: string) => Promise<CelebrationPostOutcome>
  /** what to say when nothing is connected. MAIN owns the wording (src/main/share/discord.ts). */
  unsetError: string
  /** how a delayed send is arranged. `setTimeout` in main; a fake in the tests. */
  schedule: (fn: () => void, ms: number) => void
}

/** The one card this app can put in somebody's channel, and everything it remembers about doing
 *  it. Created once by main; `offer` is fire-and-forget and NEVER throws. */
export interface CelebrationQueue {
  offer: (payload: ToastPayload, now?: number) => void
  view: () => CelebrationPostView
}

/**
 * THE QUEUE, as a closure over its own state.
 *
 * A card is DROPPED, never buffered, when the answer is no - a celebration is worth saying at the
 * moment it happens and worth nothing ten minutes later, so there is no retry, no backlog and no
 * disk. What is kept is one sentence about the last failure, because a switch that silently posts
 * nothing is indistinguishable from a broken one.
 */
export function createCelebrationQueue(deps: CelebrationQueueDeps): CelebrationQueue {
  /** the earliest moment the next message may leave. See `CELEBRATION_POST_SPACING_MS`. */
  let nextAt = 0
  /** what was said recently, and when. See `CELEBRATION_DEDUPE_MS`. */
  const said = new Map<string, number>()
  let lastError: string | undefined
  let lastErrorAt: number | undefined

  /** JSON rather than a joined string: a title containing the separator cannot forge a hit. */
  function keyOf(payload: ToastPayload): string {
    return JSON.stringify([payload.kind, payload.title, payload.subtitle ?? ''])
  }

  /** Has this exact card already been said inside the window? Ages the ledger on the way past. */
  function isRepeat(payload: ToastPayload, now: number): boolean {
    for (const [key, at] of said) {
      if (now - at >= CELEBRATION_DEDUPE_MS) said.delete(key)
    }
    const key = keyOf(payload)
    const at = said.get(key)
    if (at !== undefined && now - at < CELEBRATION_DEDUPE_MS) return true
    if (said.size >= MAX_DEDUPE_KEYS) said.clear()
    said.set(key, now)
    return false
  }

  /** Send one, and remember the sentence if it did not land. The `catch` is the second lock on a
   *  transport that already promises not to throw: this runs detached from any caller. */
  function send(payload: ToastPayload, at: number, channelId?: string): void {
    void deps
      .post(celebrationEmbed(payload, at), channelId)
      .then((res) => {
        if (res.ok) {
          lastError = undefined
          lastErrorAt = undefined
          return
        }
        lastError = res.error
        lastErrorAt = deps.now()
      })
      .catch(() => {
        lastError = deps.unsetError
        lastErrorAt = deps.now()
      })
  }

  function offer(payload: ToastPayload, nowArg?: number): void {
    const now = nowArg ?? deps.now()
    if (!deps.configured()) return
    const prefs = deps.prefs()
    if (!shouldPostCelebration(prefs, payload)) return
    if (!deps.hasChannel(prefs.channelId)) {
      lastError = deps.unsetError
      lastErrorAt = now
      return
    }
    if (isRepeat(payload, now)) return
    const at = Math.max(now, nextAt)
    nextAt = at + CELEBRATION_POST_SPACING_MS
    if (at <= now) send(payload, now, prefs.channelId)
    else deps.schedule(() => { send(payload, now, prefs.channelId) }, at - now)
  }

  return {
    offer,
    view: () => ({
      prefs: deps.prefs(),
      ...(lastError === undefined ? {} : { lastError }),
      ...(lastErrorAt === undefined ? {} : { lastErrorAt })
    })
  }
}
