// raceUnlockPlan.ts — the Races tab's whole model, pure and node-tested
// (tests/raceUnlockPlan.test.mts).
//
// THREE INPUTS, EACH SAYING ONE KIND OF THING:
//   * the achievements dump's race projection (`RaceUnlockState`) — what the SERVER says each
//     objective's status is. The only source of "unlocked".
//   * the log's `faction` fold (`FactionSnap`) — what THIS LOG watched: a sum of stated moves and a
//     count of "could not possibly get any better" lines. A `maxed` line is the one log fact that
//     completes an objective (the standing is at the rail); the sum is never a standing.
//   * the generated wiki dataset (`FactionSourcesData`) — which kills and turn-ins raise a faction
//     and by how much, as the wiki states it.
//
// A FACTION COUNTS AS MAXED when its objective row is `C` or the fold saw it maxed, and the row
// says which (`maxedBy`), because the two are different evidence.
//
// THE ORDER IS "FASTEST TO UNLOCK": not yet unlocked first, fewest remaining objectives first, then
// the best raise rate — the SLOWEST remaining faction's best stated gain, since that faction is the
// one that decides when the race is done; a race with a faction nobody states a gain for ranks after
// every race whose rate is known. Unlocked races go last.

import { factionKey, type FactionLoss, type FactionSourcesData } from './factionSources'
import type { FactionSnap } from './factionTypes'
import { raceUnlockGrant, type RaceUnlockGrant, type RaceUnlockState } from './outputs/raceUnlocks'

/** How many raising mobs and quests a faction row offers. */
export const RAISE_ROWS = 5

export type RaceUnlockStatus = 'unlocked' | 'in-progress' | 'not-started'

/** What this log watched about one faction. Never a standing. */
export interface FactionSeen {
  delta: number
  hits: number
  maxed: number
}

/** One way to raise a faction, ranked. */
export interface RaiseWay {
  kind: 'mob' | 'quest'
  /** wiki page title */
  page: string
  /** the mob's in-game name, or the quest's title */
  name: string
  /** stated gain, null when the wiki names no amount */
  gain: number | null
  /** level text (mob) or minimum level (quest) */
  level?: string
  /** zones (mob) or the start zone (quest) */
  zones: string[]
  giver?: string
  /** OTHER factions this race needs that the same kill or turn-in lowers */
  hurts: FactionLoss[]
}

export interface RaceFactionPlan {
  faction: string
  maxed: boolean
  /** which evidence said maxed: the dump's `C`, or a "could not get any better" line in the log */
  maxedBy: 'achievement' | 'log' | null
  /** what this log watched, or null when it never named the faction */
  seen: FactionSeen | null
  mobs: RaiseWay[]
  quests: RaiseWay[]
  /** the best stated gain among the offered ways; null when none states one */
  bestGain: number | null
}

/** Half Elf's route: the other unlocks that complete it, and the closest of them. */
export interface RaceVia {
  races: string[]
  /** the matching race closest to done, or null when the dump names none of them */
  closest: string | null
}

export interface RacePlan {
  race: string
  status: RaceUnlockStatus
  grant: RaceUnlockGrant | null
  done: number
  total: number
  remaining: number
  createdAs: boolean
  tokenBypass: boolean
  factions: RaceFactionPlan[]
  /** Kerran's task, by name, and whether it is done */
  task?: { name: string; complete: boolean }
  via?: RaceVia
  /** objective rows of a shape this app does not know, verbatim, with their status */
  other: { text: string; complete: boolean }[]
  /** the slowest remaining faction's best stated gain; null when unknown or nothing to raise */
  rate: number | null
}

/** The fold's factions, re-keyed by `factionKey` (aliases folded together). */
export function seenByKey(snap: FactionSnap | null): Map<string, FactionSeen> {
  const out = new Map<string, FactionSeen>()
  if (!snap) return out
  for (const totals of Object.values(snap.factions)) {
    const key = factionKey(totals.display)
    const prev = out.get(key) ?? { delta: 0, hits: 0, maxed: 0 }
    out.set(key, { delta: prev.delta + totals.delta, hits: prev.hits + totals.hits, maxed: prev.maxed + totals.maxed })
  }
  return out
}

