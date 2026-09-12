// ============================================================================
// shared/sessionShare.ts — A PLAY SESSION, AS THE THING A PLAYER POSTS IN A CHANNEL.
// ============================================================================
//
// The Overview's "Last session" card already answers the one question nobody has to choose a range
// for: what last night was worth. This file is that card's wire shape, so the same answer can leave
// the app - as a picture, as a line of chat, or as a Discord post with both.
//
// IT IS `fightShare.ts` APPLIED TO A SESSION, deliberately and structurally: the same three
// renderings of one object, the same re-validation at the trust boundary, the same attachment
// spelling, the same footer. A session card that invented its own vocabulary would be a second
// dialect of the same feature.
//
//   `buildSessionShare`    the card's own inputs -> `SessionShare`
//   `sessionShareText`     the plain-text summary (Copy text, and the embed's own description)
//   `discordSessionEmbed`  the embed Discord draws
//
// ---------------------------------------------------------------------------
// THERE IS NO EXPERIENCE NUMBER IN THIS APP, AND THIS FILE MUST NOT INVENT ONE
// ---------------------------------------------------------------------------
// The log states a level-bar PERCENTAGE and nothing else, so the only honest currencies here are
// LEVELS OF PROGRESS (`levelEquiv`, Σ of the stated percentages / 100), the dings themselves
// (`levelUps`) and KILLS. `xp`, `exp` and every points-shaped word are absent on purpose - a
// share card is exactly where a fabricated number would travel furthest.
//
// ---------------------------------------------------------------------------
// WHY A WIRE SHAPE, AND WHY IT IS BUILT FROM PIECES RATHER THAN FROM A SNAPSHOT
// ---------------------------------------------------------------------------
// The card's facts come from four owners that never meet: the progression range query
// (`rangeStats`), the loot feed, the death recaps and the combat engine's segments. `buildSessionShare`
// takes the NARROWEST structural view of each - the fields it reads and no more - so this file can
// be node-tested with no React, no Electron and no module transport, and so a caller may hand it the
// real objects unchanged (`RangeStats`, `DropRow`, `SegmentSummary` all satisfy their slot).
//
// AND IT CROSSES THE TRUST BOUNDARY. The renderer composes it and main posts it, so main
// RE-VALIDATES every field (`sanitizeSessionShare`) before a byte reaches a socket - the discipline
// `sanitizeFightShare` states at length, for the same reason.

import {
  DISCORD_LIMIT,
  cutToDiscordLimit as cut,
  discordPostBody,
  type DiscordEmbed,
  type DiscordEmbedField,
  type DiscordWebhookBody
} from './discordWebhook'

/** One item the session produced, and how many of it. Counts are stack sizes, as the log wrote them. */
export interface SessionShareDrop {
  name: string
  count: number
}

/** The hardest hit of the night, when the snapshot still held the fight that was it. */
export interface SessionShareFight {
  name: string
  dps: number
  durationSec: number
  zone?: string
}

/** ONE SESSION, AS IT TRAVELS. Built in the renderer, re-validated in main, posted by main. */
export interface SessionShare {
  v: 1
  /** the character the log is for, when one is known */
  character?: string
  /** the loadout in force at the session's end - `PAL`, `CLR|PAL`; an unknown slot is simply absent */
  classes: string[]
  /** the level stated at the time, when anything stated one */
  level?: number
  /** the session's bounds, as two logouts the log actually printed (lastSession.ts states which two) */
  t0: number
  t1: number
  durationMs: number
  /** of that, the part the range query calls play rather than silence or absence */
  activeMs: number
  /** where it happened, in the order the range query grouped them */
  zones: string[]
  kills: number
  /** kills per hour of ACTIVE time, or 0 when the range had no active time to divide by */
  killsPerHour: number
  /** Σ stated level-bar percent / 100 - "levels of progress", never experience points */
  levelEquiv: number
  /** the levels reached inside the session, in order */
  levelUps: number[]
  deaths: number
  /** what was looted, biggest stack first, capped at `MAX_DROPS` */
  drops: SessionShareDrop[]
  /** `12p 5g`, per denomination and never converted (coinTypes.ts's law). Absent when none landed. */
  coin?: string
  bestFight?: SessionShareFight
}

