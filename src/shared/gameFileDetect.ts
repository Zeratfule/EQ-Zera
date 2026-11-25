// gameFileDetect.ts — one detector per game-file reader: measurements in, a GameFileReport out.
// PURE (no fs, no Electron); tests/gameFileHealth.test.mts drives each with synthetic input.
//
// A DETECTOR JUDGES THE LAYOUT, NOT THE CONTENT. It asks "could the reader this app ships make
// sense of these bytes", which is what a patch changes, and leaves "is that spell's number right" to
// the reader's own tests. Where the reader is a pure function in src/main, the probe runs it and
// hands the counts in (maps, the skin XML, GlobalLoad's anchor); where the format is a row table, the
// detector measures the rows itself.
//
// THE THRESHOLD IS "MOST ROWS". A layout change moves every row at once, so a file where most rows
// are an unmeasured width is a new layout, while a handful of odd rows in a file that otherwise
// reads is the file's own noise (and the parser already skips those one at a time).

import {
  dominantFieldCount,
  topOfHistogram,
  type GameFileId,
  type GameFileReport
} from './gameFileHealth'

/** Rows and their field-count histogram, the measurement both row-table detectors start from. */
export interface RowLayout {
  rows: number
  /** field count -> rows with that many fields */
  histogram: Record<string, number>
}

/**
 * Count the rows of a caret-delimited table and how many fields each has. Counts carets rather than
 * splitting, so a 38 MB file costs one pass and no garbage. A trailing `\r` never adds a field
 * (carets are what is counted), and an empty line is not a row.
 */
export function caretLayout(text: string): RowLayout {
  const histogram: Record<string, number> = {}
  let rows = 0
  let carets = 0
  let nonEmpty = false
  const flush = (): void => {
    if (nonEmpty) {
      rows++
      const k = String(carets + 1)
      histogram[k] = (histogram[k] ?? 0) + 1
    }
    carets = 0
    nonEmpty = false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 10) flush()
    else if (c === 94) {
      carets++
      nonEmpty = true
    } else if (c !== 13) nonEmpty = true
  }
  flush()
  return { rows, histogram }
}

function report(id: GameFileId, status: GameFileReport['status'], signature: string, rest: Partial<GameFileReport> & { version: string }): GameFileReport {
  return { id, status, signature, facts: {}, ...rest }
}

/** The common verdict for a file whose shape is "rows of N fields, and these N are known". */
function rowTableVerdict(id: GameFileId, layout: RowLayout, known: ReadonlySet<number>, version: string): GameFileReport {
  const rowsRead = Object.entries(layout.histogram).reduce((n, [k, v]) => (known.has(Number(k)) ? n + v : n), 0)
  const rowsSkipped = layout.rows - rowsRead
  const fields = dominantFieldCount(layout.histogram)
  const facts = { rows: layout.rows, rowsRead, rowsSkipped, fields }
  const histogram = topOfHistogram(layout.histogram)
  // No rows at all is a file being written (a patcher mid-copy), not a layout: re-checked later.
  if (layout.rows === 0) return report(id, 'pending', 'empty', { version, facts })
  // The DOMINANT width must be a measured one, not merely most rows: a file of mixed widths whose
  // commonest is unmeasured is a layout this build has not seen.
  const status = rowsSkipped * 2 > layout.rows || !known.has(fields) ? 'unrecognised' : 'ok'
  return report(id, status, `fields-${String(fields)}`, { version, facts, histogram })
}

/** Per-check passing rows over the realigned rows, and how many each needs (main/resist/spellsUsSemantics.ts). */
export interface SpellsUsSemantics {
  rows: number
  pass: Record<string, number>
  /** Passing rows each check needs; a check without an entry needs `SEMANTIC_FLOOR` of the rows. */
  need?: Record<string, number>
}

/** The default share of realigned rows a field check must pass (the per-check floors live with the checks). */
export const SEMANTIC_FLOOR = 0.95

/** How many failed checks a `-moved` report names; `failed` carries the full count. */
const MAX_FAILED_SHOWN = 8

/** The checks a file failed, by name. Empty when every field looks like itself. */
function failedChecks(s: SpellsUsSemantics): string[] {
  if (s.rows === 0) return []
  return Object.entries(s.pass)
    .filter(([k, n]) => n < (s.need?.[k] ?? Math.ceil(s.rows * SEMANTIC_FLOOR)))
    .map(([k]) => k)
}

