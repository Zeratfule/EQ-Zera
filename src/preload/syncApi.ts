// preload/syncApi.ts — SENDING YOUR SETTINGS TO YOUR OTHER PC, as one spread into `api`
// (docs/plans/settings-sync.md).
//
// Its own file the way discordApi.ts and characterApi.ts are: index.ts sits at its max-lines
// ceiling, and a feature's doors read better together than scattered through that list.
//
// NOTHING SECRET CROSSES EITHER WAY. The key lives inside the transfer code, which is minted in
// main and shown to the user; the decrypted payload - which may carry Discord webhook tokens - is
// held in main between `receiveSettings` and `applySettings` and never travels (src/main/ipc/
// sync.ts states why). What comes back here is a code, a `SharePreview`, counts and sentences.
//
// AND NOTHING HERE FETCHES. The renderer performs no network (`connect-src 'self'`); the origin is
// compiled in and dark under `EQ_E2E` (src/main/share/net.ts), which is what `syncAvailable`
// reports to the card.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { SyncApplyResult, SyncReceiveResult, SyncSendResult } from '../shared/settingsSync'

export const syncApi = {
  /** Is there a sync service in this build at all? False under a dark build - the card says so. */
  syncAvailable: (): Promise<boolean> => ipcRenderer.invoke(IPC.syncAvailable),
  /**
   * Encrypt this install's settings and upload the ciphertext. `includeDiscord` carries the
   * connected channels with them; it is OFF unless the user ticked the box, because a channel is a
   * credential. Answers the transfer code, or one sentence.
   */
  sendSettingsToPc: (ui: Record<string, string>, includeDiscord: boolean): Promise<SyncSendResult> =>
    ipcRenderer.invoke(IPC.syncSend, { ui, includeDiscord }),
  /** Fetch and decrypt a transfer, writing NOTHING - the same preview the paste box renders. */
  receiveSettingsFromPc: (code: string, ui: Record<string, string>): Promise<SyncReceiveResult> =>
    ipcRenderer.invoke(IPC.syncReceive, code, ui),
  /**
   * Apply the transfer that was just previewed, additively. `includeDiscord` is THIS machine's own
   * answer about the channels, independent of the sender's. Returns the localStorage writes to
   * perform, the merge counts, and how many channels were stored.
   */
  applySettingsFromPc: (
    code: string,
    ui: Record<string, string>,
    includeDiscord: boolean
  ): Promise<SyncApplyResult> => ipcRenderer.invoke(IPC.syncApply, { code, ui, includeDiscord })
}
