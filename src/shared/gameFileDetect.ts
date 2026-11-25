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
  if (layout.rows === 0) return report(id, 'unrecognised', 'empty', { version, facts })
  const status = rowsSkipped * 2 > layout.rows ? 'unrecognised' : 'ok'
  return report(id, status, `fields-${String(fields)}`, { version, facts, histogram })
}

/**
 * `spells_us.txt`. `known` is the parser's own list of measured row widths
 * (`resist/spellsUsParse.ts KNOWN_ROW_LENGTHS`). `entries`, when given, is how many spells the parse
 * produced: a known layout that still yields no spells is not a working table either.
 */
export function spellsUsHealth(layout: RowLayout, known: ReadonlySet<number>, version: string, entries?: number): GameFileReport {
  const verdict = rowTableVerdict('spellsUs', layout, known, version)
  if (verdict.status === 'ok' && entries === 0) return { ...verdict, status: 'unrecognised', signature: 'no-spells' }
  return entries === undefined ? verdict : { ...verdict, facts: { ...verdict.facts, entries } }
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
  if (rows === 0) return report('dbstrUs', 'unrecognised', 'empty', { version, facts })
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
 * archive missing is `missing`, any present archive failing is `unrecognised`.
 */
export function modelsHealth(archives: Readonly<Record<string, PfsHeader | null>>, version: string): GameFileReport {
  const present = Object.values(archives).filter((h): h is PfsHeader => h !== null)
  if (present.length === 0) return report('models', 'missing', 'none', { version })
  let bad = 0
  let badDir = 0
  for (const h of present) {
    const magic = h.head.length >= 8 ? String.fromCharCode(...h.head.subarray(4, 8)) : ''
    if (magic !== 'PFS ') bad++
    else if (new DataView(h.head.buffer, h.head.byteOffset, 4).getUint32(0, true) >= h.size) badDir++
  }
  const facts = { archives: present.length, badMagic: bad, badDirectory: badDir }
  if (bad > 0) return report('models', 'unrecognised', 'magic', { version, facts })
  if (badDir > 0) return report('models', 'unrecognised', 'directory', { version, facts })
  return report('models', 'ok', 'pfs', { version, facts })
}

/** GlobalLoad.txt: null text is missing; a file without the line the edit goes after is unrecognised. */
export function globalLoadHealth(text: string | null, anchorFound: boolean, version: string): GameFileReport {
  if (text === null) return report('globalLoad', 'missing', 'none', { version })
  if (!anchorFound) return report('globalLoad', 'unrecognised', 'no-anchor', { version })
  return report('globalLoad', 'ok', 'anchor', { version })
}

/** eqclient.ini: present but neither display-mode key readable is unrecognised. */
export function eqclientIniHealth(text: string | null, modeKnown: boolean, version: string): GameFileReport {
  if (text === null) return report('eqclientIni', 'missing', 'none', { version })
  if (!modeKnown) return report('eqclientIni', 'unrecognised', 'no-mode-keys', { version })
  return report('eqclientIni', 'ok', 'mode', { version })
}

/** A read that threw something other than "not there". */
export function readError(id: GameFileId, code: string | undefined, version = ''): GameFileReport {
  return report(id, 'error', code && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : 'read', { version })
}
