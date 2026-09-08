// useZoneLoot — the Zone Loot tab's two module reads, and the memo that joins them (ROADMAP §2).
//
// It adds no third store and derives no denominator of its own. The `loot` module supplies what
// you have had (each row already stamped with the zone it happened in - lootRates.ts rule 1), and
// the `progression` module supplies the hours to divide by, through the very same `rangeStats`
// query the Leveling tab's range panel and `useSliceLootRates` read. `shared/lootRates` does the
// arithmetic; this file only decides WHICH RANGE and WHICH ZONE, and `zoneLoot.ts` does the join.
//
// THE RANGE IS THE WHOLE RECORD. This tab has no timeslice control - it is a planning surface
// ("what should I expect from this zone"), not a session readout - so the window is `dataBounds`
// widened by the loot history's own ends, with the same `+1 ms` tail `windowScope.statsRangeFor`
// uses so the newest event is inside a half-open range. The history is passed WHOLE and cut by
// `windowItemRows` itself, exactly as `useSliceLootRates` passes it, so the numerator and the
// denominators can never disagree about what "inside this zone" means.
//
// NO PROGRESSION SNAPSHOT ⇒ COUNTS WITH NO RATE, NEVER A ZERO (the JOS-78 rule). A fresh log, or
// a replay that has not reached the analytics module yet, still knows what you looted; it does not
// know how long you stood there. A rate of 0 would read as "this zone pays nothing", which is a
// claim nobody made, so the cell says `-` and the count stays true.
//
// THE ZONE FILTER IS THE LOG'S FOLD APPLIED TO A CATALOG SPELLING, and the one seam where the two
// naming authorities can still miss: the picker offers the CATALOG's names, and a zone the log
// spells differently enough that `zoneKey` does not fold them together (the `catalogZonesFor`
// renames - log "The Ruins of Old Paineel" is catalog "The Hole") shows the wiki table with an
// empty Yours column rather than a wrong one. Understating your own history is the safe direction;
// crediting one zone's drops to another is not.

import { useMemo } from 'react'
import type { CharacterSnap, LootEvent, ProgressionSnap } from '@shared/types'
import { isDestroyed } from '@shared/lootDisposition'
import { windowItemRows, type WindowSpans } from '@shared/lootRates'
import { rangeStats } from '@shared/progressionStats'
import type { BuildProfile } from '../../../../shared/build/profiles'
import { useModule } from '../../lib/useModule'
// THE UPGRADE VERDICT (EQ Zera): the Build tab's own comparison, asked once per distinct item in
// the zone. It is a hook rather than a fold because it reads the gear index and the inventory
// dump; `zoneLootRows` takes it as an injected function so the node test can drive the join.
import { useUpgradeFinder } from '../build/useUpgradeFinder'
import { dataBounds } from '../leveling/zoneBands'
import { useLootHistory } from '../loot/useLootHistory'
import { MOB_CATALOG } from '../mobs/mobSearch'
import { zoneKey } from '../mobs/mobZone'
import {
  lootItemKey,
  zoneLootRows,
  zoneLootSummary,
  zoneOptions,
  type SeenRate,
  type ZoneLootRow,
  type ZoneLootSummary,
  type ZoneOption
} from './zoneLoot'

/** The same one-millisecond tail `windowScope.ts` documents - `rangeStats` ranges are half-open. */
const TAIL_MS = 1

/**
 * The picker's list, built ONCE and LAZILY on first use.
 *
 * Lazy for `mobSearch.haystacks`' reason: a pass over 7,918 catalog rows at module load is a cost
 * every session pays for a tab most sessions never open. The catalog is immutable, so the answer
 * lives for the window's lifetime once someone asks for it.
 */
let OPTIONS: ZoneOption[] | null = null
export function zoneLootOptions(): ZoneOption[] {
  OPTIONS ??= zoneOptions(MOB_CATALOG)
  return OPTIONS
}

/** Everything the view draws, for one zone. */
export interface ZoneLootState {
  /** The whole zone's table, unfiltered - the view applies the search and the era disclosure. */
  rows: ZoneLootRow[]
  summary: ZoneLootSummary
  /** True when the progression module gave this zone active time to divide by. */
  hasRates: boolean
  /** An inventory dump exists, so "beats what you wear" is a comparison and not a guess. */
  hasDump: boolean
  /** The profile the verdicts were taken under - the Build tab's, named on the chip. */
  profile: BuildProfile
}

