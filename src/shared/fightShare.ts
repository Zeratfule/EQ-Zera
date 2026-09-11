// ============================================================================
// shared/fightShare.ts — A FIGHT, AS THE THING A PLAYER POSTS IN A CHANNEL.
// ============================================================================
//
// The owner's direction (2026-09-11): *"We should also make the Discord sharing be able to have
// DPS meter sharing also."* The agreed shape is the one the character card already established: a
// PICTURE of the meter attached to the message, plus an EMBED carrying the same numbers as text,
// so the fight reads on a phone, in a search, and for anyone whose client will not load an image.
//
// THIS FILE IS PURE, and it is the WIRE SHAPE plus the three renderings of it:
//
//   `buildFightShare`    the Combat tab's selected fight (`SegmentView`) -> `FightShare`
//   `fightShareText`     the plain-text summary (Copy text, and the embed's own description)
//   `discordFightEmbed`  the embed Discord draws
//
// WHY A WIRE SHAPE AT ALL, rather than handing `SegmentView` around. Three reasons, and the third
// is the load-bearing one:
//
//   * `SegmentView` is ENORMOUS - per-skill rows, rounds, procs, healing lanes, defense. A Discord
//     message needs eight numbers per combatant, and shipping the rest across IPC to be thrown
//     away is a payload nobody reads.
//   * The card, the text and the embed must say THE SAME numbers. They read one object, so they
//     cannot drift the way three readings of the segment would.
//   * IT CROSSES THE TRUST BOUNDARY. The renderer builds it and main posts it, so main
//     RE-VALIDATES every field (`sanitizeFightShare`) before a single byte reaches a socket - the
//     same discipline `sanitizeCharacterShare` keeps, for the same reason: the handler validates,
//     it does not trust its only caller being this app's own UI.
//
// NOTHING HERE IS DERIVED THAT THE FOLD DID NOT ALREADY STATE (world-model law 1). Damage, dps and
// duration are the engine's own; `share` is the one arithmetic, and it is a ratio of two numbers
// that are both on the segment (`SourceView.total` over `SegmentView.outTotal`) rather than
// `SourceView.pct`, which is a BAR FILL - a fraction of the largest row, not of the fight.

import {
  DISCORD_LIMIT,
  cutToDiscordLimit as cut,
  discordPostBody,
  type DiscordEmbed,
  type DiscordEmbedField,
  type DiscordWebhookBody
} from './discordWebhook'
import type { SegmentView, SourceView } from './combat'

/** One combatant's row, as the card, the text and the embed all read it. */
export interface FightShareMember {
  /** RAW display name, exactly as the log spelled it (law 2: canonicalize at boundaries, display raw). */
  name: string
  damage: number
  dps: number
  /** This member's share of `FightShare.totalDamage`, 0..1. Never a bar fill - see the header. */
  share: number
  isYou: boolean
  /** A pet - yours or an ally's. Absent rather than false, so the wire shape stays small. */
  pet?: boolean
}

/** ONE FIGHT, AS IT TRAVELS. Built in the renderer, re-validated in main, posted by main. */
export interface FightShare {
  v: 1
  /** the encounter's own name - the mob, with world-model law 6's `+N others` suffix intact */
  mob: string
  /** the zone it happened in, when the log had said one (a session that starts mid-zone has not) */
  zone?: string
  /** epoch ms of the fight's first attributed damage, or 0 when nothing stated one */
  startedAt: number
  durationMs: number
  totalDamage: number
  /** every combatant, damage-descending, capped at `MAX_MEMBERS` */
  members: FightShareMember[]
  /** YOUR two numbers, lifted out so the embed's tiles do not have to find your row */
  you: { dps: number; share: number }
}

// ------------------------------------------------------------------------------------ the bounds

/**
 * How many combatants one share carries.
 *
 * A raid fight can name far more than this, and the cap is about what a PICTURE and a chat message
 * can carry rather than about what the engine knows: 24 rows is already a tall card, and the rows
 * below it are the ones nobody scrolls to. The cut is from the BOTTOM of a damage-descending list,
 * so what is dropped is always the smallest contribution.
 */
export const MAX_MEMBERS = 24

/** …and how many of those the EMBED prints before it says how many more there were. */
export const MAX_EMBED_ROWS = 15

/** Longest name this will hold. A meter row, not a paragraph. */
const MAX_NAME = 48

