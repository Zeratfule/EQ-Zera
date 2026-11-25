/**
 * AUDIT, NOT SHIPPED: every ground spawn a quest page's table states (`QuestEntry.groundSpawns`,
 * scripts/sources/questGroundSpawns.ts), the zone the step rules gave it (src/shared/questGroundSpawns.ts)
 * and why, the bestiary mobs standing near the point, and — when this machine has an EverQuest
 * install — whether the point is on the zone's drawn map. Read all of it when a rule or a table changes.
 *
 *   node --import tsx scripts/audit-quest-ground-spawns.mts [path-to-maps-dir]
 *
 * Offline: reads the committed quests.json and mobs.json, and the map files when present.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MapLayer, ZoneShort } from '../src/shared/maps'
import type { MobData, QuestData } from '../src/shared/types'
import { buildMapData, parseMapText } from '../src/main/maps/parseMap'
import { buildMobIndex } from '../src/shared/questLocations'
import { groundSpawnLocs } from '../src/shared/questGroundSpawns'

const MAPS = process.argv[2] ?? 'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/maps'
const DATA = join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'data', 'eqlegends')
const quests = (JSON.parse(readFileSync(join(DATA, 'quests.json'), 'utf8')) as QuestData).quests
const mobs = (JSON.parse(readFileSync(join(DATA, 'mobs.json'), 'utf8')) as MobData).mobs
const index = buildMobIndex(mobs, quests.map((q) => q.page))

/** The renderer's onMap.ts, restated (x = -ew, y = -ns, a 5% margin), as audit-quest-maps.mts does. */
function onMap(stem: ZoneShort, l: { ns: number; ew: number }): string {
  const layers: [string, MapLayer][] = [[`${stem}.txt`, 0], [`${stem}_1.txt`, 1], [`${stem}_3.txt`, 3]]
  const parts = layers.flatMap(([f, layer]) => (existsSync(join(MAPS, f)) ? [parseMapText(readFileSync(join(MAPS, f), 'utf8'), layer)] : []))
  if (parts.length === 0) return 'no map file here'
  const b = buildMapData(parts, { zone: stem, sources: [] }).bounds
  const mx = (b.maxX - b.minX) * 0.05
  const my = (b.maxY - b.minY) * 0.05
  const inside = -l.ew >= b.minX - mx && -l.ew <= b.maxX + mx && -l.ns >= b.minY - my && -l.ns <= b.maxY + my
  return inside ? 'on the drawn map' : 'OFF THE DRAWN MAP'
}

const fmt = (l: { ns: number; ew: number; z?: number }): string => `(${[l.ns, l.ew, ...(l.z === undefined ? [] : [l.z])].join(', ')})`
let total = 0
let mapped = 0
let named = 0
for (const q of quests) {
  const locs = groundSpawnLocs(q, index)
  if (locs.length === 0) continue
  console.log(`\n[${q.page}] start zone: ${q.startZone ?? '-'}`)
  for (const { spawn, chip } of locs) {
    total++
    if (chip.zone !== undefined) mapped++
    else if (chip.zoneName !== undefined) named++
    const where = chip.zone !== undefined ? `${chip.zoneName ?? ''} -> ${chip.zone}` : chip.zoneName === undefined ? 'NO ZONE' : `${chip.zoneName} (no map)`
    console.log(`  ${spawn.kind ?? 'ground spawn'} ${spawn.item} ${fmt(spawn)}${spawn.zone ? ` [table says ${spawn.zone}]` : ''} => ${where}`)
    console.log(`    because ${chip.why}`)
    const near = index.nearby(spawn, 30).map((m) => `${m.name} ${fmt(m.at)} (${m.zone.stem ?? m.zone.name})`)
    if (near.length > 0) console.log(`    bestiary within 30: ${near.join('; ')}`)
    if (chip.zone !== undefined) console.log(`    map: ${onMap(chip.zone, spawn)}`)
    if (spawn.note) console.log(`    note: ${spawn.note}`)
  }
}
console.log(`\nground spawns: ${String(total)}; map jump: ${String(mapped)}; zone named, no map: ${String(named)}; no zone: ${String(total - mapped - named)}`)
