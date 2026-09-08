// IPC: THE QUEST TRACKER's door (EQ Zera).
//
// One per-character read/write pair over `ProgressState.questPins`, the `wishlist:get`/`:set`
// arrangement exactly. Nothing here touches the network, nothing rejects, and nothing invents: the
// tracker is a small list of wiki page titles and hand-ticked step indexes.
//
// THE RENDERER IS UNTRUSTED, here as everywhere. `sanitizeQuestPins` runs AT THE HANDLER, and again
// inside the store accessor — which is also the READ path's normalizer, so the store can never be
// reached by an unvalidated route and the second pass costs nothing (sanitizing is a fixed point).
//
// A SET PUSHES `onProgress`, the way `setQuestTurnIns` does and for the same reason: a tick made on
// one surface has to reach the tracked-quests list, the quest page and the always-mounted
// completion watch without any of them refetching, and without a race between them.
//
// The write RETURNS the stored list rather than void (the `setQuestTurnIns` shape rather than the
// `wishlist:set` one): the renderer folds its next edit onto what it sent, and handing back what
// was actually kept is how a capped or stripped write becomes visible instead of silently diverging.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { sanitizeQuestPins } from '../../shared/questPins'
import { activeCharId } from '../session'
import { getProgress } from '../store'
// The tracker's store accessors live in their own module — store.ts is at its 400-code-line
// ceiling, and this repo splits rather than ratchets (src/main/storeQuestPins.ts says why).
import { getQuestPins, setQuestPins } from '../storeQuestPins'
import { sendToMain } from '../windows'

export function registerQuestPinsIpc(): void {
  ipcMain.handle(IPC.questPinsGet, () => getQuestPins(activeCharId()))
  ipcMain.handle(IPC.questPinsSet, (_e, pins: unknown) => {
    const stored = setQuestPins(activeCharId(), sanitizeQuestPins(pins))
    sendToMain(IPC.onProgress, getProgress(activeCharId()))
    return stored
  })
}
