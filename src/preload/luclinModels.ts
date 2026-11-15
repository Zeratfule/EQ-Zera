// preload/luclinModels.ts - "Luclin character models" and the Play button, spread into `api` in
// index.ts like ./graphics.ts. Nothing here takes a path: main finds the EQ folder itself.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { LuclinPrefs, LuclinResult, LuclinStatus, PlayResult } from '../shared/luclinModels'

export const luclinBridge = {
  getLuclinPrefs: (): Promise<LuclinPrefs> => ipcRenderer.invoke(IPC.luclinPrefsGet),
  /** Merge-patch; resolves to what was actually stored. */
  setLuclinPrefs: (patch: Partial<LuclinPrefs>): Promise<LuclinPrefs> =>
    ipcRenderer.invoke(IPC.luclinPrefsSet, patch),
  /** Read GlobalLoad.txt (re-applying a launcher revert when keep-applied is on). Null on a read failure. */
  checkLuclin: (): Promise<LuclinStatus | null> => ipcRenderer.invoke(IPC.luclinCheck),
  applyLuclin: (): Promise<LuclinResult> => ipcRenderer.invoke(IPC.luclinApply),
  revertLuclin: (): Promise<LuclinResult> => ipcRenderer.invoke(IPC.luclinRevert),
  /** Luclin models when switched on, LaunchPad otherwise. */
  playEverQuest: (): Promise<PlayResult> => ipcRenderer.invoke(IPC.luclinPlay),
  openEqLauncher: (): Promise<PlayResult> => ipcRenderer.invoke(IPC.luclinOpenLauncher),
  createLuclinShortcut: (): Promise<LuclinResult> => ipcRenderer.invoke(IPC.luclinShortcut),
  /** A Play started from the tray or a desktop shortcut finished. */
  onEverQuestPlayed: (cb: (r: PlayResult) => void): (() => void) => {
    const listener = (_e: unknown, r: PlayResult): void => cb(r)
    ipcRenderer.on(IPC.onLuclinPlayed, listener)
    return () => ipcRenderer.removeListener(IPC.onLuclinPlayed, listener)
  }
}
