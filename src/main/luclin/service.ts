// service.ts - "Luclin character models" and the Play button, as the app runs them.
//
// The disk work is ./files.ts (Electron-free, temp-folder tested); this file adds the four facts
// only a running app has: WHERE the game is (`effectiveEqRoot`, never a hard-coded path), whether
// it is RUNNING, what the user CHOSE (the store), and how to START things.
//
// THE ONE LAW: never write GlobalLoad.txt while an EverQuest client is running. The client reads
// the file once, at startup, so a write then changes nothing for the running game and only muddies
// what the next launch sees. Apply, revert and the silent re-apply before Play all refuse.
//
// PLAY means two things, chosen by the card's switch:
//   * Luclin models ON  - re-apply the chosen races if LaunchPad put the file back, then start
//     `eqgame.exe patchme` (cwd = EQ root). `patchme` is what stops the client asking for the
//     launcher, so the edit survives.
//   * Luclin models OFF - start LaunchPad.exe, the normal way in, so the button is useful to all.
// Both are started by ./launch.ts (the one spawning module): detached, explicit args, no shell.

import { app, shell } from 'electron'
import { closeSync, openSync } from 'fs'
import { dirname, join } from 'path'
import { E2E } from '../e2e'
import { logError, logInfo } from '../errorLog'
import { effectiveEqRoot } from '../log/config'
import { getLuclinPrefs, setLuclinPrefs } from '../storeLuclin'
import { GAME_EXE, applyOnDisk, diskStatus, revertOnDisk, type DiskOutcome } from './files'
import { launchFromEqRoot } from './launch'
import type { LuclinRefusal, LuclinResult, LuclinStatus, PlayKind, PlayResult } from '../../shared/luclinModels'

export const SHORTCUT_NAME = 'EverQuest Legends (Luclin models)'
/** The argument a desktop shortcut passes to EQ Zera: re-apply, then start the game. */
export const PLAY_ARG = '--play'

const MESSAGES: Record<LuclinRefusal, string> = {
  running:
    'EverQuest is already running. The game reads this file when it starts, so close it first.',
  'file-missing': 'Could not find Resources\\GlobalLoad.txt in your EverQuest folder.',
  'anchor-missing':
    'GlobalLoad.txt does not have the line this edit goes after, so nothing was changed. A game patch may have changed the file.',
  'no-races': 'Pick at least one race whose models this install has.',
  'game-missing': 'Could not find eqgame.exe in your EverQuest folder.',
  'launcher-missing': 'Could not find LaunchPad.exe in your EverQuest folder.',
  'write-failed': 'Could not write GlobalLoad.txt. Check the file is not read-only.',
  'launch-failed': 'Could not start the game.',
  unsupported: 'Desktop shortcuts are only available on Windows.',
  'not-accepted': 'Accept the Use at your own risk notice in EQ Zera first (Preferences, Game, Luclin character models).'
}

/**
 * Is THIS install's EverQuest client running? Asked of the file system, in process, with no
 * process enumeration and nothing launched (tests/noChildProcess.test.mts): Windows refuses to
 * open a running executable for writing (EBUSY, measured 2026-11-15 on a copied node.exe: idle
 * opens, running EBUSY, exited opens). The open writes nothing. Any other failure (no permission,
 * no file) answers false: the refusal guards a no-op edit, not a dangerous one, so it fails open.
 * Under the e2e harness the spec says instead, through `EQ_LUCLIN_E2E_RUNNING`.
 */
export function isEqRunning(root: string = effectiveEqRoot()): Promise<boolean> {
  if (E2E) return Promise.resolve(process.env.EQ_LUCLIN_E2E_RUNNING === '1')
  if (process.platform !== 'win32') return Promise.resolve(false)
  try {
    closeSync(openSync(join(root, GAME_EXE), 'r+'))
    return Promise.resolve(false)
  } catch (err) {
    return Promise.resolve((err as NodeJS.ErrnoException).code === 'EBUSY')
  }
}

/** Where things stand. Recognises a hand-applied file as applied, so its later revert is noticed. */
export async function luclinStatus(): Promise<LuclinStatus> {
  const root = effectiveEqRoot()
  let prefs = getLuclinPrefs()
  const disk = diskStatus(root, prefs.races)
  if (disk.state === 'applied' && !prefs.applied) prefs = setLuclinPrefs({ applied: true })
  return {
    ...disk,
    root,
    reverted: prefs.applied && disk.state === 'not-applied',
    eqRunning: await isEqRunning(root)
  }
}

function refuse(reason: LuclinRefusal, status: LuclinStatus | null): LuclinResult {
  return { ok: false, reason, message: MESSAGES[reason], status }
}

