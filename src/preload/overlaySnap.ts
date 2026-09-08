// preload/overlaySnap.ts — the overlay-snapping preference, on the app bridge (JOS-217).
//
// Its own module, spread into `api` in index.ts, for the same reason `./uiScale.ts`, `./perf.ts`
// and `./graphics.ts` are: that file is at the repo's 400-code-line factoring ceiling and the
// answer to that is a split, not a widened threshold. On `window.eq` these two methods are
// indistinguishable from the ones written out there.
//
// The setter is a MERGE-PATCH and resolves to what was ACTUALLY stored — main re-validates through
// `shared/overlaySnap.ts`, the same normalizer the store reader uses — so the Preferences switch
// renders main's answer rather than assuming its own request landed.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { OverlaySnapPrefs } from '../shared/overlaySnap'

export const overlaySnapBridge = {
  /** The snap preference. OFF on every install that has never turned it on. */
  getOverlaySnap: (): Promise<OverlaySnapPrefs> => ipcRenderer.invoke(IPC.overlaySnapGet),
  /** Merge-patch it; the next drag of an already-open overlay obeys the new value. */
  setOverlaySnap: (patch: Partial<OverlaySnapPrefs>): Promise<OverlaySnapPrefs> =>
    ipcRenderer.invoke(IPC.overlaySnapSet, patch)
}
