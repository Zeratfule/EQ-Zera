// questLocZones.ts — WHICH ZONE IS A QUEST STEP'S COORDINATE IN? (quest locations wave)
//
// A step says "Tell Rylin Coil in Ak'Anon, at (1469, -190)". The numbers are a fact; the zone is a
// reading of the words around them, and this module is that reading and nothing else. It is the
// one place the rules live, and `scripts/audit-quest-locs.mts` prints every coordinate step in the
// catalog with the zone it chose and WHY, so the rules are checked against the real corpus rather
// than against the examples they were written from.
//
// THE RULES, in order (the first that answers wins):
//   0. A `{{Loc|Zone|a, b}}` template names its zone. That is the page's own statement.
//   1. A zone NAMED in the coordinate's own SENTENCE — a link to a zone page, or the zone's name
//      written out (capitalised, so "a hole in the wall" is not The Hole). One zone ⇒ that zone.
//   2. Several zones in the sentence ⇒ the one an NPC linked in that sentence lives in, when exactly
//      one of the named zones is such an NPC's zone ("Travel through Nektulos Forest into Lake
//      Nerius, then meet Retainer Ozval…"). Otherwise NO ZONE: we do not pick between two places.
//   3. No zone in the sentence ⇒ an NPC linked in the sentence, when every such NPC lives in ONE
//      zone. Two NPCs in two zones ⇒ no zone.
//   4. Nothing in the sentence ⇒ rules 1-3 again over the whole step.
//   5. The step names no zone and links no placeable NPC at all ⇒ the WALKTHROUGH'S current zone:
//      the zone an earlier step last moved the player to ("You have entered North Qeynos.") or
//      placed a point in, else the quest's Start Zone; and LOST (no map) once a step names some
//      other single zone or a zone's bare head word ("Kithicor", "Kael") without moving there.
//   Then two checks every answer must survive (review of 4b66753):
//   - a named zone that contradicts the linked NPC's own single bestiary zone ⇒ no map (rule 1);
//   - the BESTIARY'S SECOND OPINION (`crossCheck`): a mob of ANOTHER zone standing at the point
//     (±SAME_POINT) picks that zone when the walkthrough names it and the answer was a fallback,
//     and otherwise refuses a fallback, a named zone the mob contradicts, or a point copied to the
//     unit from another zone's mob. And the zone's spread, then the map file's own extent at runtime.
//   Anything else ⇒ the coordinate is shown WITHOUT a map. Never guess (world-model law 1).
//
// "AN NPC'S ZONE" is the bestiary's `|zone`, only when it names exactly one place. The quest GIVER
// is the one stated exception: a giver the bestiary gives no zone stands where the page's header
// says the quest starts ("Quest Giver: Retainer Ozval / Starts In: Lake Nerius").
//
// A NAME THAT IS NOT ONE MAP COUNTS AS A ZONE but resolves to none: the bare city names the zone
// table refuses (`Felwithe`, `Freeport`…) are still the step naming a place, so they block rule 5
// and make a two-zone sentence ambiguous rather than quietly vanishing.
//
// PURE, and node-tested against the real catalog (tests/questLocations.test.mts). RELATIVE value
// imports, the repo rule for node-tested modules.

import type { ZoneShort } from './maps'
import type { MobEntry } from './mobTypes'
import type { QuestEntry, QuestStepLink } from './types'
import { ZONES, zoneShortNameFromCatalog } from './zones'

/** A place a step names: its stem when the zone table knows one map for it, else just its name. */
export interface ZoneMention {
  name: string
  stem: ZoneShort | null
}

/**
 * The bare city names the zone table deliberately refuses (zones.ts, "AMBIGUOUS"): each is two or
 * three maps. Written out in a step they still NAME a place, so they are read as an unplaceable one.
 */
const AMBIGUOUS_NAMES = ['Freeport', 'Qeynos', 'Neriak', 'Kaladim', 'Felwithe']

/** What the resolver needs from the bestiary: an NPC by its page or name, and a zone's spread. */
export interface NpcLookup {
  npc: (page: string) => MobEntry | undefined
  /**
   * Does `p` lie within the spread of the points the bestiary states for zone `stem`? `undefined`
   * when the bestiary states too few points there to say.
   */
  within: (stem: ZoneShort, p: { ns: number; ew: number }) => boolean | undefined
  /** Every single-zone bestiary point within `tol` /loc units of `p` (both axes), with its zone. */
  nearby: (p: { ns: number; ew: number }, tol: number) => NearbyMob[]
}

