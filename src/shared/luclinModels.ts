// ============================================================================
// luclinModels - the shapes and the race table behind "Luclin character models".
// ============================================================================
//
// EverQuest Legends ships the Luclin-era player models but does not load them. A community guide
// switches them on by hand: add `global<CODE>_chr2` / `global<CODE>_chr` lines (and the four
// `LGEquip*` armour archives) to `<EQ root>\Resources\GlobalLoad.txt`, directly after the
// `it101084` furniture line, then start `eqgame.exe patchme` so LaunchPad does not put the file
// back. This feature does the same edit, per race, and nothing else: one text file, no memory, no
// network.
//
// PURE and IMPORT-FREE, so the renderer card and the Node tests read the same table main writes
// with. The text surgery itself lives in src/main/luclin/globalLoad.ts.

/** One playable race: a male and a female model code, in the order the guide lists them. */
export interface LuclinRace {
  /** Stable id, stored in the preference. Never shown. */
  id: string
  /** What the checkbox says, and what the `Loading <label>` line says. */
  label: string
  /** Male code first, then female - the order the lines are written in. */
  codes: readonly [string, string]
}

/** The guide's thirteen races, in the guide's order. The order is the order lines are written. */
export const LUCLIN_RACES: readonly LuclinRace[] = [
  { id: 'human', label: 'Human', codes: ['HUM', 'HUF'] },
  { id: 'barbarian', label: 'Barbarian', codes: ['BAM', 'BAF'] },
  { id: 'erudite', label: 'Erudite', codes: ['ERM', 'ERF'] },
  { id: 'woodelf', label: 'Wood Elf', codes: ['ELM', 'ELF'] },
  { id: 'highelf', label: 'High Elf', codes: ['HIM', 'HIF'] },
  { id: 'darkelf', label: 'Dark Elf', codes: ['DAM', 'DAF'] },
  { id: 'halfelf', label: 'Half Elf', codes: ['HAM', 'HAF'] },
  { id: 'dwarf', label: 'Dwarf', codes: ['DWM', 'DWF'] },
  { id: 'troll', label: 'Troll', codes: ['TRM', 'TRF'] },
  { id: 'ogre', label: 'Ogre', codes: ['OGM', 'OGF'] },
  { id: 'halfling', label: 'Halfling', codes: ['HOM', 'HOF'] },
  { id: 'gnome', label: 'Gnome', codes: ['GNM', 'GNF'] },
  { id: 'iksar', label: 'Iksar', codes: ['IKM', 'IKF'] }
]

export const LUCLIN_RACE_IDS: readonly string[] = LUCLIN_RACES.map((r) => r.id)

/** The stored preference. */
export interface LuclinPrefs {
  /** The card's master switch. OFF by default: nothing about the game changes until asked. */
  enabled: boolean
  /** Races whose Luclin models are wanted. All of them by default (the guide's default). */
  races: string[]
  /** Re-apply by itself when LaunchPad has put the file back. OFF by default. */
  keepApplied: boolean
  /**
   * Did the user leave it APPLIED? Not a setting: it is the memory that lets the app tell "never
   * applied" from "applied, and LaunchPad reverted it".
   */
  applied: boolean
  /** Has the user accepted GAME_FILE_DISCLAIMER (shared/gameModsDisclaimer.ts)? Asked once, before the first apply or Luclin launch. */
  riskAccepted: boolean
}

export const DEFAULT_LUCLIN_PREFS: LuclinPrefs = {
  enabled: false,
  races: [...LUCLIN_RACE_IDS],
  keepApplied: false,
  applied: false,
  riskAccepted: false
}

/** Known race ids only, deduped, in table order. Anything that is not an array keeps `fallback`. */
function racesOf(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const wanted = new Set(value.filter((v): v is string => typeof v === 'string'))
  return LUCLIN_RACE_IDS.filter((id) => wanted.has(id))
}

/**
 * The prefs, defaulted field by field. `fallback` is the default when reading the store and the
 * current value when applying a patch, so a patch that names no field keeps every field.
 */
export function mergeLuclinPrefs(
  value: unknown,
  fallback: LuclinPrefs = DEFAULT_LUCLIN_PREFS
): LuclinPrefs {
  const v =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const bool = (key: keyof LuclinPrefs, fb: boolean): boolean => {
    const x = v[key]
    return typeof x === 'boolean' ? x : fb
  }
  return {
    enabled: bool('enabled', fallback.enabled),
    races: racesOf(v.races, fallback.races),
    keepApplied: bool('keepApplied', fallback.keepApplied),
    applied: bool('applied', fallback.applied),
    riskAccepted: bool('riskAccepted', fallback.riskAccepted)
  }
}

/** What the file says right now. */
export type GlobalLoadState =
  /** Exactly the lines for the chosen races are in place. */
  | 'applied'
  /** Some Luclin lines are in place, but not the set the chosen races want. */
  | 'partial'
  /** No Luclin lines at all. */
  | 'not-applied'
  /** There is no `Resources\GlobalLoad.txt` under the EverQuest folder. */
  | 'file-missing'
  /** The file is there, but the line the edit goes after is not. Nothing is written. */
  | 'anchor-missing'

/** Everything the card, the Overview button and the tray need to say where things stand. */
export interface LuclinStatus {
  state: GlobalLoadState
  /** The EverQuest folder this was read from. */
  root: string
  /** Race ids that currently have at least one Luclin line in the file. */
  appliedRaces: string[]
  /** Race ids with at least one Luclin archive present in this install. */
  availableRaces: string[]
  /** The user left it applied and the file no longer is: LaunchPad put it back. */
  reverted: boolean
  /** Is an EverQuest client running right now? The file is only read when the game starts. */
  eqRunning: boolean
  /** Is `eqgame.exe` in the EverQuest folder? */
  gamePresent: boolean
  /** Is `LaunchPad.exe` in the EverQuest folder? */
  launcherPresent: boolean
}

/** Why an action did not happen. */
export type LuclinRefusal =
  | 'running'
  | 'file-missing'
  | 'anchor-missing'
  | 'no-races'
  | 'game-missing'
  | 'launcher-missing'
  | 'write-failed'
  | 'launch-failed'
  | 'unsupported'
  /** The first apply or Luclin launch needs the disclaimer accepted first. */
  | 'not-accepted'

export type LuclinResult =
  | { ok: true; status: LuclinStatus; message: string }
  | { ok: false; reason: LuclinRefusal; message: string; status: LuclinStatus | null }

/** What the Play button actually did. */
export type PlayKind = 'luclin' | 'launcher'

export type PlayResult = LuclinResult & { kind: PlayKind }
