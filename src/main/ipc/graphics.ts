// IPC: the two GRAPHICS COMPATIBILITY switches (JOS-40 — shared/graphicsPrefs.ts).
//
// Three channels (two of them JOS-40's), and what is interesting about the pair is what they
// DON'T do. Every other prefs
// setter in this folder brings the running session into line with the write — the perf sampler
// starts, the presence effects refresh. Neither of these can, and neither pretends to:
//
//   safeMode        — `app.disableHardwareAcceleration()` is only accepted before Electron's
//                     `ready` event, so this session's renderer is already drawn the way it is
//                     drawn. The composition root reads the stored value at module scope on the
//                     NEXT launch (src/main/graphics.ts), which is what the label promises.
//   opaqueOverlays  — a BrowserWindow's transparency is fixed at construction, so it lands when
//                     an overlay is next opened (windows.ts reads it there).
//
// A setter that quietly re-created five overlay windows to make itself look instant would be
// choosing a lie over a sentence in a label.
//
// VALIDATED AT THE HANDLER, never trusted because today's only caller is the app's own UI (the
// `sounds:getData` rule). The patch runs through `shared/graphicsPrefs.ts` — the same normalizer
// the store reader and the 10→11 migration use — so a renderer, a hand-edited file and a
// migration cannot end up with three ideas of what a valid switch is.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { getGraphicsPrefs, setGraphicsPrefs } from '../store'
import { graphicsEnvironment } from '../wine'
import type { GraphicsPrefs } from '../../shared/graphicsPrefs'

/** A patch is a plain object or it is nothing — anything else merges as "no fields given". The
 *  FIELD types are not checked here on purpose: `normalizeGraphicsPrefs` takes `unknown` per
 *  field and is the one place that decides what each one may be (the presence.ts precedent). */
function patchOf(value: unknown): Partial<GraphicsPrefs> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value
}

export function registerGraphicsIpc(): void {
  ipcMain.handle(IPC.graphicsPrefsGet, () => getGraphicsPrefs())
  ipcMain.handle(IPC.graphicsPrefsSet, (_e, patch: unknown) => setGraphicsPrefs(patchOf(patch)))
  // The third channel is READ-ONLY and describes the machine, not a setting (JOS-31). It exists so
  // the Preferences card can say WHY a switch it did not set is on — a compatibility mode that
  // engages silently is indistinguishable, from the user's chair, from the app being broken in a
  // new way.
  ipcMain.handle(IPC.graphicsEnvGet, () => graphicsEnvironment())
}