/** A bestiary mob whose own page puts it at (about) a given point, in one placeable zone. */
export interface NearbyMob {
  name: string
  zone: ZoneMention
  /** the stated point itself */
  at: { ns: number; ew: number; z?: number }
}

/** The zone the bestiary (or, for the giver, the quest header) places an NPC in. */
export interface NpcZone {
  entry: MobEntry | undefined
  /** null when no single zone is stated */
  zone: ZoneMention | null
  /** how many zones the bestiary page names */
  count: number
}

/** `[start, end)` of the sentence holding `at`. A full stop inside a number (`3.81`) is not an end. */
export function sentenceSpan(text: string, at: number): [number, number] {
  const isEnd = (i: number): boolean => /[.!?;]/.test(text[i] ?? '') && (i + 1 >= text.length || /\s/.test(text[i + 1]))
  let start = at
  while (start > 0 && !isEnd(start - 1)) start--
  let end = at
  while (end < text.length && !isEnd(end)) end++
  return [start, Math.min(text.length, end + 1)]
}

interface VocabWord {
  re: RegExp
  name: string
}

let VOCAB: VocabWord[] | null = null

/**
 * Zone names that are ordinary English words, so a capital letter in prose is no evidence: "behind
 * the Arena" in West Freeport is a building, not The Arena. They still count when LINKED.
 */
const PROSE_SKIP = new Set(['the hole', 'the arena', 'the bazaar', 'the nexus', 'the warrens'])

/** Every zone spelling worth finding in prose, longest first so `North Qeynos` beats `Qeynos`. */
function vocabulary(): VocabWord[] {
  if (VOCAB) return VOCAB
  const names = new Set<string>(AMBIGUOUS_NAMES)
  for (const z of ZONES) {
    for (const n of [z.name, ...(z.aliases ?? []), ...(z.mobCatalogNames ?? [])]) {
      if (!PROSE_SKIP.has(n.toLowerCase())) names.add(n)
    }
  }
  VOCAB = [...names]
    .map((name) => {
      const core = name.replace(/^the\s+/i, '')
      const body = core
        .split(/[\s-]+/)
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s-]+')
      return { name, re: new RegExp(`(?<![\\w'\`])(?:the\\s+)?${body}(?![\\w'\`])`, 'gi'), len: core.length }
    })
    .sort((a, b) => b.len - a.len)
    .map(({ name, re }) => ({ name, re }))
  return VOCAB
}

export const mention = (name: string): ZoneMention => ({ name, stem: zoneShortNameFromCatalog(name) })

/**
 * A zone named as a WAY OUT is not where the point is: "near the Steamfont Mountains entrance",
 * "the Qeynos Hills zone line", "guarding the zone-in to East Cabilis" all describe a spot in the
 * OTHER zone, at its edge. Such a mention is not read at all.
 */
