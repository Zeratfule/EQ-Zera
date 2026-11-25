// gameFileHealth.ts — DID THE APP RECOGNISE THE GAME'S OWN FILES? The model, the notice and the
// report. PURE: no fs, no Electron, no clock; tests/gameFileHealth.test.mts drives every function.
//
// WHY THIS EXISTS. On 2026-11-24 a client patch widened `spells_us.txt` from 174 to 190 fields per
// row. The parser skips a row length it has never measured (it must: reading a moved column at the
// old offset is a wrong number, not a missing one), so every row was skipped, the resist table came
// out EMPTY, and mob resist estimates stopped working for every player with nothing on screen to
// say so. Every reader of a Daybreak file can fail that way, so every one of them now answers the
// same question in the same shape, and the app says out loud when the answer is "no".
//
// FOUR STATUSES, AND TWO OF THEM ARE NOT ALARMS.
//   ok            the file was read and the layout is one this build has measured.
//   unrecognised  the file is there and this build could not read it: a patch moved the layout.
//                 The ONLY status that shows a notice and files a report.
//   missing       no file at the resolved path (no install, a logs-only folder, a trimmed install).
//                 A supported configuration every feature already explains in its own place.
//   error         the read itself failed (a lock, a permission). Logged, never noticed: it is not
//                 something an app update fixes.
//   pending       the file is empty or half-written (a patcher copying in place while the check
//                 ran). Re-checked a little later; never noticed, never reported.
//
// THE REPORT CARRIES NO PATH AND NO NAME. A report is a reader id from the fixed table below, a
// status, a short code-shaped layout signature (`fields-200`) and a handful of counts. The file
// label is the client's own file name, never a location on disk.

/** Every reader of a Daybreak game-client file, in notice priority order. */
export const GAME_FILE_IDS = ['spellsUs', 'dbstrUs', 'maps', 'uiSkin', 'models', 'globalLoad', 'eqclientIni'] as const
export type GameFileId = (typeof GAME_FILE_IDS)[number]

export type GameFileStatus = 'ok' | 'unrecognised' | 'missing' | 'error' | 'pending'

/** One reader's verdict on one version of its file. */
export interface GameFileReport {
  id: GameFileId
  status: GameFileStatus
  /**
   * The layout seen, short and code-shaped (`fields-190`, `no-anchor`, `magic`): what the
   * developer needs to know first, and what "once per detected layout" is keyed on.
   */
  signature: string
  /** What was measured. Counts only; never text out of the file. */
  facts: Readonly<Record<string, number>>
  /**
   * Field-count histogram for row-shaped files (`{ "190": 74024 }`), the commonest few only.
   * Absent for readers that have no rows.
   */
  histogram?: Readonly<Record<string, number>>
  /**
   * Which version of the file this verdict is about: its size and mtime (`40752305-1763333460000`),
   * '' when unknown. A dismissed notice stays dismissed until this changes, so the NEXT patch earns
   * its own line.
   */
  version: string
}

export interface GameFileReader {
  id: GameFileId
  /** The file as a player would recognise it, for the notice sentence. */
  label: string
  /** What stops working, as the second half of the notice sentence. */
  paused: string
  /** False for a reader whose only consumer is diagnostic: it reports, but never notices. */
  notice: boolean
}

export const GAME_FILE_READERS: Readonly<Record<GameFileId, GameFileReader>> = {
  spellsUs: {
    id: 'spellsUs',
    label: 'spells_us.txt',
    paused: 'mob resist estimates and client spell figures are paused',
    notice: true
  },
  dbstrUs: {
    id: 'dbstrUs',
    label: 'dbstr_us.txt',
    paused: 'spell category names in the spell catalogue are paused',
    notice: true
  },
  maps: { id: 'maps', label: 'its map files', paused: 'the Maps tab may not draw them', notice: true },
  uiSkin: { id: 'uiSkin', label: 'its UI files', paused: 'building the EQ Zera UI skin is paused', notice: true },
  models: { id: 'models', label: 'its character model archives', paused: '3D character models are paused', notice: true },
  globalLoad: {
    id: 'globalLoad',
    label: 'GlobalLoad.txt',
    paused: 'Luclin character models cannot be applied',
    notice: true
  },
  eqclientIni: { id: 'eqclientIni', label: 'eqclient.ini', paused: 'the display-mode reading is paused', notice: false }
}

/** The one sentence a notice shows for a reader. No em dashes: this is copy. */
export function noticeSentence(id: GameFileId): string {
  const r = GAME_FILE_READERS[id]
  return `The game's last patch changed ${r.label}; ${r.paused} until EQ Zera updates.`
}

/** The key a dismissal is stored under: one reader, one file version, one layout. */
export function dismissKey(r: Pick<GameFileReport, 'id' | 'version' | 'signature'>): string {
  return `${r.id}:${r.version}:${r.signature}`
}

/** The key a report is filed under: one reader, one layout, whatever file version carried it. */
export function reportKey(r: Pick<GameFileReport, 'id' | 'signature'>): string {
  return `${r.id}:${r.signature}`
}

/** Everything the renderer is told: every verdict (for a diagnostics reader) and the notice, if any. */
export interface GameFileHealthView {
  /** False until the launch's one check has finished. */
  checked: boolean
  reports: GameFileReport[]
  notice: GameFileNotice | null
}

