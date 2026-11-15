// globalLoad.ts - the text surgery behind "Luclin character models". PURE: no fs, no Electron.
//
// The edit is the community guide's, line for line: directly after the line that begins
// `2,0,TFFFE,it101084,`, one `1,1,TFFT,global<CODE>_chr2,...` and one `..._chr,...` line per model
// code (male then female, race by race), then the four `LGEquip*` armour lines. Only archives the
// install actually has are listed - several `_chr2` files do not exist in EQ Legends, and naming a
// missing archive risks a client load failure.
//
// THREE RULES MAKE IT SAFE TO RUN ON SOMEBODY ELSE'S FILE:
//   1. Every byte that is not ours is kept exactly: lines are split with their terminators and
//      joined back verbatim, so CRLF, a stray LF, a BOM or a missing final newline all survive.
//   2. "Ours" is narrow: the unbroken run of catalogue lines directly after the anchor. A catalogue
//      line anywhere else in the file is somebody else's and is never touched.
//   3. Applying is strip-then-insert, so applying twice, or applying a different race set, can
//      never stack lines - and stripping a patched file gives back the original bytes.

import { LUCLIN_RACES, type GlobalLoadState } from '../../shared/luclinModels'

/** The line the edit goes after. Matched as a prefix: the trailing caption is not ours to pin. */
export const ANCHOR_PREFIX = '2,0,TFFFE,it101084,'

/** One line the edit can write, and the archive in the EQ folder it names. */
export interface CatalogLine {
  line: string
  /** Lowercase file name in the EQ root, e.g. `globalhum_chr2.s3d`. */
  file: string
  /** The race this line belongs to, or null for the shared armour lines. */
  race: string | null
}

const ARMOUR: readonly CatalogLine[] = ['LGEquip_amr2', 'LGEquip_amr', 'LGEquip2', 'LGEquip'].map(
  (name) => ({
    line: `1,1,TFFF,${name},Loading Armor Files`,
    file: `${name.toLowerCase()}.s3d`,
    race: null
  })
)

function raceLines(raceId: string): CatalogLine[] {
  const race = LUCLIN_RACES.find((r) => r.id === raceId)
  if (!race) return []
  const out: CatalogLine[] = []
  for (const code of race.codes) {
    for (const suffix of ['_chr2', '_chr']) {
      out.push({
        line: `1,1,TFFT,global${code}${suffix},Loading ${race.label}`,
        file: `global${code.toLowerCase()}${suffix}.s3d`,
        race: race.id
      })
    }
  }
  return out
}

/** Every line this feature could ever write, in write order. */
export const CATALOG: readonly CatalogLine[] = [
  ...LUCLIN_RACES.flatMap((r) => raceLines(r.id)),
  ...ARMOUR
]

const BY_LINE = new Map(CATALOG.map((c) => [c.line, c]))

/**
 * The lines to write for these races, in the guide's order, keeping only archives `hasArchive`
 * says exist. No race chosen means no lines at all - armour on its own changes nothing.
 */
export function desiredLines(raceIds: readonly string[], hasArchive: (file: string) => boolean): string[] {
  const wanted = new Set(raceIds)
  const races = LUCLIN_RACES.filter((r) => wanted.has(r.id)).flatMap((r) => raceLines(r.id))
  const present = races.filter((c) => hasArchive(c.file))
  if (present.length === 0) return []
  return [...present, ...ARMOUR.filter((c) => hasArchive(c.file))].map((c) => c.line)
}

/** Races with at least one model archive in this install. */
export function availableRaces(hasArchive: (file: string) => boolean): string[] {
  return LUCLIN_RACES.filter((r) => raceLines(r.id).some((c) => hasArchive(c.file))).map((r) => r.id)
}

/** A line and its own terminator (`''` for an unterminated last line). Joined back, they are the file. */
interface Line {
  content: string
  eol: string
}

export function splitLines(text: string): Line[] {
  const out: Line[] = []
  let i = 0
  while (i < text.length) {
    let j = i
    while (j < text.length && text[j] !== '\r' && text[j] !== '\n') j++
    let eol = ''
    if (text.startsWith('\r\n', j)) eol = '\r\n'
    else if (j < text.length) eol = text[j]
    out.push({ content: text.slice(i, j), eol })
    i = j + eol.length
  }
  return out
}

function joinLines(lines: readonly Line[]): string {
  return lines.map((l) => l.content + l.eol).join('')
}

interface Located {
  lines: Line[]
  /** Index of the anchor line. */
  anchor: number
  /** One past the last line of our block (=== anchor + 1 when there is none). */
  end: number
}

function locate(text: string): Located | null {
  const lines = splitLines(text)
  const anchor = lines.findIndex((l) => l.content.startsWith(ANCHOR_PREFIX))
  if (anchor < 0) return null
  let end = anchor + 1
  while (end < lines.length && BY_LINE.has(lines[end].content)) end++
  return { lines, anchor, end }
}

/** The file's own line ending: the anchor's, else the first one it uses, else CRLF (the client's). */
function eolOf(lines: readonly Line[], anchor: number): string {
  if (lines[anchor].eol !== '') return lines[anchor].eol
  return lines.find((l) => l.eol !== '')?.eol ?? '\r\n'
}

/** The text with our block removed. Unchanged when there is no anchor or no block. */
export function stripLuclin(text: string): string {
  const at = locate(text)
  if (!at || at.end === at.anchor + 1) return text
  const { lines, anchor, end } = at
  const kept = [...lines.slice(0, anchor + 1), ...lines.slice(end)]
  // The block was the end of the file and its last line had no newline: the anchor was the last
  // line before we touched it, so it gives back the newline we lent it.
  if (lines[end - 1].eol === '' && end === lines.length) kept[anchor] = { ...kept[anchor], eol: '' }
  return joinLines(kept)
}

/** The text with exactly `desired` after the anchor (and nothing else of ours), or null with no anchor. */
export function patchLuclin(text: string, desired: readonly string[]): string | null {
  const clean = stripLuclin(text)
  const at = locate(clean)
  if (!at) return null
  if (desired.length === 0) return clean
  const { lines, anchor } = at
  const eol = eolOf(lines, anchor)
  const anchorLine = lines[anchor]
  const before = joinLines(lines.slice(0, anchor))
  const after = joinLines(lines.slice(anchor + 1))
  if (anchorLine.eol === '') {
    // Unterminated last line: lend it a newline and leave the final line of ours unterminated,
    // so stripping restores the exact original.
    return before + anchorLine.content + desired.map((l) => eol + l).join('') + after
  }
  return before + anchorLine.content + anchorLine.eol + desired.map((l) => l + eol).join('') + after
}

export interface Inspection {
  state: Exclude<GlobalLoadState, 'file-missing'>
  /** Races with at least one of our lines in the block. */
  appliedRaces: string[]
}

/** Where this text stands against the lines the chosen races want. */
export function inspectLuclin(text: string, desired: readonly string[]): Inspection {
  const at = locate(text)
  if (!at) return { state: 'anchor-missing', appliedRaces: [] }
  const block = at.lines.slice(at.anchor + 1, at.end).map((l) => l.content)
  const races = new Set(block.map((l) => BY_LINE.get(l)?.race).filter((r): r is string => !!r))
  const appliedRaces = LUCLIN_RACES.filter((r) => races.has(r.id)).map((r) => r.id)
  if (block.length === 0) return { state: 'not-applied', appliedRaces }
  const have = new Set(block)
  const same = have.size === block.length && block.length === desired.length && desired.every((l) => have.has(l))
  return { state: same ? 'applied' : 'partial', appliedRaces }
}
