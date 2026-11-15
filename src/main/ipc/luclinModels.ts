// IPC: "Luclin character models" and the Play button (src/main/luclin/service.ts).
//
// Every handler takes nothing from the renderer but a prefs patch, and that patch is re-validated
// through `mergeLuclinPrefs` inside `setLuclinPrefs`. Paths are never renderer-supplied: the EQ
// folder comes from `effectiveEqRoot()` in main.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { getLuclinPrefs, setLuclinPrefs } from '../storeLuclin'
import { sendToMain } from '../windows'
import {
  applyLuclin,
  createDesktopShortcut,
  luclinCheck,
  openLauncher,
  play,
  playLuclin,
  revertLuclin
} from '../luclin/service'
import type { PlayResult } from '../../shared/luclinModels'

export function registerLuclinIpc(): void {
  ipcMain.handle(IPC.luclinPrefsGet, () => getLuclinPrefs())
  ipcMain.handle(IPC.luclinPrefsSet, (_e, patch: unknown) => setLuclinPrefs(patch))
  ipcMain.handle(IPC.luclinCheck, () => luclinCheck())
  ipcMain.handle(IPC.luclinApply, () => applyLuclin())
  ipcMain.handle(IPC.luclinRevert, () => revertLuclin())
  ipcMain.handle(IPC.luclinPlay, () => play())
  ipcMain.handle(IPC.luclinOpenLauncher, () => openLauncher())
  ipcMain.handle(IPC.luclinShortcut, () => createDesktopShortcut())
}

/** A Play from outside the window (tray, `--play`): run it and tell the window what happened. */
export function playFromOutside(which: 'play' | 'luclin'): void {
  const run: Promise<PlayResult> = which === 'luclin' ? playLuclin() : play()
  void run.then((r) => sendToMain(IPC.onLuclinPlayed, r))
}
