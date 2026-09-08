// ============================================================================
// shared/characterShare.ts — A CHARACTER PROFILE, AS SOMETHING YOU HAND TO SOMEBODY ELSE.
// ============================================================================
//
// The owner's direction: *"add a way to share your character profile to others online to show
// your gear, gear scores for dps/tank/healing, etc."* V1 has no server, so a share is two
// artefacts and this file is the second one: a SHARE STRING carrying the same facts the Character
// tab and the Build tab already draw, in the app's existing `EQC1-` envelope
// (`shared/shareSchema.ts`, `kind:'character'` — designed there since the profiles ticket and
// unclaimed until now).
//
// PURE, and imported by main, the renderer and node:test alike. The compression half of the codec
// lives in `src/main/shareCodec.ts` because it needs `node:zlib` — so the STRING is produced and
// read in main (`src/main/characterShare.ts`), exactly as the settings/alert strings are, and the
// renderer reaches it over IPC. There is one encoder and one decoder in this app; a second
// spelling of deflate in the renderer would be a second format waiting to disagree.
//
// ---------------------------------------------------------------------------
// WHAT TRAVELS, AND WHAT REFUSES TO
// ---------------------------------------------------------------------------
// A character profile is the opposite of a settings bundle: a name on a live server IS an
// identity (shared/profiles.ts states that constraint under PRIVACY). So the body is built by
// PROJECTION, field by field, from things already on screen — never by spreading a sheet:
//
//   * the worn cells, as the dump spelled them (name with its ` +N`, the socketed exaltations,
//     the ornament) plus the icon the committed DB joined in. Empty cells do not travel; the
//     grid that draws this profile knows the twenty-four places and leaves the rest quiet.
//   * what the gear adds up to — the same `GearTotals` the sheet prints, reduced to plain
//     numbers and stated strings (percent-valued stats are STATED, never added: law 6).
//   * the four Build-tab readings, as percents.
//   * the look the reader picked for their figure (race, sex, face) — three picks, not facts
//     read from a log (modelPrefs.ts says why).
//
// NO PATH, NO SERVER, NO PROGRESS, NO INVENTORY BEYOND WHAT IS WORN. Nothing here ever reads one.
//
// ---------------------------------------------------------------------------
// A SCORE THE BUILD TAB COULD NOT COMPUTE IS OMITTED, NOT ZERO (world-model law 1)
// ---------------------------------------------------------------------------
// `meterPercent` answers 0 when there is no best to measure against, and 0 is also what a truly
// terrible set reads. Those are different statements and a share card must not conflate them, so
// `scores` is OPTIONAL: the builder is handed a reading only when the Build tab actually had one
// (a dump present, the gear index loaded, a reachable best above zero), and the card draws
// "not computed yet" rather than four empty bars claiming a number.
//
// ---------------------------------------------------------------------------
// EVERYTHING COMING BACK IS UNTRUSTED
// ---------------------------------------------------------------------------
// `sanitizeCharacterShare` rebuilds the profile field by field from an arbitrary object, the way
// `sanitizeAlertDef` rebuilds an alert: every string is clamped, every list is capped, every
// number must be finite and in range, and an unknown key cannot survive because nothing copies
// one. A decoded profile is drawn on screen and put in an `<img src>`-shaped grid, so "a stranger
// wrote this JSON" is the only assumption it is safe to make.

import type { GearTotals, SheetCellView } from './characterSheet'
import { clampStr, SHARE_LIMITS } from './shareSchema'

/** Body generation. Bump only for a change this file's reader cannot make sense of. */
export const CHARACTER_SHARE_VERSION = 1

/** Which figure the sharer's card drew - three picks, never a log fact (modelPrefs.ts). */
export interface ShareLook {
  race: string
  sex: 'M' | 'F'
  face?: number
}

/** One worn slot, as the dump spelled it plus the icon the committed DB joined in. */
export interface ShareCell {
  /** the sheet's own cell id (`chest`, `ear1`) - the grid's key, never a side */
  slot: string
  /** what the cell is called on screen; identical for both cells of a pair */
  label: string
  /** the Name column verbatim, ` +N` and all */
  item: string
  /** the ` +N` the name stated; absent means the name carried none, NOT tier 0 */
  tier?: number
  iconId?: number
  /** the names of the exaltations socketed into it, the client's `(Exaltation)` suffix removed */
  exaltations: string[]
  /** the donor item whose LOOK this one wears, when it wears one */
  ornament?: string
}

