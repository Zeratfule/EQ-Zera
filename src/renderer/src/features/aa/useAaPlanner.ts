// useAaPlanner — the AA tab's inputs, joined. Reads four served modules (leveling for the purchase
// and point lines, progression for the log clock and the pace window, character for who and what
// level, combo for the class trio) plus the committed wiki catalog, and keeps the user's plan in a
// per-character renderer pref. Every rule is in shared/aaPlanner.ts and shared/aaPlanStore.ts,
// pure and node-tested; this file only wires.
//
// THE PACE is the AA pace of the LAST 24 HOURS OF THE LOG, in points per ONLINE hour (logouts the
// log shows are carved out). Wider than the Overview card's hour on purpose: a plan is measured in
// days, and an hour window is empty the moment the user stops to med, travel or log off, which
// left most plans with no estimate. A pause since the last completion does not void the pace here
// either; only too few completions in the window (`no-pace`) leaves the plan without an ETA.

import { useCallback, useMemo, useState } from 'react'
import type { CharacterSnap, LevelingSnap, ProgressionSnap } from '@shared/types'
import type { AaCatalogData, AaCatalogEntry } from '@shared/aaCatalog'
import type { ClassAbbr } from '@shared/classCombo'
import { useModule } from '../../lib/useModule'
import { EMPTY_LEVELING } from '../leveling/levelingModule'
import { EMPTY_PROGRESSION } from '../leveling/progressionDelta'
import { useStatedLevel } from '../leveling/useStatedLevel'
import { useComboSnap } from '../profiles/ClassComboData'
import { computeAAAccounting } from '../../../../shared/aa'
import { aaLedger } from '../../../../shared/aaLedger'
import { aaPace } from '../../../../shared/aaPace'
import { rangeStats } from '../../../../shared/progressionStats'
import { resolvedClasses } from '../../../../shared/classCombo'
import { catalogIndex, heldRanks, type AaHeld } from '../../../../shared/aaPlanner'
import { aaPlanStorageKey, EMPTY_AA_PLAN, parseStoredPlan, serializePlan, type AaPlan } from '../../../../shared/aaPlanStore'
import catalogJson from '../../data/eqlegends/aaCatalog.json'

export const AA_CATALOG = catalogJson as unknown as AaCatalogData
const INDEX = catalogIndex(AA_CATALOG.entries)
const PACE_WINDOW_MS = 24 * 3_600_000

export interface AaPlannerInputs {
  catalog: readonly AaCatalogEntry[]
  index: ReadonlyMap<string, AaCatalogEntry>
  held: Map<string, AaHeld>
  /** log AA names the catalog does not know */
  unmatched: string[]
  /** the resolved classes of the current loadout */
  classes: ClassAbbr[]
  /** how many class slots the current loadout has (0 before the combo module answers) */
  slots: number
  level: number | null
  banked: number
  allocated: number
  /** ESTIMATE input: points per online hour over the last 24 hours of the log; null when there is no pace */
  pointsPerHour: number | null
  /** the first AA line this log holds, or null when it holds none */
  seenSince: number | null
  plan: AaPlan
  updatePlan: (fn: (p: AaPlan) => AaPlan) => void
}

function loadPlan(key: string | null): AaPlan {
  if (key === null) return EMPTY_AA_PLAN
  try {
    return parseStoredPlan(localStorage.getItem(key), INDEX)
  } catch {
    return EMPTY_AA_PLAN
  }
}

function savePlan(key: string | null, plan: AaPlan): void {
  if (key === null) return
  try {
    localStorage.setItem(key, serializePlan(plan))
  } catch {
    // A plan that cannot be written is a plan that is not remembered, never an error.
  }
}

/** The plan for this character, re-read when the character changes, written on every edit. */
function useStoredPlan(key: string | null): [AaPlan, (fn: (p: AaPlan) => AaPlan) => void] {
  const [state, setState] = useState(() => ({ key, plan: loadPlan(key) }))
  // Adjusting state while rendering (React's documented pattern) rather than in an effect: the
  // character module can answer after mount, and an effect would draw one frame of the old plan.
  let current = state
  if (state.key !== key) {
    current = { key, plan: loadPlan(key) }
    setState(current)
  }
  const update = useCallback(
    (fn: (p: AaPlan) => AaPlan) => {
      setState((prev) => {
        const plan = fn(prev.plan)
        savePlan(prev.key, plan)
        return { key: prev.key, plan }
      })
    },
    []
  )
  return [current.plan, update]
}

function paceOf(leveling: LevelingSnap, prog: ProgressionSnap): number | null {
  if (leveling.aaGains.length === 0 || prog.lastTs <= 0) return null
  const window = rangeStats({ snap: prog, range: { t0: prog.lastTs - PACE_WINDOW_MS, t1: prog.lastTs } })
  const pace = aaPace({ leveling, prog, window })
  if (pace.eta.blocked === 'no-pace') return null
  const pph = pace.pointsPerHourWall
  return pph !== null && pph > 0 ? pph : null
}

function firstAaTs(leveling: LevelingSnap): number | null {
  const a = leveling.aaGains[0]?.ts
  const b = leveling.aaSpends[0]?.ts
  if (a === undefined && b === undefined) return null
  return Math.min(a ?? Number.POSITIVE_INFINITY, b ?? Number.POSITIVE_INFINITY)
}

export function useAaPlanner(): AaPlannerInputs {
  const leveling = useModule<LevelingSnap>('leveling') ?? EMPTY_LEVELING
  const prog = useModule<ProgressionSnap>('progression') ?? EMPTY_PROGRESSION
  const who = useModule<CharacterSnap>('character')
  const combo = useComboSnap()
  const stated = useStatedLevel(prog)
  const [plan, updatePlan] = useStoredPlan(aaPlanStorageKey(who?.character))
  const ledger = useMemo(() => aaLedger(leveling.aaSpends), [leveling.aaSpends])
  const acct = useMemo(() => computeAAAccounting(leveling.aaGains, leveling.aaSpends), [leveling.aaGains, leveling.aaSpends])
  const { held, unmatched } = useMemo(() => heldRanks(ledger, plan.stated, INDEX), [ledger, plan.stated])
  const pointsPerHour = useMemo(() => paceOf(leveling, prog), [leveling, prog])
  const current = combo.current
  const classes = useMemo(() => (current ? resolvedClasses(current) : []), [current])
  return {
    catalog: AA_CATALOG.entries,
    index: INDEX,
    held,
    unmatched,
    classes,
    slots: current?.slots.length ?? 0,
    level: stated.level,
    banked: acct.unspent,
    allocated: acct.allocated,
    pointsPerHour,
    seenSince: firstAaTs(leveling),
    plan,
    updatePlan
  }
}
