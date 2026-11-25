// preload/gameFileHealthApi.ts — game-file health on the app bridge (src/main/gameFileHealth).
//
// Its own module, spread into `api` in index.ts, for the reason ./patchNotesApi.ts is one: that
// file sits near the 400-code-line ceiling. Main reads the files; these methods only read its
// verdict and record a dismissal.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { GameFileHealthView } from '../shared/gameFileHealth'

export const gameFileHealthBridge = {
  getGameFileHealth: (): Promise<GameFileHealthView> => ipcRenderer.invoke(IPC.gameFileHealthGet),
  /** Close the notice: every key it stood for (`GameFileNotice.dismissKeys`). */
  dismissGameFileNotice: (keys: readonly string[]): Promise<GameFileHealthView> =>
    ipcRenderer.invoke(IPC.gameFileHealthDismiss, keys),
  onGameFileHealth: (cb: (v: GameFileHealthView) => void): (() => void) => {
    const listener = (_e: unknown, v: GameFileHealthView): void => cb(v)
    ipcRenderer.on(IPC.onGameFileHealth, listener)
    return () => ipcRenderer.removeListener(IPC.onGameFileHealth, listener)
  }
}
