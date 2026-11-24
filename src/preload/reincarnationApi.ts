// preload/reincarnationApi.ts — the REINCARNATION RECORD's two methods, spread into `api` (the
// characterApi.ts arrangement: index.ts sits at its max-lines ceiling).

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { ReincarnationLife } from '../shared/reincarnation'
import type { ProgressState } from '../shared/types'

export const reincarnationApi = {
  /**
   * Merge confirmed lives the log showed into the active character's record. `who` is the
   * character the caller was folding; main refuses (null) when it is no longer the active one.
   */
  recordReincarnations: (
    who: { name: string; server: string },
    lives: ReincarnationLife[]
  ): Promise<ProgressState | null> => ipcRenderer.invoke(IPC.recordReincarnations, who, lives),
  /** State one class or race's reincarnation count by hand, or take it back with `null`. */
  setReincarnationCount: (
    component: 'class' | 'race',
    name: string,
    count: number | null
  ): Promise<ProgressState | null> => ipcRenderer.invoke(IPC.setReincarnationCount, component, name, count)
}