/** …and the longest zone name, same reasoning. */
const MAX_ZONE = 64

/** The furthest ahead a `startedAt` may sit before it is not a timestamp - 2100-01-01. */
const MAX_STARTED_AT = 4_102_444_800_000

/** The attached picture's file name, and the `attachment://` reference that names it in the embed.
 *  ONE spelling, read by the embed builder AND by the multipart sender (src/main/share/discord.ts). */
export const FIGHT_CARD_FILE = 'fight.png'
export const FIGHT_CARD_TYPE = 'image/png'

/** EQ Zera's damage red, as Discord takes a colour: one integer, not a CSS string. */
const FIGHT_EMBED_COLOR = 0xff6b6b

/** What a fight with no name at all is called. The engine always names one; this is the floor. */
const UNNAMED_FIGHT = 'A fight'

/** …and a combatant the log somehow named with nothing. */
const UNNAMED_MEMBER = 'Unknown'

// ------------------------------------------------------------------------------------ the atoms

/** A finite number at or above zero, or 0. Every number in the shape goes through this. */
function atLeastZero(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0
}

/** …rounded to whole points, which is the only resolution a damage total has. */
function wholeNumber(raw: unknown): number {
  return Math.round(atLeastZero(raw))
}

/** …and to one decimal, which is what a rate is worth carrying across a wire. */
function rate(raw: unknown): number {
  return Math.round(atLeastZero(raw) * 10) / 10
}

/** A fraction, clamped into 0..1. A share outside it is a broken caller, not a bigger share. */
function fraction(raw: unknown): number {
  const n = atLeastZero(raw)
  return n > 1 ? 1 : n
}

/**
 * A name, made safe to DRAW and to CUT: control characters (newlines included) become spaces, it is
 * trimmed, and it is cut to `max`.
 *
 * A mob name is text from a log file and a member name is text another player chose, so what this
 * defends is the LAYOUT (a name with a newline in it is a card row that is suddenly two rows tall,
 * and a code block that suddenly has an extra line) and the message budget. There is no markup
 * hazard - the card is React and the embed is JSON - and none is claimed.
 *
 * Walked rather than regexed: a control-character CLASS in a regex is exactly what
 * `no-control-regex` exists to complain about, and the loop says the same thing in the open. It is
 * `shared/discordChannels.ts cleanName`'s twin, and deliberately the same shape.
 */
function cleanName(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  let flat = ''
  for (const ch of raw.slice(0, max * 2)) {
    const code = ch.codePointAt(0) ?? 0
    flat += code < 0x20 || code === 0x7f ? ' ' : ch
  }
  return flat.trim().slice(0, max).trim()
}

// ----------------------------------------------------------------------------------- the builder

/** Is this source a pet - yours, or somebody else's charm (JOS-250)? Both draw as pets. */
function isPetKind(kind: SourceView['kind']): boolean {
  return kind === 'pet' || kind === 'allyPet'
}

/** One `SourceView` -> one row. `total` is the fight's, because share is a share OF THE FIGHT. */
function memberOf(source: SourceView, total: number): FightShareMember {
  const damage = wholeNumber(source.total)
  return {
    name: cleanName(source.name, MAX_NAME) || UNNAMED_MEMBER,
    damage,
    dps: rate(source.dps),
    share: total > 0 ? damage / total : 0,
    isYou: source.kind === 'you',
    ...(isPetKind(source.kind) ? { pet: true } : {})
  }
}

/**
 * THE COMBAT TAB'S SELECTED FIGHT -> the thing that gets posted.
 *
 * `startedAt` is a SECOND ARGUMENT rather than a field of the segment, because `SegmentView` does
 * not carry one - the start instant lives on the matching `SegmentSummary` (`segments[]`), which is
 * where the caller reads it. Handing 0 is legal and honest: it means nothing stated when this
 * fight began, and the embed then timestamps itself at the moment of posting rather than inventing
 * a start (law 1).
 *
 * ENEMIES ARE NOT HERE, and that is the segment's own shape rather than a filter: `entities` is the
 * OUTGOING list (you, your pets, group-mates, allies), and what is hitting you lives in `incoming`.
 * A DPS meter share is the outgoing meter, which is the meter the owner asked for.
 */
