// ============================================================================
// perfProbeWorker.ts — THE SECOND CLOCK (JOS-367). Keep it this small.
// ============================================================================
//
// WHY A WHOLE THREAD FOR ONE `setInterval`. An in-process timer cannot say WHO failed to schedule
// it. Two of them can: if this thread — which does nothing but count — goes late in the same half
// second main does, the MACHINE stalled (paging, a driver reset, a DPC storm) and our loop was a
// victim; if only main goes late, WE stalled and it is a bug with an address. That comparison is
// the whole reason this file exists, and it is worthless the moment this thread does anything
// else, so it never will. The matcher and the argument live in `src/shared/perfLive.ts`.
//
// IT SPEAKS ONLY WHEN IT HAS SOMETHING TO SAY: a late tick past the report threshold, or one fold
// a minute — otherwise a probe would become part of the load it measures. Its lifetime is owned
// entirely by `src/main/livePerfProbe.ts`, which holds the handle `unref`'d and terminates it.

import { parentPort } from 'node:worker_threads'
import {
  LIVE_PROBE_FOLD_MS,
  LIVE_PROBE_INTERVAL_MS,
  LIVE_PROBE_REPORT_MS
} from '../shared/perfLive'

const port = parentPort
let due = performance.now() + LIVE_PROBE_INTERVAL_MS
// The FIRST fold is due immediately, so the first tick announces this thread rather than a
// healthy worker staying silent for a minute — main reads "has it ever spoken" as "is there a
// second clock", and a session that ends before the first fold would otherwise report NO VERDICT
// when it had two clocks all along. MEASURED: the e2e's ~5 s launch saw exactly that.
let foldDue = Date.now()
let ticks = 0
let maxLateMs = 0

setInterval(() => {
  const now = performance.now()
  const lateMs = Math.round(Math.max(0, now - due))
  due = now + LIVE_PROBE_INTERVAL_MS
  ticks++
  if (lateMs > maxLateMs) maxLateMs = lateMs
  const at = Date.now()
  if (lateMs >= LIVE_PROBE_REPORT_MS) port?.postMessage({ k: 'late', at, lateMs })
  if (at >= foldDue) {
    port?.postMessage({ k: 'fold', at, ticks, maxLateMs })
    foldDue = at + LIVE_PROBE_FOLD_MS
    ticks = 0
    maxLateMs = 0
  }
}, LIVE_PROBE_INTERVAL_MS)
