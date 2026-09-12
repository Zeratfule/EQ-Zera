// IPC: POST CELEBRATIONS TO DISCORD — the two preference doors, and deliberately nothing else.
//
// There is no `post` channel here and there must not be one. A celebration is posted by MAIN, off
// the one function every card already passes through (`sendToToastOverlay`, src/main/toast.ts), so
// a renderer cannot ask this app to put a message in somebody's channel — it can only say whether,
// where, and which kinds. That is the same shape the alert system has: the renderer owns the
// preference, main owns the event.
//
// VALIDATED AT THE HANDLER, never trusted because today's only caller is the app's own UI (the
// `sounds:getData` rule). The patch runs through `shared/celebrationPost.ts`'s normalizer — the
// same one the store reader uses — so an unknown kind, a channel id outside the closed class or a
// patch that is not an object at all cannot reach the store.
//
// NO TOKEN CROSSES EITHER DOOR. The view is `{ prefs, lastError?, lastErrorAt? }`: a boolean, a
// webhook id the renderer already holds from `discord:listChannels`, a list of kinds, and a
// sentence main wrote.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { celebrationPostView, setCelebrationPostPrefs } from '../celebrationPost'
import type { CelebrationPostView } from '../../shared/celebrationPost'

export function registerCelebrationPostIpc(): void {
  ipcMain.handle(IPC.celebrationPostGet, (): CelebrationPostView => celebrationPostView())
  ipcMain.handle(
    IPC.celebrationPostSet,
    (_e, patch: unknown): CelebrationPostView => setCelebrationPostPrefs(patch)
  )
}
