// ---- sending your settings to another PC (docs/plans/settings-sync.md) ----
//
// Four doors over `../share/sync.ts`, and this file's whole job is the wiring plus ONE piece of
// state: the decrypted payload between a preview and an apply.
//
// ---------------------------------------------------------------------------
// WHY THE PAYLOAD IS HELD HERE INSTEAD OF ROUND-TRIPPED
// ---------------------------------------------------------------------------
// A transfer can carry Discord channels, and a channel carries the webhook token that posts to
// somebody's server. Handing the renderer the decrypted payload so it could hand it back on Apply
// would put that token in the DOM, in a devtools panel and in any crash report - for no gain, since
// the renderer has nothing to do with it. So the preview crosses the boundary and the payload stays
// here, keyed by the transfer's own service code, exactly as `character:shareLink` keeps the delete
// token it never forwards.
//
// ONE SLOT, not a cache: this is a person pressing Receive and then Apply, so the interesting
// number of pending transfers is one. A second receive replaces the first, and an apply consumes
// what it applied - a payload that has been imported is not a thing to keep holding.
//
// THE BOX IS TICKED TWICE, INDEPENDENTLY. The sender says whether the channels travel; the receiver
// says whether they are stored. Both default to FALSE at this handler, so an argument the renderer
// omits - or a `true` that is not a boolean - never stores a credential.

import { app, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { SYNC_ERROR, type SyncApplyResult, type SyncReceiveResult } from '../../shared/settingsSync'
import { applyShare, exportSettingsString, previewShare } from '../share'
import { addDiscordChannel, listDiscordChannels } from '../storeDiscord'
import { pushAppKnowledge } from '../dataServer/definePush'
import {
  applyReceivedSettings,
  receiveSettings,
  sendSettings,
  syncAvailable,
  type SyncDeps
} from '../share/sync'
import { parseTransferCode, type SyncPayload } from '../share/syncCrypto'

/** The real seams. `fetch` is the global here and injected everywhere else, so tests need none. */
const deps: SyncDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  exportSettings: (ui) => exportSettingsString(app.getVersion(), ui),
  previewSettings: (text, ui) => previewShare(text, ui),
  applySettings: (text, ui) => applyShare(text, ui),
  listChannels: () => listDiscordChannels(),
  addChannel: (channel) => addDiscordChannel(channel)
}

/** The transfer this install has fetched and not yet applied. See the header. */
let pending: { code: string; payload: SyncPayload } | null = null

/** A renderer argument that is meant to be the ui pref map. Anything else is an empty one. */
function uiOf(raw: unknown): Record<string, string> {
  return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {}
}

/** …and one that is meant to be a tick box. Absent, or anything but `true`, is OFF. */
function includeDiscordOf(raw: unknown): boolean {
  return raw === true
}

/** The service code inside whatever the renderer sent, or '' when it is not a transfer code. */
function serviceCodeOf(raw: unknown): string {
  return parseTransferCode(raw)?.code ?? ''
}

export function registerSyncIpc(): void {
  ipcMain.handle(IPC.syncAvailable, () => syncAvailable())

  ipcMain.handle(IPC.syncSend, async (_e, req: unknown) => {
    const r = (req ?? {}) as Record<string, unknown>
    return sendSettings({ ui: uiOf(r.ui), includeDiscord: includeDiscordOf(r.includeDiscord) }, deps)
  })

  ipcMain.handle(IPC.syncReceive, async (_e, code: unknown, ui: unknown): Promise<SyncReceiveResult> => {
    const res = await receiveSettings(code, uiOf(ui), deps)
    if (!res.ok) {
      pending = null
      return res
    }
    // The payload stops here; the renderer gets the preview and a count.
    pending = { code: serviceCodeOf(code), payload: res.payload }
    const { preview, discordChannels } = res
    return { ok: true, preview, ...(discordChannels === undefined ? {} : { discordChannels }) }
  })

  ipcMain.handle(IPC.syncApply, (_e, req: unknown): SyncApplyResult => {
    const r = (req ?? {}) as Record<string, unknown>
    const code = serviceCodeOf(r.code)
    // The code has to name the transfer that was previewed. Anything else - a stale card, a second
    // window, a code typed after the preview was replaced - is refused rather than guessed at.
    if (pending === null || code === '' || pending.code !== code) {
      return { ok: false, error: SYNC_ERROR.expired }
    }
    const payload = pending.payload
    pending = null
    const res = applyReceivedSettings(
      payload,
      uiOf(r.ui),
      { includeDiscord: includeDiscordOf(r.includeDiscord) },
      deps
    )
    // Tell the ENGINE about any alerts the import appended - the evaluator is over there now, and
    // a full-set replace is exactly what a `*.define` is (src/main/ipc/share.ts does the same).
    if (res.ok && res.added > 0) pushAppKnowledge('alerts.define')
    return res
  })
}
