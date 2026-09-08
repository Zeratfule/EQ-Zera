// telemetry/funnels.ts — the ONCE-EVER half of the schema: who actually reached each step.
//
// The funnel STEPS have been in the contract since it was written (TELEMETRY_FUNNEL_STEPS), the
// server has aggregated them since wave A2, and the Analytics tab has rendered them all along —
// as a column of zeros, because nothing ever called `recordEvent` with one. The panel was
// therefore telling the truth about the instrument and a lie about the world: "nobody has ever
// finished a first run" reads as a catastrophic product failure and meant "we never measured it".
// This module is the missing half, and it is deliberately the ONLY place a funnel step is minted.
//
// WHY ONCE-EVER, AND WHY IT IS PERSISTED. `first-run` and `voice-install` ask how far an INSTALL
// ever got. Every step of both may therefore contribute at most one event for the life of the
// install: a step that could re-fire would count tab switches rather than installs, and the
// panel's conversion ("of the installs that reached step 1, how many reached step 2") would run
// past 100% by construction. The marks live in the telemetry PREFS blob rather than in the event
// ring because the ring is disposable by design — it is dropped on opt-out, on rotation and on
// any unreadable file — and a mark that went with it would let `installed` fire twice on one
// machine.
//
// THE FEEDBACK FUNNEL IS NOT HERE. Its three steps are per-REPORT, not per-install (a second
// report is a second dialog, and its conversion is the interesting number), so it is emitted
// straight through `track()` from the renderer and always has been.
//
// FAILURES ARE NOT MARKS. `recordFunnelFailure` records the attempt WITHOUT consuming the
// once-ever mark, so a voice download that fails, is retried and then succeeds produces both the
// failure and the eventual success. Marking on failure would make "installs that finished the
// download" permanently unmeasurable for anyone who had one bad night.

import {
  funnelStepMark,
  TELEMETRY_FUNNEL_STEPS,
  type TelemetryEvent,
  type TelemetryFailureClass,
  type TelemetryFunnel
} from '../../shared/telemetry'
import { getTelemetryPrefs, setTelemetryPrefs } from '../store'
import { recordEvent } from './collector'
import { telemetryCollectEnabled } from './net'

/** Is `step` a declared step of `funnel`? The validator's pair check, main-side. */
function declared(funnel: TelemetryFunnel, step: string): boolean {
  return TELEMETRY_FUNNEL_STEPS[funnel].includes(step)
}

/**
 * Emit one funnel step, AT MOST ONCE for the life of this install. Returns whether it fired.
 *
 * Collection being OFF is not a mark: the step is left unspent, so a user who turns analytics on
 * later can still be counted at the next step they actually reach. (Marking anyway would silently
 * retire steps for an install that never reported one.)
 */
export function markFunnelStep(funnel: TelemetryFunnel, step: string): boolean {
  if (!declared(funnel, step)) return false
  const prefs = getTelemetryPrefs()
  if (!telemetryCollectEnabled(prefs)) return false
  const mark = funnelStepMark(funnel, step)
  if (prefs.funnelsDone.includes(mark)) return false
  setTelemetryPrefs({ funnelsDone: [...prefs.funnelsDone, mark] })
  recordEvent({ t: 'funnelStep', funnel, step })
  return true
}

/**
 * A step that was REACHED AND FAILED — the outcome plus its coarse class, and no mark (see the
 * header). This is the shape the panel's "failures" list reads: `<funnel>:<step>:<class>`.
 */
export function recordFunnelFailure(
  funnel: TelemetryFunnel,
  step: string,
  failureClass: TelemetryFailureClass
): void {
  if (!declared(funnel, step)) return
  recordEvent({ t: 'funnelStep', funnel, step, outcome: 'failed', failureClass })
}

/**
 * THE TWO FIRST-RUN STEPS THAT ONLY THE RENDERER CAN SEE, derived from the events it already
 * sends rather than from two new IPC channels.
 *
 * `firstNonOverviewView` and `firstOverlayEnabled` are facts about `viewDwell` and
 * `overlayToggle`, both of which cross the boundary already and are validated there. Deriving
 * them in MAIN (rather than trusting the renderer to send the funnel step itself) keeps the
 * once-ever mark on the side of the process that owns the prefs file, and means the renderer
 * cannot mint a first-run step at all.
 *
 * OVERVIEW IS EXCLUDED because it is where the app opens: dwelling on it is not navigating, and
 * counting it would make the step fire for every install in its first second and measure nothing.
 */
export function observeFirstRun(ev: TelemetryEvent): void {
  if (ev.t === 'viewDwell' && ev.view !== 'overview') {
    markFunnelStep('first-run', 'firstNonOverviewView')
    return
  }
  if (ev.t === 'overlayToggle' && ev.open) markFunnelStep('first-run', 'firstOverlayEnabled')
}