export function buildFightShare(fight: SegmentView, startedAt: number): FightShare {
  const total = wholeNumber(fight.outTotal)
  const ranked = [...fight.entities].sort((a, b) => b.total - a.total).slice(0, MAX_MEMBERS)
  // YOUR row is found in the FULL list, not in the capped one: being outside the top 24 of a raid
  // is exactly the moment the two tiles are worth reading.
  const you = fight.entities.find((e) => e.kind === 'you')
  const zone = cleanName(fight.zone, MAX_ZONE)
  return {
    v: 1,
    mob: cleanName(fight.name, MAX_NAME) || UNNAMED_FIGHT,
    ...(zone === '' ? {} : { zone }),
    startedAt: startedAt > 0 && startedAt <= MAX_STARTED_AT ? Math.floor(startedAt) : 0,
    durationMs: Math.round(atLeastZero(fight.durationSec) * 1000),
    totalDamage: total,
    members: ranked.map((e) => memberOf(e, total)),
    you: {
      dps: you === undefined ? 0 : rate(you.dps),
      share: you === undefined || total === 0 ? 0 : wholeNumber(you.total) / total
    }
  }
}

// ---------------------------------------------------------------------------------- the re-check

/** One member row, RE-VALIDATED. Anything that is not a row at all is dropped entirely. */
function sanitizeMember(raw: unknown): FightShareMember | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = cleanName(r.name, MAX_NAME)
  if (name === '') return null
  return {
    name,
    damage: wholeNumber(r.damage),
    dps: rate(r.dps),
    share: fraction(r.share),
    isYou: r.isYou === true,
    ...(r.pet === true ? { pet: true } : {})
  }
}

/** The rows of a renderer-supplied list, re-validated and re-capped. Never throws on a non-list. */
function sanitizeMembers(raw: unknown): FightShareMember[] {
  const out: FightShareMember[] = []
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_MEMBERS) break
    const member = sanitizeMember(item)
    if (member !== null) out.push(member)
  }
  return out
}

/**
 * A RENDERER-SUPPLIED FIGHT -> the fight main will post, or null when there is nothing to post.
 *
 * THE HANDLER VALIDATES; it does not trust the fact that today's only caller is this app's own
 * share dialog (AGENTS.md, the trust boundary). Every number is re-clamped, every string re-cut,
 * the member list re-capped, and a body with no members at all is refused - a fight card with no
 * rows on it is not a thing to put in somebody's channel.
 *
 * It DEGRADES rather than refusing wherever it honestly can (a broken number reads as 0, a member
 * without a name falls out) for `sanitizeChannel`'s reason: the message is the point, and losing
 * the whole post over one field is the worse failure.
 */
export function sanitizeFightShare(raw: unknown): FightShare | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const members = sanitizeMembers(r.members)
  if (members.length === 0) return null
  const zone = cleanName(r.zone, MAX_ZONE)
  const you = (r.you && typeof r.you === 'object' ? r.you : {}) as Record<string, unknown>
  const startedAt = wholeNumber(r.startedAt)
  return {
    v: 1,
    mob: cleanName(r.mob, MAX_NAME) || UNNAMED_FIGHT,
    ...(zone === '' ? {} : { zone }),
    startedAt: startedAt <= MAX_STARTED_AT ? startedAt : 0,
    durationMs: wholeNumber(r.durationMs),
    totalDamage: wholeNumber(r.totalDamage),
    members,
    you: { dps: rate(you.dps), share: fraction(you.share) }
  }
}

// ------------------------------------------------------------------------------------ the words

/**
 * A whole number with thousands separators: `31,204`.
 *
 * DELIBERATELY NOT `lib/formatRate` (AGENTS.md, Formatting). That rule is about the METERS - every
 * bar, overlay, drill-down and tooltip scales to `31.2k` so the app reads one way. This string is
 * not a meter: it is a line in somebody's chat client, where the exact number is the point of
 * quoting it, and `31.2k dps` beside `31,204` in the same channel is two apps' worth of voice.
 * The CARD, which is a meter, uses `formatRate` like every other meter in the app.
 *
 * The locale is pinned so the same fight produces the same message on every machine.
 */
