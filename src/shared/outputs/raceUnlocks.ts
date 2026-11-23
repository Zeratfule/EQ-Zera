// ============================================================================
// shared/outputs/raceUnlocks.ts — the `/outputfile achievements` dump's RACE-UNLOCK projection.
// ============================================================================
//
// The sibling of `classUnlockClaims` (achievements.ts): the same file, a different category, and a
// different question. The class projection answers "which Sky quests did the server credit"; this
// one answers "how far is each race unlock", so unlike the class half it keeps the `I` rows too —
// an objective's status IS the progress, and the Races tab draws it as a bar.
//
// THE CATEGORY, MEASURED — the owner's dump (tests/fixtures/Primitive_freeport-Achievements.txt),
// `Untapped Potential: Races`, sixteen `Race Unlock - <Race>` achievements:
//
//   Get maximum faction with <Faction>.                      the usual objective, 1 to 3 per race
//   Complete the '<Task>' Task.                              Kerran's one objective
//   This achievement will autocomplete when you unlock       Half Elf's one objective
//     Human or Wood Elf as a race.
//   This achievement will autocomplete if your character     every race: `C` on the race you MADE
//     was created as a <Race>.
//   This achievement can be bypassed using a Race Unlock     every race: the token row (Human's
//     Token.                                                   two variants spell it "can by")
//
// A GRANTED UNLOCK CASCADES `C` INTO THE OBJECTIVES, exactly as the class half's header measured
// for classes: the owner's Froglok (created-as `C`) and Ogre (token `C`) carry every faction row
// `C`. So a race whose created-as or token row is `C` is reported as granted that way, and its
// objective rows are not read as factions the player maxed by playing.
//
// Two pseudo-rows are recognised by their STEM, never by an exact sentence: the created-as row
// names the race in the game's own grammar ("a Erudite"), and the token row has a typo in two of
// sixteen achievements. Anything else under the category is kept verbatim as an `other` objective
// rather than dropped, so a new objective shape shows up on screen as text instead of vanishing.

import type { AchievementsDump } from './achievements'

/** The category holding the race-unlock achievements. */
export const RACE_UNLOCK_CATEGORY = 'Untapped Potential: Races'

/** What every race-unlock achievement's name starts with; the rest is the race. */
export const RACE_UNLOCK_PREFIX = 'Race Unlock - '

/** The faction objective, up to the faction name. A trailing period ends the row. */
const FACTION_PREFIX = 'Get maximum faction with '

/** Kerran's task objective: `Complete the '<Task>' Task.` */
const TASK_RE = /^Complete the '(.+)' Task\.?$/

/** Half Elf's objective: completes when another race unlocks. */
const VIA_RE = /^This achievement will autocomplete when you unlock (.+?) as a race\.?$/

/** The created-as pseudo-row, up to the race name. */
const CREATED_AS_PREFIX = 'This achievement will autocomplete if your character was created as '

/** The token pseudo-row's stem — `be` or `by`, both are real rows. */
const TOKEN_RE = /^This achievement can b[ey] bypassed using a Race Unlock Token\.?$/

/** What one objective row asks for. */
export type RaceObjectiveKind = 'faction' | 'task' | 'via' | 'other'

/** One requirement of a race unlock, as the dump states it. */
export interface RaceUnlockObjective {
  kind: RaceObjectiveKind
  /** the row, verbatim */
  text: string
  /** `C` on the row */
  complete: boolean
  /** the faction to max, game spelling; only on `faction` rows */
  faction?: string
  /** the task to complete; only on `task` rows */
  task?: string
  /** the races whose unlock completes this one, game spelling; only on `via` rows */
  via?: string[]
}

/** How a COMPLETE race unlock was granted, read off the two pseudo-rows. */
export type RaceUnlockGrant = 'objectives' | 'created' | 'token'

/** One race's unlock, as the dump states it. The flat artifact main persists. */
export interface RaceUnlockState {
  /** the achievement's race, verbatim: `Human (Freeport)`, `Half Elf` */
  race: string
  /** `C` on the achievement row itself */
  complete: boolean
  /** the created-as row is `C`: this character was made as this race */
  createdAs: boolean
  /** the token row is `C` */
  token: boolean
  /** a token can bypass this unlock (the token row is present) */
  tokenBypass: boolean
  objectives: RaceUnlockObjective[]
}

