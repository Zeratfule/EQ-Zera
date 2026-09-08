// IPC: what's new (JOS-73) — two channels over ONE store key, and nothing else.
//
// The notes are committed source the bundler inlines into the renderer (src/shared/
// releaseNotes.ts), so they never travel over IPC and main never reads them. What main owns is
// the single fact the renderer cannot: which release this install has already been shown, which
// lives in the settings file and therefore behind this boundary.
//
// THE SETTER TAKES `null` ON PURPOSE. Clearing the key is not housekeeping — an absent key IS
// the fresh-install state, and it is one of the four states the DEV variant control drives.
// A setter that could only ever write forward could not simulate the state the app ships in.
//
// VALIDATED IN THE STORE, at the write (src/main/store.ts `setLastSeenNotesVersion`): a plain
// MAJOR.MINOR.PATCH or nothing. The check lives there rather than here because the store is what
// has to stay readable — a hand-edited file and a renderer call must meet the same rule.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { getLastSeenNotesVersion, setLastSeenNotesVersion } from '../store'

export function registerReleaseNotesIpc(): void {
  ipcMain.handle(IPC.releaseNotesSeenGet, () => getLastSeenNotesVersion())
  // Anything that is not a string reads as "clear it" — the fresh-install state — rather than
  // as a silent no-op, so the renderer's `null` and an accidental `undefined` mean the same
  // thing and neither leaves a stale stamp behind.
  ipcMain.handle(IPC.releaseNotesSeenSet, (_e, version: unknown) =>
    setLastSeenNotesVersion(typeof version === 'string' ? version : null)
  )
}