/** Known gains first, then clean ways (lowering nothing this race needs), then larger, then lower level. */
function compareWays(a: RaiseWay, b: RaiseWay): number {
  const known = Number(b.gain !== null) - Number(a.gain !== null)
  if (known !== 0) return known
  const clean = Number(b.hurts.length === 0) - Number(a.hurts.length === 0)
  if (clean !== 0) return clean
  return (b.gain ?? 0) - (a.gain ?? 0) || levelOf(a) - levelOf(b) || a.name.localeCompare(b.name)
}

function levelOf(w: RaiseWay): number {
  const m = w.level === undefined ? null : /\d+/.exec(w.level)
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY
}

/** The OTHER required factions in `lowers`. */
function hurtsOf(lowers: FactionLoss[], required: Set<string>, self: string): FactionLoss[] {
  const out: FactionLoss[] = []
  for (const l of lowers) {
    const k = factionKey(l.faction)
    if (k !== self && required.has(k)) out.push(l)
  }
  return out
}

function raiseWays(sources: FactionSourcesData, key: string, required: Set<string>): { mobs: RaiseWay[]; quests: RaiseWay[] } {
  const entry = sources.factions[key] as FactionSourcesData['factions'][string] | undefined
  if (!entry) return { mobs: [], quests: [] }
  const mobs: RaiseWay[] = entry.mobs.map((m) => ({
    kind: 'mob',
    page: m.page,
    name: m.name,
    gain: m.gain,
    ...(m.level === undefined ? {} : { level: m.level }),
    zones: m.zones ?? [],
    hurts: hurtsOf(m.lowers, required, key)
  }))
  const quests: RaiseWay[] = entry.quests.map((q) => ({
    kind: 'quest',
    page: q.page,
    name: q.page,
    gain: q.gain,
    ...(q.level === undefined ? {} : { level: String(q.level) }),
    zones: q.zone === undefined ? [] : [q.zone],
    ...(q.giver === undefined ? {} : { giver: q.giver }),
    hurts: hurtsOf(q.lowers, required, key)
  }))
  return { mobs: mobs.sort(compareWays).slice(0, RAISE_ROWS), quests: quests.sort(compareWays).slice(0, RAISE_ROWS) }
}

function bestGainOf(ways: RaiseWay[]): number | null {
  let best: number | null = null
  for (const w of ways) if (w.gain !== null && (best === null || w.gain > best)) best = w.gain
  return best
}

interface PlanInputs {
  seen: Map<string, FactionSeen>
  sources: FactionSourcesData
}

function factionPlans(state: RaceUnlockState, inputs: PlanInputs): RaceFactionPlan[] {
  const required = new Set<string>()
  for (const o of state.objectives) if (o.faction !== undefined) required.add(factionKey(o.faction))
  const out: RaceFactionPlan[] = []
  for (const o of state.objectives) {
    if (o.faction === undefined) continue
    const key = factionKey(o.faction)
    const seen = inputs.seen.get(key) ?? null
    const maxedBy = o.complete ? 'achievement' : seen !== null && seen.maxed > 0 ? 'log' : null
    const ways = raiseWays(inputs.sources, key, required)
    out.push({
      faction: o.faction,
      maxed: maxedBy !== null,
      maxedBy,
      seen,
      ...ways,
      bestGain: bestGainOf([...ways.mobs, ...ways.quests])
    })
  }
  return out
}

/** The slowest remaining faction's best gain; null when any remaining one has none stated. */
function rateOf(factions: RaceFactionPlan[]): number | null {
  let rate: number | null = null
  for (const f of factions) {
    if (f.maxed) continue
    if (f.bestGain === null) return null
    rate = rate === null ? f.bestGain : Math.min(rate, f.bestGain)
  }
  return rate
}

function statusOf(complete: boolean, done: number): RaceUnlockStatus {
  if (complete) return 'unlocked'
  return done > 0 ? 'in-progress' : 'not-started'
}

/**
 * The countable objectives: each faction (maxed by either evidence), the task, and any row of an
 * unknown shape. A complete achievement counts every one done, because a granted unlock cascades
 * `C` into its rows anyway (shared/outputs/raceUnlocks.ts).
 */