/** `Get maximum faction with Storm Guard.` → `Storm Guard` — or null for any other row. */
export function objectiveFaction(text: string): string | null {
  if (!text.startsWith(FACTION_PREFIX)) return null
  const name = text.slice(FACTION_PREFIX.length).trim().replace(/\.$/, '').trim()
  return name === '' ? null : name
}

/** `Human or Wood Elf` → `['Human', 'Wood Elf']`. */
function splitVia(list: string): string[] {
  const out: string[] = []
  for (const part of list.split(/\s*(?:,|\bor\b|\band\b)\s*/)) {
    const name = part.trim()
    if (name !== '') out.push(name)
  }
  return out
}

/** One objective row, classified. The two pseudo-rows never reach here. */
function objectiveOf(text: string, complete: boolean): RaceUnlockObjective {
  const faction = objectiveFaction(text)
  if (faction !== null) return { kind: 'faction', text, complete, faction }
  const task = TASK_RE.exec(text)
  if (task) return { kind: 'task', text, complete, task: task[1] }
  const via = VIA_RE.exec(text)
  if (via) return { kind: 'via', text, complete, via: splitVia(via[1]) }
  return { kind: 'other', text, complete }
}

/** The race an achievement row names, or null when it is not a race unlock. */
function raceOf(category: string, achievement: string): string | null {
  if (category !== RACE_UNLOCK_CATEGORY) return null
  if (!achievement.startsWith(RACE_UNLOCK_PREFIX)) return null
  const race = achievement.slice(RACE_UNLOCK_PREFIX.length).trim()
  return race === '' ? null : race
}

/**
 * Every race unlock the dump carries, in the file's order. A dump with no race category yields an
 * empty list. The two pseudo-rows are folded into `createdAs` / `token` / `tokenBypass`; every
 * other component row becomes an objective.
 */
export function raceUnlockStates(dump: AchievementsDump): RaceUnlockState[] {
  const byRace = new Map<string, RaceUnlockState>()
  for (const row of dump.rows) {
    const race = raceOf(row.category, row.achievement)
    if (race === null) continue
    let state = byRace.get(race)
    if (!state) {
      state = { race, complete: false, createdAs: false, token: false, tokenBypass: false, objectives: [] }
      byRace.set(race, state)
    }
    const done = row.status === 'complete'
    if (row.component === undefined) state.complete = done
    else if (row.component.startsWith(CREATED_AS_PREFIX)) state.createdAs = done
    else if (TOKEN_RE.test(row.component)) {
      state.tokenBypass = true
      state.token = done
    } else state.objectives.push(objectiveOf(row.component, done))
  }
  return [...byRace.values()]
}

/** How a complete unlock was granted; null while it is not complete. `created` wins a tie. */
export function raceUnlockGrant(state: RaceUnlockState): RaceUnlockGrant | null {
  if (!state.complete) return null
  if (state.createdAs) return 'created'
  if (state.token) return 'token'
  return 'objectives'
}

/**
 * A race-unlock list read back from the store, validated. The store file is hand-editable, so a
 * malformed entry is dropped rather than trusted.
 */
export function sanitizeRaceUnlocks(raw: unknown): RaceUnlockState[] {
  if (!Array.isArray(raw)) return []
  const out: RaceUnlockState[] = []
  for (const r of raw as unknown[]) {
    if (typeof r !== 'object' || r === null) continue
    const s = r as Partial<RaceUnlockState>
    if (typeof s.race !== 'string' || !Array.isArray(s.objectives)) continue
    const objectives: RaceUnlockObjective[] = []
    for (const o of s.objectives as unknown[]) {
      if (typeof o !== 'object' || o === null) continue
      const ob = o as Partial<RaceUnlockObjective>
      if (typeof ob.text !== 'string') continue
      objectives.push(objectiveOf(ob.text, ob.complete === true))
    }
    out.push({
      race: s.race,
      complete: s.complete === true,
      createdAs: s.createdAs === true,
      token: s.token === true,
      tokenBypass: s.tokenBypass === true,
      objectives
    })
  }
  return out
}