const NO_ROWS: ZoneLootRow[] = []
const EMPTY = {
  rows: NO_ROWS,
  summary: { mobs: 0, drops: 0, outOfEra: 0, seen: 0, upgrades: 0 },
  hasRates: false
}

/** Your counts with no rate at all - the no-progression fallback. Σ stack sizes, destroys refused
 *  the way `lootRates.inWindow` refuses them, so a bag cleanup is not a drop. */
function countsOnly(events: readonly LootEvent[], key: string): Map<string, SeenRate> {
  const out = new Map<string, SeenRate>()
  for (const e of events) {
    if (isDestroyed(e)) continue
    if (key !== '' && zoneKey(e.zone ?? '') !== key) continue
    const row = out.get(lootItemKey(e.item))
    if (row) row.drops += e.count ?? 1
    else out.set(lootItemKey(e.item), { drops: e.count ?? 1, perHour: null })
  }
  return out
}

/** The map `zoneLootRows` joins against, plus whether anything divided by real time. */
interface SeenJoin {
  map: Map<string, SeenRate>
  hasRates: boolean
}

/**
 * Your history for one zone: item key -> count and per-hour-of-active-time rate.
 *
 * `windowItemRows` applies the zone filter itself and must: `spans` is already that zone's own
 * time, so counting every zone's drops against one zone's hours is the exact mismatch
 * lootRates.ts rule 2 exists to prevent.
 */
function seenByItem(events: readonly LootEvent[], prog: ProgressionSnap | null, zone: string): SeenJoin {
  const key = zoneKey(zone)
  if (events.length === 0) return { map: new Map(), hasRates: false }
  const bounds = prog ? dataBounds(prog, [events[0].ts, events[events.length - 1].ts]) : null
  if (!prog || !bounds) return { map: countsOnly(events, key), hasRates: false }
  const range = { t0: bounds.lo, t1: bounds.hi + TAIL_MS }
  const spans: WindowSpans = rangeStats({ snap: prog, range, zoneKey: key === '' ? null : key })
  const map = new Map<string, SeenRate>()
  for (const row of windowItemRows({ events, ...range, spans, zoneKey: key === '' ? null : key })) {
    map.set(row.key, { drops: row.drops, perHour: row.dropsPerHourActive })
  }
  return { map, hasRates: spans.activeMs > 0 }
}

/**
 * The tab's data, for the zone the picker is on. `''` is a real state (nothing picked) and costs
 * nothing - no catalog walk, no progression query.
 */
export function useZoneLoot(zone: string): ZoneLootState {
  const loot = useLootHistory()
  const prog = useModule<ProgressionSnap>('progression')
  const finder = useUpgradeFinder()
  const { verdictFor, hasDump, profile } = finder
  return useMemo(() => {
    if (zone === '') return { ...EMPTY, hasDump, profile }
    const seen = seenByItem(loot, prog, zone)
    const rows = zoneLootRows({ zone, catalog: MOB_CATALOG, seenByItem: seen.map, verdict: verdictFor })
    return { rows, summary: zoneLootSummary(rows), hasRates: seen.hasRates, hasDump, profile }
  }, [zone, loot, prog, verdictFor, hasDump, profile])
}

/**
 * The zone to open on when nothing has been remembered: WHERE YOU ARE STANDING.
 *
 * Resolved to a PICKER OPTION rather than returned raw, because the raw display zone the log
 * printed ("The Ruins of Old Paineel - Solo 4 (Refined)") is not a value the picker can hold - it
 * would seed the control with a name absent from its own list. A zone whose fold key matches no
 * option yields `''`, which lands the reader on the "pick a zone" state instead of a wrong one.
 */
export function useDefaultZone(): string {
  const zone = useModule<CharacterSnap>('character')?.zone
  return useMemo(() => {
    const key = zoneKey(zone ?? '')
    if (key === '') return ''
    return zoneLootOptions().find((o) => o.key === key)?.zone ?? ''
  }, [zone])
}
