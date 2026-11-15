// preload/patchNotesApi.ts — the EverQuest Legends patch notes on the app bridge.
//
// Its own module, spread into `api` in index.ts, for the reason ./releaseNotes.ts is one: that file
// sits at the 400-code-line ceiling. Nothing here fetches; main does, and these methods only read
// its cache, ask it to check, and record what was read.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { PatchNotesView } from '../shared/patchNotes'
import type { PatchNoteArticle } from '../shared/patchNotesParse'

export const patchNotesBridge = {
  /** The list, the unread count, the launch notice and the switch, as main holds them. */
  getPatchNotes: (): Promise<PatchNotesView> => ipcRenderer.invoke(IPC.patchNotesGet),
  /** One downloaded note's body, or null when it has not been downloaded yet. */
  getPatchNote: (pageName: string): Promise<PatchNoteArticle | null> =>
    ipcRenderer.invoke(IPC.patchNotesArticle, pageName),
  /** "Check now". Resolves once the check is over. */
  checkPatchNotes: (): Promise<PatchNotesView> => ipcRenderer.invoke(IPC.patchNotesCheck),
  /** Mark one note read, or all of them with `null`. */
  markPatchNoteRead: (pageName: string | null): Promise<PatchNotesView> =>
    ipcRenderer.invoke(IPC.patchNotesMarkRead, pageName),
  /** The "check on launch" switch. */
  setPatchNotesEnabled: (enabled: boolean): Promise<PatchNotesView> =>
    ipcRenderer.invoke(IPC.patchNotesSetEnabled, enabled),
  /** The launch notice was seen. */
  dismissPatchNotesNotice: (): Promise<PatchNotesView> => ipcRenderer.invoke(IPC.patchNotesDismissNotice),
  /** Every change main makes to the view. Returns the unsubscribe. */
  onPatchNotes: (cb: (v: PatchNotesView) => void): (() => void) => {
    const listener = (_e: unknown, v: PatchNotesView): void => cb(v)
    ipcRenderer.on(IPC.onPatchNotes, listener)
    return () => ipcRenderer.removeListener(IPC.onPatchNotes, listener)
  }
}
