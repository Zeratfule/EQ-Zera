// WHO THE FIGURE IS — the vocabulary half (EQ Zera, 2026-09-08).
//
// "Having the ability to change the character model faces for both sexes and all races should be
// an option too. We want to represent everyone's characters." (owner). Race, sex and face are the
// three things the app cannot read from anywhere: the log states a race only in the player's own
// `/who` row, illusion-polluted and unkept, and it never states a sex or a face at all. So they
// are three picks, remembered per reader.
//
// DOM-FREE, MUI-FREE, REACT-FREE, and its imports are RELATIVE — the combatPrefs.ts idiom, for
// the same reason: every rule that can silently go wrong (a default, a guard, a migration, a
// degrade) is here and runs under plain node in tests/characterPrefs.test.mts. The storage half
// (localStorage, and the try/catch around it) is ModelPickers.tsx's.
//
// THE MIGRATION. Until now one key held a THREE-letter actor code (`eq.character.race` = `HUF`),
// which is race and sex fused; splitting the picker splits the value, and an existing reader must
// not be silently turned back into a human male. So a stored three-letter value still reads, as
// the race AND the sex it always meant, and the new sex key wins when there is one.

/** The race, two letters (`HU`). Historically the whole actor code, which `readRace` still accepts. */
export const RACE_KEY = 'eq.character.race'
/** The sex, `M` or `F`. */
export const SEX_KEY = 'eq.character.sex'
/**
 * The face, PER ACTOR CODE. A face digit means a different face on every race, and often does not
 * exist at all on the next one (HUF has no face 0), so a human's pick must never dress a dwarf.
 */
export function faceKey(actor: string): string {
  return `eq.character.face.${actor}`
}

export type Sex = 'M' | 'F'

export const DEFAULT_RACE = 'HU'
export const DEFAULT_SEX: Sex = 'M'

/** One row of the race picker: the two-letter code, its name, and whether this app has a model. */
export interface RaceOption {
  code: string
  label: string
  /** false = named honestly and unpickable: the archives exist, this reader does not read them */
  modelled: boolean
}

/**
 * EVERY PLAYABLE RACE IS NAMED, and the three this app cannot draw say so instead of being absent.
 * The twelve classic races and the Iksar come out of the archives (main's `raceArchive`); Vah Shir,
 * Froglok and Drakkin are listed disabled - see ipc/eqModel.ts for what each of them would need.
 */
export const RACE_OPTIONS: readonly RaceOption[] = [
  { code: 'HU', label: 'Human', modelled: true },
  { code: 'BA', label: 'Barbarian', modelled: true },
  { code: 'ER', label: 'Erudite', modelled: true },
  { code: 'EL', label: 'Wood Elf', modelled: true },
  { code: 'HI', label: 'High Elf', modelled: true },
  { code: 'DA', label: 'Dark Elf', modelled: true },
  { code: 'HA', label: 'Half Elf', modelled: true },
  { code: 'DW', label: 'Dwarf', modelled: true },
  { code: 'TR', label: 'Troll', modelled: true },
  { code: 'OG', label: 'Ogre', modelled: true },
  { code: 'HO', label: 'Halfling', modelled: true },
  { code: 'GN', label: 'Gnome', modelled: true },
  { code: 'IK', label: 'Iksar', modelled: true },
  { code: 'VS', label: 'Vah Shir', modelled: false },
  { code: 'FR', label: 'Froglok', modelled: false },
  { code: 'DR', label: 'Drakkin', modelled: false }
]

const DRAWABLE = new Set(RACE_OPTIONS.filter((r) => r.modelled).map((r) => r.code))

/** Which figure the card draws: a race the app has a model for, and a sex. */
export interface ModelPick {
  race: string
  sex: Sex
}

/**
 * The stored race, and the sex it CARRIES when the value is the old three-letter actor code.
 * A race this app cannot draw - misspelled, hand-edited, or written by a build that could draw
 * more than this one - degrades to the default rather than asking main for a model that is not
 * there (JOS-105).
 */
export function readRace(raw: string | null): { race: string; sex: Sex | null } {
  if (raw !== null && DRAWABLE.has(raw)) return { race: raw, sex: null }
  const old = raw !== null && /^[A-Z]{2}[MF]$/.test(raw) ? raw : null
  const race = old ? old.slice(0, 2) : ''
  if (old && DRAWABLE.has(race)) return { race, sex: old.slice(2) as Sex }
  return { race: DEFAULT_RACE, sex: null }
}

/** The stored sex, or none - which is what lets the migrated value speak. */
export function readSex(raw: string | null): Sex | null {
  return raw === 'M' || raw === 'F' ? raw : null
}

/** The figure the two stored values name, the old fused code included. */
export function readPick(raceRaw: string | null, sexRaw: string | null): ModelPick {
  const { race, sex } = readRace(raceRaw)
  return { race, sex: readSex(sexRaw) ?? sex ?? DEFAULT_SEX }
}

/** The actor code the archives use: race then sex (`DW` + `F` = `DWF`). */
export function actorCode(race: string, sex: Sex): string {
  return `${race}${sex}`
}

/**
 * Which face the picker shows as chosen: the reader's own pick when this actor still has that
 * face, otherwise the face the archive's own head binds, otherwise the first face there is.
 * Undefined only when the payload named no faces at all - and then the control does not draw.
 */
export function readFace(stored: number | undefined, faces: readonly number[] | undefined, bound: number | undefined): number | undefined {
  if (stored !== undefined && faces?.includes(stored)) return stored
  if (bound !== undefined && faces?.includes(bound)) return bound
  return faces?.[0]
}

/**
 * The face to ASK MAIN FOR, before any payload has said which faces exist: the raw stored digit
 * and nothing more. Main guards every substitution against the archive's own file list, so a
 * stale pick draws the head the archive bound and never a hole.
 */
export function storedFace(raw: string | null): number | undefined {
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : undefined
}
