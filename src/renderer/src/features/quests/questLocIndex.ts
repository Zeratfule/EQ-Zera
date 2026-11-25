// questLocIndex.ts — the renderer's ONE handle on quest locations (quest locations wave).
//
// The resolving is all in src/shared/questLocations.ts (pure, node-tested against the real
// catalog); this file only owns the two lazy singletons the renderer needs to call it: the
// bestiary index, built once on first use from the mob catalog the Mobs tab already bundles, and a
// per-page cache, because the catalog is immutable and a quest page re-renders on every tick.
// Nothing is built at module load — a session that never opens a quest page pays nothing.

import type { QuestEntry } from '@shared/types'
// RELATIVE value imports: the `@shared` alias exists only inside the vite build.
import { buildMobIndex, questLocations, type LocPoint, type MobIndex, type QuestLocations } from '../../../../shared/questLocations'
import { MOB_CATALOG } from '../mobs/mobSearch'
import { QUEST_CATALOG } from './questSearch'

let INDEX: MobIndex | null = null
const CACHE = new Map<string, QuestLocations>()

/** Everything the catalog says about where `quest` happens. Cached per page. */
export function questLocationsFor(quest: QuestEntry): QuestLocations {
  const hit = CACHE.get(quest.page)
  if (hit) return hit
  INDEX ??= buildMobIndex(MOB_CATALOG, QUEST_CATALOG.map((q) => q.page))
  const locs = questLocations(quest, INDEX)
  CACHE.set(quest.page, locs)
  return locs
}

/** `(1469, -190)` / `(-90, 287, 127)`: /loc order, as the game prints it. */
export function formatQuestLoc(p: LocPoint): string {
  return `(${[p.ns, p.ew, ...(p.z === undefined ? [] : [p.z])].map(String).join(', ')})`
}