export interface SpellsUsMeasure {
  layout: RowLayout
  semantics?: SpellsUsSemantics
  /** Spells the parse produced, when a table pass measured it. Zero at a known width is no table. */
  entries?: number
  version: string
}

/**
 * `spells_us.txt`. `known` is the parser's own list of measured row widths
 * (`resist/spellsUsParse.ts KNOWN_ROW_LENGTHS`). A measured width is necessary and not sufficient:
 * when the field checks fail (`semantics`), the columns moved under an unchanged width, and the
 * signature says so (`fields-190-moved`). The facts lead with how many checks failed, then name the
 * first `MAX_FAILED_SHOWN` of them in column order as a percentage each; passing checks are left
 * out (a report's message is capped at 200 characters after redaction). A known width that
 * parsed to no spells at all (`entries` 0: blank names, non-numeric ids) is `no-spells`.
 */
export function spellsUsHealth(m: SpellsUsMeasure, known: ReadonlySet<number>): GameFileReport {
  const verdict = rowTableVerdict('spellsUs', m.layout, known, m.version)
  if (verdict.status !== 'ok') return verdict
  if (m.entries === 0) return { ...verdict, status: 'unrecognised', signature: 'no-spells' }
  if (!m.semantics) return verdict
  const s = m.semantics
  const failed = failedChecks(s)
  const checks = Object.keys(s.pass).length
  if (failed.length === 0) return { ...verdict, facts: { ...verdict.facts, checks } }
  // In column order, the first few only: where the move starts is what the developer needs, and a
  // move across fifty columns would otherwise run the message past the redactor's cap.
  const col = (k: string): number => (/^c\d+/.test(k) ? Number(/\d+/.exec(k)?.[0]) : 999)
  const shown = [...failed].sort((a, b) => col(a) - col(b)).slice(0, MAX_FAILED_SHOWN)
  const pct = Object.fromEntries(shown.map((k) => [`${k}Pct`, s.rows ? Math.round(((s.pass[k] ?? 0) / s.rows) * 100) : 0]))
  const { rows, fields } = verdict.facts
  return { ...verdict, status: 'unrecognised', signature: `${verdict.signature}-moved`, facts: { failed: failed.length, rows, fields, ...pct } }
}
/** The spell-category namespace of `dbstr_us.txt` (engine `fold::dbstr` reads type 5). */
const DBSTR_SPELL_CATEGORY_TYPE = '5'
const DIGITS = /^\d+$/

/**
 * `dbstr_us.txt`: `id^type^string^…`. The engine reader needs at least three fields, a numeric id
 * and type, and the type-5 namespace to exist. Unrecognised when most rows are not that shape, or
 * when no row is in the namespace the reader keeps.
 */
export function dbstrHealth(text: string, version: string): GameFileReport {
  const histogram: Record<string, number> = {}
  let rows = 0
  let wellFormed = 0
  let categories = 0
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line === '') continue
    rows++
    const f = line.split('^')
    const k = String(f.length)
    histogram[k] = (histogram[k] ?? 0) + 1
    if (f.length < 3 || !DIGITS.test(f[0]) || !DIGITS.test(f[1])) continue
    wellFormed++
    if (f[1] === DBSTR_SPELL_CATEGORY_TYPE) categories++
  }
  const fields = dominantFieldCount(histogram)
  const facts = { rows, rowsRead: wellFormed, rowsSkipped: rows - wellFormed, spellCategories: categories, fields }
  const hist = topOfHistogram(histogram)
  if (rows === 0) return report('dbstrUs', 'pending', 'empty', { version, facts })
  if ((rows - wellFormed) * 2 > rows) return report('dbstrUs', 'unrecognised', `fields-${String(fields)}`, { version, facts, histogram: hist })
  if (categories === 0) return report('dbstrUs', 'unrecognised', 'no-spell-categories', { version, facts, histogram: hist })
  return report('dbstrUs', 'ok', `fields-${String(fields)}`, { version, facts, histogram: hist })
}

/** What the maps probe measured over its sample of `<eqRoot>/maps`. */
export interface MapSample {
  files: number
  /** line + point records the parser kept */
  records: number
  /** lines the parser dropped */
  skipped: number
}

