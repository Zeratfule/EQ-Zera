// gameFileHealth/index.ts — ONE CHECK A LAUNCH: did this build recognise the game's own files?
// The model and the notice rules are shared/gameFileHealth.ts; the reads are ./probe.ts. This file
// owns when the check runs, what is filed, and what the renderer is told.
//
// WHEN. A few seconds after the IPC is registered, so it never competes with the window's first
// paint, and once: a game patch is followed by a game launch, and the client files do not change
// under a running client (an empty or half-written file is the one exception, re-checked below).
// Nothing big runs on main: `spells_us.txt` is judged from the resist cache's small layout sidecar
// without loading the table, and `dbstr_us.txt` on the resist worker.
//
// WHAT IS FILED. An `unrecognised` verdict for a reader that matters to this player (the notice's
// own gate) goes through `logError` ONCE PER LAYOUT, ever (the key is
// persisted): one errors.log line with the counts, which the error report carries on as an
// `errorReport` named `GameFile<Reader>` with the layout signature as its `code`, so each reader is
// its own row and the signature is the first thing the developer reads. The message holds no path
// and no name (shared/gameFileHealth.ts `reportMessage`). A read failure (`error`) is an info line,
// not an alarm: it is not something an update fixes. `missing` says nothing at all; every feature
// already explains a missing install in its own place.
//
// WHAT THE PLAYER SEES. The notice (shared `gameFileNotice`), with GlobalLoad.txt only counted for a
// player who switched Luclin models on: an opt-in edit nobody asked for is no news to anybody else.

import { E2E } from '../e2e'
import { logError, logInfo } from '../errorLog'
import { effectiveEqRoot } from '../log/config'
import { spellsUsHealthNow } from '../resist/spellTable'
import { runResistWorker } from '../resist/spellsUsMeta'
import { getLuclinPrefs } from '../storeLuclin'
import { addGameFileKeys, gameFileKeys } from '../storeGameFileHealth'
import { sendToMain } from '../windows'
import { IPC } from '../../shared/ipc'
import {
  GAME_FILE_READERS,
  gameFileNotice,
  reportErrorName,
  reportKey,
  reportMessage,
  shouldReport,
  type GameFileHealthView,
  type GameFileId,
  type GameFileReport
} from '../../shared/gameFileHealth'
import { probeGameFiles } from './probe'

/** After the window's first paint, before anybody has gone looking for a resist estimate. */
const CHECK_DELAY_MS = E2E ? 500 : 4000

let reports: GameFileReport[] = []
let checked = false
let running: Promise<void> | null = null

function noticeable(id: GameFileId): boolean {
  if (id !== 'globalLoad') return true
  const prefs = getLuclinPrefs()
  return prefs.enabled || prefs.applied
}

export function gameFileHealthView(): GameFileHealthView {
  return { checked, reports, notice: checked ? gameFileNotice(reports, gameFileKeys('dismissed'), noticeable) : null }
}

/** File each newly seen unrecognised layout once (readers that matter to this player only), and note read failures. */
function file(found: readonly GameFileReport[]): void {
  const filed = gameFileKeys('reported')
  const fresh: string[] = []
  for (const r of found) {
    if (r.status === 'error') logInfo(`[gameFiles] ${GAME_FILE_READERS[r.id].label} could not be read (${r.signature})`)
    if (!shouldReport(r, filed, noticeable)) continue
    logError('main:gameFiles', { name: reportErrorName(r.id), code: r.signature, message: reportMessage(r) })
    fresh.push(reportKey(r))
  }
  if (fresh.length > 0) addGameFileKeys('reported', fresh)
}

/** `dbstr_us.txt` on the resist worker, so its 10 MB split never runs on main. */
async function dbstrOnWorker(path: string, version: string): Promise<GameFileReport | null> {
  return (await runResistWorker({ path, job: 'dbstr', version }))?.report ?? null
}

/**
 * A PENDING FILE IS LOOKED AT AGAIN. An empty or half-written file is a patcher mid-copy, so the
 * whole check re-runs after `RECHECK_MS`, a few times at most; whatever is still pending after
 * that stays pending (never noticed, never reported) until the next launch.
 */
const RECHECK_MS = E2E ? 1500 : 60_000
const MAX_RECHECKS = 3
let rechecks = 0

async function runCheck(): Promise<void> {
  try {
    reports = await probeGameFiles(effectiveEqRoot(), { spellsUs: spellsUsHealthNow, dbstr: dbstrOnWorker })
    file(reports)
  } catch (err) {
    logError('main:gameFiles', { message: 'game-file health check failed', err })
  }
  checked = true
  sendToMain(IPC.onGameFileHealth, gameFileHealthView())
  if (reports.some((r) => r.status === 'pending') && rechecks < MAX_RECHECKS) {
    rechecks++
    setTimeout(() => {
      running = runCheck()
    }, RECHECK_MS)
  }
}

/** Run the check now (once per launch plus pending re-checks; a second call waits for the current one). */
export function checkGameFiles(): Promise<void> {
  running ??= runCheck()
  return running
}

/** The notice was closed: every key it stood for stays dismissed until its file changes. */
export function dismissGameFileNotice(keys: unknown): GameFileHealthView {
  const valid = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string').slice(0, 16) : []
  if (valid.length > 0) addGameFileKeys('dismissed', valid)
  const view = gameFileHealthView()
  sendToMain(IPC.onGameFileHealth, view)
  return view
}

export function scheduleGameFileCheck(): void {
  setTimeout(() => void checkGameFiles(), CHECK_DELAY_MS)
}