/** One summed row of the gear totals: a label and an integer. */
export interface ShareStat {
  label: string
  total: number
}

/** A stat whose values are NOT addable (percentages): the values, stated, never a total. */
export interface ShareUnsummed {
  label: string
  values: string[]
}

/** What the worn gear adds up to - `GearTotals` reduced to plain numbers and stated strings. */
export interface ShareTotals {
  ac: number
  stats: ShareStat[]
  saves: ShareStat[]
  unsummed: ShareUnsummed[]
  /** worn items whose stat block the committed DB had */
  counted: number
  /** worn items it knew nothing about; their stats are in NO total above */
  unknown: number
}

/** The Build tab's four readings, as percents. All four or none - see the header. */
export interface ShareScores {
  tank: number
  dps: number
  heal: number
  solo: number
}

/** The whole shareable profile. Optional fields are ABSENT facts, never zeroed ones. */
export interface CharacterProfileShare {
  v: number
  /** epoch millis the card was built - what the viewer's "shared ... on" line reads */
  capturedAt: number
  name?: string
  level?: number
  classes: string[]
  look: ShareLook
  cells: ShareCell[]
  totals: ShareTotals
  scores?: ShareScores
}

/** Everything the builder is handed. One object because five loose arguments is four too many. */
export interface CharacterShareInput {
  cells: readonly SheetCellView[]
  totals: GearTotals
  look: ShareLook
  classes: readonly string[]
  name?: string | undefined
  level?: number | undefined
  /** the Build tab's reading, or undefined when it had none to give (header, law 1) */
  scores?: ShareScores | undefined
  capturedAt: number
}

/** The highest level this app reads out of a stranger's body. A range check, not a size cap. */
const MAX_LEVEL = 999

// ---------------------------------------------------------------------------------------- build

/** A worn cell as the wire carries it, or null when the cell is empty. */
function shareCell(cell: SheetCellView): ShareCell | null {
  const item = cell.item
  if (!item) return null
  const out: ShareCell = {
    slot: cell.id,
    label: cell.label,
    item: item.name,
    exaltations: item.exaltations.slice(0, SHARE_LIMITS.maxCharacterExaltations)
  }
  if (item.tier !== undefined) out.tier = item.tier
  if (item.iconId !== undefined) out.iconId = item.iconId
  if (item.ornament !== undefined) out.ornament = item.ornament
  return out
}

/** The summed rows, reduced to label + total. `from` is bookkeeping and stays home. */
function shareStats(rows: readonly { label: string; total: number }[]): ShareStat[] {
  const out: ShareStat[] = []
  for (const row of rows.slice(0, SHARE_LIMITS.maxCharacterStats)) {
    out.push({ label: row.label, total: row.total })
  }
  return out
}

function shareUnsummed(rows: GearTotals['unsummed']): ShareUnsummed[] {
  const out: ShareUnsummed[] = []
  for (const row of rows.slice(0, SHARE_LIMITS.maxCharacterStats)) {
    out.push({ label: row.label, values: row.values.slice(0, SHARE_LIMITS.maxStatValues) })
  }
  return out
}

function shareLook(look: ShareLook): ShareLook {
  const out: ShareLook = { race: look.race, sex: look.sex }
  if (look.face !== undefined) out.face = look.face
  return out
}

/**
 * The profile, PROJECTED out of what is already on screen. Field by field on purpose (see the
 * header): a spread would let a future sheet field leave this machine by being added to a type.
 */
export function buildCharacterShare(input: CharacterShareInput): CharacterProfileShare {
  const cells: ShareCell[] = []
  for (const cell of input.cells) {
    if (cells.length >= SHARE_LIMITS.maxCharacterCells) break
    const one = shareCell(cell)
    if (one) cells.push(one)
  }
  const profile: CharacterProfileShare = {
    v: CHARACTER_SHARE_VERSION,
    capturedAt: input.capturedAt,
    classes: input.classes.slice(0, SHARE_LIMITS.maxCharacterClasses).map(String),
    look: shareLook(input.look),
    cells,
    totals: {
      ac: input.totals.ac,
      stats: shareStats(input.totals.stats),
      saves: shareStats(input.totals.saves),
      unsummed: shareUnsummed(input.totals.unsummed),
      counted: input.totals.counted,
      unknown: input.totals.unknown
    }
  }
  if (input.name) profile.name = input.name
  if (input.level !== undefined) profile.level = input.level
  if (input.scores) profile.scores = { ...input.scores }
  return profile
}

