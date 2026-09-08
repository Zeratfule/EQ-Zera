// questsApi.ts — the slice of the bridge that is about THE QUEST TRACKER (EQ Zera).
//
// A separate file for FILE MASS, not for scope — the planner.ts/roster.ts/windows.ts pattern and
// the rule those files state: `src/preload/index.ts` sits at the measured 400-code-line ceiling and
// the answer is to SPLIT rather than to ratchet. This object is spread into the bridge, so both
// methods below are ordinary members of the one `window.eq` surface and no renderer call site has
// to know where they were defined.
//
// Two calls over ONE small per-character document. Nothing here rejects: an unreadable stored value
// is an empty tracker, never an error.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { QuestPins } from '../shared/questPins'

export const questsApi = {
  /** The active character's TRACKED QUESTS — `[]` when it tracks none. */
  getQuestPins: (): Promise<QuestPins> => ipcRenderer.invoke(IPC.questPinsGet),

  /**
   * Replace the whole tracker for the active character. Main re-validates every entry — the page
   * title, the hand-ticked step indexes, the completion instant — and silently drops what does not
   * fit, then RETURNS what it actually stored, so a capped or stripped write is visible to the
   * caller rather than a silent divergence.
   */
  setQuestPins: (pins: QuestPins): Promise<QuestPins> => ipcRenderer.invoke(IPC.questPinsSet, pins)
}
