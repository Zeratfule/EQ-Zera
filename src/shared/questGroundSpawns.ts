// questGroundSpawns.ts — WHERE a quest's ground spawns are: one chip per point a walkthrough TABLE
// states for an item to pick up (or the object to combine them in), `QuestEntry.groundSpawns`.
//
// THE SAME RULES AS THE STEPS, NOT LOOSER ONES. A ground spawn's zone is decided by `coordZone`
// (./questLocZones.ts), the resolver every step coordinate goes through, over the row's own words:
//   - the row's stated zone (a Zone column, or its `{{Loc|Zone|…}}`) is rule 0, the template zone;
//   - the row's words and links ("on the chessboard in front of [[The Game Master]]") are the step
//     text and links of rules 1-4 — an NPC the row names places it only when the bestiary puts that
//     NPC in one zone;
//   - the table's SECTION is the walkthrough trail of rule 5: the zone the section's own words name
//     before the table ("…to enter Nektropos Castle"), when they name exactly one; nothing named
//     leaves the quest's start zone standing; two or more zones named is LOST — no map, never a pick.
// And every answer still faces the bestiary's second opinion, the zone's known spread, and at runtime
// the map file's own extent (features/maps/onMap.ts). A row the rules cannot place keeps its numbers
// as plain text with no jump: the coordinate is real, the map would be a guess (world-model law 1).
//
// PURE; tests/questGroundSpawns.test.mts drives the real catalog and bestiary.

import type { NpcLookup, ZoneMention } from './questLocZones'
import { coordZone, questItemNames, zonesNamed } from './questLocZones'
import type { QuestLocChip } from './questLocations'
import type { QuestEntry, QuestGroundSpawn } from './questTypes'

/** One ground spawn (or object), and the chip that says where it is. */
export interface GroundSpawnLoc {
  spawn: QuestGroundSpawn
  chip: QuestLocChip
}

const fmt = (s: QuestGroundSpawn): string => `(${[s.ns, s.ew, ...(s.z === undefined ? [] : [s.z])].map(String).join(', ')})`

/** The trail the table's section sets: one zone named, none (the start zone stands), or several (lost). */
function sectionTrail(spawn: QuestGroundSpawn, items: readonly string[]): ZoneMention | null | undefined {
  if (spawn.context === undefined) return undefined
  const named = zonesNamed(spawn.context, [], items)
  if (named.length === 0) return undefined
  return named.length === 1 ? named[0] : null
}

/** What every spawn of one quest is judged with. */
interface Judge {
  quest: QuestEntry
  lookup: NpcLookup
  /** item names, never read as places */
  items: readonly string[]
}

/** Where one ground spawn is, by the step rules. */
function spawnChip({ quest, lookup, items }: Judge, spawn: QuestGroundSpawn, i: number): QuestLocChip {
  // The row read as the step a walkthrough would have written: "<item> at (a, b). <its note>".
  const lead = `${spawn.item} at `
  const text = `${lead}${fmt(spawn)}.${spawn.note === undefined ? '' : ` ${spawn.note}`}`
  const point = spawn.z === undefined ? { ns: spawn.ns, ew: spawn.ew } : { ns: spawn.ns, ew: spawn.ew, z: spawn.z }
  const v = coordZone({
    text,
    at: lead.length,
    templateZone: spawn.zone,
    links: spawn.links ?? [],
    quest,
    lookup,
    point,
    trail: sectionTrail(spawn, items),
    neighbours: text
  })
  const chip: QuestLocChip = { key: `gs${String(i)}`, name: spawn.item, loc: point, sources: ['quest'], why: v.why }
  if (v.zone !== null) chip.zoneName = v.zone.name
  if (v.zone?.stem != null) chip.zone = v.zone.stem
  return chip
}

/** Every ground spawn the quest's tables state, in page order, each with its chip. */
export function groundSpawnLocs(quest: QuestEntry, lookup: NpcLookup): GroundSpawnLoc[] {
  // The spawns' own names are items too: "Harpsichord String" must never read as a place.
  const judge: Judge = { quest, lookup, items: [...questItemNames(quest), ...(quest.groundSpawns ?? []).map((s) => s.item)] }
  return (quest.groundSpawns ?? []).map((spawn, i) => ({ spawn, chip: spawnChip(judge, spawn, i) }))
}

/**
 * The page's ground spawns, split for the page: those of a NEEDED item (by name, case aside), which
 * read under "Where to get it", and the rest, which get their own block.
 */
export function splitGroundSpawns(all: readonly GroundSpawnLoc[], needed: readonly string[]): { needed: GroundSpawnLoc[]; rest: GroundSpawnLoc[] } {
  const keys = new Set(needed.map((n) => n.toLowerCase()))
  const isNeeded = (g: GroundSpawnLoc): boolean => keys.has(g.spawn.item.toLowerCase())
  return { needed: all.filter(isNeeded), rest: all.filter((g) => !isNeeded(g)) }
}

/** The block's title, naming what its lines are: "Ground spawns · 10", "Objects · 1", or both. */
export function groundSpawnsTitle(ground: readonly GroundSpawnLoc[]): string {
  const objects = ground.filter((g) => g.spawn.kind === 'object').length
  const head = objects === 0 ? 'Ground spawns' : objects === ground.length ? 'Objects' : 'Ground spawns and objects'
  return `${head} · ${String(ground.length)}`
}