// ------------------------------------------------------------------------------------- sanitize

/** Untrusted -> a finite integer in `[min, max]`, or undefined. */
function clampInt(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.max(min, Math.min(max, Math.round(v)))
}

/** Untrusted -> a bounded list of bounded strings, empties dropped. */
function clampStrings(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const one of v.slice(0, max)) {
    const text = clampStr(one, SHARE_LIMITS.maxNameChars).trim()
    if (text) out.push(text)
  }
  return out
}

function sanitizeLook(v: unknown): ShareLook {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  // The race is a two-letter archive code here, not a label - anything else degrades to the
  // default rather than reaching a lookup (the `readRace` rule, JOS-105).
  const race = clampStr(r.race, 8).trim().toUpperCase()
  const look: ShareLook = {
    race: /^[A-Z]{2}$/.test(race) ? race : 'HU',
    sex: r.sex === 'F' ? 'F' : 'M'
  }
  const face = clampInt(r.face, 0, 9)
  if (face !== undefined) look.face = face
  return look
}

function sanitizeCell(v: unknown): ShareCell | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const slot = clampStr(r.slot, 40).trim()
  const item = clampStr(r.item, SHARE_LIMITS.maxNameChars).trim()
  if (!slot || !item) return null
  const cell: ShareCell = {
    slot,
    label: clampStr(r.label, 40).trim() || slot,
    item,
    exaltations: clampStrings(r.exaltations, SHARE_LIMITS.maxCharacterExaltations)
  }
  const tier = clampInt(r.tier, 0, 99)
  if (tier !== undefined) cell.tier = tier
  // The icon id reaches an `eqimg://item/<id>` URL, so it is an id or it is absent.
  const iconId = clampInt(r.iconId, 0, 999_999)
  if (iconId !== undefined) cell.iconId = iconId
  const ornament = clampStr(r.ornament, SHARE_LIMITS.maxNameChars).trim()
  if (ornament) cell.ornament = ornament
  return cell
}

function sanitizeStats(v: unknown): ShareStat[] {
  if (!Array.isArray(v)) return []
  const out: ShareStat[] = []
  for (const one of v.slice(0, SHARE_LIMITS.maxCharacterStats)) {
    if (!one || typeof one !== 'object') continue
    const r = one as Record<string, unknown>
    const label = clampStr(r.label, 40).trim()
    const total = clampInt(r.total, -1_000_000, 1_000_000)
    if (label && total !== undefined) out.push({ label, total })
  }
  return out
}

function sanitizeUnsummed(v: unknown): ShareUnsummed[] {
  if (!Array.isArray(v)) return []
  const out: ShareUnsummed[] = []
  for (const one of v.slice(0, SHARE_LIMITS.maxCharacterStats)) {
    if (!one || typeof one !== 'object') continue
    const r = one as Record<string, unknown>
    const label = clampStr(r.label, 40).trim()
    const values = clampStrings(r.values, SHARE_LIMITS.maxStatValues)
    if (label && values.length) out.push({ label, values })
  }
  return out
}

function sanitizeTotals(v: unknown): ShareTotals {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    ac: clampInt(r.ac, -1_000_000, 1_000_000) ?? 0,
    stats: sanitizeStats(r.stats),
    saves: sanitizeStats(r.saves),
    unsummed: sanitizeUnsummed(r.unsummed),
    counted: clampInt(r.counted, 0, SHARE_LIMITS.maxCharacterCells) ?? 0,
    unknown: clampInt(r.unknown, 0, SHARE_LIMITS.maxCharacterCells) ?? 0
  }
}

/**
 * The four readings, or undefined. ALL FOUR OR NONE: a body that names three of them is not a
 * partial reading this card can draw, it is a body that did not come from `buildCharacterShare`,
 * and half a score row is exactly the invented number law 1 forbids.
 */
