// useRaceUnlocks — the Races tab's inputs, joined: the stored race-unlock projection of the
// achievements dump (re-read on every `onProgress` push, which is what main sends after it reads a
// new dump), the log's `faction` fold, and the committed faction-source dataset. The join itself
// is `shared/raceUnlockPlan.ts`, pure and node-tested; this file only wires the three in.

import { useEffect, useMemo, useState } from 'react'
import type { FactionSnap, ProgressState } from '@shared/types'
import { useModule } from '../../lib/useModule'
import { sanitizeRaceUnlocks, type RaceUnlockState } from '../../../../shared/outputs/raceUnlocks'
import { raceUnlockPlans, type RacePlan } from '../../../../shared/raceUnlockPlan'
import type { FactionSourcesData } from '../../../../shared/factionSources'
import factionSourcesJson from '../../data/eqlegends/factionSources.json'

const SOURCES = factionSourcesJson as FactionSourcesData

export interface RaceUnlocks {
  /** false until the stored progress has been read once */
  ready: boolean
  plans: RacePlan[]
  /** when this app last read the achievements dump, or null when it never has */
  readAt: number | null
}

interface Stored {
  races: RaceUnlockState[]
  readAt: number | null
}

function storedOf(p: ProgressState | null): Stored {
  return { races: sanitizeRaceUnlocks(p?.raceUnlocks), readAt: p?.achievementsSource?.readAt ?? null }
}

export function useRaceUnlocks(): RaceUnlocks {
  const [stored, setStored] = useState<Stored | null>(null)
  const snap = useModule<FactionSnap>('faction')

  useEffect(() => {
    let alive = true
    const take = (p: ProgressState | null): void => {
      if (alive) setStored(storedOf(p))
    }
    void window.eq.getProgress().then(take)
    const offProgress = window.eq.onProgress(take)
    const offChar = window.eq.onCharacter(() => void window.eq.getProgress().then(take))
    return () => {
      alive = false
      offProgress()
      offChar()
    }
  }, [])

  const plans = useMemo(() => (stored ? raceUnlockPlans(stored.races, snap, SOURCES) : []), [stored, snap])
  return { ready: stored !== null, plans, readAt: stored?.readAt ?? null }
}
