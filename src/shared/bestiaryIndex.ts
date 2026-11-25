// bestiaryIndex.ts — the bestiary (mobs.json), indexed once for the quest-location resolver.
//
// Four questions, all answered from the wiki's own mob pages and nothing else:
//   * which page is this NPC link        — by page title, else by a name only one page carries;
//   * which mobs drop this item          — `|known_loot` inverted, the lib/itemSources.ts key;
//   * is this point inside that zone     — the SPREAD of the points the zone's pages state;
//   * whose spawn point is this          — every single-zone point within a few units of it.
//
// THE SPREAD IS A TRIMMED BOX, ON PURPOSE. It is built from the same points it then judges, so a
// plain min/max box swallows every outlier into itself: Paglan's page says (-8500, 0) for a West
// Karana mob, and a box containing Paglan would vouch for Paglan. The box is the 3rd-97th
// percentile of the zone's points, padded by 30% of that span (at least 150 units), so one wild
// point cannot stretch it — and a zone with too few points to trim says "cannot tell" (undefined)
// rather than anything. It is one witness among several (questLocZones.ts) and a REFUSAL only:
// nothing is ever placed because it fits the box.
//
// PURE; node-tested through tests/questLocations.test.mts against the real catalog.

import type { ZoneShort } from './maps'
import type { MobEntry } from './mobTypes'
import { itemBaseName } from './itemStats'
import { zoneShortNameFromCatalog } from './zones'
import { isPlaceholderZone, type NearbyMob, type NpcLookup } from './questLocZones'

/** The bestiary, indexed once: by page, by unique name, by what each mob drops, by where. */
export interface MobIndex extends NpcLookup {
  droppers: (item: string) => readonly MobEntry[]
}

/** The item key — `lib/itemSources.ts sourceItemKey`, from its shared half. */
export const dropKey = (name: string): string => itemBaseName(name).toLowerCase()

/** Fewer stated points than this in a zone and its spread is no evidence of anything. */
const MIN_SPREAD_POINTS = 8
/** Slack around a zone's trimmed spread, in /loc units, so an edge camp still counts as inside. */
const SPREAD_PAD = 150
const TRIM = 0.03
const PAD_SHARE = 0.3
/** Grid cell for the nearby lookup, /loc units. */
const CELL = 16

interface Box {
  ns: [number, number]
  ew: [number, number]
}

const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]

function trimmed(values: number[]): [number, number] {
  const s = [...values].sort((a, b) => a - b)
  const lo = quantile(s, TRIM)
  const hi = quantile(s, 1 - TRIM)
  const pad = Math.max(SPREAD_PAD, (hi - lo) * PAD_SHARE)
  return [lo - pad, hi + pad]
}

interface Placed {
  name: string
  zoneName: string
  stem: ZoneShort
  ns: number
  ew: number
  z?: number
}

/** Every stated point of every page that names exactly one placeable zone. */
function placedPoints(mobs: readonly MobEntry[]): Placed[] {
  const out: Placed[] = []
  for (const m of mobs) {
    const zones = m.zones ?? []
    if (zones.length !== 1 || isPlaceholderZone(zones[0]) || !m.loc?.length) continue
    const stem = zoneShortNameFromCatalog(zones[0])
    if (stem === null) continue
    for (const l of m.loc) out.push({ name: m.name, zoneName: zones[0], stem, ns: l.ns, ew: l.ew, ...(l.z === undefined ? {} : { z: l.z }) })
  }
  return out
}

function spreads(points: readonly Placed[]): Map<ZoneShort, Box> {
  const byStem = new Map<ZoneShort, { ns: number[]; ew: number[] }>()
  for (const p of points) {
    const s = byStem.get(p.stem) ?? { ns: [], ew: [] }
    s.ns.push(p.ns)
    s.ew.push(p.ew)
    byStem.set(p.stem, s)
  }
  const out = new Map<ZoneShort, Box>()
  for (const [stem, s] of byStem) if (s.ns.length >= MIN_SPREAD_POINTS) out.set(stem, { ns: trimmed(s.ns), ew: trimmed(s.ew) })
  return out
}

const cellKey = (ns: number, ew: number): string => `${String(Math.floor(ns / CELL))},${String(Math.floor(ew / CELL))}`

function grid(points: readonly Placed[]): Map<string, Placed[]> {
  const out = new Map<string, Placed[]>()
  for (const p of points) {
    const k = cellKey(p.ns, p.ew)
    out.set(k, [...(out.get(k) ?? []), p])
  }
  return out
}

/** The grid cells a `tol` window around `p` touches. */
function cellsAround(p: { ns: number; ew: number }, tol: number): string[] {
  const out: string[] = []
  for (let a = Math.floor((p.ns - tol) / CELL); a <= Math.floor((p.ns + tol) / CELL); a++) {
    for (let b = Math.floor((p.ew - tol) / CELL); b <= Math.floor((p.ew + tol) / CELL); b++) out.push(`${String(a)},${String(b)}`)
  }
  return out
}

/** Every placed point within `tol` of `p` on both axes, one per mob and zone. */
function nearbyIn(cells: Map<string, Placed[]>, p: { ns: number; ew: number }, tol: number): NearbyMob[] {
  const out: NearbyMob[] = []
  const seen = new Set<string>()
  for (const m of cellsAround(p, tol).flatMap((k) => cells.get(k) ?? [])) {
    const k = `${m.name}@${m.stem}`
    if (Math.abs(m.ns - p.ns) > tol || Math.abs(m.ew - p.ew) > tol || seen.has(k)) continue
    seen.add(k)
    out.push({ name: m.name, zone: { name: m.zoneName, stem: m.stem }, at: { ns: m.ns, ew: m.ew, ...(m.z === undefined ? {} : { z: m.z }) } })
  }
  return out
}

/** The pages by lowercased title and by lowercased name, and the item inversion. */
function tables(mobs: readonly MobEntry[]): { byPage: Map<string, MobEntry>; byName: Map<string, MobEntry[]>; byDrop: Map<string, MobEntry[]> } {
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
  return { byPage, byName, byDrop }
}

/**
 * `questPages` are the catalog's quest titles: a step linking "Cleaner Clockwork" links the QUEST,
 * whatever bestiary page shares its name, so those titles are never read as an NPC.
 */
export function buildMobIndex(mobs: readonly MobEntry[], questPages: Iterable<string> = []): MobIndex {
  const notNpc = new Set([...questPages].map((p) => p.toLowerCase()))
  const { byPage, byName, byDrop } = tables(mobs)
  const points = placedPoints(mobs)
  const boxes = spreads(points)
  const cells = grid(points)
  return {
    within: (stem, p) => {
      const b = boxes.get(stem)
      if (b === undefined) return undefined
      return p.ns >= b.ns[0] && p.ns <= b.ns[1] && p.ew >= b.ew[0] && p.ew <= b.ew[1]
    },
    nearby: (p, tol) => nearbyIn(cells, p, tol),
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
