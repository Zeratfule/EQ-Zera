// preload/awayAlerts.ts — AWAY ALERTS, as one spread into `api` (src/shared/awayAlerts.ts).
//
// Split out the way discordApi.ts and windows.ts are: src/preload/index.ts sits at the measured
// 400-code-line ceiling and the house answer to that is a file rather than three more lines there.
//
// THREE METHODS AND NO SECRET. The view carries a channel ID, a preference and - when something
// went wrong - one of main's own failure sentences; nothing here ever holds a webhook, and nothing
// here fetches (`connect-src 'self'` makes that structurally impossible). The post is main's, and
// its origin is dark under `EQ_E2E` like every other Discord post in this app.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { AwayAlertsPrefs, AwayHealth } from '../shared/awayAlerts'

/** Everything the Preferences card draws, in one read. Mirrors `src/main/awayAlerts.ts`. */
export interface AwayAlertsView extends AwayHealth {
  prefs: AwayAlertsPrefs
  /** How long this machine has been without keyboard or mouse input, right now. */
  idleSeconds: number
}

export const awayAlertsApi = {
  /** The preference, the last attempt's outcome, and the live idle reading. */
  getAwayAlerts: (): Promise<AwayAlertsView> => ipcRenderer.invoke(IPC.awayAlertsGet),
  /** Replace the whole preference. MAIN RE-VALIDATES, so the reply is what was actually stored. */
  setAwayAlerts: (prefs: AwayAlertsPrefs): Promise<AwayAlertsView> =>
    ipcRenderer.invoke(IPC.awayAlertsSet, prefs),
  /** Post one sample now, so a channel can be watched working before anybody walks away. */
  testAwayAlerts: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.awayAlertsTest)
}