function num(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** A share as a whole percent: `42%`. */
function pct(share: number): string {
  return `${String(Math.round(share * 100))}%`
}

/** A duration as a clock: `2:41`. `m:ss`, the one spelling every combat surface already uses. */
export function fightClock(durationMs: number): string {
  const s = Math.max(0, Math.round(durationMs / 1000))
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`
}

/** One ranked line: `1. Zeratfule 31,204 (471 dps, 42%)`. */
function memberLine(member: FightShareMember, rank: number): string {
  return `${String(rank)}. ${member.name} ${num(member.damage)} (${num(member.dps)} dps, ${pct(member.share)})`
}

/** The one-line headline: who, where, how long, how much. Zone only when the log stated one. */
export function fightHeadline(f: FightShare): string {
  const bits = [f.mob]
  if (f.zone !== undefined) bits.push(f.zone)
  bits.push(fightClock(f.durationMs), `${num(f.totalDamage)} damage`)
  return bits.join(' · ')
}

/**
 * THE PLAIN-TEXT SUMMARY: the headline, then one line per member.
 *
 * Two callers, one wording (the `characterShareText` argument, restated): the dialog's Copy text
 * button, and the embed's own description - so a reader who copied the text and a reader looking
 * at the post are reading the same sentences, and there is nowhere for a second spelling to live.
 */
export function fightShareText(f: FightShare): string {
  const lines = [fightHeadline(f)]
  let rank = 0
  for (const member of f.members) {
    rank += 1
    lines.push(memberLine(member, rank))
  }
  return lines.join('\n')
}

// ------------------------------------------------------------------------------------ the embed

/**
 * The ranked rows as a CODE BLOCK, capped, with an honest tail.
 *
 * A code block rather than prose because it is a table: Discord renders it monospaced, so the
 * numbers line up in a column instead of ragging against proportional text. The cap is 15 rows
 * because an embed is a glance - the picture beside it carries all 24, and `+N more` says so
 * rather than letting the reader believe the fight had fifteen people in it.
 */
function embedRows(f: FightShare): string {
  const lines: string[] = []
  let rank = 0
  for (const member of f.members) {
    rank += 1
    if (rank > MAX_EMBED_ROWS) break
    lines.push(memberLine(member, rank))
  }
  const hidden = f.members.length - lines.length
  if (hidden > 0) lines.push(`+${String(hidden)} more`)
  return `\`\`\`\n${lines.join('\n')}\n\`\`\``
}

/** The three inline tiles: your rate, your slice, and how long it took. */
function fightFields(f: FightShare): DiscordEmbedField[] {
  const tiles: [string, string][] = [
    ['Your DPS', `${num(f.you.dps)} dps`],
    ['Your share', pct(f.you.share)],
    ['Duration', fightClock(f.durationMs)]
  ]
  return tiles.map(([name, value]) => ({
    name: cut(name, DISCORD_LIMIT.fieldName),
    value: cut(value, DISCORD_LIMIT.fieldValue),
    inline: true
  }))
}

/**
 * THE WHOLE POST BODY FOR ONE FIGHT.
 *
 * `cardAttached` is whether a picture rode along in the same request (src/main/share/discord.ts's
 * multipart path). When it did, the embed points at it by the name the file was sent under -
 * `attachment://fight.png`, Discord's own spelling for "the file in this message" - and Discord
 * draws it inside the embed rather than as a bare attachment below it. When the capture failed the
 * field is simply ABSENT and the numbers post on their own: a message that says what happened
 * beats no message, and an `image` naming a file that is not there renders as a broken picture.
 *
 * The TIMESTAMP is the fight's own start when the fold stated one, else the moment of posting -
 * the same ladder `discordEmbedFor` walks for a card's capture instant, and for the same reason.
 */
export function discordFightEmbed(f: FightShare, cardAttached: boolean): DiscordWebhookBody {
  const embed: DiscordEmbed = {
    title: cut(`${f.mob} · ${fightClock(f.durationMs)} · ${num(f.totalDamage)} damage`, DISCORD_LIMIT.title),
    description: cut(embedRows(f), DISCORD_LIMIT.description),
    color: FIGHT_EMBED_COLOR,
    ...(cardAttached ? { image: { url: `attachment://${FIGHT_CARD_FILE}` } } : {}),
    fields: fightFields(f),
    footer: { text: cut('EQ Zera · eqzera.com', DISCORD_LIMIT.footer) },
    timestamp: new Date(f.startedAt > 0 ? f.startedAt : Date.now()).toISOString()
  }
  return discordPostBody(embed)
}
