// IPC: the REINCARNATION RECORD's two doors (shared/reincarnation.ts).
//
// `record` merges the confirmed lives the renderer's always-mounted recorder saw in the leveling
// snapshot; `setCount` is the Leveling tab's hand correction. Both push `onProgress`, the
// `setQuestTurnIns` arrangement, so every surface reading the record stays consistent.
//
// THE RENDERER IS UNTRUSTED: the store accessors sanitize, and `record` carries the character the
// renderer believed it was folding — a snapshot that crossed a character switch is refused rather
// than written into the new character's record.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { activeCharId } from '../session'
import { recordReincarnations, setReincarnationCount } from '../storeReincarnation'
import { sendToMain } from '../windows'

/** `characterId` (main/log/config.ts) for a renderer-supplied `{ name, server }`, or null. */
function idOf(who: unknown): string | null {
  if (typeof who !== 'object' || who === null) return null
  const { name, server } = who as Record<string, unknown>
  if (typeof name !== 'string' || typeof server !== 'string') return null
  return `${name}_${server}`.toLowerCase()
}

export function registerReincarnationIpc(): void {
  ipcMain.handle(IPC.recordReincarnations, (_e, who: unknown, lives: unknown) => {
    const charId = activeCharId()
    if (idOf(who) !== charId) return null
    const { progress, changed } = recordReincarnations(charId, lives)
    if (changed) sendToMain(IPC.onProgress, progress)
    return progress
  })
  ipcMain.handle(IPC.setReincarnationCount, (_e, component: unknown, name: unknown, count: unknown) => {
    if (component !== 'class' && component !== 'race') return null
    if (typeof name !== 'string') return null
    const n = count === null ? null : typeof count === 'number' ? count : NaN
    if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 99)) return null
    const progress = setReincarnationCount(activeCharId(), component, name, n)
    sendToMain(IPC.onProgress, progress)
    return progress
  })
}
