// questLocations.ts — WHERE a quest happens: per-step location chips, where each needed item
// comes from, and the quest pins a map draws (quest locations wave).
//
// TWO AUTHORITIES, AND EVERY CHIP SAYS WHICH. A coordinate the QUEST PAGE writes in a step
// (`stepLocs`, the scraper's facts) and a spawn point the NPC's OWN wiki page states (the
// bestiary's `loc`) are different witnesses and they do disagree — "Hate, Betrayal, and Trust"
// puts Corrupted Kedgespawn at (2662, 1238, -119) while his page says (2640, 1226, -120). Both are
// shown, each tagged. When they state the SAME point in the same zone they are one chip carrying
// both tags.
//
// COORDINATES ARE REAL OR ABSENT (the mobPins.ts law, restated). A chip carries a point only when
// a page stated one, and a MAP STEM only when a zone was resolved by the rules in questLocZones.ts
// or by the bestiary page naming exactly one zone. A multi-zone bestiary page keeps its points but
// gets no map: which zone they describe is unknowable, the same call the Maps tab's pane makes.
//
// ITEM SOURCES are the bestiary's `|known_loot` inverted, keyed by the SAME item key the app's
// other item -> mob join uses (`lib/itemSources.ts sourceItemKey` = `itemBaseName`, lowercased) —
// re-applied here from its shared half because src/shared cannot import the renderer. An item no
// mob drops has no row at all: quest rewards and ground spawns drop from nobody, and saying nothing
// is the honest answer.
//
// PURE. The caller hands in the catalog; tests/questLocations.test.mts drives the real one.

import type { ZoneShort } from './maps'
import type { MobEntry, MobLoc } from './mobTypes'
import type { QuestEntry, QuestStepLink } from './types'
import { coordZone, isBoundary, isPlaceholderZone, linksIn, nextTrail, npcZone, questItemNames, sentenceSpan, type NpcZone, type ZoneMention } from './questLocZones'
import type { MobIndex } from './bestiaryIndex'
import { groundSpawnLocs, type GroundSpawnLoc } from './questGroundSpawns'
// The bestiary index lives in ./bestiaryIndex.ts; re-exported so callers keep one import.
export { buildMobIndex, dropKey, type MobIndex } from './bestiaryIndex'

/** Who stated a point: the quest's own page, or the NPC's / mob's own page. */
export type LocSource = 'quest' | 'npc'

export interface LocPoint {
  ns: number
  ew: number
  z?: number
}

/** One place to look. `zone` (a map stem) is present only when the zone is resolved to one map. */
export interface QuestLocChip {
  key: string
  /** who or what is there, when the words say */
  name?: string
  /** the zone as named, when one is */
  zoneName?: string
  zone?: ZoneShort
  /** absent ⇒ a zone, but no stated point in it */
  loc?: LocPoint
  sources: LocSource[]
  /** the rule that placed it — read by the audit script, and the chip's hover */
  why: string
}

/** One mob that drops a needed item. */
export interface ItemSourceRow {
  mob: string
  mobPage: string
  level?: string
  zoneName?: string
  zone?: ZoneShort
  /** its stated spawn points, only when its page names ONE zone */
  points: LocPoint[]
  /** what the page draws for it: one chip per stated point, else one naming its zone */
  chips: QuestLocChip[]
}

export interface QuestItemSources {
  item: string
  /** capped at MAX_ITEM_SOURCES, the located ones first */
  rows: ItemSourceRow[]
  /** how many more mobs drop it than are listed */
  more: number
  /** every listed row's chips, in row order — what the page draws (it shows the first few) */
  chips: QuestLocChip[]
}

export interface QuestLocations {
  /** index-aligned with `quest.steps` */
  steps: QuestLocChip[][]
  /** the giver and each "Related NPCs" name that the bestiary can place */
  npcs: { name: string; chips: QuestLocChip[] }[]
  /** one entry per required item that SOME mob drops */
  items: QuestItemSources[]
  /** the ground spawns (and objects) the page's tables locate, each with its chip (./questGroundSpawns.ts) */
  groundSpawns: GroundSpawnLoc[]
}