// ------------------------------------------------------------------------------------ the bounds

/** How many item names one share carries. A card is a glance; the Loot tab is the ledger. */
export const MAX_DROPS = 12

/** …how many zone names, before the rest are counted rather than named. */
export const MAX_ZONES = 8

/** …how many dings. A session with more than this many is a session with a story, not a list. */
export const MAX_LEVEL_UPS = 12

/** …and how many loadout slots. EQ Legends gives a character two, then three. */
export const MAX_CLASSES = 4

/** Longest name this will hold. A card row, not a paragraph. */
const MAX_NAME = 48

/** …the longest zone name, same reasoning. */
const MAX_ZONE = 64

/** …and the longest coin string (`12p 5g 3s 2c` is already the whole ladder). */
const MAX_COIN = 32

/** The furthest ahead a timestamp may sit before it is not a timestamp - 2100-01-01. */
const MAX_TS = 4_102_444_800_000

/** The longest session this will believe: 30 days. Beyond that the log stated something else. */
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000

/** The highest level this will carry. EQ Legends' cap moves; this is a shape check, not a rule. */
const MAX_LEVEL = 200

/** The attached picture's file name, and the `attachment://` reference that names it in the embed.
 *  ONE spelling, read by the embed builder AND by the multipart sender (src/main/share/discord.ts). */
export const SESSION_CARD_FILE = 'session.png'
export const SESSION_CARD_TYPE = 'image/png'

/** EQ Zera's accent cyan, as Discord takes a colour: one integer, not a CSS string. */
const SESSION_EMBED_COLOR = 0x5ee6ff

/** What an item the log somehow named with nothing is called. */
const UNNAMED_ITEM = 'Something'

/** …and a fight with no name at all. The engine always names one; this is the floor. */
const UNNAMED_FIGHT = 'A fight'

// ------------------------------------------------------------------------------------ the atoms

/** A finite number at or above zero, or 0. Every number in the shape goes through this. */
function atLeastZero(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0
}

/** …rounded to whole units, which is the only resolution a count or a duration has here. */
function wholeNumber(raw: unknown): number {
  return Math.round(atLeastZero(raw))
}

/** …and to one decimal, which is what a rate is worth carrying across a wire. */
function rate(raw: unknown): number {
  return Math.round(atLeastZero(raw) * 10) / 10
}

/** Levels of progress, to two decimals - the resolution the card itself prints. */
function levels(raw: unknown): number {
  return Math.round(atLeastZero(raw) * 100) / 100
}

/** A timestamp, or 0 when nothing stated one. */
function instant(raw: unknown): number {
  const n = wholeNumber(raw)
  return n <= MAX_TS ? n : 0
}

/**
 * A name, made safe to DRAW and to CUT: control characters (newlines included) become spaces, it is
 * trimmed, and it is cut to `max`.
 *
 * `fightShare.ts cleanName`'s twin, deliberately the same shape and for the same reason: what it
 * defends is the LAYOUT and the message budget, not a markup hazard (the card is React, the embed
 * is JSON). Walked rather than regexed because a control-character CLASS in a regex is exactly what
 * `no-control-regex` exists to complain about.
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

/** A list of names, cleaned, de-duplicated and capped. Order is the caller's; nothing is sorted. */
function cleanNames(raw: unknown, max: number, cap: number): string[] {
  const out: string[] = []
  for (const item of Array.isArray(raw) ? (raw as unknown[]) : []) {
    if (out.length >= cap) break
    const name = cleanName(item, max)
    if (name !== '' && !out.includes(name)) out.push(name)
  }
  return out
}

