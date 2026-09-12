// ---- away alerts (src/shared/awayAlerts.ts) ----
//
// Three doors onto one preference: read everything the card draws, replace the whole preference,
// and send one sample post now.
//
// IT STAYS SMALL ON PURPOSE, like ./discord.ts beside it: the filter is in `shared/awayAlerts.ts`,
// the storage in `../storeAwayAlerts.ts`, the batching, the timer and the post in
// `../awayAlerts.ts`. What is left here is the three doors.
//
// NOTHING HERE VALIDATES ANYTHING ITSELF, and that is the point rather than an omission. `setAwayAlertsPrefs`
// runs the renderer's object through the SAME filter the store reader runs a file through
// (`sanitizeAwayAlertsPrefs`), so a patch from the renderer and a hand-edited settings file are
// held to one standard and there is no second opinion to keep in step.
//
// NO TOKEN, NO URL, NO HOST. The view carries a channel ID and, when something went wrong, one of
// `share/discord.ts`'s own failure sentences. The `catch` below therefore logs a FIXED string and
// never the thrown value: a thrown error from anywhere near a post could carry the webhook, and
// that is a secret (share/discord.ts header item 6).

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { logError } from '../errorLog'
import { DISCORD_ERR } from '../share/discord'
import { awayAlertsView, sendAwayTest, setAwayAlertsPrefs, type AwayAlertsView } from '../awayAlerts'

export type { AwayAlertsView }

export function registerAwayAlertsIpc(): void {
  ipcMain.handle(IPC.awayAlertsGet, (): AwayAlertsView => awayAlertsView())
  ipcMain.handle(IPC.awayAlertsSet, (_e, prefs: unknown): AwayAlertsView => setAwayAlertsPrefs(prefs))
  ipcMain.handle(IPC.awayAlertsTest, async () => {
    try {
      return await sendAwayTest()
    } catch {
      logError('main:awayAlerts', 'the away-alerts test post failed')
      return { ok: false, error: DISCORD_ERR.offline }
    }
  })
}
