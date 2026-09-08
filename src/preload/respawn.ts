// preload/respawn.ts — the RESPAWN WATCH LIST half of the app bridge (JOS-194).
//
// Its own module, spread into `api` in index.ts, for the same reason `./buffTrust.ts` and
// `./graphics.ts` are: that file is at the repo's 400-code-line factoring ceiling and the answer
// to that is a split, not a widened threshold. On `window.eq` these two methods are
// indistinguishable from the ones written out there.
//
// THE CLOCKS THEMSELVES ARE NOT HERE. They are module state and ride the generic
// `getModuleSnapshot`/`onModuleDelta` transport under the id `respawn`, like every other fold in
// this app. What this bridge carries is the one input the log cannot supply.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { RespawnPrefs } from '../shared/respawn'

export const respawnBridge = {
  /** The persisted watch list. Auto-watch on, no explicit watches, by default. */
  getRespawn: (): Promise<RespawnPrefs> => ipcRenderer.invoke(IPC.respawnGet),
  /**
   * Replace the watch list; resolves to what was ACTUALLY stored (the handler re-normalizes).
   *
   * Takes effect on the call: the handler applies it to the running module and forces a push, so
   * a mob you start watching gets a row from its next death — and, if it already died during this
   * fold, from the death already in the model.
   */
  setRespawn: (prefs: RespawnPrefs): Promise<RespawnPrefs> => ipcRenderer.invoke(IPC.respawnSet, prefs),
  /**
   * "That sighting was the spawn — start this row's clock from it" (owner ruling, round 3).
   *
   * The ONE thing on this feature that changes a clock without a log line behind it, which is
   * exactly why it is a call and not a rule. Resolves to whether it took effect: false means the
   * row is gone or is no longer seen, i.e. the click lost a race with a death message.
   */
  confirmRespawnSighting: (rowId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.respawnConfirmSighting, rowId),
  /**
   * "Stop watching this mob" (owner ruling, round 4) — the other half of Watch, offered on the mob
   * itself wherever a surface names it rather than only in the global list.
   *
   * It takes a KEY and not a list on purpose: the callers are a clock row and a Recently-killed
   * entry, each of which knows one mob, and the handler is the only thing that rewrites the list.
   * Resolves to whether anything was watching that name; false is a no-op, not an error.
   */
  unwatchRespawn: (key: string): Promise<boolean> => ipcRenderer.invoke(IPC.respawnUnwatch, key)
}