// "…is on Temple of Solusek Ro faction" names an allegiance, not a place: read the same way.
const EXIT_AFTER = /^\s*(?:'s\s+)?(?:entrance|zone\s*line|zone-?in|zonein|zone|border|tunnel|exit|faction)\b/i
const EXIT_BEFORE = /(?:zone[\s-]?(?:in|line|out)?|entrance|tunnel|gate|portal|border|exit|road|path)\s+(?:to|into|from|for|of)\s+(?:the\s+)?$/i

/**
 * …and so is a zone the spot is merely BESIDE: "in The Feerrott, near Oggok at (+135, +705)",
 * "in Warsliks Woods, just outside West Cabilis", "between Blackburrow and Surefall Glade".
 */
const BESIDE_BEFORE = /\b(?:near|outside|beside|behind|past|towards?|from|between|next\s+to|close\s+to|by)\s+(?:the\s+)?$/i
const BETWEEN_AND = /\bbetween\s+[^.;]{1,48}\band\s+(?:the\s+)?$/i

/** True when the mention at `[a, b)` of `text` names a zone the point is NOT in, only next to. */
export function isExitMention(text: string, a: number, b: number): boolean {
  const before = text.slice(Math.max(0, a - 64), a)
  return EXIT_AFTER.test(text.slice(b, b + 24)) || EXIT_BEFORE.test(before) || BESIDE_BEFORE.test(before) || BETWEEN_AND.test(before)
}

/**
 * `[start, end)` of the CLAUSE holding `at`, inside its sentence: cut at `;`, ` - `, ` or `, and
 * at a comma that is not one of the commas inside a coordinate. "Linadian is located at -142,
 * -545, 161 in Kelethin, two platforms over … - alternatively - in West Freeport at (56, -299)"
 * puts each point with its own zone.
 */
export function clauseSpan(text: string, at: number, [s, e]: [number, number]): [number, number] {
  const cut = (i: number): number => {
    if (text[i] === ';') return 1
    if (text.startsWith(' - ', i)) return 3
    if (text.startsWith(' or ', i)) return 4
    if (text[i] === ',' && !(/[\d.]/.test(text[i - 1] ?? '') && /^\s*[-+]?\d/.test(text.slice(i + 1, i + 4)))) return 1
    return 0
  }
  let a = at
  while (a > s && cut(a - 1) === 0 && !text.startsWith(' - ', a - 3) && !text.startsWith(' or ', a - 4)) a--
  let b = at
  while (b < e && cut(b) === 0) b++
  return [a, b]
}

interface ProseHit {
  zone: ZoneMention
  a: number
  b: number
}

/** Zones the text names in prose. Capitalised matches only; a longer name hides the shorter inside it. */
function proseZones(text: string): ProseHit[] {
  const out: ProseHit[] = []
  for (const w of vocabulary()) {
    for (const m of text.matchAll(w.re)) {
      const a = m.index
      const b = a + m[0].length
      const first = m[0].replace(/^the\s+/i, '')[0] ?? ''
      if (first === first.toLowerCase() || out.some((h) => a < h.b && b > h.a)) continue
      out.push({ zone: mention(w.name), a, b })
    }
  }
  return out
}

/** The link's zone: its label first (what the writer showed), then its target. Null when neither. */
function linkZone(link: QuestStepLink): ZoneMention | null {
  for (const n of [link.label, link.page]) {
    if (n === undefined) continue
    const z = mention(n)
    if (z.stem !== null) return z
  }
  const ambiguous = [link.label, link.page].find((n) => n !== undefined && AMBIGUOUS_NAMES.some((a) => a.toLowerCase() === n.toLowerCase()))
  return ambiguous === undefined ? null : { name: ambiguous, stem: null }
}

/** The links whose shown text falls inside `scope`. */
export function linksIn(scope: string, links: readonly QuestStepLink[]): QuestStepLink[] {
  const s = scope.toLowerCase()
  return links.filter((l) => s.includes((l.label ?? l.page).toLowerCase()))
}

/** Distinct by stem (or by name, for the unplaceable ones). */
function distinct(zs: readonly ZoneMention[]): ZoneMention[] {
  const seen = new Map<string, ZoneMention>()
  for (const z of zs) {
    const k = z.stem ?? `?${z.name.toLowerCase()}`
    if (!seen.has(k)) seen.set(k, z)
  }
  return [...seen.values()]
}

/** `text` with every occurrence of `names` blanked to spaces (same length, so offsets hold). */
function mask(text: string, names: readonly string[]): string {
  let out = text
  for (const n of names) {
    if (n.length < 3) continue
    let i = out.toLowerCase().indexOf(n.toLowerCase())
    while (i >= 0) {
      out = out.slice(0, i) + ' '.repeat(n.length) + out.slice(i + n.length)
      i = out.toLowerCase().indexOf(n.toLowerCase(), i + n.length)
    }
  }
  return out
}

/**
 * Every zone a scope of text names, linked or written. Prose is read with every NON-zone link's
 * text and every item the quest names blanked out first: a link is judged by its target (a quest
 * called "Crushbone Belts" is not Crushbone), and "RunnyEye Warbeads" is an item, not Runnyeye.
 * A zone link whose text sits INSIDE a longer written zone name gives way to it: "in [[Erudin]]
 * Palace" is Erudin Palace.
 */
export function zonesNamed(scope: string, links: readonly QuestStepLink[], items: readonly string[] = []): ZoneMention[] {
  return distinct(zoneHits(scope, links, items).map((h) => h.zone))
}

/** `zonesNamed`, keeping WHERE in `scope` each mention sits (way-out mentions already dropped). */
function zoneHits(scope: string, links: readonly QuestStepLink[], items: readonly string[]): ProseHit[] {
  const lower = scope.toLowerCase()
  const inScope = linksIn(scope, links).map((l) => {
    const shown = (l.label ?? l.page).toLowerCase()
    const a = lower.indexOf(shown)
    return { zone: linkZone(l), shown, a, b: a + shown.length }
  })
  const blanks = [...items, ...inScope.filter((l) => l.zone === null).map((l) => l.shown)]
  const prose = proseZones(mask(scope, blanks.sort((x, y) => y.length - x.length)))
  const linked = inScope.flatMap((l) => {
    if (l.zone === null || prose.some((h) => h.a <= l.a && h.b >= l.b && h.b - h.a > l.b - l.a)) return []
    return [{ zone: l.zone, a: l.a, b: l.b }]
  })
  return [...linked, ...prose].filter((h) => !isExitMention(scope, h.a, h.b)).sort((x, y) => x.a - y.a)
}

/**
 * The words that MOVE the player, right before a zone's name: "You have entered North Qeynos",
 * "Head to North Qeynos", "Go to Qeynos Hills", "Travel through Nektulos Forest into Lake Nerius".
 * A zone named any other way — "vendors in the Field of Bones, Cabilis and Neriak" — moves nobody.
 */
const MOVE_BEFORE =
  /(?:you have entered|\b(?:head(?:s|ed|ing)?|go(?:es|ing)?|went|travel(?:s|l?ed|l?ing)?|return(?:s|ed|ing)?|run|ran|port(?:s|ed)?|zone(?:s|d)?|enter(?:s|ed)?|make your way|move|swim|fly)\b[^.;:!?()]{0,30})$/i

/**
 * Where this step leaves the player, when it says so: the LAST zone it moves them to, at its
 * offset in `text`. `undefined` when the step moves nobody.
 */
export function movedTo(text: string, links: readonly QuestStepLink[], items: readonly string[]): { zone: ZoneMention; at: number } | undefined {
  let last: { zone: ZoneMention; at: number } | undefined
  for (const h of zoneHits(text, links, items)) {
    if (MOVE_BEFORE.test(text.slice(Math.max(0, h.a - 48), h.a))) last = { zone: h.zone, at: h.a }
  }
  return last
}

/** The items a quest names (required and reward) — the words prose zone-reading must skip. */
export function questItemNames(quest: QuestEntry): string[] {
  return [...(quest.requiredItems ?? []), ...(quest.rewards ?? []).map((r) => r.name)]
}

/** "Various", "Unknown", "?" — a bestiary `|zone` that is a placeholder, not a place. */
const PLACEHOLDER_ZONE = /^(various|unknown|several|multiple|many|most |all )|\?/i

/** True when a bestiary zone string is a placeholder ("Various"), not a place. */
export function isPlaceholderZone(zone: string): boolean {
  return PLACEHOLDER_ZONE.test(zone)
}

/** True when `specific` is a named part of `general`: "South Kaladim" of "Kaladim". */
function refines(general: ZoneMention, specific: ZoneMention): boolean {
  if (specific.stem === null) return false
  const word = general.name.replace(/^the\s+/i, '').toLowerCase()
  const names = ZONES.filter((z) => z.short === specific.stem).flatMap((z) => [z.name, ...(z.aliases ?? [])])
  return [specific.name, ...names].some((n) => new RegExp(`(^|[\\s-])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s-])`, 'i').test(n))
}

/** Where an NPC lives, per the bestiary — or, for the quest giver alone, per the quest header. */
export function npcZone(entry: MobEntry | undefined, link: QuestStepLink | null, quest: QuestEntry): NpcZone {
  const raw = entry?.zones ?? []
  const count = zoneCount(raw)
  if (count === 1) return { entry, zone: mention(raw[0]), count }
  const giverHere = isGiver(quest, [link?.page, link?.label, entry?.page, entry?.name])
  if (count === 0 && giverHere && quest.startZone) return { entry, zone: mention(quest.startZone), count }
  return { entry, zone: null, count }
}

/**
 * How many zones a bestiary page names. "Various" is not a place, and it is not NO place either:
 * the page's numbers describe one of several, so a placeholder counts as more than one (no map).
 */
function zoneCount(zones: readonly string[]): number {
  return zones.some((z) => PLACEHOLDER_ZONE.test(z)) ? Math.max(2, zones.length) : zones.length
}

/** True when any of `names` is the quest's giver. */
function isGiver(quest: QuestEntry, names: readonly (string | undefined)[]): boolean {
  const giver = quest.giver?.toLowerCase()
  return giver !== undefined && names.some((n) => n?.toLowerCase() === giver)
}

/** The NPCs a scope links, each with its zone. Links that are not bestiary pages are left out. */
export function npcsIn(scope: string, links: readonly QuestStepLink[], quest: QuestEntry, lookup: NpcLookup): NpcZone[] {
  const out: NpcZone[] = []
  for (const l of linksIn(scope, links)) {
    const entry = lookup.npc(l.page)
    if (entry === undefined && !isGiver(quest, [l.page])) continue
    out.push(npcZone(entry, l, quest))
  }
  return out
}

/** A coordinate's zone, and the reason — or no zone, and the reason. */
export interface ZoneVerdict {
  zone: ZoneMention | null
  why: string
  /** true when the zone is the walkthrough's trail or start zone, not anything this step states */
  fallback?: boolean
}

/** Rules 1-3 over one scope. `undefined` ⇒ the scope says nothing; look wider. */
/** Rule 1: the scope names exactly one zone. */
function oneNamed(zone: ZoneMention, npcs: readonly NpcZone[], npcZones: readonly ZoneMention[], where: string): ZoneVerdict {
  // "the Kaladim Warrior's Guild" names a city that is two maps; an NPC there whose page says
  // South Kaladim is the second witness that picks one. Exactly one such NPC zone, or none.
  const sharper = zone.stem === null ? npcZones.filter((z) => refines(zone, z)) : []
  if (sharper.length === 1) return { zone: sharper[0], why: `the ${where} says ${zone.name}; its NPC lives in ${sharper[0].name}` }
  // TWO WITNESSES THAT DISAGREE PICK NOTHING: "Cain Darkmoore is at 662, -675 in East Freeport"
  // while Cain's own page says West Freeport. Either could be the typo; the map would be a coin.
  const own = npcs.flatMap((n) => (n.count === 1 && n.zone?.stem != null ? [n.zone] : []))
  const clash = zone.stem !== null && own.length > 0 && !own.some((z) => z.stem === zone.stem) ? own[0] : undefined
  if (clash) return { zone: null, why: `the ${where} names ${zone.name}, but its NPC's page says ${clash.name}` }
  return { zone, why: `the ${where} names ${zone.name}` }
}

function scopeVerdict(named: ZoneMention[], npcs: NpcZone[], where: string): ZoneVerdict | undefined {
  const npcZones = distinct(npcs.flatMap((n) => (n.zone ? [n.zone] : [])))
  if (named.length === 1) return oneNamed(named[0], npcs, npcZones, where)
  if (named.length > 1) {
    const both = named.filter((z) => z.stem !== null && npcZones.some((n) => n.stem === z.stem))
    if (both.length === 1) return { zone: both[0], why: `the ${where} names ${String(named.length)} zones; its NPC lives in ${both[0].name}` }
    return { zone: null, why: `the ${where} names ${named.map((z) => z.name).join(', ')}` }
  }
  if (npcZones.length === 1) {
    const who = npcs.find((n) => n.zone)?.entry?.name ?? 'the quest giver'
    return { zone: npcZones[0], why: `${who} (linked in the ${where}) lives in ${npcZones[0].name}` }
  }
  if (npcZones.length > 1) return { zone: null, why: `the ${where} links NPCs in ${npcZones.map((z) => z.name).join(', ')}` }
  return undefined
}

/**
 * The verdict for one coordinate at `at` in step `text`. `templateZone` is a `{{Loc}}`'s own zone.
 *
 * EVERY RULE ANSWERS TO THE MAP'S OWN SPREAD. A zone named in the sentence is often the zone the
 * spot is NEXT to — "near the Tower of Frozen Shadow", "guarding the zone-in to East Cabilis",
 * "just outside Halas in Everfrost" — and the audit found every one of those by the same test: the
 * point lies outside the box the bestiary's own points span for the named zone. Such a point gets
 * no zone at all rather than a mark drawn off the edge of the wrong map.
 */
export function coordZone(args: CoordArgs): ZoneVerdict {
  const v = crossCheck(coordZoneRules(args), args)
  if (v.zone?.stem == null || args.lookup.within(v.zone.stem, args.point) !== false) return v
  return { zone: null, why: `${v.why}, but the point lies outside ${v.zone.name}` }
}

/** How close (per axis, /loc units) a bestiary point must be to BE the quest's coordinate. */
export const SAME_POINT = 4

/** Within a unit on both axes, and on the third when both sides state it. */
function sameSpot(a: { ns: number; ew: number; z?: number }, b: { ns: number; ew: number; z?: number }): boolean {
  if (Math.abs(a.ns - b.ns) > 1 || Math.abs(a.ew - b.ew) > 1) return false
  return a.z === undefined || b.z === undefined || Math.abs(a.z - b.z) <= 1
}

/** A mob name worth searching prose for: a proper name, not "a guard" / "an orc pawn". */
const GENERIC_MOB = /^(a|an|the)\s/i

const named = (text: string, name: string): boolean =>
  !GENERIC_MOB.test(name) && new RegExp(`(?<![\\w'\`])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w'\`])`, 'i').test(text)

/**
 * THE BESTIARY'S SECOND OPINION. A quest coordinate that is, to within a few units, some mob's own
 * stated spawn point is very likely THAT mob's spot. If that mob lives in the zone already chosen,
 * the choice is confirmed. If it lives elsewhere, the walkthrough naming it nearby makes it the
 * answer ("Your Location is -154.95, -292.89" between two steps about Sequea Erthinon, who stands
 * at (-155, -293) in Surefall Glade); otherwise the two disagree and the point gets no map.
 */
function crossCheck(v: ZoneVerdict, args: CoordArgs): ZoneVerdict {
  const near = args.lookup.nearby(args.point, SAME_POINT)
  if (near.length === 0) return v
  const chosen = v.zone?.stem
  if (chosen != null && near.some((m) => m.zone.stem === chosen)) return v
  const text = args.neighbours ?? args.text
  const picks = distinct(near.filter((m) => named(text, m.name)).map((m) => m.zone))
  // A FALLBACK (no zone in the step's own words) yields to the bestiary; a zone the words STATE
  // only yields to a mob the words also name, and then the two statements disagree: no map.
  const weak = chosen == null || v.fallback === true
  if (picks.length === 1 && weak) {
    const who = near.find((m) => m.zone.stem === picks[0].stem && named(text, m.name))?.name ?? ''
    return { zone: picks[0], why: `${who}'s own page puts them at this point in ${picks[0].name}, and the walkthrough names them` }
  }
  if (chosen == null) return v
  return disagreement(v, near, picks, args.point)
}

/** A chosen zone against other zones' mobs at the point: keep it, or refuse it. */
function disagreement(v: ZoneVerdict, near: readonly NearbyMob[], picks: readonly ZoneMention[], p: CoordArgs['point']): ZoneVerdict {
  const weak = v.fallback === true
  // THE SAME SPOT TO THE UNIT (and the same elevation where both state one) is not chance: "Belious
  // Naliedin is located at -253, 242, 77" is Sylia Windlehands' Kelethin spot copied onto a South
  // Qeynos page. That refuses even a stated zone.
  const twin = near.find((m) => sameSpot(m.at, p))
  // MEASURED: a strongly stated zone meets an UNNAMED mob of another zone within the window about
  // as often as chance predicts (~3% of coordinates, the density of small city coordinates across
  // ~130 overlapping zone frames), so that alone is noise, not evidence — the audit lists those and
  // they do not refuse.
  if (picks.length === 0 && !weak && twin === undefined) return v
  const against = twin ?? near.find((m) => picks.some((z) => z.stem === m.zone.stem)) ?? near[0]
  return { zone: null, why: `${v.why}, but the bestiary puts ${against.name} (${against.zone.name}) at this point` }
}

/** One coordinate, and everything around it the rules may read. */
export interface CoordArgs {
  /** the step's text */
  text: string
  /** where in `text` the coordinate starts */
  at: number
  /** a `{{Loc}}` template's own zone, verbatim */
  templateZone: string | undefined
  links: readonly QuestStepLink[]
  quest: QuestEntry
  lookup: NpcLookup
  point: { ns: number; ew: number; z?: number }
  /** the zone the walkthrough's EARLIER steps last moved to or placed a point in; undefined = none */
  trail?: ZoneMention | null
  /** this step's text with its neighbours', for "is that mob named around here" */
  neighbours?: string
}

function coordZoneRules(args: CoordArgs): ZoneVerdict {
  const { text, at, templateZone, links, quest, lookup } = args
  const items = questItemNames(quest)
  const [a, b] = sentenceSpan(text, at)
  // The sentence; then what the step said BEFORE it (a walkthrough sets the scene, then states the
  // spot); then the whole step.
  const [ca, cb] = clauseSpan(text, at, [a, b])
  const scopes = [
    [text.slice(ca, cb), 'clause'],
    [text.slice(a, b), 'sentence'],
    [text.slice(0, a), 'step'],
    [text, 'step']
  ] as const
  // A zone's HEAD word in the coordinate's own sentence ("a burnt hut in Kithicor Woods") is a place
  // we cannot read but must not overrule: a zone found further away has to be that place or nothing.
  const heads = headsIn(text.slice(a, b), items)
  const prose = (): ZoneVerdict | undefined => {
    for (const [i, [scope, where]] of scopes.entries()) {
      if (scope.trim() === '') continue
      const v = scopeVerdict(zonesNamed(scope, links, items), npcsIn(scope, links, quest, lookup), where)
      if (!v) continue
      // A clause only ever ANSWERS; when it cannot, the sentence decides.
      if (i === 0 && v.zone === null) continue
      const stray = i <= 1 || v.zone === null ? undefined : heads.find((h) => !refines({ name: h, stem: null }, v.zone ?? { name: '', stem: null }))
      return stray === undefined ? v : { zone: null, why: `the sentence mentions ${stray}; ${v.why}` }
    }
    return undefined
  }
  if (templateZone !== undefined) {
    const stated = mention(templateZone)
    if (stated.stem !== null) return { zone: stated, why: 'the {{Loc}} template names it' }
    // `{{Loc|Splitpaw|…}}` in a step that says "Splitpaw Lair": the words pick the one map.
    const v = prose()
    if (v?.zone && refines(stated, v.zone)) return { zone: v.zone, why: `the {{Loc}} template says ${templateZone}; ${v.why}` }
    return { zone: stated, why: 'the {{Loc}} template names it' }
  }
  const v = prose()
  if (v) return v
  return startZoneVerdict(args)
}

/**
 * Words that START a multi-word zone name and say which zone on their own — "in Kithicor",
 * "in Butcherblock", "in Highpass Keep". Too loose to PLACE a point, so they never resolve
 * anything; they only stop rule 5 from putting a point in the start zone when the step plainly
 * talks about somewhere else. Directions, articles and the generic heads ("Lake", "Plane",
 * "Temple", "Ocean"…) are not on it.
 */
const GENERIC_HEADS = /^(north|south|east|west|northern|southern|eastern|western|upper|lower|lake|plane|temple|ocean|city|castle|great|greater|lesser|old|new|crystal|dragon|burning|field|estate|ruins|mines|tower|island|frontier|guild|halls|hills|plains|caverns|crypt|lair|tomb|palace|cobalt|crystal|marus)$/i

/** Zone words under five letters that still name one place, case-sensitive as prose writes them. */
const SHORT_HEADS = ['Kael', 'OOT', 'Lfay', 'Gfay', 'Sky', 'Fear', 'Hate']

let HEADS: RegExp | null = null

function zoneHeads(): RegExp {
  if (HEADS) return HEADS
  const heads = new Set<string>()
  for (const z of ZONES) {
    for (const n of [z.name, ...(z.aliases ?? [])]) {
      const words = n.replace(/^the\s+/i, '').split(/[\s-]+/)
      const head = words[0]
      if (words.length > 1 && head.length >= 5 && !GENERIC_HEADS.test(head)) heads.add(head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    }
  }
  // The SHORT ones a walkthrough writes for a zone ("Headed to Kael from Wakening", "OOT", "Lfay").
  for (const h of SHORT_HEADS) heads.add(h)
  HEADS = new RegExp(`(?<![\\w'])(${[...heads].join('|')})(?![\\w'])`, 'g')
  return HEADS
}

/** Every zone head word in `text` standing ALONE: items and full zone names are blanked first. */
export function headsIn(text: string, items: readonly string[]): string[] {
  let bare = mask(text, items)
  for (const h of proseZones(bare)) bare = bare.slice(0, h.a) + ' '.repeat(h.b - h.a) + bare.slice(h.b)
  return [...bare.matchAll(zoneHeads())].map((m) => m[1])
}

/**
 * Rule 5, with its two refusals: the step must not open with a zone's own head word ("in
 * Kithicor"), and the point must lie inside the spread the bestiary states for the start zone —
 * "Follow Snowflake east until… (+2045, +3835)" on a quest that starts in Halas is Everfrost, and a
 * Halas whose stated mobs never pass 600 cannot hold it. Too few bestiary points to judge ⇒ no.
 * And the walkthrough must not have LEFT the start zone already: once an earlier step was placed
 * somewhere else, "he wanders over to the house at (275, -350)" is wherever that trail now is,
 * which these words do not say.
 */
/**
 * THE WALKTHROUGH'S POSITION AFTER ONE STEP. `undefined` = nothing said yet (the start zone
 * stands), a zone = where it last went, `null` = LOST: it went somewhere its words do not let us
 * place. A step that moves the player (or places a point) sets it. A step that moves nobody but
 * names ONE other zone, or a zone's bare head word ("Giz is found in Kithicor"), loses it — the
 * player is plainly elsewhere now and a later "Your Location is…" cannot be read against the old
 * zone. A step naming SEVERAL zones in passing ("vendors in the Field of Bones, Cabilis and
 * Neriak") is a remark, not a move, and changes nothing.
 */
export function nextTrail(args: {
  text: string
  links: readonly QuestStepLink[]
  items: readonly string[]
  prev: ZoneMention | null | undefined
  start: string | undefined
  placed?: { zone: ZoneMention; at: number }
}): ZoneMention | null | undefined {
  const { text, links, items, prev, start, placed } = args
  const moved = movedTo(text, links, items)
  const last = [moved, placed].filter((m) => m !== undefined).sort((a, b) => b.at - a.at)[0]
  if (last) return last.zone
  const base = prev === undefined ? (start ? mention(start) : undefined) : prev
  // A line of dialogue ("You say, 'A Warder of Ro?'") is talk, not travel.
  if (base == null || /^\s*You say\b/i.test(text)) return prev
  const others = zonesNamed(text, links, items).filter((z) => (z.stem ?? z.name) !== (base.stem ?? base.name) && !refines(z, base))
  const heads = headsIn(text, items).filter((h) => !refines({ name: h, stem: null }, base))
  return others.length === 1 || (others.length === 0 && heads.length > 0) ? null : prev
}

function startZoneVerdict(args: CoordArgs): ZoneVerdict {
  const { text, quest, lookup, point: p, trail } = args
  // WHERE THE WALKTHROUGH IS NOW: the zone an earlier step last moved the player to or placed a
  // point in ("You have entered North Qeynos."), else where the quest starts.
  if (trail === null) return { zone: null, why: 'the step names no zone, and the walkthrough has moved somewhere its words do not place' }
  if (trail === undefined && !quest.startZone) return { zone: null, why: 'nothing names a zone' }
  const base = trail ?? mention(quest.startZone ?? '')
  const said = trail === undefined ? `the quest starts in ${base.name}` : `the walkthrough was last in ${base.name}`
  const head = headsIn(text, questItemNames(quest)).find((h) => !refines({ name: h, stem: null }, base))
  if (head !== undefined) return { zone: null, why: `the step mentions ${head}, not ${base.name}` }
  if (base.stem === null) return { zone: base, why: `the step names no zone; ${said}`, fallback: true }
  const inside = lookup.within(base.stem, p)
  if (inside !== true) {
    return { zone: null, why: `${said}, but ${inside === false ? 'the point lies outside it' : 'too few known points there to check'}` }
  }
  return { zone: base, why: `the step names no zone; ${said}`, fallback: true }
}
