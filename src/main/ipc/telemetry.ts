// IPC: usage analytics — the six channels behind `window.eq.track()` and the Preferences pane.
//
// EVERY RENDERER-SUPPLIED VALUE IS VALIDATED HERE, at the boundary, not deeper in and not
// "because today's only caller is the app's own UI". Same law as `sounds:getData`'s packId and
// `feedback:submit`'s draft, and it matters more here than usual: the renderer is where the
// strings of this app live (character names, zone names, search boxes, alert text), and the
// entire promise of this feature is that none of them can reach the buffer.
//
// `validateTelemetryEvent` is the SHARED validator — the same function the renderer's own
// `track()` shim runs before sending, and the same one wave A2's ingest Lambda will run on
// arrival. It CONSTRUCTS its result field by field from the schema, so an event carrying an
// extra `characterName` property does not get "sanitized"; the property simply never appears in
// the value that is buffered.
//
// `telemetry:track` is a SEND, not an invoke: it is fire-and-forget by design (the renderer must
// never wait on a counter), so an invalid event is dropped silently on this side. That is the
// right failure mode for analytics and the wrong one for anything else — nothing a user does
// depends on it having worked.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { validateTelemetryEvent } from '../../shared/telemetryValidate'
import { getTelemetryPrefs } from '../store'
import {
  answerNotice,
  applyTelemetryEnabled,
  observeFirstRun,
  recordEvent,
  rotateAnalyticsId,
  telemetryPayload
} from '../telemetry'

export function registerTelemetryIpc(): void {
  ipcMain.on(IPC.telemetryTrack, (_e, event: unknown) => {
    const valid = validateTelemetryEvent(event)
    // Dropped, not thrown: a bad counter must never become a renderer-visible failure. The
    // renderer validated the same value with the same function before it sent it, so reaching
    // here means either a bug we want to find in dev or a caller that is not our UI.
    if (!valid.ok) return
    recordEvent(valid.value)
    // TWO FIRST-RUN STEPS ARE DERIVED FROM THESE EVENTS, in main, from the VALIDATED value —
    // never sent as funnel steps by the renderer. "Visited a tab that is not overview" and
    // "opened an overlay" are facts about `viewDwell` and `overlayToggle`, which already cross
    // this boundary; deriving them here keeps the once-ever mark on the side of the process that
    // owns the prefs file, so the renderer cannot mint a first-run step at all (funnels.ts).
    observeFirstRun(valid.value)
  })

  ipcMain.handle(IPC.telemetryPrefsGet, () => getTelemetryPrefs())

  // The master switch. A non-boolean is not a guess — it leaves the pref exactly as it was.
  ipcMain.handle(IPC.telemetrySetEnabled, (_e, enabled: unknown) =>
    typeof enabled === 'boolean' ? applyTelemetryEnabled(enabled) : getTelemetryPrefs()
  )

  // The first-run notice was answered or dismissed. Dismissal keeps it ON (T1: that is what
  // opt-out means), so a non-boolean reads as "keep on" rather than as a silent opt-out.
  ipcMain.handle(IPC.telemetryNoticeShown, (_e, keepEnabled: unknown) =>
    answerNotice(typeof keepEnabled === 'boolean' ? keepEnabled : true)
  )

  ipcMain.handle(IPC.telemetryRotate, () => rotateAnalyticsId())

  ipcMain.handle(IPC.telemetryPayload, () => telemetryPayload())
}
