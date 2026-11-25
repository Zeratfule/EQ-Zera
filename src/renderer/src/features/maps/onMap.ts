// onMap.ts — does the drawn map hold this /loc? (quest locations wave, review of 4b66753)
//
// THE MAP FILE'S OWN EXTENT IS THE LAST WORD on whether a quest point is in this zone. The resolver
// (shared/questLocations.ts) judges a zone from the wiki's words and the bestiary's spread; the map
// files themselves live only in the player's install, so this check runs where the map is loaded.
// A point outside the drawn extent plus a 5% margin is the wiki being wrong about something, and
// nothing is drawn or centred there as if it were real. Pure, so tests and the audit
// (scripts/audit-quest-maps.mts, which parses the real map files) call the same function.

import type { MapBounds } from '@shared/maps'
// RELATIVE value import: node-tested pure module.
import { mapFromLoc } from './mapGeometry'

/** Margin around the drawn extent, as a share of its span. */
export const ON_MAP_MARGIN = 0.05

export function onMap(bounds: MapBounds, loc: { ns: number; ew: number }): boolean {
  const p = mapFromLoc({ ns: loc.ns, ew: loc.ew, z: 0 })
  const mx = (bounds.maxX - bounds.minX) * ON_MAP_MARGIN
  const my = (bounds.maxY - bounds.minY) * ON_MAP_MARGIN
  return p.x >= bounds.minX - mx && p.x <= bounds.maxX + mx && p.y >= bounds.minY - my && p.y <= bounds.maxY + my
}