// ----------------------------------------------------------------------------------- the builder

/** What `rangeStats` answers, narrowed to what a session card reads. `RangeStats` satisfies it. */
export interface SessionRangeStats {
  kills: number
  levelEquiv: number
  activeMs: number
  killsPerHourActive: number | null
  levelUps: readonly { ts: number; level: number }[]
  zones: readonly { zone: string }[]
}

/** The card's own bounds and the one string it composes itself. `LastSessionView` satisfies it. */
export interface SessionRange {
  t0: number
  t1: number
  durationMs: number
  /** `12p 5g`, or '' when no coin line landed inside the range. */
  coin: string
}

/** One looted row, narrowed. The Overview feed's `DropRow` satisfies it. */
export interface SessionDropSource {
  ts: number
  item: string
  count?: number
}

/** One finalized fight, narrowed. `SegmentSummary` satisfies it. */
export interface SessionFightSource {
  kind: 'fight' | 'zone' | 'current'
  name: string
  zone?: string
  durationSec: number
  dps: number
  startTs: number
}

/** Everything `buildSessionShare` reads, from the four owners that answer a session. */
export interface SessionShareInput {
  character?: string
  classes?: readonly string[]
  level?: number
  session: SessionRange
  stats: SessionRangeStats
  deaths: number
  drops: readonly SessionDropSource[]
  fights: readonly SessionFightSource[]
}

/** The zones the range covered, in the order the query grouped them. A walk, never a filter. */
function zonesOf(stats: SessionRangeStats): string[] {
  const names: string[] = []
  for (const row of stats.zones) {
    if (names.length >= MAX_ZONES) break
    const zone = cleanName(row.zone, MAX_ZONE)
    if (zone !== '' && !names.includes(zone)) names.push(zone)
  }
  return names
}

/** The dings inside the range, as levels. A walk, for `zonesOf`'s reason. */
function levelUpsOf(stats: SessionRangeStats): number[] {
  const out: number[] = []
  for (const up of stats.levelUps) {
    if (out.length >= MAX_LEVEL_UPS) break
    const level = wholeNumber(up.level)
    if (level > 0 && level <= MAX_LEVEL) out.push(level)
  }
  return out
}

/**
 * What was looted INSIDE the session, biggest stack first.
 *
 * The window test is the point: the feed this reads is the app's RECENT drops (the newest rows
 * whatever session they belong to), and a session card that listed tonight's pickups under last
 * night's heading would be the quietest kind of wrong. A stack of 1 is what the log means by a line
 * that named no count.
 */
function dropsOf(rows: readonly SessionDropSource[], t0: number, t1: number): SessionShareDrop[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (row.ts < t0 || row.ts >= t1) continue
    const name = cleanName(row.item, MAX_NAME) || UNNAMED_ITEM
    counts.set(name, (counts.get(name) ?? 0) + Math.max(1, wholeNumber(row.count)))
  }
  const out: SessionShareDrop[] = []
  for (const [name, count] of counts) out.push({ name, count })
  out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return out.slice(0, MAX_DROPS)
}

/**
 * The hardest fight the snapshot still holds from inside the session, or undefined.
 *
 * IT IS RANKED HERE rather than taken from anything's order: the segments arrive newest-first and
 * "best" is a rate, not a recency. A ZONE row is not a fight - it is the aggregate over one - and a
 * fight that started outside the window belongs to another session, so both fall out. Undefined is
 * the COMMON answer and an honest one: the Overview's snapshot asks for one finalized segment, so a
 * session that ended before the app started usually has none of its fights left to rank.
 */
