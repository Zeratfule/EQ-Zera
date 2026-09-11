// ============================================================================
// shared/discordWebhook.ts — A DISCORD CHANNEL WEBHOOK, AS A THING A USER PASTES IN.
// ============================================================================
//
// The owner's direction (2026-09-10): *"we should also develope a way to export your character
// profile directly to a chat in Discord. that would be cool."* The agreed design is a CHANNEL
// WEBHOOK and nothing else — no bot, no OAuth, no server of ours, no slash commands. The user
// makes one in Discord (channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL)
// and pastes it here; the app POSTs one embed to it.
//
// THIS FILE IS PURE, and it is the FIRST of the two boundaries that decide where those bytes go.
// The second is `src/main/share/discord.ts`, which owns the outbound origin. This one owns the
// READ FILTER, and it is the same argument `share/net.ts parseShareLink` makes: a webhook URL is
// a string a user pasted out of another program, and the main process is about to POST a JSON
// body to it. So it is not "stored as typed and hoped about" — it is PARSED into the only two
// values that matter (`id`, `token`), each re-checked against a CLOSED CHARACTER CLASS, and the
// request URL is REBUILT from them. A string that does not parse never becomes a request.
//
// WHY THE URL IS SPLIT AT ALL rather than stored whole:
//
//   * A stored string is a stored string. Split into `{ id, token }` under closed classes, the
//     value cannot grow a query, a fragment, a second path segment or a host on its way back out
//     of the store - there is nothing in the record that could carry one.
//   * The DISPLAY of a secret is a separate question from the secret (`maskWebhook`), and having
//     the id already apart from the token is what makes the masked form trivial and total: no
//     regex over a live secret, no "the last 4 of whatever this is".
//
// THE TOKEN IS A SECRET AND IS TREATED AS ONE EVERYWHERE ELSE: it is stored main-side, it never
// crosses IPC (only the masked VIEW does — src/main/storeDiscord.ts), and it is never logged
// (src/main/share/discord.ts). Nothing in this file writes one anywhere.

import { characterShareText, type CharacterProfileShare } from './characterShare'

/** A parsed webhook: the two values a request is rebuilt from, and nothing else. */
export interface DiscordWebhook {
  id: string
  token: string
}

/**
 * THE ONLY SHAPE THAT CROSSES IPC. Whether a webhook is set, and what it looks like
 * (`maskWebhook`) - never the token. Declared here rather than in main or in the preload so the
 * two ends of the boundary cannot grow two ideas of what the renderer is allowed to hold.
 */
export interface DiscordWebhookView {
  set: boolean
  masked?: string
}

/** One inline stat tile on the embed. Discord's own field shape. */
export interface DiscordEmbedField {
  name: string
  value: string
  inline: boolean
}

/** The one embed a post carries. Field names are Discord's wire spelling, not ours. */
export interface DiscordEmbed {
  title: string
  /** OPTIONAL since the FIGHT embed (2026-09-11). A character card WRAPS a share link; a fight
   *  card wraps nothing - it IS the message. Discord refuses `url: ''`, so a post with no link
   *  omits the field rather than sending an empty one. */
  url?: string
  description: string
  color: number
  /** OPTIONAL for the same reason, and it carries a second spelling now: a character card names a
   *  URL on the share service, a fight card names `attachment://fight.png` - the picture that rode
   *  along in the same multipart body (src/main/share/discord.ts). */
  image?: { url: string }
  fields: DiscordEmbedField[]
  footer: { text: string }
  timestamp: string
}

/** The whole POST body. `content` is empty on purpose: the embed IS the message. */
export interface DiscordWebhookBody {
  username: string
  avatar_url: string
  content: string
  embeds: DiscordEmbed[]
}

// -------------------------------------------------------------------------------- the parser

/** The only two hosts a webhook may name. `discordapp.com` is the legacy spelling Discord
 *  still hands out in older copy buttons, and refusing it would refuse a real user's real URL. */
const WEBHOOK_HOSTS = new Set(['discord.com', 'discordapp.com'])

/** The one path a webhook lives at. Compared segment by segment, never with `startsWith`. */
const WEBHOOK_PATH: readonly string[] = ['api', 'webhooks']

/** Longest string this will even look at - `share/net.ts MAX_URL_LEN`'s reasoning, same number. */
const MAX_URL_LEN = 2048

/**
 * A webhook id, as Discord mints one: a snowflake, which is decimal digits. The bound is
 * generous rather than exact (17 today, 18 and 19 in the wild, 20 before the epoch runs out) so a
 * future snowflake length is not a silent refusal. CLOSED CLASS, because the value is
 * concatenated into a request path.
 */
const WEBHOOK_ID = /^[0-9]{17,20}$/

/**
 * A webhook token: base64url-ish, 68 characters today. Bounded and closed for the id's reason,
 * and rather more sharply - this is the secret half, and it also lands in a request path.
 */
const WEBHOOK_TOKEN = /^[A-Za-z0-9_-]{60,100}$/

