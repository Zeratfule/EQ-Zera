// questMapPins.ts — the Maps tab's QUEST PIN LAYER, as pure data (quest locations wave).
//
// The quests a player is following (the tracker, shared/questPins.ts) plus the one they just
// jumped from each resolve to chips (shared/questLocations.ts); this keeps the chips that state a
// POINT on the map ON SCREEN and labels each with the quest and the part it plays. Nothing is
// re-resolved here and nothing is placed that the chip did not already place: a chip with no map
// stem, or a stem other than the zone drawn, is simply not on this map.
//
// One pin per distinct point per quest. Two chips saying the same spot in one quest (a step and
// the NPC it names) are one pin naming both, because two marks on one pixel read as one anyway
// and the hover is where the difference belongs.

import type { ZoneShort } from './maps'
import type { LocPoint, QuestLocations } from './questLocations'

/** One mark on the quest layer, still in /loc axes — the surface converts through `mapFromLoc`. */
export interface QuestMapPin {
  key: string
  loc: LocPoint
  /** the quest page this pin belongs to */
  quest: string
  /** "Hate, Betrayal, and Trust - step 4: Rylin Coil", one line per thing at this point */
  labels: string[]
}

export interface QuestForPins {
  page: string
  name: string
  locs: QuestLocations
}

/** Most pins the layer draws at once. Far above any real quest; a guard, not a policy. */
export const MAX_QUEST_PINS = 300

interface Placed {
  zone?: ZoneShort
  loc?: LocPoint
  label: string
}

/** Everything one quest places, labelled with the part it plays. */
function placed(q: QuestForPins): Placed[] {
  const out: Placed[] = []
  q.locs.steps.forEach((chips, i) => {
    for (const c of chips) out.push({ zone: c.zone, loc: c.loc, label: `${q.name} - step ${String(i + 1)}${c.name ? `: ${c.name}` : ''}` })
  })
  for (const n of q.locs.npcs) for (const c of n.chips) out.push({ zone: c.zone, loc: c.loc, label: `${q.name} - ${n.name}` })
  for (const it of q.locs.items) {
    for (const r of it.rows) for (const c of r.chips) out.push({ zone: c.zone, loc: c.loc, label: `${q.name} - ${it.item} drops from ${r.mob}` })
  }
  for (const g of q.locs.groundSpawns) {
    const what = g.spawn.kind === 'object' ? g.spawn.item : `${g.spawn.item} (ground spawn)`
    out.push({ zone: g.chip.zone, loc: g.chip.loc, label: `${q.name} - ${what}` })
  }
  return out
}

/** The pins for the zone on screen, one per distinct point per quest, capped. */
export function questPinsInZone(
  quests: readonly QuestForPins[],
  zone: ZoneShort | null | undefined,
  /** the map file's own say: a point it does not hold is never drawn (the renderer knows the extent) */
  keep: (loc: LocPoint) => boolean = () => true
): QuestMapPin[] {
  if (zone == null) return []
  const byKey = new Map<string, QuestMapPin>()
  for (const q of quests) {
    for (const p of placed(q)) {
      if (p.zone !== zone || p.loc === undefined || !keep(p.loc)) continue
      add(byKey, q.page, p.loc, p.label)
    }
  }
  return [...byKey.values()].slice(0, MAX_QUEST_PINS)
}

/** One placed thing into the pin map: a new pin, or one more label on the pin already there. */
function add(byKey: Map<string, QuestMapPin>, quest: string, loc: LocPoint, label: string): void {
  const key = `${quest}@${String(Math.round(loc.ns))},${String(Math.round(loc.ew))}`
  const pin = byKey.get(key)
  if (!pin) byKey.set(key, { key, loc, quest, labels: [label] })
  else if (!pin.labels.includes(label)) pin.labels.push(label)
}