function bestFightOf(fights: readonly SessionFightSource[], t0: number, t1: number): SessionShareFight | undefined {
  let best: SessionFightSource | null = null
  for (const fight of fights) {
    if (fight.kind === 'zone') continue
    if (fight.startTs < t0 || fight.startTs >= t1) continue
    if (!(fight.dps > 0)) continue
    if (best === null || fight.dps > best.dps) best = fight
  }
  if (best === null) return undefined
  const zone = cleanName(best.zone, MAX_ZONE)
  return {
    name: cleanName(best.name, MAX_NAME) || UNNAMED_FIGHT,
    dps: rate(best.dps),
    durationSec: rate(best.durationSec),
    ...(zone === '' ? {} : { zone })
  }
}

/** THE CARD'S OWN FACTS -> the thing that gets posted. Pure; every bound is applied here. */
export function buildSessionShare(input: SessionShareInput): SessionShare {
  const t0 = instant(input.session.t0)
  const t1 = instant(input.session.t1)
  const character = cleanName(input.character, MAX_NAME)
  const coin = cleanName(input.session.coin, MAX_COIN)
  const level = wholeNumber(input.level)
  const best = bestFightOf(input.fights, t0, t1)
  return {
    v: 1,
    ...(character === '' ? {} : { character }),
    classes: cleanNames(input.classes, MAX_NAME, MAX_CLASSES),
    ...(level > 0 && level <= MAX_LEVEL ? { level } : {}),
    t0,
    t1,
    durationMs: Math.min(MAX_DURATION_MS, wholeNumber(input.session.durationMs)),
    activeMs: Math.min(MAX_DURATION_MS, wholeNumber(input.stats.activeMs)),
    zones: zonesOf(input.stats),
    kills: wholeNumber(input.stats.kills),
    killsPerHour: rate(input.stats.killsPerHourActive),
    levelEquiv: levels(input.stats.levelEquiv),
    levelUps: levelUpsOf(input.stats),
    deaths: wholeNumber(input.deaths),
    drops: dropsOf(input.drops, t0, t1),
    ...(coin === '' ? {} : { coin }),
    ...(best === undefined ? {} : { bestFight: best })
  }
}

// ---------------------------------------------------------------------------------- the re-check

/** One drop row, RE-VALIDATED. Anything that is not a row at all is dropped entirely. */
function sanitizeDrop(raw: unknown): SessionShareDrop | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = cleanName(r.name, MAX_NAME)
  if (name === '') return null
  return { name, count: Math.max(1, wholeNumber(r.count)) }
}

/** The rows of a renderer-supplied list, re-validated and re-capped. Never throws on a non-list. */
function sanitizeDrops(raw: unknown): SessionShareDrop[] {
  const out: SessionShareDrop[] = []
  for (const item of Array.isArray(raw) ? (raw as unknown[]) : []) {
    if (out.length >= MAX_DROPS) break
    const drop = sanitizeDrop(item)
    if (drop !== null) out.push(drop)
  }
  return out
}

/** The dings, re-validated. A level outside the shape check is dropped, never clamped. */
function sanitizeLevelUps(raw: unknown): number[] {
  const out: number[] = []
  for (const item of Array.isArray(raw) ? (raw as unknown[]) : []) {
    if (out.length >= MAX_LEVEL_UPS) break
    const level = wholeNumber(item)
    if (level > 0 && level <= MAX_LEVEL) out.push(level)
  }
  return out
}

/** The best fight, re-validated, or undefined when the body carried nothing that is one. */
function sanitizeBestFight(raw: unknown): SessionShareFight | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const dps = rate(r.dps)
  if (dps <= 0) return undefined
  const zone = cleanName(r.zone, MAX_ZONE)
  return {
    name: cleanName(r.name, MAX_NAME) || UNNAMED_FIGHT,
    dps,
    durationSec: rate(r.durationSec),
    ...(zone === '' ? {} : { zone })
  }
}