export const MAX_ITEM_SOURCES = 3
/** Chips one step may carry. A step linking nine placeable NPCs is a list, not a step. */
export const MAX_STEP_CHIPS = 6


const point = (l: MobLoc | LocPoint): LocPoint => (l.z === undefined ? { ns: l.ns, ew: l.ew } : { ns: l.ns, ew: l.ew, z: l.z })
const samePoint = (a: LocPoint, b: LocPoint): boolean => Math.round(a.ns) === Math.round(b.ns) && Math.round(a.ew) === Math.round(b.ew)

function chip(base: Omit<QuestLocChip, 'key'>, key: string): QuestLocChip {
  const out: QuestLocChip = { key, sources: base.sources, why: base.why }
  if (base.name !== undefined) out.name = base.name
  if (base.zoneName !== undefined) out.zoneName = base.zoneName
  if (base.zone !== undefined) out.zone = base.zone
  if (base.loc !== undefined) out.loc = base.loc
  return out
}

function fromMention(z: ZoneMention | null): { zoneName?: string; zone?: ZoneShort } {
  if (z === null) return {}
  return z.stem === null ? { zoneName: z.name } : { zoneName: z.name, zone: z.stem }
}

/** Where a bestiary page places its mob: one zone, several named ones (no map), or nothing said. */
function bestiaryWhere(entry: MobEntry, nz: NpcZone): { zoneName?: string; zone?: ZoneShort } {
  if (nz.count <= 1) return fromMention(nz.zone)
  const named = (entry.zones ?? []).filter((z) => !isPlaceholderZone(z))
  return named.length > 0 ? { zoneName: named.join(' or ') } : {}
}

function bestiaryWhy(entry: MobEntry, nz: NpcZone): string {
  if (nz.count > 1) return `${entry.name}'s page names ${String(nz.count)} zones`
  if (nz.zone === null) return `${entry.name}'s page names no zone`
  if (nz.count === 0) return `${entry.name}'s page names no zone; the quest giver stands where the quest starts`
  return `${entry.name}'s page`
}

interface BestiaryArgs {
  entry: MobEntry
  link: QuestStepLink | null
  quest: QuestEntry
  index: MobIndex
  key: string
}

/**
 * Every stated spawn point of one bestiary page, as chips. A multi-zone page gets no map, and so
 * does a point outside its zone's known spread (the giver-stands-where-it-starts reading of a
 * page that names no zone is the case this catches: Priest of Discord's one point is not in every
 * city that quest starts in).
 */
function bestiaryChips({ entry, link, quest, index, key }: BestiaryArgs): QuestLocChip[] {
  const nz = npcZone(entry, link, quest)
  const where = bestiaryWhere(entry, nz)
  const why = bestiaryWhy(entry, nz)
  return (entry.loc ?? []).map((l, i) => {
    const p = point(l)
    const k = `${key}:npc:${entry.page}#${String(i)}`
    if (where.zone !== undefined && index.within(where.zone, p) === false) {
      return chip({ name: entry.name, loc: p, sources: ['npc'], why: `${why}, but the point lies outside ${where.zoneName ?? where.zone}` }, k)
    }
    return chip({ name: entry.name, ...where, loc: p, sources: ['npc'], why }, k)
  })
}

/** Fold a chip into the list, merging it into one that states the same point in the same zone. */
function addChip(list: QuestLocChip[], c: QuestLocChip): void {
  const twin = list.find(
    (o) =>
      o.loc !== undefined &&
      c.loc !== undefined &&
      samePoint(o.loc, c.loc) &&
      (o.zone ?? o.zoneName) === (c.zone ?? c.zoneName) &&
      (o.name === undefined || c.name === undefined || o.name === c.name)
  )
  if (!twin) {
    list.push(c)
    return
  }
  for (const s of c.sources) if (!twin.sources.includes(s)) twin.sources.push(s)
  twin.name ??= c.name
}

/** One step's chips: what its words state, then what the NPCs it links state, merged. */
/** A zone the walkthrough put the player in, and where in the step's text it said so. */
interface TrailMark {
  zone: ZoneMention
  at: number
}

