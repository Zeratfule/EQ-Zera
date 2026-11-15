// IPC: EverQuest Legends patch notes (src/main/patchNotes). Six channels, every argument
// re-validated in main: a page name must pass PAGE_NAME_RE before it can address the cache, and
// the switch takes a boolean or nothing.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  checkPatchNotes,
  dismissPatchNotesNotice,
  loadedPatchNotesView,
  markPatchNoteRead,
  patchNoteArticle,
  patchNotesView
} from '../patchNotes'
import { setPatchNotesEnabled } from '../storePatchNotes'
import { sendToMain } from '../windows'

export function registerPatchNotesIpc(): void {
  ipcMain.handle(IPC.patchNotesGet, () => loadedPatchNotesView())
  ipcMain.handle(IPC.patchNotesArticle, (_e, pageName: unknown) => patchNoteArticle(pageName))
  ipcMain.handle(IPC.patchNotesCheck, () => checkPatchNotes())
  ipcMain.handle(IPC.patchNotesMarkRead, (_e, pageName: unknown) => markPatchNoteRead(pageName))
  ipcMain.handle(IPC.patchNotesSetEnabled, (_e, enabled: unknown) => {
    setPatchNotesEnabled(enabled)
    const view = patchNotesView()
    sendToMain(IPC.onPatchNotes, view)
    return view
  })
  ipcMain.handle(IPC.patchNotesDismissNotice, () => dismissPatchNotesNotice())
}