/**
 * A RENDERER-SUPPLIED SESSION -> the session main will post, or null when there is nothing to post.
 *
 * THE HANDLER VALIDATES; it does not trust the fact that today's only caller is this app's own
 * share dialog (AGENTS.md, the trust boundary). Every number is re-clamped, every string re-cut and
 * every list re-capped, and a body that states no duration at all is refused - a session card with
 * no session in it is not a thing to put in somebody's channel.
 *
 * It DEGRADES rather than refusing wherever it honestly can (a broken number reads as 0, a drop
 * without a name falls out) for `sanitizeFightShare`'s reason: the message is the point, and losing
 * the whole post over one field is the worse failure.
 */
export function sanitizeSessionShare(raw: unknown): SessionShare | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const durationMs = Math.min(MAX_DURATION_MS, wholeNumber(r.durationMs))
  if (durationMs <= 0) return null
  const character = cleanName(r.character, MAX_NAME)
  const coin = cleanName(r.coin, MAX_COIN)
  const level = wholeNumber(r.level)
  const best = sanitizeBestFight(r.bestFight)
  return {
    v: 1,
    ...(character === '' ? {} : { character }),
    classes: cleanNames(r.classes, MAX_NAME, MAX_CLASSES),
    ...(level > 0 && level <= MAX_LEVEL ? { level } : {}),
    t0: instant(r.t0),
    t1: instant(r.t1),
    durationMs,
    activeMs: Math.min(durationMs, wholeNumber(r.activeMs)),
    zones: cleanNames(r.zones, MAX_ZONE, MAX_ZONES),
    kills: wholeNumber(r.kills),
    killsPerHour: rate(r.killsPerHour),
    levelEquiv: levels(r.levelEquiv),
    levelUps: sanitizeLevelUps(r.levelUps),
    deaths: wholeNumber(r.deaths),
    drops: sanitizeDrops(r.drops),
    ...(coin === '' ? {} : { coin }),
    ...(best === undefined ? {} : { bestFight: best })
  }
}

// ------------------------------------------------------------------------------------- the words

/**
 * A whole number with thousands separators: `31,204`.
 *
 * `fightShare.ts num`'s twin and deliberately not `lib/formatRate`: this string is a line in
 * somebody's chat client, where the exact number is the point of quoting it. The CARD, which is a
 * meter, uses `formatRate` like every other meter in the app. The locale is pinned so the same
 * session produces the same message on every machine.
 */
function num(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/**
 * A session's length as a person says it: `2d 4h`, `3h 12m`, `45m`, `20s`.
 *
 * The renderer's `fmtDuration` ladder, restated here because the CARD, the TEXT and the EMBED must
 * all say one duration and only one of those three is a React component. A session is hours long,
 * so `fightClock`'s `m:ss` is the wrong instrument entirely.
 */
export function sessionDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const hrs = Math.floor(total / 3600)
  if (hrs >= 48) return `${String(Math.floor(hrs / 24))}d ${String(hrs % 24)}h`
  const mins = Math.floor((total % 3600) / 60)
  if (hrs > 0) return `${String(hrs)}h ${String(mins)}m`
  return mins > 0 ? `${String(mins)}m` : `${String(total % 60)}s`
}

/** `1 death` / `3 deaths`. The one place this app pluralizes a session word. */
function deathText(n: number): string {
  return `${String(n)} ${n === 1 ? 'death' : 'deaths'}`
}

/** `Primitive (PAL / ROG) level 46 · 3h 12m in Befallen, Guk` - who, how long, and where. */
export function sessionHeadline(s: SessionShare): string {
  const who: string[] = []
  if (s.character !== undefined) who.push(s.character)
  if (s.classes.length > 0) who.push(`(${s.classes.join(' / ')})`)
  if (s.level !== undefined) who.push(`level ${String(s.level)}`)
  const where = s.zones.length > 0 ? ` in ${s.zones.join(', ')}` : ''
  const bits: string[] = []
  if (who.length > 0) bits.push(who.join(' '))
  bits.push(`${sessionDuration(s.durationMs)}${where}`)
  return bits.join(' · ')
}

