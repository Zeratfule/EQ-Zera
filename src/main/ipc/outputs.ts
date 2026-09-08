// IPC: the `/outputfile` registry's one door (JOS-44).
//
// ONE CHANNEL, ONE SHAPE. Every surface fed by an EQ export command asks the same question —
// "what do I tell the player to type, why, and how old is the file?" — and gets the same
// `OutputFileStatus[]` back, in registry order. There is deliberately no per-kind channel and no
// path argument: the renderer does not name files, and it does not learn where the install root
// is (the trust boundary is unchanged — main owns `fs`).
//
// Nothing here rejects and nothing here caches. A kind whose command has never been run answers
// with `path: null, updatedAt: null`, which is the "not yet run" state a surface renders, not an
// error; and a fresh read per ask is the entire point (the file is one the player rewrites
// mid-session on purpose).

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { OutputFileStatus } from '../../shared/outputs/kinds'
import { outputStatuses } from '../outputs'
import { getActiveCharacter } from '../session'

export function registerOutputsIpc(): void {
  ipcMain.handle(IPC.outputsStatus, (): OutputFileStatus[] => {
    const character = getActiveCharacter()
    return outputStatuses({ name: character?.name, server: character?.server })
  })
}
