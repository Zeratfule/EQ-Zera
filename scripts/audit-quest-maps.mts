/**
 * AUDIT, NOT SHIPPED: every quest chip that would JUMP (a map stem and a point) checked against the
 * REAL map file's drawn extent, parsed from this machine's EverQuest install by the app's own map
 * parser. The app makes the same check at runtime (src/renderer/src/features/maps/onMap.ts) — a
 * point off its map is never drawn — so anything this lists shows the "outside the map" card in
 * the app; read the list to see whether the resolver should have refused it outright.
 *
 *   node --import tsx scripts/audit-quest-maps.mts [path-to-maps-dir]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MapLayer, ZoneShort } from '../src/shared/maps'
import type { MobData, QuestData } from '../src/shared/types'
import { buildMapData, parseMapText } from '../src/main/maps/parseMap'
import { buildMobIndex, questLocations, type QuestLocChip } from '../src/shared/questLocations'
// The renderer's onMap.ts, restated (the node project cannot import renderer modules): the
// mapFromLoc transform is x = -ew, y = -ns, and the margin is 5% of the drawn span.
function onMap(b: { minX: number; maxX: number; minY: number; maxY: number }, l: { ns: number; ew: number }): boolean {
  const mx = (b.maxX - b.minX) * 0.05
  const my = (b.maxY - b.minY) * 0.05
  return -l.ew >= b.minX - mx && -l.ew <= b.maxX + mx && -l.ns >= b.minY - my && -l.ns <= b.maxY + my
}

const MAPS = process.argv[2] ?? 'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/maps'
const DATA = join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'data', 'eqlegends')
const quests = (JSON.parse(readFileSync(join(DATA, 'quests.json'), 'utf8')) as QuestData).quests
const mobs = (JSON.parse(readFileSync(join(DATA, 'mobs.json'), 'utf8')) as MobData).mobs
const index = buildMobIndex(mobs, quests.map((q) => q.page))

const boundsCache = new Map<ZoneShort, ReturnType<typeof buildMapData>['bounds'] | null>()
function boundsOf(stem: ZoneShort): ReturnType<typeof buildMapData>['bounds'] | null {
  if (boundsCache.has(stem)) return boundsCache.get(stem) ?? null
  const layers: [string, MapLayer][] = [[`${stem}.txt`, 0], [`${stem}_1.txt`, 1], [`${stem}_3.txt`, 3]]
  const parts = layers.flatMap(([f, layer]) => (existsSync(join(MAPS, f)) ? [parseMapText(readFileSync(join(MAPS, f), 'utf8'), layer)] : []))
  const b = parts.length === 0 ? null : buildMapData(parts, { zone: stem, sources: [] }).bounds
  boundsCache.set(stem, b)
  return b
}

let checked = 0
let noMapFile = 0
const off: string[] = []
for (const q of quests) {
  const l = questLocations(q, index)
  const chips: [string, QuestLocChip][] = [
    ...l.steps.flatMap((s, i) => s.map((c): [string, QuestLocChip] => [`step ${String(i + 1)}`, c])),
    ...l.npcs.flatMap((n) => n.chips.map((c): [string, QuestLocChip] => [`NPC ${n.name}`, c])),
    ...l.items.flatMap((it) => it.chips.map((c): [string, QuestLocChip] => [`item ${it.item}`, c]))
  ]
  for (const [where, c] of chips) {
    if (c.zone === undefined || c.loc === undefined) continue
    const b = boundsOf(c.zone)
    if (b === null) {
      noMapFile++
      continue
    }
    checked++
    if (!onMap(b, c.loc)) off.push(`[${q.page}] ${where}: ${c.name ?? ''} ${JSON.stringify(c.loc)} -> ${c.zone} [${c.sources.join('+')}] ${c.why}`)
  }
}
for (const o of [...new Set(off)]) console.log(o)
console.log(`\njumpable chips checked against real map files: ${String(checked)}; off their map: ${String(off.length)} (${String(new Set(off).size)} distinct); no map file in the default set: ${String(noMapFile)}`)
