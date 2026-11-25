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
import { itemBaseName } from './itemStats'
import { zoneShortNameFromCatalog } from './zones'
import { coordZone, isPlaceholderZone, linksIn, npcZone, sentenceSpan, type NpcLookup, type NpcZone, type ZoneMention } from './questLocZones'

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
}

export const MAX_ITEM_SOURCES = 3
/** Chips one step may carry. A step linking nine placeable NPCs is a list, not a step. */
export const MAX_STEP_CHIPS = 6

/** The bestiary, indexed once: by page, by unique name, and by what each mob drops. */
export interface MobIndex extends NpcLookup {
  droppers: (item: string) => readonly MobEntry[]
}

/** The item key — `lib/itemSources.ts sourceItemKey`, from its shared half. */
export const dropKey = (name: string): string => itemBaseName(name).toLowerCase()

/** Fewer stated points than this in a zone and its spread is no evidence of anything. */
const MIN_SPREAD_POINTS = 8
/** Slack around a zone's stated spread, in /loc units, so an edge camp still counts as inside. */
const SPREAD_PAD = 150

interface Spread {
  n: number
  minNs: number
  maxNs: number
  minEw: number
  maxEw: number
}

/** Per map stem, the box the bestiary's single-zone pages' stated points span. */
function zoneSpreads(mobs: readonly MobEntry[]): Map<ZoneShort, Spread> {
  const out = new Map<ZoneShort, Spread>()
  for (const m of mobs) {
    if (m.zones?.length !== 1 || !m.loc?.length) continue
    const stem = zoneShortNameFromCatalog(m.zones[0])
    if (stem === null) continue
    for (const l of m.loc) {
      const s = out.get(stem)
      if (!s) out.set(stem, { n: 1, minNs: l.ns, maxNs: l.ns, minEw: l.ew, maxEw: l.ew })
      else {
        s.n++
        s.minNs = Math.min(s.minNs, l.ns)
        s.maxNs = Math.max(s.maxNs, l.ns)
        s.minEw = Math.min(s.minEw, l.ew)
        s.maxEw = Math.max(s.maxEw, l.ew)
      }
    }
  }
  return out
}

/**
 * `questPages` are the catalog's quest titles: a step linking "Cleaner Clockwork" links the QUEST,
 * whatever bestiary page shares its name, so those titles are never read as an NPC.
 */
export function buildMobIndex(mobs: readonly MobEntry[], questPages: Iterable<string> = []): MobIndex {
  const notNpc = new Set([...questPages].map((p) => p.toLowerCase()))
  const byPage = new Map<string, MobEntry>()
  const byName = new Map<string, MobEntry[]>()
  const byDrop = new Map<string, MobEntry[]>()
  for (const m of mobs) {
    byPage.set(m.page.toLowerCase(), m)
    const n = m.name.toLowerCase()
    byName.set(n, [...(byName.get(n) ?? []), m])
    for (const d of new Set((m.drops ?? []).map(dropKey))) {
      if (d !== '') byDrop.set(d, [...(byDrop.get(d) ?? []), m])
    }
  }
  const spread = zoneSpreads(mobs)
  return {
    within: (stem, p) => {
      const s = spread.get(stem)
      if (s === undefined || s.n < MIN_SPREAD_POINTS) return undefined
      const padNs = Math.max(SPREAD_PAD, (s.maxNs - s.minNs) * 0.15)
      const padEw = Math.max(SPREAD_PAD, (s.maxEw - s.minEw) * 0.15)
      return p.ns >= s.minNs - padNs && p.ns <= s.maxNs + padNs && p.ew >= s.minEw - padEw && p.ew <= s.maxEw + padEw
    },
    // A page title is unique; a name is used only when exactly one page carries it.
    npc: (page) => {
      const k = page.replace(/_/g, ' ').trim().toLowerCase()
      if (notNpc.has(k)) return undefined
      const named = byName.get(k)
      return byPage.get(k) ?? (named?.length === 1 ? named[0] : undefined)
    },
    droppers: (item) => byDrop.get(dropKey(item)) ?? []
  }
}

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
function stepChips(quest: QuestEntry, i: number, index: MobIndex, earlier: ReadonlySet<ZoneShort>): QuestLocChip[] {
  const text = quest.steps?.[i] ?? ''
  const links = quest.stepLinks?.[i] ?? []
  const out: QuestLocChip[] = []
  ;(quest.stepLocs?.[i] ?? []).forEach((l, n) => {
    const v = coordZone({ text, at: l.at, templateZone: l.zone, links, quest, lookup: index, point: l, earlier })
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
  return out.slice(0, MAX_STEP_CHIPS)
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

/** Where each needed item drops: located mobs first, then catalog order; capped. */
export function itemSources(quest: QuestEntry, index: MobIndex): QuestItemSources[] {
  const out: QuestItemSources[] = []
  for (const item of quest.requiredItems ?? []) {
    const rows = index.droppers(item).map((m) => itemRow(m, quest, index, `item:${item}`))
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
  // The walkthrough's trail: where the quest page's own words placed each earlier step.
  const earlier = new Set<ZoneShort>()
  const steps = (quest.steps ?? []).map((_s, i) => {
    const chips = stepChips(quest, i, index, earlier)
    for (const c of chips) if (c.zone !== undefined && c.sources.includes('quest')) earlier.add(c.zone)
    return chips
  })
  return {
    steps,
    npcs: npcChips(quest, index),
    items: itemSources(quest, index)
  }
}
