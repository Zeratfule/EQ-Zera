// gameFileHealth/probe.ts — READ EACH GAME FILE JUST ENOUGH TO JUDGE ITS LAYOUT. Electron-free: the
// install root is passed in, so a test (or a throwaway script against the real install) runs it
// as-is. Read-only, always: nothing here opens a file for writing.
//
// CHEAP BY DESIGN, and async throughout so nothing blocks main. The big files never touch the main
// thread: `spells_us.txt` is judged from a small sidecar of its worker measurements (passed in),
// `dbstr_us.txt` (10 MB) on the same worker, the `.s3d` archives from their first eight bytes. The
// rest are small or sampled: up to a dozen map files, one EQUI XML, GlobalLoad.txt, eqclient.ini.
// An empty file anywhere is `pending` (a patch copying in place), re-checked by the caller.
//
// Each probe answers for itself and none can throw past `probeGameFiles`: a read that fails for any
// reason but "not there" is an `error` report naming the code, which is never a notice.

import { open, readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  dbstrHealth,
  eqclientIniHealth,
  globalLoadHealth,
  mapsHealth,
  modelsHealth,
  readError,
  uiSkinHealth,
  type PfsHeader
} from '../../shared/gameFileDetect'
import { fileVersion, type GameFileId, type GameFileReport } from '../../shared/gameFileHealth'
import { parseMapText } from '../maps/parseMap'
import { MAPS_SUBDIR, splitMapFileName } from '../maps/packs'
import { parseAnimationFrames } from '../uiSkin/animations'
import { BASE_SKIN, FALLBACK_SKIN } from '../uiSkin/rules'
import { inspectLuclin } from '../luclin/globalLoad'
import { eqWindowModeOf } from '../telemetry/setupFacts'

/** How many map files the sample reads, spread evenly over the folder. */
const MAP_SAMPLE = 12
/** The archives the character model reads first: classic races, the Iksar, the weapons. */
const MODEL_ARCHIVES = ['global_chr.s3d', 'global4_chr.s3d', 'gequip.s3d'] as const
const SKIN_XML = 'EQUI_Animations.xml'

function codeOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code
}

/** The file's text and version, null when it is not there; throws on any other failure. */
async function readText(path: string): Promise<{ text: string; version: string } | null> {
  try {
    const [text, st] = await Promise.all([readFile(path, 'latin1'), stat(path)])
    return { text, version: fileVersion(st.size, st.mtimeMs) }
  } catch (err) {
    if (codeOf(err) === 'ENOENT' || codeOf(err) === 'ENOTDIR') return null
    throw err
  }
}

/** Run one probe; anything it throws becomes that reader's `error` report. */
async function guarded(id: GameFileId, run: () => Promise<GameFileReport>): Promise<GameFileReport> {
  try {
    return await run()
  } catch (err) {
    return readError(id, codeOf(err))
  }
}

/**
 * The readers the caller supplies. `spellsUs` because the resist table's own machinery already
 * measures that file; `dbstr`, when given, judges `dbstr_us.txt` OFF the main thread (main passes
 * the resist worker's `dbstr` job). Without it the file is read and judged in-process, which is for
 * tests only: a 10 MB split is ~26 ms of main-thread time.
 */
export interface ProbeDeps {
  spellsUs: () => Promise<GameFileReport>
  dbstr?: (path: string, version: string) => Promise<GameFileReport | null>
}

async function probeDbstr(root: string, deps: ProbeDeps): Promise<GameFileReport> {
  const path = join(root, 'dbstr_us.txt')
  let version: string
  try {
    const st = await stat(path)
    version = fileVersion(st.size, st.mtimeMs)
    if (st.size === 0) return { id: 'dbstrUs', status: 'pending', signature: 'empty', facts: {}, version }
  } catch (err) {
    if (codeOf(err) === 'ENOENT' || codeOf(err) === 'ENOTDIR') return { id: 'dbstrUs', status: 'missing', signature: 'none', facts: {}, version: '' }
    throw err
  }
  if (deps.dbstr) return (await deps.dbstr(path, version)) ?? readError('dbstrUs', 'worker', version)
  const got = await readText(path)
  return got ? dbstrHealth(got.text, got.version) : { id: 'dbstrUs', status: 'missing', signature: 'none', facts: {}, version: '' }
}