/** Run one disk change behind the running check, and record the user's intent when it lands. */
async function change(
  run: (root: string) => DiskOutcome,
  applied: boolean,
  okMessage: string
): Promise<LuclinResult> {
  const before = await luclinStatus()
  if (before.eqRunning) return refuse('running', before)
  let outcome: DiskOutcome
  try {
    outcome = run(before.root)
  } catch (err) {
    logError('main:luclin', err)
    return refuse('write-failed', before)
  }
  if (!outcome.ok) return refuse(outcome.reason, before)
  setLuclinPrefs({ applied })
  if (outcome.changed) logInfo(`[everquest-companion] luclin: GlobalLoad.txt ${applied ? 'applied' : 'reverted'}`)
  return { ok: true, status: await luclinStatus(), message: okMessage }
}

export async function applyLuclin(): Promise<LuclinResult> {
  if (!getLuclinPrefs().riskAccepted) return refuse('not-accepted', await luclinStatus())
  const userData = app.getPath('userData')
  return change(
    (root) => applyOnDisk(root, getLuclinPrefs().races, userData),
    true,
    'Luclin models applied. Start the game from Play or the shortcut to keep them.'
  )
}

export function revertLuclin(): Promise<LuclinResult> {
  return change((root) => revertOnDisk(root), false, 'Classic models restored.')
}

/** Re-apply the chosen races if they are not in place (silently), then start `eqgame.exe patchme`. */
export async function playLuclin(): Promise<PlayResult> {
  const kind: PlayKind = 'luclin'
  const status = await luclinStatus()
  if (status.eqRunning) return { ...refuse('running', status), message: 'EverQuest is already running.', kind }
  if (!status.gamePresent) return { ...refuse('game-missing', status), kind }
  if (!getLuclinPrefs().riskAccepted) return { ...refuse('not-accepted', status), kind }
  if (status.state !== 'applied') {
    const applied = await applyLuclin()
    if (!applied.ok) return { ...applied, kind }
  }
  const started = await launchFromEqRoot(status.root, 'game')
  if (!started) return { ...refuse('launch-failed', status), kind }
  logInfo('[everquest-companion] luclin: started eqgame.exe patchme')
  return { ok: true, status: await luclinStatus(), message: 'Starting EverQuest with Luclin models.', kind }
}

/** Start LaunchPad.exe: the normal way in, and the way to take a game patch. */
export async function openLauncher(): Promise<PlayResult> {
  const kind: PlayKind = 'launcher'
  const status = await luclinStatus()
  if (!status.launcherPresent) return { ...refuse('launcher-missing', status), kind }
  const started = await launchFromEqRoot(status.root, 'launcher')
  if (!started) return { ...refuse('launch-failed', status), kind }
  return { ok: true, status, message: 'Starting the EverQuest launcher.', kind }
}

/** The Play button: Luclin models when they are switched on, the normal launcher otherwise. */
export async function play(): Promise<PlayResult> {
  if (getLuclinPrefs().enabled) return playLuclin()
  if (await isEqRunning()) {
    return { ...refuse('running', null), message: 'EverQuest is already running.', kind: 'launcher' }
  }
  return openLauncher()
}

/**
 * A desktop shortcut that starts EQ Zera with `--play`: a running EQ Zera receives it through the
 * single-instance lock, a closed one starts and handles it at boot. Either way the models are
 * re-applied before the game starts, which a shortcut straight to eqgame.exe could not do.
 */
export async function createDesktopShortcut(): Promise<LuclinResult> {
  if (process.platform !== 'win32') return refuse('unsupported', null)
  const status = await luclinStatus()
  const exe = process.execPath
  const args = app.isPackaged ? PLAY_ARG : `"${app.getAppPath()}" ${PLAY_ARG}`
  const link = join(app.getPath('desktop'), `${SHORTCUT_NAME}.lnk`)
  const ok = shell.writeShortcutLink(link, 'create', {
    target: exe,
    args,
    cwd: dirname(exe),
    description: 'Start EverQuest Legends with Luclin character models (via EQ Zera)',
    ...(status.gamePresent ? { icon: join(status.root, GAME_EXE), iconIndex: 0 } : {})
  })
  if (!ok) return { ...refuse('write-failed', status), message: 'Could not create the desktop shortcut.' }
  return { ok: true, status, message: `Shortcut "${SHORTCUT_NAME}" added to your desktop.` }
}

/**
 * At startup and whenever the card opens: when the user asked to keep it applied and LaunchPad
 * put the file back, re-apply. Only then - otherwise the card offers Re-apply. Answers the status
 * afterwards; never throws.
 */
export async function luclinCheck(): Promise<LuclinStatus | null> {
  try {
    const prefs = getLuclinPrefs()
    const status = await luclinStatus()
    if (!prefs.enabled || !status.reverted) return status
    if (!prefs.keepApplied) {
      logInfo('[everquest-companion] luclin: the launcher reverted GlobalLoad.txt (Re-apply offered)')
      return status
    }
    const r = await applyLuclin()
    logInfo(`[everquest-companion] luclin: keep-applied re-apply ${r.ok ? 'done' : `refused (${r.reason})`}`)
    return r.status ?? status
  } catch (err) {
    logError('main:luclin', err)
    return null
  }
}

/** Does this argv ask for Play (a desktop shortcut)? */
export function argvWantsPlay(argv: readonly string[]): boolean {
  return argv.includes(PLAY_ARG)
}
