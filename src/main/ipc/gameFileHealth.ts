// IPC: game-file health (src/main/gameFileHealth). Two channels and a push. The dismiss argument is
// re-validated in main (strings only, capped, key-shaped in the store accessor). Registering also
// schedules the launch's one check, so nothing in main/index.ts has to remember to start it.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { dismissGameFileNotice, gameFileHealthView, scheduleGameFileCheck } from '../gameFileHealth'

export function registerGameFileHealthIpc(): void {
  ipcMain.handle(IPC.gameFileHealthGet, () => gameFileHealthView())
  ipcMain.handle(IPC.gameFileHealthDismiss, (_e, keys: unknown) => dismissGameFileNotice(keys))
  scheduleGameFileCheck()
}