/** The map files: unrecognised when the sample is mostly lines the parser drops. */
export function mapsHealth(sample: MapSample | null, version: string): GameFileReport {
  if (sample === null || sample.files === 0) return report('maps', 'missing', 'none', { version })
  const facts = { files: sample.files, records: sample.records, skipped: sample.skipped }
  const total = sample.records + sample.skipped
  if (total === 0) return report('maps', 'unrecognised', 'empty', { version, facts })
  if (sample.skipped * 2 > total) return report('maps', 'unrecognised', 'records', { version, facts })
  return report('maps', 'ok', 'LP', { version, facts })
}

/** The UI skin's source: how many `<Ui2DAnimation>` frames its EQUI XML yielded, null when absent. */
export function uiSkinHealth(frames: number | null, version: string): GameFileReport {
  if (frames === null) return report('uiSkin', 'missing', 'none', { version })
  if (frames === 0) return report('uiSkin', 'unrecognised', 'no-frames', { version, facts: { frames } })
  return report('uiSkin', 'ok', 'frames', { version, facts: { frames } })
}

/** One `.s3d` archive's header as the probe read it: the first 8 bytes and the file's size. */
export interface PfsHeader {
  head: Uint8Array
  size: number
}

/**
 * Does an `.s3d` start the way `eqassets/pfs.ts` needs: a directory offset inside the file and the
 * `PFS ` magic at byte 4? `archives` maps an archive name to its header, or null when absent; every
 * archive missing is `missing`, any present archive with the wrong magic is `unrecognised`.
 *
 * A FILE SHORTER THAN ITS HEADER IS PENDING (`truncated`): a patcher copying in place. A full
 * header whose directory offset is outside the file is pending (`directory`) the first time only,
 * because the directory is written last; `settlePending` (shared/gameFileHealth.ts) turns it into
 * `unrecognised` when a re-check finds the same file version still saying so.
 */
export function modelsHealth(archives: Readonly<Record<string, PfsHeader | null>>, version: string): GameFileReport {
  const present = Object.values(archives).filter((h): h is PfsHeader => h !== null)
  if (present.length === 0) return report('models', 'missing', 'none', { version })
  let bad = 0
  let short = 0
  let badDir = 0
  for (const h of present) {
    if (h.head.length < 8 || h.size < 8) short++
    else if (String.fromCharCode(...h.head.subarray(4, 8)) !== 'PFS ') bad++
    else if (new DataView(h.head.buffer, h.head.byteOffset, 4).getUint32(0, true) >= h.size) badDir++
  }
  const facts = { archives: present.length, badMagic: bad, truncated: short, badDirectory: badDir }
  if (bad > 0) return report('models', 'unrecognised', 'magic', { version, facts })
  if (short > 0) return report('models', 'pending', 'truncated', { version, facts })
  if (badDir > 0) return report('models', 'pending', 'directory', { version, facts })
  return report('models', 'ok', 'pfs', { version, facts })
}

/** GlobalLoad.txt: null text is missing; a file without the line the edit goes after is unrecognised. */
export function globalLoadHealth(text: string | null, anchorFound: boolean, version: string): GameFileReport {
  if (text === null) return report('globalLoad', 'missing', 'none', { version })
  if (text.trim() === '') return report('globalLoad', 'pending', 'empty', { version })
  if (!anchorFound) return report('globalLoad', 'unrecognised', 'no-anchor', { version })
  return report('globalLoad', 'ok', 'anchor', { version })
}

/**
 * eqclient.ini. A fresh install writes it WITHOUT the display-mode keys until the player opens the
 * video options, so missing keys are `missing`, never a layout change. Only a non-empty file with
 * no `[section]` header at all is not an INI this reader understands.
 */
export function eqclientIniHealth(text: string | null, modeKnown: boolean, version: string): GameFileReport {
  if (text === null) return report('eqclientIni', 'missing', 'none', { version })
  if (text.trim() === '') return report('eqclientIni', 'pending', 'empty', { version })
  if (!modeKnown && !/^\s*\[[^\]\r\n]+\]/m.test(text)) return report('eqclientIni', 'unrecognised', 'no-sections', { version })
  if (!modeKnown) return report('eqclientIni', 'missing', 'no-mode-keys', { version })
  return report('eqclientIni', 'ok', 'mode', { version })
}

/** A read that threw something other than "not there". */
export function readError(id: GameFileId, code: string | undefined, version = ''): GameFileReport {
  return report(id, 'error', code && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : 'read', { version })
}