/** Is this an id this app will put in a URL? */
export function isWebhookId(raw: unknown): raw is string {
  return typeof raw === 'string' && WEBHOOK_ID.test(raw)
}

/** Is this a token this app will put in a URL? */
export function isWebhookToken(raw: unknown): raw is string {
  return typeof raw === 'string' && WEBHOOK_TOKEN.test(raw)
}

/** Parse a bounded, trimmed string as a URL. Non-strings, empty, absurdly long and malformed
 *  all -> null. `share/net.ts parseBoundedUrl`'s twin, and deliberately the same shape. */
function parseBoundedUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (text.length === 0 || text.length > MAX_URL_LEN) return null
  try {
    return new URL(text)
  } catch {
    return null
  }
}

/**
 * Is this URL's ORIGIN one this app will speak to about a webhook? https, one of the two hosts by
 * EXACT hostname compare (so `discord.com.evil.com` fails), no credentials, the default port.
 */
function isWebhookOrigin(u: URL): boolean {
  if (u.protocol !== 'https:') return false
  if (!WEBHOOK_HOSTS.has(u.hostname)) return false
  return u.username === '' && u.password === '' && u.port === ''
}

/**
 * A pasted string -> the webhook it names, or null for anything that is not one.
 *
 * ACCEPTED, and exactly this: `https://discord.com/api/webhooks/<id>/<token>` and the same on
 * `discordapp.com`, with or without a trailing slash, with or without a query or fragment (a
 * copy button that appends one has not changed which webhook this is - the query is DROPPED,
 * never carried into the request).
 *
 * REFUSED: http, any other host (an exact hostname compare, so `discord.com.evil.com` fails),
 * any other path, a deeper path, credentials in the URL, a non-default port, and an id or token
 * outside the closed classes above. A bare token is not a webhook and answers null.
 */
export function parseDiscordWebhook(text: unknown): DiscordWebhook | null {
  const u = parseBoundedUrl(text)
  if (u === null || !isWebhookOrigin(u)) return null
  const parts = u.pathname.split('/').filter((p) => p !== '')
  // FOUR SEGMENTS, EXACTLY: `api`, `webhooks`, the id, the token. Three is a webhook with no
  // token; five is `.../slack`, a different endpoint with a different body.
  if (parts.length !== 4) return null
  if (parts[0] !== WEBHOOK_PATH[0] || parts[1] !== WEBHOOK_PATH[1]) return null
  const id = parts[2]
  const token = parts[3]
  return isWebhookId(id) && isWebhookToken(token) ? { id, token } : null
}

/**
 * How a stored webhook is SHOWN: `…/webhooks/<id>/••••<last 4>`.
 *
 * The id is not a secret (it is in the channel's own integration list) and showing it is what
 * lets somebody with two webhooks tell which one this install holds. The token is a secret, so
 * four characters of it survive - enough to recognise, not enough to use.
 */
export function maskWebhook(id: string, token: string): string {
  const tail = token.slice(-4)
  return `…/webhooks/${id}/••••${tail}`
}

// --------------------------------------------------------------------------------- the embed

/** EQ Zera's blue, as Discord takes a colour: one integer, not a CSS string. */
const EMBED_COLOR = 0x5ee6ff

/**
 * The bot name and picture a post wears in the channel.
 *
 * THE LOGO URL IS NOT AN OUTBOUND ORIGIN OF THIS APP'S, which is why naming it here does not
 * cross `share/net.ts`'s law ("the ONLY place the share service's origin is named"). That law is
 * about which hosts THIS PROCESS opens a socket to, and nothing here fetches this URL: it is a
 * string handed to Discord, whose servers render it, and the route is the share service's own
 * (share-server/src/logo.ts serves `/logo.png`). The two URLs this app actually builds - the link
 * and the card - are still minted from `SHARE_ORIGIN` by the caller and are never spelled here.
 */
const POST_USERNAME = 'EQ Zera'
const POST_AVATAR = 'https://share.eqzera.com/logo.png'

/**
 * Discord's own ceilings. Every string below is cut to one of them before it is sent.
 *
 * EXPORTED since the fight embed (`shared/fightShare.ts`): a second embed builder cutting to a
 * second set of numbers is a second opinion about what Discord accepts, and the copy nobody was
 * looking at would be the one that started getting the whole message refused.
 */
export const DISCORD_LIMIT = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048
} as const

const LIMIT = DISCORD_LIMIT

/** The furthest ahead a `capturedAt` may sit before it is not a timestamp - 2100-01-01. */
const MAX_CAPTURED_AT = 4_102_444_800_000

/** The `With gear:` line's own prefix, so the summary can be found rather than counted to. */
const WITH_GEAR = 'With gear:'

/**
 * Cut a string to a ceiling. Discord refuses the whole message over one long field.
 *
 * EXPORTED for `shared/fightShare.ts`, beside the ceilings themselves - see `DISCORD_LIMIT`.
 */
export function cutToDiscordLimit(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max)
}

