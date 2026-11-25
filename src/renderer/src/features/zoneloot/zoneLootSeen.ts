// zoneLootSeen — the "Yours" half of Zone Loot: your own loot history for one picked zone, as item
// key -> count and per-hour-of-active-time rate. PURE (relative value imports, the repo rule for
// node-tested modules) so tests/zoneLoot.test.mts drives it under plain node.
//
// ONE ZONE WHICHEVER WAY IT IS SPELLED. The picker names a zone the table carries by the table's
// name (zoneLoot.ts `zoneOptions`), while the log may print any spelling the table knows for it
// (`Northern Felwithe` is `North Felwithe`, `The Permafrost Caverns - Solo 3` is `Permafrost
// Keep`). So the zone test here, and the one `rangeStats` / `windowItemRows` run, admits every
// place-fold key `shared/zones.zoneSameKeys` returns for the option — verified rows only, never a
// matcher.

import type { LootEvent, ProgressionSnap } from '../../../../shared/types'
import { isDestroyed } from '../../../../shared/lootDisposition'
import { windowItemRows, type WindowSpans } from '../../../../shared/lootRates'
import { rangeStats } from '../../../../shared/progressionStats'
import { zoneKey, zoneSameKeys } from '../../../../shared/zones'
import { dataBounds } from '../leveling/zoneBands'
import { lootItemKey, type SeenRate } from './zoneLoot'

/** The same one-millisecond tail `windowScope.ts` documents - `rangeStats` ranges are half-open. */
const TAIL_MS = 1

/** Your counts with no rate at all - the no-progression fallback. Σ stack sizes, destroys refused
 *  the way `lootRates.inWindow` refuses them, so a bag cleanup is not a drop. */
function countsOnly(events: readonly LootEvent[], same: ReadonlySet<string>): Map<string, SeenRate> {
  const out = new Map<string, SeenRate>()
  for (const e of events) {
    if (isDestroyed(e)) continue
    if (same.size > 0 && !same.has(zoneKey(e.zone ?? ''))) continue
    const row = out.get(lootItemKey(e.item))
    if (row) row.drops += e.count ?? 1
    else out.set(lootItemKey(e.item), { drops: e.count ?? 1, perHour: null })
  }
  return out
}

/** The map `zoneLootRows` joins against, plus whether anything divided by real time. */
export interface SeenJoin {
  map: Map<string, SeenRate>
  hasRates: boolean
}

/**
 * Your history for one zone. `windowItemRows` applies the zone filter itself and must: `spans` is
 * already that zone's own time, so counting every zone's drops against one zone's hours is the
 * exact mismatch lootRates.ts rule 2 exists to prevent.
 */
export function zoneLootSeen(events: readonly LootEvent[], prog: ProgressionSnap | null, zone: string): SeenJoin {
  const key = zoneKey(zone)
  const same = zoneSameKeys(zone)
  if (events.length === 0) return { map: new Map(), hasRates: false }
  const bounds = prog ? dataBounds(prog, [events[0].ts, events[events.length - 1].ts]) : null
  if (!prog || !bounds) return { map: countsOnly(events, same), hasRates: false }
  const range = { t0: bounds.lo, t1: bounds.hi + TAIL_MS }
  const zf = key === '' ? { zoneKey: null } : { zoneKey: key, zoneSameKeys: same }
  const spans: WindowSpans = rangeStats({ snap: prog, range, ...zf })
  const map = new Map<string, SeenRate>()
  for (const row of windowItemRows({ events, ...range, spans, ...zf })) {
    map.set(row.key, { drops: row.drops, perHour: row.dropsPerHourActive })
  }
  return { map, hasRates: spans.activeMs > 0 }
}