/** `n` names spread evenly over a sorted list, so the sample is not twelve variants of one zone. */
export function spread(names: readonly string[], n: number): string[] {
  if (names.length <= n) return [...names]
  const step = names.length / n
  return Array.from({ length: n }, (_, i) => names[Math.floor(i * step)])
}

async function probeMaps(root: string): Promise<GameFileReport> {
  const dir = join(root, MAPS_SUBDIR)
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => splitMapFileName(n) !== null).sort()
  } catch (err) {
    if (codeOf(err) === 'ENOENT' || codeOf(err) === 'ENOTDIR') return mapsHealth(null, '')
    throw err
  }
  const sample = { files: 0, records: 0, skipped: 0 }
  let newest = 0
  for (const name of spread(names, MAP_SAMPLE)) {
    const split = splitMapFileName(name)
    const got = split ? await readText(join(dir, name)) : null
    if (!split || !got) continue
    const parsed = parseMapText(got.text, split.layer)
    sample.files++
    sample.records += parsed.lines.count + parsed.points.length
    sample.skipped += parsed.skipped
    newest = Math.max(newest, Number(got.version.split('-')[1]) || 0)
  }
  return mapsHealth(sample, sample.files > 0 ? fileVersion(names.length, newest) : '')
}

async function probeUiSkin(root: string): Promise<GameFileReport> {
  for (const skin of [BASE_SKIN, FALLBACK_SKIN]) {
    const got = await readText(join(root, 'uifiles', skin, SKIN_XML))
    if (got?.text.trim() === '') return { id: 'uiSkin', status: 'pending', signature: 'empty', facts: {}, version: got.version }
    if (got) return uiSkinHealth(parseAnimationFrames(got.text).length, got.version)
  }
  return uiSkinHealth(null, '')
}

async function pfsHeader(path: string): Promise<{ header: PfsHeader; version: string } | null> {
  let handle
  try {
    handle = await open(path, 'r')
  } catch (err) {
    if (codeOf(err) === 'ENOENT') return null
    throw err
  }
  try {
    const st = await handle.stat()
    const head = new Uint8Array(8)
    const { bytesRead } = await handle.read(head, 0, 8, 0)
    return { header: { head: head.subarray(0, bytesRead), size: st.size }, version: fileVersion(st.size, st.mtimeMs) }
  } finally {
    await handle.close()
  }
}

async function probeModels(root: string): Promise<GameFileReport> {
  const archives: Record<string, PfsHeader | null> = {}
  let version = ''
  for (const name of MODEL_ARCHIVES) {
    const got = await pfsHeader(join(root, name))
    archives[name] = got?.header ?? null
    if (got && version === '') version = got.version
  }
  return modelsHealth(archives, version)
}

async function probeGlobalLoad(root: string): Promise<GameFileReport> {
  const got = await readText(join(root, 'Resources', 'GlobalLoad.txt'))
  if (!got) return globalLoadHealth(null, false, '')
  return globalLoadHealth(got.text, inspectLuclin(got.text, []).state !== 'anchor-missing', got.version)
}

async function probeEqclientIni(root: string): Promise<GameFileReport> {
  const got = await readText(join(root, 'eqclient.ini'))
  if (!got) return eqclientIniHealth(null, false, '')
  return eqclientIniHealth(got.text, eqWindowModeOf(got.text) !== 'unknown', got.version)
}

/**
 * Every reader's verdict, in `GAME_FILE_IDS` order (see `ProbeDeps` for the two the caller
 * supplies). An empty root (no install resolved at all) is every reader `missing`, without
 * touching the disk.
 */
export async function probeGameFiles(root: string, deps: ProbeDeps): Promise<GameFileReport[]> {
  if (root === '') {
    const ids: GameFileId[] = ['spellsUs', 'dbstrUs', 'maps', 'uiSkin', 'models', 'globalLoad', 'eqclientIni']
    return ids.map((id) => ({ id, status: 'missing', signature: 'none', facts: {}, version: '' }))
  }
  return Promise.all([
    guarded('spellsUs', deps.spellsUs),
    guarded('dbstrUs', () => probeDbstr(root, deps)),
    guarded('maps', () => probeMaps(root)),
    guarded('uiSkin', () => probeUiSkin(root)),
    guarded('models', () => probeModels(root)),
    guarded('globalLoad', () => probeGlobalLoad(root)),
    guarded('eqclientIni', () => probeEqclientIni(root))
  ])
}