function countDone(state: RaceUnlockState, factions: RaceFactionPlan[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const f of factions) {
    total++
    if (state.complete || f.maxed) done++
  }
  for (const o of state.objectives) {
    if (o.kind !== 'task' && o.kind !== 'other') continue
    total++
    if (state.complete || o.complete) done++
  }
  return { done, total }
}

/** Kerran's task and Half Elf's route, when the race has them. */
function extrasOf(state: RaceUnlockState): Pick<RacePlan, 'task' | 'via'> {
  const out: Pick<RacePlan, 'task' | 'via'> = {}
  for (const o of state.objectives) {
    if (o.task !== undefined) out.task = { name: o.task, complete: state.complete || o.complete }
    if (o.via !== undefined) out.via = { races: o.via, closest: null }
  }
  return out
}

function basePlan(state: RaceUnlockState, inputs: PlanInputs): RacePlan {
  const factions = factionPlans(state, inputs)
  const other: RacePlan['other'] = []
  for (const o of state.objectives) if (o.kind === 'other') other.push({ text: o.text, complete: o.complete })
  const { done, total } = countDone(state, factions)
  return {
    race: state.race,
    status: statusOf(state.complete, done),
    grant: raceUnlockGrant(state),
    done,
    total,
    remaining: total - done,
    createdAs: state.createdAs,
    tokenBypass: state.tokenBypass,
    factions,
    ...extrasOf(state),
    other,
    rate: rateOf(factions)
  }
}

/** Does a dump race (`Human (Freeport)`) answer to a name the via row uses (`Human`)? */
function answersTo(race: string, name: string): boolean {
  const r = race.toLowerCase()
  const n = name.toLowerCase()
  return r === n || r.startsWith(`${n} (`)
}

/** Fewest remaining first, then the better known rate, then the name. */
function closer(a: RacePlan, b: RacePlan): number {
  return a.remaining - b.remaining || (b.rate ?? -1) - (a.rate ?? -1) || a.race.localeCompare(b.race)
}

/**
 * Half Elf: its one objective completes when another race unlocks, so its progress IS the closest
 * of those races' progress, and the plan points at it.
 */
function resolveVia(plan: RacePlan, all: RacePlan[]): RacePlan {
  if (!plan.via || plan.status === 'unlocked') return plan
  const via = plan.via
  const matches = all.filter((p) => p !== plan && via.races.some((n) => answersTo(p.race, n)))
  if (matches.length === 0) return { ...plan, total: 1, remaining: 1 }
  const best = [...matches].sort(closer)[0]
  return {
    ...plan,
    via: { ...via, closest: best.race },
    done: best.done,
    total: best.total,
    remaining: best.remaining,
    status: best.done > 0 ? 'in-progress' : 'not-started',
    rate: best.rate
  }
}

/** Not yet unlocked first, then closest to done, then the best rate. */
function fastestFirst(a: RacePlan, b: RacePlan): number {
  const unlocked = Number(a.status === 'unlocked') - Number(b.status === 'unlocked')
  if (unlocked !== 0) return unlocked
  if (a.status === 'unlocked') return a.race.localeCompare(b.race)
  const rateKnown = Number(b.rate !== null) - Number(a.rate !== null)
  return a.remaining - b.remaining || rateKnown || (b.rate ?? 0) - (a.rate ?? 0) || a.race.localeCompare(b.race)
}

/** How many of the plans are unlocked. */
export function unlockedCount(plans: RacePlan[]): number {
  let n = 0
  for (const p of plans) if (p.status === 'unlocked') n++
  return n
}

/** Every race unlock, planned and ordered fastest-to-unlock first. */
export function raceUnlockPlans(
  races: RaceUnlockState[],
  snap: FactionSnap | null,
  sources: FactionSourcesData
): RacePlan[] {
  const inputs: PlanInputs = { seen: seenByKey(snap), sources }
  const base = races.map((r) => basePlan(r, inputs))
  return base.map((p) => resolveVia(p, base)).sort(fastestFirst)
}