/** What the renderer draws: one sentence, how many more are waiting, and what a close dismisses. */
export interface GameFileNotice {
  id: GameFileId
  sentence: string
  more: number
  dismissKeys: string[]
}

/**
 * The notice to show, or null. Only `unrecognised` reports of a noticeable reader count, and a
 * report whose `dismissKey` is in `dismissed` is skipped. The first one in `GAME_FILE_IDS` order
 * is named; the rest are a count, and one close dismisses every one the line stood for.
 */
export function gameFileNotice(
  reports: readonly GameFileReport[],
  dismissed: readonly string[],
  noticeable: (id: GameFileId) => boolean = () => true
): GameFileNotice | null {
  const gone = new Set(dismissed)
  const live = reports
    .filter((r) => r.status === 'unrecognised' && GAME_FILE_READERS[r.id].notice && noticeable(r.id))
    .filter((r) => !gone.has(dismissKey(r)))
    .sort((a, b) => GAME_FILE_IDS.indexOf(a.id) - GAME_FILE_IDS.indexOf(b.id))
  const first = live[0]
  if (first === undefined) return null
  return { id: first.id, sentence: noticeSentence(first.id), more: live.length - 1, dismissKeys: live.map(dismissKey) }
}

/**
 * Should this report be filed (once per layout)? Only an unrecognised layout not filed before, and
 * only for a reader that matters to this player: one that can notice at all (eqclient.ini cannot)
 * and that `noticeable` admits (GlobalLoad.txt only with Luclin models on). The same gate as the
 * notice, so a report never exists for something the player was never told about.
 */
export function shouldReport(r: GameFileReport, filed: readonly string[], noticeable: (id: GameFileId) => boolean): boolean {
  return r.status === 'unrecognised' && GAME_FILE_READERS[r.id].notice && noticeable(r.id) && !filed.includes(reportKey(r))
}

/** 74024 -> `74k`: five digits or more would be redacted to `<n>`, so a big count is rounded first. */
function compact(n: number): string {
  return Math.abs(n) >= 10_000 ? `${String(Math.round(n / 1000))}k` : String(n)
}

/** Row counts are sent as a share of `rows`; everything else is compacted. */
const ROW_SHARES = new Set(['rowsRead', 'rowsSkipped'])

/**
 * A pending verdict that a re-check found UNCHANGED (same reader, same signature, same file version)
 * is no longer a file mid-copy. A short or empty file stays pending (a stable empty file is not a
 * layout, and every feature handles a missing one); a full-size archive whose directory is outside
 * the file (`directory`) becomes `unrecognised`.
 */
export function settlePending(prev: GameFileReport | undefined, next: GameFileReport): GameFileReport {
  const stable = prev?.status === 'pending' && prev.signature === next.signature && prev.version === next.version
  return stable && next.status === 'pending' && next.signature === 'directory' ? { ...next, status: 'unrecognised' } : next
}

/** `spellsUs` -> `GameFileSpellsUs`: the error name, which is what separates one reader's report from another's. */
export function reportErrorName(id: GameFileId): string {
  return `GameFile${id.charAt(0).toUpperCase()}${id.slice(1)}`
}

/**
 * The report's one-line message, built to survive the error report's redaction intact: no path, no
 * quotes, and no number of five digits or more (the redactor turns those into `<n>`). Read and
 * skipped rows are percentages of `rows`, the histogram is its two commonest widths as
 * percentages of rows, and any other big count is rounded to thousands (`74k`). Facts keep their
 * order, and a `-moved` verdict puts its failed checks first, so the 200-character cap the
 * redactor applies cuts the least useful end. tests/gameFileHealthReview.test.mts runs it through
 * the real redactor.
 */
export function reportMessage(r: GameFileReport): string {
  const label = GAME_FILE_READERS[r.id].label
  const rows = r.facts.rows ?? 0
  const share = (n: number): string => `${String(rows > 0 ? Math.round((n / rows) * 100) : 0)}%`
  const facts = Object.entries(r.facts)
    .map(([k, v]) => `${k}=${ROW_SHARES.has(k) ? share(v) : compact(v)}`)
    .join(' ')
  const hist = r.histogram
    ? ` fields ${Object.entries(r.histogram)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([k, v]) => `${k}x${share(v)}`)
        .join(',')}`
    : ''
  return `game file not recognised: ${label} layout ${r.signature}${facts ? ` ${facts}` : ''}${hist}`
}

/** `{ "190": 74024, "17": 3 }` -> the commonest field count, or 0 for an empty histogram. */
export function dominantFieldCount(histogram: Readonly<Record<string, number>>): number {
  let best = 0
  let bestRows = -1
  for (const [k, v] of Object.entries(histogram)) {
    if (v > bestRows) {
      best = Number(k)
      bestRows = v
    }
  }
  return best
}

/** The `limit` commonest entries of a histogram, for a report that must stay short. */
export function topOfHistogram(histogram: Readonly<Record<string, number>>, limit = 4): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(histogram)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)) {
    out[k] = v
  }
  return out
}

/** A file's version string from its size and mtime. */
export function fileVersion(size: number, mtimeMs: number): string {
  return `${String(size)}-${String(Math.round(mtimeMs))}`
}
