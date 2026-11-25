// useAaPlanner — the AA tab's inputs, joined. Reads four served modules (leveling for the purchase
// and point lines, progression for the log clock and the pace window, character for who and what
// level, combo for the class trio), the persisted reincarnation record, and the committed wiki
// catalog, and keeps three per-character renderer prefs: the plan, the race and the respec
// history. Every rule is in shared/aaPlanner.ts, shared/aaPlanStore.ts, shared/aaCharacter.ts and
// shared/aaRankCaps.ts, pure and node-tested; this file only wires.
//
// THE PACE is the AA pace of the LAST 24 HOURS OF THE LOG, in points per ONLINE hour (logouts the
// log shows are carved out). Wider than the Overview card's hour on purpose: a plan is measured in
// days, and an hour window is empty the moment the user stops to med, travel or log off, which
// left most plans with no estimate. A pause since the last completion does not void the pace here
// either; only too few completions in the window (`no-pace`) leaves the plan without an ETA.
//
// A RESPEC cuts the purchase lines (paid lines before it stop counting) for held ranks and for
// `allocated`; `banked` stays the log's own "You now have" arithmetic over every line, because the
// refunded points re-enter the pool as fresh gain lines (shared/aa.ts).

import { useCallback, useMemo } from 'react'
import type { CharacterSnap, LevelingSnap, ProgressionSnap } from '@shared/types'
import type { AaCatalogData, AaCatalogEntry } from '@shared/aaCatalog'
import type { ClassAbbr } from '@shared/classCombo'
import { useModule } from '../../lib/useModule'
import { EMPTY_LEVELING } from '../leveling/levelingModule'
import { EMPTY_PROGRESSION } from '../leveling/progressionDelta'
import { useStatedLevel } from '../leveling/useStatedLevel'
import { useReincarnationRecord } from '../leveling/useReincarnation'
import { useComboSnap } from '../profiles/ClassComboData'
import { computeAAAccounting } from '../../../../shared/aa'
import { aaLedger } from '../../../../shared/aaLedger'
import { aaPace } from '../../../../shared/aaPace'
import { rangeStats } from '../../../../shared/progressionStats'
import { resolvedClasses } from '../../../../shared/classCombo'
import { catalogIndex, heldRanks, type AaHeld } from '../../../../shared/aaPlanner'
import { aaPlanStorageKey, parseStoredPlan, serializePlan, type AaPlan } from '../../../../shared/aaPlanStore'
import {
  aaRaceStorageKey,
  aaRespecStorageKey,
  detectedRace,
  lastRespec,
  parseStoredRace,
  parseStoredRespecs,
  recordRespec,
  respecRefusal,
  serializeRace,
  serializeRespecs,
  spendsSinceRespec,
  undoRespec,
  type AaRespec,
  type AaRespecHistory
} from '../../../../shared/aaCharacter'
import catalogJson from '../../data/eqlegends/aaCatalog.json'
import { useStoredValue, type StoredCodec } from './useStoredValue'

export const AA_CATALOG = catalogJson as unknown as AaCatalogData
const INDEX = catalogIndex(AA_CATALOG.entries)
const PACE_WINDOW_MS = 24 * 3_600_000

const PLAN_CODEC: StoredCodec<AaPlan> = { parse: (raw) => parseStoredPlan(raw, INDEX), serialize: serializePlan }
const RACE_CODEC: StoredCodec<string | null> = { parse: parseStoredRace, serialize: serializeRace }
const RESPEC_CODEC: StoredCodec<AaRespecHistory> = { parse: parseStoredRespecs, serialize: serializeRespecs }

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
  /** the race in force: the user's pick, else the detected one, else null */
  race: string | null
  /** the race the user picked (null = follow the detected one) */
  pickedRace: string | null
  /** the race the latest `Race Reincarnation` grant states, or null */
  detected: string | null
  setRace: (race: string | null) => void
  /** the respec in force, or null */
  respec: AaRespec | null
  onRespec: (at: number) => void
  onUndoRespec: () => void
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

/** Race and respec: the two character facts beside the plan. */
type CharacterFacts = Pick<AaPlannerInputs, 'race' | 'pickedRace' | 'detected' | 'setRace' | 'respec' | 'onRespec' | 'onUndoRespec'>

function useCharacterFacts(
  who: CharacterSnap | null | undefined,
  leveling: LevelingSnap,
  plan: AaPlan,
  updatePlan: (fn: (p: AaPlan) => AaPlan) => void
): CharacterFacts {
  const record = useReincarnationRecord()
  const [pickedRace, updateRace] = useStoredValue(aaRaceStorageKey(who?.character), RACE_CODEC)
  const [respecs, updateRespecs] = useStoredValue(aaRespecStorageKey(who?.character), RESPEC_CODEC)
  const detected = useMemo(() => detectedRace(leveling.aaSpends, record?.lives ?? [])?.race ?? null, [leveling.aaSpends, record])
  const setRace = useCallback((race: string | null) => updateRace(() => race), [updateRace])
  const onRespec = useCallback(
    (at: number) => {
      if (respecRefusal(respecs, at, Date.now()) !== null) return
      const next = recordRespec(respecs, at, plan.stated, INDEX)
      updateRespecs(() => next.history)
      updatePlan((p) => ({ ...p, stated: next.stated }))
    },
    [respecs, plan.stated, updateRespecs, updatePlan]
  )
  const onUndoRespec = useCallback(() => {
    const next = undoRespec(respecs, plan.stated)
    updateRespecs(() => next.history)
    updatePlan((p) => ({ ...p, stated: next.stated }))
  }, [respecs, plan.stated, updateRespecs, updatePlan])
  return { pickedRace, detected, race: pickedRace ?? detected, setRace, respec: lastRespec(respecs), onRespec, onUndoRespec }
}

export function useAaPlanner(): AaPlannerInputs {
  const leveling = useModule<LevelingSnap>('leveling') ?? EMPTY_LEVELING
  const prog = useModule<ProgressionSnap>('progression') ?? EMPTY_PROGRESSION
  const who = useModule<CharacterSnap>('character')
  const combo = useComboSnap()
  const stated = useStatedLevel(prog)
  const [plan, updatePlan] = useStoredValue(aaPlanStorageKey(who?.character), PLAN_CODEC)
  const facts = useCharacterFacts(who, leveling, plan, updatePlan)
  const { respec } = facts
  const spends = useMemo(() => spendsSinceRespec(leveling.aaSpends, respec), [leveling.aaSpends, respec])
  const ledger = useMemo(() => aaLedger(spends), [spends])
  const banked = useMemo(() => computeAAAccounting(leveling.aaGains, leveling.aaSpends).unspent, [leveling.aaGains, leveling.aaSpends])
  const allocated = useMemo(() => computeAAAccounting(leveling.aaGains, spends).allocated, [leveling.aaGains, spends])
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
    banked,
    allocated,
    pointsPerHour,
    seenSince: firstAaTs(leveling),
    plan,
    updatePlan,
    ...facts
  }
}
