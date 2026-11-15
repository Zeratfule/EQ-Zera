// preload/uiSkin.ts — the in-game UI skin card's bridge, as one spread into `api` (index.ts is at
// the factoring ceiling). No method takes or returns a path: main resolves the game folder itself.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { UiSkinBuildResult, UiSkinProgress, UiSkinView } from '../shared/uiSkin'

export const uiSkinBridge = {
  /** Built? Out of date after a game patch? Accepted? Building right now? */
  getUiSkin: (): Promise<UiSkinView> => ipcRenderer.invoke(IPC.uiSkinStatus),
  /** Remember that the player accepted the use-at-your-own-risk notice. */
  acceptUiSkin: (): Promise<UiSkinView> => ipcRenderer.invoke(IPC.uiSkinAccept),
  /** Build or rebuild uifiles/EQZera from the game's default skin. */
  buildUiSkin: (): Promise<UiSkinBuildResult> => ipcRenderer.invoke(IPC.uiSkinBuild),
  /** Delete uifiles/EQZera (only a folder EQ Zera wrote). */
  removeUiSkin: (): Promise<UiSkinView> => ipcRenderer.invoke(IPC.uiSkinRemove),
  /** Build progress pushes; returns the unsubscribe. */
  onUiSkinProgress: (cb: (p: UiSkinProgress) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: UiSkinProgress): void => cb(p)
    ipcRenderer.on(IPC.onUiSkinProgress, listener)
    return () => ipcRenderer.removeListener(IPC.onUiSkinProgress, listener)
  }
}