const cut = cutToDiscordLimit

/**
 * The two lines this embed describes a profile with: the scores line and the `With gear:` line.
 *
 * THEY ARE TAKEN OUT OF `characterShareText`'S OWN OUTPUT rather than rebuilt here, and that is
 * the whole point of this function existing. The plain-text summary, the share page and this
 * embed must say the same words about the same character; three spellings of "Tank 71% · DPS 64%"
 * is three places to disagree, and the two that were not being looked at would be the ones that
 * drifted. So the wording lives in ONE function and this one reads it.
 */
function summaryLines(profile: CharacterProfileShare): string[] {
  const lines = characterShareText(profile).split('\n')
  const at = lines.findIndex((line) => line.startsWith(WITH_GEAR))
  const gear = at < 0 ? undefined : lines[at]
  if (gear === undefined) return []
  const scores = at >= 1 ? lines[at - 1] : undefined
  if (profile.scores === undefined || scores === undefined || scores === '') return [gear]
  return [scores, gear]
}

/** The head line: who this is. Every part may be absent, and then it is simply not said. */
function embedTitle(profile: CharacterProfileShare): string {
  const parts: string[] = [profile.name ?? 'A character']
  if (profile.level !== undefined) parts.push(`Level ${String(profile.level)}`)
  if (profile.classes.length > 0) parts.push(profile.classes.join(' / '))
  return cut(parts.join(' · '), LIMIT.title)
}

/** The four labels the Build tab uses, so the tiles and the card read the same words. */
const SCORE_FIELD: readonly [keyof NonNullable<CharacterProfileShare['scores']>, string][] = [
  ['tank', 'Tank'],
  ['dps', 'DPS'],
  ['heal', 'Healer'],
  ['solo', 'Solo']
]

/**
 * The four readings as inline tiles, or NO TILES AT ALL when the profile carried none.
 *
 * All four or none is the profile's own law (shared/characterShare.ts): a score the Build tab
 * could not compute is omitted, not zero, and four tiles reading 0% would be exactly the
 * invented number world-model law 1 forbids.
 */
function scoreFields(profile: CharacterProfileShare): DiscordEmbedField[] {
  const scores = profile.scores
  if (scores === undefined) return []
  const out: DiscordEmbedField[] = []
  for (const [key, label] of SCORE_FIELD) {
    out.push({
      name: cut(label, LIMIT.fieldName),
      value: cut(`${String(scores[key])}%`, LIMIT.fieldValue),
      inline: true
    })
  }
  return out
}

/** The card's capture instant as Discord takes one, or this moment when the body named none. */
function embedTimestamp(capturedAt: number): string {
  const ms =
    Number.isFinite(capturedAt) && capturedAt > 0 && capturedAt <= MAX_CAPTURED_AT
      ? Math.floor(capturedAt)
      : Date.now()
  return new Date(ms).toISOString()
}

/**
 * The whole POST body for one character.
 *
 * WHAT IT IS: the share LINK, wrapped. The page at `link` already unfurls in Discord with the
 * card and the score line, so the embed is not a second rendering of the profile - it is the
 * link, given a title, the two summary lines, the four score tiles and the card picture, so the
 * message reads as something rather than as a bare URL. `content` is empty because the embed
 * carries all of it; a duplicate line above it would be the same facts twice.
 *
 * `cardUrl` is a URL on the share service, minted by the caller (src/main/ipc/discord.ts) - this
 * file never learns an origin, which is what keeps the origin question in exactly one place.
 */
export function discordEmbedFor(
  profile: CharacterProfileShare,
  link: string,
  cardUrl: string
): DiscordWebhookBody {
  const embed: DiscordEmbed = {
    title: embedTitle(profile),
    url: link,
    description: cut(summaryLines(profile).join('\n'), LIMIT.description),
    color: EMBED_COLOR,
    image: { url: cardUrl },
    fields: scoreFields(profile),
    footer: { text: cut('EQ Zera · eqzera.com', LIMIT.footer) },
    timestamp: embedTimestamp(profile.capturedAt)
  }
  return discordPostBody(embed)
}

/**
 * ONE EMBED, WEARING THIS APP'S NAME AND PICTURE - the envelope every embed post travels in.
 *
 * Its own function so the FIGHT post (`shared/fightShare.ts`) wears the same bot identity as the
 * character post without either file learning the other's strings: two spellings of the username
 * is two bots in one channel as far as anybody scrolling past it is concerned. `content` is empty
 * on both for the reason it always was - the embed IS the message.
 */
export function discordPostBody(embed: DiscordEmbed): DiscordWebhookBody {
  return { username: POST_USERNAME, avatar_url: POST_AVATAR, content: '', embeds: [embed] }
}

/** What the Test button posts: one plain line, no embed, so a channel sees the wiring work. */
export function discordTestBody(): { username: string; content: string } {
  return {
    username: POST_USERNAME,
    content: 'EQ Zera connected. Character cards you post will appear here.'
  }
}
