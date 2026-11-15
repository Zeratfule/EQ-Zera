// files.ts - the disk half of "Luclin character models". Electron-free: every path is passed in,
// so the tests run it against temp folders and never the real game install.
//
// THE FILE IS READ AND WRITTEN AS LATIN-1, which in Node is a byte-for-byte mapping: whatever the
// client's file holds (a BOM, a stray high byte) comes back out unchanged. The lines we add are
// plain ASCII.
//
// TWO BACKUPS, both of the file WITHOUT our lines (the "pristine" text - stripping is exact, so a
// file somebody already patched by hand still yields the original):
//   * `<userData>\luclin-models\GlobalLoad.pristine.txt`, refreshed on every apply, so it tracks
//     what LaunchPad's latest patch shipped;
//   * `Resources\GlobalLoad.txt.eqzera-backup` beside the original, written ONCE and never
//     replaced - the copy a player can find and restore by hand.
// Revert never restores a backup: it strips our lines from the CURRENT file, because a backup
// older than the last game patch would put an old file back.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { availableRaces, desiredLines, inspectLuclin, patchLuclin, stripLuclin, type Inspection } from './globalLoad'
import type { GlobalLoadState } from '../../shared/luclinModels'

export const GAME_EXE = 'eqgame.exe'
export const LAUNCHER_EXE = 'LaunchPad.exe'
export const BESIDE_BACKUP = 'GlobalLoad.txt.eqzera-backup'
export const USERDATA_DIR = 'luclin-models'
export const USERDATA_BACKUP = 'GlobalLoad.pristine.txt'

export function globalLoadPath(root: string): string {
  return join(root, 'Resources', 'GlobalLoad.txt')
}

/** The file's text, or null when it is not there. Throws on any other read failure. */
export function readGlobalLoad(root: string): string | null {
  try {
    return readFileSync(globalLoadPath(root), 'latin1')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Which archives this install has, as one directory listing (case-insensitive, like Windows).
 * An unreadable root has none, which makes every race unavailable rather than guessed at.
 */
export function archiveProbe(root: string): (file: string) => boolean {
  let names: Set<string>
  try {
    names = new Set(readdirSync(root).map((n) => n.toLowerCase()))
  } catch {
    names = new Set()
  }
  return (file) => names.has(file.toLowerCase())
}

export interface DiskStatus {
  state: GlobalLoadState
  appliedRaces: string[]
  availableRaces: string[]
  gamePresent: boolean
  launcherPresent: boolean
}

/** Read the file and say where it stands for these races. Never writes. */
export function diskStatus(root: string, races: readonly string[]): DiskStatus {
  const has = archiveProbe(root)
  const base = {
    availableRaces: availableRaces(has),
    gamePresent: has(GAME_EXE),
    launcherPresent: has(LAUNCHER_EXE)
  }
  const text = readGlobalLoad(root)
  if (text === null) return { ...base, state: 'file-missing', appliedRaces: [] }
  const seen: Inspection = inspectLuclin(text, desiredLines(races, has))
  return { ...base, ...seen }
}

/** Replace the file in one step where the OS allows it; a direct write where it does not. */
function writeAtomically(path: string, text: string): void {
  const tmp = `${path}.eqzera-tmp`
  writeFileSync(tmp, text, 'latin1')
  try {
    renameSync(tmp, path)
  } catch {
    writeFileSync(path, text, 'latin1')
    try {
      renameSync(tmp, `${tmp}.stale`)
    } catch {
      /* the temp file is harmless; the real write above is what mattered */
    }
  }
}

function keepBackups(root: string, userData: string, pristine: string): void {
  const beside = join(root, 'Resources', BESIDE_BACKUP)
  if (!existsSync(beside)) writeFileSync(beside, pristine, 'latin1')
  const dir = join(userData, USERDATA_DIR)
  mkdirSync(dir, { recursive: true })
  const mine = join(dir, USERDATA_BACKUP)
  if (!existsSync(mine) || readFileSync(mine, 'latin1') !== pristine) writeFileSync(mine, pristine, 'latin1')
}

export type DiskOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'file-missing' | 'anchor-missing' | 'no-races' }

/** Write exactly the chosen races' lines (backing up first). `changed` is false when it already was. */
export function applyOnDisk(root: string, races: readonly string[], userData: string): DiskOutcome {
  const text = readGlobalLoad(root)
  if (text === null) return { ok: false, reason: 'file-missing' }
  const desired = desiredLines(races, archiveProbe(root))
  if (desired.length === 0) return { ok: false, reason: 'no-races' }
  const next = patchLuclin(text, desired)
  if (next === null) return { ok: false, reason: 'anchor-missing' }
  if (next === text) return { ok: true, changed: false }
  keepBackups(root, userData, stripLuclin(text))
  writeAtomically(globalLoadPath(root), next)
  return { ok: true, changed: true }
}

/** Remove exactly our lines from the current file. `changed` is false when there were none. */
export function revertOnDisk(root: string): DiskOutcome {
  const text = readGlobalLoad(root)
  if (text === null) return { ok: false, reason: 'file-missing' }
  const next = stripLuclin(text)
  if (next === text) return { ok: true, changed: false }
  writeAtomically(globalLoadPath(root), next)
  return { ok: true, changed: true }
}