function stepChips(quest: QuestEntry, i: number, index: MobIndex, trail: ZoneMention | null | undefined): { chips: QuestLocChip[]; placed?: TrailMark } {
  const text = quest.steps?.[i] ?? ''
  const links = quest.stepLinks?.[i] ?? []
  const neighbours = (quest.steps ?? []).slice(Math.max(0, i - 1), i + 2).join('\n')
  const out: QuestLocChip[] = []
  let placed: TrailMark | undefined
  ;(quest.stepLocs?.[i] ?? []).forEach((l, n) => {
    const v = coordZone({ text, at: l.at, templateZone: l.zone, links, quest, lookup: index, point: l, trail, neighbours })
    if (v.zone?.stem != null) placed = { zone: v.zone, at: l.at }
    // Name it after the NPC its sentence links, when the sentence links exactly one.
    const sentence = text.slice(...sentenceSpan(text, l.at))
    const npcs = linksIn(sentence, links).filter((k) => index.npc(k.page) !== undefined)
    // The name the STEP shows for it: a link may point at a page under another name.
    const name = npcs.length === 1 ? (npcs[0].label ?? index.npc(npcs[0].page)?.name) : undefined
    addChip(out, chip({ ...(name === undefined ? {} : { name }), ...fromMention(v.zone), loc: point(l), sources: ['quest'], why: v.why }, `s${String(i)}:q${String(n)}`))
  })
  for (const link of links) {
    const entry = index.npc(link.page)
    if (entry === undefined) continue
    for (const c of bestiaryChips({ entry, link, quest, index, key: `s${String(i)}` })) addChip(out, c)
  }
  return { chips: out.slice(0, MAX_STEP_CHIPS), ...(placed ? { placed } : {}) }
}

/**
 * One dropper. Its chips are its stated spawn points (one per point, never collapsed); a page that
 * states no point still gets ONE chip naming its zone, which opens that map without a mark. The
 * giver rule does not apply here: a mob that drops an item is not the quest's giver.
 */
function itemRow(m: MobEntry, quest: QuestEntry, index: MobIndex, key: string): ItemSourceRow {
  const asDropper: QuestEntry = { ...quest, giver: undefined }
  const nz = npcZone(m, null, asDropper)
  const row: ItemSourceRow = { mob: m.name, mobPage: m.page, points: nz.count === 1 ? (m.loc ?? []).map(point) : [], chips: [] }
  if (m.level !== undefined) row.level = m.level
  const where = bestiaryWhere(m, nz)
  if (where.zoneName !== undefined) row.zoneName = where.zoneName
  if (where.zone !== undefined && nz.count === 1) row.zone = where.zone
  const located = bestiaryChips({ entry: m, link: null, quest: asDropper, index, key })
  row.chips = located.length > 0 ? located : [chip({ name: m.name, ...where, sources: ['npc'], why: `${m.name}'s page states no point` }, `${key}:npc:${m.page}`)]
  return row
}

/**
 * Item names that are a KIND of thing, not one thing: many unrelated quests need "a note" and many
 * unrelated mobs drop one. MEASURED: "a tattered note" put a Lake of Ill Omen sarnak under 36
 * Guild Summons quests, "Sealed Letter" put three unrelated mobs under nine quests.
 */
const GENERIC_ITEM = /\b(note|notes|letter|letters|parchment|scroll|paper|papers|message|page|list|map|journal|book|report|orders?|receipt|ticket|sack|bag|box|pouch|key|token|missive|document|writ|card)\b/i

/**
 * A SPECIFIC name ("Crushed Topaz", "Bone Chips") is one item wherever it drops, so every dropper
 * is a true answer even across twenty zones; only a KIND name needs the evidence. Measured the
 * other way first (more than two dropper zones = shared): it hid 549 true gem and bone sources.
 */
function sharedName(item: string): boolean {
  return GENERIC_ITEM.test(item)
}