function sanitizeScores(v: unknown): ShareScores | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as Record<string, unknown>
  const tank = clampInt(r.tank, 0, 100)
  const dps = clampInt(r.dps, 0, 100)
  const heal = clampInt(r.heal, 0, 100)
  const solo = clampInt(r.solo, 0, 100)
  if (tank === undefined || dps === undefined || heal === undefined || solo === undefined) {
    return undefined
  }
  return { tank, dps, heal, solo }
}

/** The worn cells of an untrusted body: capped, each rebuilt, the unreadable ones dropped. */
function sanitizeCells(v: unknown): ShareCell[] {
  const cells: ShareCell[] = []
  if (!Array.isArray(v)) return cells
  for (const one of v.slice(0, SHARE_LIMITS.maxCharacterCells)) {
    const cell = sanitizeCell(one)
    if (cell) cells.push(cell)
  }
  return cells
}

/**
 * An untrusted object -> a profile this app may draw, or null when there is nothing in it.
 *
 * Rebuilt field by field, like `sanitizeAlertDef`: unknown keys are dropped by construction, every
 * string is bounded, every list is capped and every number is finite and in range. A body carrying
 * no worn cell at all is null - that is an empty payload, not a character.
 */
export function sanitizeCharacterShare(v: unknown): CharacterProfileShare | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.v === 'number' && r.v > CHARACTER_SHARE_VERSION) return null
  const cells = sanitizeCells(r.cells)
  if (!cells.length) return null
  const profile: CharacterProfileShare = {
    v: CHARACTER_SHARE_VERSION,
    capturedAt: clampInt(r.capturedAt, 0, 4_102_444_800_000) ?? 0,
    classes: clampStrings(r.classes, SHARE_LIMITS.maxCharacterClasses),
    look: sanitizeLook(r.look),
    cells,
    totals: sanitizeTotals(r.totals)
  }
  const name = clampStr(r.name, SHARE_LIMITS.maxNameChars).trim()
  if (name) profile.name = name
  const level = clampInt(r.level, 1, MAX_LEVEL)
  if (level !== undefined) profile.level = level
  const scores = sanitizeScores(r.scores)
  if (scores) profile.scores = scores
  return profile
}

// ------------------------------------------------------------------------------------ plain text

/** The four labels the Build tab uses, so a pasted summary and the tab read the same words. */
const SCORE_LABEL: readonly [keyof ShareScores, string][] = [
  ['tank', 'Tank'],
  ['dps', 'DPS'],
  ['heal', 'Healer'],
  ['solo', 'Solo']
]

/** The head line: who this is. Every part is allowed to be absent, and then it is simply not said. */
function headLine(profile: CharacterProfileShare): string {
  const parts: string[] = [profile.name ?? 'A character']
  if (profile.level !== undefined) parts.push(`level ${String(profile.level)}`)
  if (profile.classes.length) parts.push(profile.classes.join(' / '))
  return parts.join(' - ')
}

/** One worn slot as a line: `Chest: Crested Mistmoore Breastplate +3 · 2 exaltations`. */
function cellLine(cell: ShareCell): string {
  const bits: string[] = [`${cell.label}: ${cell.item}`]
  if (cell.exaltations.length) {
    const n = cell.exaltations.length
    bits.push(`${String(n)} exaltation${n === 1 ? '' : 's'}`)
  }
  if (cell.ornament !== undefined) bits.push(`ornamented as ${cell.ornament}`)
  return bits.join(' · ')
}

/**
 * The profile as text you can paste into a chat window - the third way to share, beside the card
 * image and the string, and the only one that survives a client that eats long strings.
 *
 * WHAT IS NOT HERE IS THE POINT: no scores line when there are no scores, no gear line for a slot
 * nothing is worn in. It says what the profile states and stops.
 */
export function characterShareText(profile: CharacterProfileShare): string {
  const lines: string[] = [headLine(profile)]
  if (profile.scores) {
    const scores = profile.scores
    lines.push(SCORE_LABEL.map(([key, label]) => `${label} ${String(scores[key])}%`).join(' · '))
  }
  lines.push(`AC ${String(profile.totals.ac)} from ${String(profile.totals.counted)} of ${String(profile.cells.length)} worn items`)
  lines.push('')
  for (const cell of profile.cells) lines.push(cellLine(cell))
  lines.push('')
  lines.push('Shared from EQ Zera')
  return lines.join('\n')
}
