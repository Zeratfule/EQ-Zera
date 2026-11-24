// reincarnationSummary.ts — everything the Leveling tab's reincarnation panel draws, derived once.
//
// Joins the persisted record (merged with whatever confirmed events the live snapshot holds that the
// recorder has not written yet), the active loadout, and the progression snapshot into: the counts,
// the reincarnation AAs held, the loadout's REPORTED XP requirement, the re-level estimate, and the
// possible (inferred) reincarnations awaiting the player's word. Pure; relative value imports.

import type { ProgressionSnap } from './progressionTypes'
import {
  canonicalName,
  classNameOf,
  mergeLives,
  reincarnationAas,
  reincarnationCounts,
  type ComponentCount,
  type ReincarnationAas,
  type ReincarnationEvent,
  type ReincarnationRecord
} from './reincarnation'
import { xpRequirement, type PenaltyComponent, type XpRequirement } from './reincarnationXp'
import { reLevelForecast, type ReLevelForecast } from './reincarnationForecast'

export interface ReincarnationSummary {
  counts: ComponentCount[]
  aas: ReincarnationAas
  /** The active loadout's classes and race, with their counts. */
  loadout: PenaltyComponent[]
  /** The race could not be named (no reincarnation printed one and none was stated). */
  raceUnknown: boolean
  requirement: XpRequirement
  /** The re-level estimate, or null when the previous life is too thin to stand on. */
  forecast: ReLevelForecast | null
  /** Inferred reincarnations — shown as possible, never counted. */
  possible: ReincarnationEvent[]
  /** True when there is anything at all to say. */
  any: boolean
}

export interface SummaryInput {
  record: ReincarnationRecord
  events: readonly ReincarnationEvent[]
  /** The active loadout's resolved `/who` codes (the combo model's current interval). */
  classCodes: readonly string[]
  prog: ProgressionSnap
  currentLevel: number | null
}

/** The class codes of a combo interval's RESOLVED slots (one candidate); ambiguous slots say nothing. */
export function resolvedCodes(slots: readonly { candidates: readonly string[] }[]): string[] {
  return slots.flatMap((s) => (s.candidates.length === 1 ? [s.candidates[0]] : []))
}

function countFor(counts: readonly ComponentCount[], component: 'class' | 'race', name: string): number {
  const canon = canonicalName(component, name).toLowerCase()
  return counts.find((c) => c.component === component && c.name.toLowerCase() === canon)?.count ?? 0
}

/** The race in force: the latest reincarnation's race grant, else the only race with a count. */
function activeRace(events: readonly ReincarnationEvent[], counts: readonly ComponentCount[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const race = events[i].grants.find((g) => g.component === 'race')
    if (race && !events[i].inferred) return canonicalName('race', race.name)
  }
  const races = counts.filter((c) => c.component === 'race' && c.count > 0)
  return races.length === 1 ? races[0].name : null
}

/** The loadout's class names: the combo model's, else the latest confirmed reincarnation's. */
function activeClasses(codes: readonly string[], events: readonly ReincarnationEvent[]): string[] {
  const named = codes.map(classNameOf).filter((n): n is string => n !== null)
  if (named.length > 0) return named
  const last = [...events].reverse().find((e) => !e.inferred)
  return last ? last.grants.filter((g) => g.component === 'class').map((g) => canonicalName('class', g.name)) : []
}

/** The previous life's multiplier: the same loadout with the latest reincarnation's grants undone. */
function previousRequirement(loadout: readonly PenaltyComponent[], last: ReincarnationEvent | undefined): XpRequirement {
  const reborn = new Set((last?.grants ?? []).map((g) => `${g.component}:${canonicalName(g.component === 'race' ? 'race' : 'class', g.name).toLowerCase()}`))
  return xpRequirement(
    loadout.map((c) => (reborn.has(`${c.component}:${c.name.toLowerCase()}`) ? { ...c, count: Math.max(0, c.count - 1) } : c))
  )
}

export function reincarnationSummary(input: SummaryInput): ReincarnationSummary {
  const confirmed = input.events.filter((e) => !e.inferred)
  const record = { ...input.record, lives: mergeLives(input.record.lives, confirmed) }
  const counts = reincarnationCounts(record)
  const race = activeRace(input.events, counts)
  const loadout: PenaltyComponent[] = activeClasses(input.classCodes, input.events).map((name) => ({
    component: 'class' as const,
    name,
    count: countFor(counts, 'class', name)
  }))
  if (race) loadout.push({ component: 'race', name: race, count: countFor(counts, 'race', race) })
  const requirement = xpRequirement(loadout)
  const prev = previousRequirement(loadout, confirmed.length ? confirmed[confirmed.length - 1] : undefined)
  const forecast =
    input.currentLevel != null && confirmed.length > 0
      ? reLevelForecast(input.prog, input.currentLevel, requirement.multiplier / prev.multiplier)
      : null
  const possible = input.events.filter((e) => e.inferred)
  return {
    counts,
    aas: reincarnationAas(counts),
    loadout,
    raceUnknown: race === null,
    requirement,
    forecast,
    possible,
    any: counts.length > 0 || possible.length > 0
  }
}