const placeKey = (r: { zone?: ZoneShort; zoneName?: string }): string => r.zone ?? `?${(r.zoneName ?? '').toLowerCase()}`

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Does the walkthrough NAME this mob? Its FULL name, as whole words. A common-noun mob ("a
 * magician", "an orc runner") must appear WITH an article — any of a / an / the — so a Magician's
 * quest page that says "Magician" names no mob at all; a proper name ("Drosco", "Ronn Castekin")
 * appears as written, case aside.
 */
export function mentions(text: string, mob: string): boolean {
  const bare = mob.replace(/^(a|an|the)\s+/i, '').trim()
  if (bare === '') return false
  const article = bare !== mob.trim() || /^[a-z]/.test(bare) ? '(?:a|an|the)\\s+' : ''
  return new RegExp(`(?<![\\w'\`])${article}${escape(bare)}(?![\\w'\`])`, 'i').test(text)
}

/** Two pages for one mob name in one zone are one row: their chips are merged, never repeated. */
function dedupeRows(rows: readonly ItemSourceRow[]): ItemSourceRow[] {
  const out = new Map<string, ItemSourceRow>()
  for (const r of rows) {
    const k = `${r.mob.toLowerCase()}|${placeKey(r)}`
    const had = out.get(k)
    if (had) had.chips.push(...r.chips.filter((c) => !had.chips.some((o) => c.loc !== undefined && o.loc?.ns === c.loc.ns && o.loc.ew === c.loc.ew)))
    else out.set(k, { ...r, chips: [...r.chips] })
  }
  return [...out.values()]
}

/** Where each needed item drops: located mobs first, then catalog order; capped. */
export function itemSources(quest: QuestEntry, index: MobIndex): QuestItemSources[] {
  const out: QuestItemSources[] = []
  const text = (quest.steps ?? []).join('\n')
  for (const item of quest.requiredItems ?? []) {
    const all = dedupeRows(index.droppers(item).map((m) => itemRow(m, quest, index, `item:${item}`)))
    // A NAME MANY THINGS SHARE ("a tattered note", "Sealed Letter") needs evidence that THIS dropper
    // drops THIS quest's one: the quest's own words name the mob. (Its zone being on the route is
    // NOT enough: Tergon's Spellbook visits West Freeport and its Sealed Letter is Tergon's own.)
    const rows = sharedName(item) ? all.filter((r) => mentions(text, r.mob)) : all
    if (rows.length === 0) continue
    const located = rows.filter((r) => r.zone !== undefined && r.points.length > 0)
    const rest = rows.filter((r) => !(r.zone !== undefined && r.points.length > 0))
    const ordered = [...located, ...rest]
    const listed = ordered.slice(0, MAX_ITEM_SOURCES)
    out.push({ item, rows: listed, more: Math.max(0, ordered.length - MAX_ITEM_SOURCES), chips: listed.flatMap((r) => r.chips) })
  }
  return out
}

/** The giver and the Related NPCs, each with the points its bestiary page states. */
function npcChips(quest: QuestEntry, index: MobIndex): QuestLocations['npcs'] {
  const names = [...new Set([quest.giver, ...(quest.relatedNpcs ?? [])].filter((n): n is string => n !== undefined))]
  return names.map((name) => {
    const entry = index.npc(name)
    return { name, chips: entry ? bestiaryChips({ entry, link: { page: name }, quest, index, key: `npc:${name}` }) : [] }
  })
}

/** Everything the quest page draws about WHERE, in one pass. */
export function questLocations(quest: QuestEntry, index: MobIndex): QuestLocations {
  // THE WALKTHROUGH'S TRAIL: the zone the steps so far last MOVED the player to ("You have entered
  // North Qeynos.", "Head to North Qeynos.") or placed a point in. A step that names no zone is
  // read against it, not against the quest's start zone (questLocZones.ts, rule 5).
  let trail: ZoneMention | null | undefined
  const items = questItemNames(quest)
  const steps = (quest.steps ?? []).map((text, i) => {
    const { chips, placed } = stepChips(quest, i, index, trail)
    const atTop = (quest.steps ?? []).slice(0, i).every(isBoundary)
    trail = nextTrail({ text, links: quest.stepLinks?.[i] ?? [], items, prev: trail, start: quest.startZone, atTop, ...(placed ? { placed } : {}) })
    return chips
  })
  return {
    steps,
    npcs: npcChips(quest, index),
    items: itemSources(quest, index),
    groundSpawns: groundSpawnLocs(quest, index)
  }
}