/** `412 kills (38.5/h) · +2.31 levels · 1 death · best fight a fire giant warrior 1,204 DPS`. */
export function sessionTally(s: SessionShare): string {
  const bits = [
    s.killsPerHour > 0 ? `${num(s.kills)} kills (${String(s.killsPerHour)}/h)` : `${num(s.kills)} kills`,
    `+${s.levelEquiv.toFixed(2)} levels`,
    deathText(s.deaths)
  ]
  if (s.bestFight !== undefined) {
    bits.push(`best fight ${s.bestFight.name} ${num(s.bestFight.dps)} DPS`)
  }
  return bits.join(' · ')
}

/** `drops: Bone Chips x4, Rusty Dagger`, or '' when nothing was named. */
function dropText(s: SessionShare): string {
  if (s.drops.length === 0) return ''
  const parts: string[] = []
  for (const drop of s.drops) parts.push(drop.count > 1 ? `${drop.name} x${String(drop.count)}` : drop.name)
  return `drops: ${parts.join(', ')}`
}

/**
 * THE PLAIN-TEXT SUMMARY: who and how long, then the tally, then what came out of it.
 *
 * Two callers, one wording (`fightShareText`'s argument, restated): the dialog's Copy text button,
 * and the embed's own description - so a reader who copied the text and a reader looking at the
 * post are reading the same sentences, and there is nowhere for a second spelling to live.
 */
export function sessionShareText(s: SessionShare): string {
  const lines = [sessionHeadline(s), sessionTally(s)]
  if (s.coin !== undefined) lines.push(`coin: ${s.coin}`)
  const drops = dropText(s)
  if (drops !== '') lines.push(drops)
  return lines.join('\n')
}

// ------------------------------------------------------------------------------------- the embed

/** The four inline tiles: what the session was worth, in the four currencies the log states. */
function sessionFields(s: SessionShare): DiscordEmbedField[] {
  const tiles: [string, string][] = [
    ['Kills', num(s.kills)],
    ['Levels', `+${s.levelEquiv.toFixed(2)}`],
    ['Deaths', String(s.deaths)],
    ['Best DPS', s.bestFight === undefined ? '-' : num(s.bestFight.dps)]
  ]
  return tiles.map(([name, value]) => ({
    name: cut(name, DISCORD_LIMIT.fieldName),
    value: cut(value, DISCORD_LIMIT.fieldValue),
    inline: true
  }))
}

/**
 * THE WHOLE POST BODY FOR ONE SESSION.
 *
 * `cardAttached` is whether a picture rode along in the same request (src/main/share/discord.ts's
 * multipart path). When it did, the embed points at it by the name the file was sent under -
 * `attachment://session.png`, Discord's own spelling for "the file in this message". When the
 * capture failed the field is simply ABSENT and the numbers post on their own: a message that says
 * what happened beats no message, and an `image` naming a file that is not there renders as a
 * broken picture.
 *
 * The TIMESTAMP is the session's own END when the log stated one, else the moment of posting - the
 * same ladder `discordFightEmbed` walks for a fight's start, and for the same reason.
 */
export function discordSessionEmbed(s: SessionShare, cardAttached: boolean): DiscordWebhookBody {
  const who = s.character === undefined ? '' : `${s.character} · `
  const embed: DiscordEmbed = {
    title: cut(`${who}${sessionDuration(s.durationMs)} session`, DISCORD_LIMIT.title),
    description: cut(sessionShareText(s), DISCORD_LIMIT.description),
    color: SESSION_EMBED_COLOR,
    ...(cardAttached ? { image: { url: `attachment://${SESSION_CARD_FILE}` } } : {}),
    fields: sessionFields(s),
    footer: { text: cut('EQ Zera · eqzera.com', DISCORD_LIMIT.footer) },
    timestamp: new Date(s.t1 > 0 ? s.t1 : Date.now()).toISOString()
  }
  return discordPostBody(embed)
}
