// lib/telemetry.ts — the renderer's one door onto usage analytics.
//
// Every `window.eq.track()` call in the app goes through `track()` here, for two reasons:
//
//   1. IT VALIDATES FIRST, with the SAME shared function main runs at the IPC handler and wave
//      A2's ingest Lambda will run on arrival. A mistake is then caught where it was made,
//      instead of vanishing silently at a boundary three files away. (Main validates again
//      regardless — the renderer is untrusted there, and that never changes.)
//   2. IT CANNOT THROW. Analytics is the one feature in this app that must never make noise
//      when it fails: a broken counter must not take a click, a view switch, or a dialog with
//      it. Every failure here is a dropped event and nothing else.
//
// THE SCHEMA IS THE PRIVACY BOUNDARY, not this file. `TelemetryEvent` (src/shared/telemetry.ts)
// has no free-text field anywhere in it, so a call site literally cannot pass a character name,
// a zone, a spell, a search string or a line of log — there is no parameter for one.
//
// NOTHING IS SENT FROM HERE. These calls fill a local ring the user can read in Preferences;
// main's flush loop is the only thing that transmits, and only once the first-run notice has
// rendered and the switch is on.

import { useEffect, useRef } from 'react'
import { TELEMETRY_VIEWS, type TelemetryEvent, type TelemetryFeature } from '@shared/telemetry'
import { validateTelemetryEvent } from '@shared/telemetryValidate'

/** Record one event. Never throws, never rejects, never blocks the caller. */
export function track(event: TelemetryEvent): void {
  try {
    if (!validateTelemetryEvent(event).ok) return
    window.eq.track(event)
  } catch {
    // A counter is never worth a user-visible failure.
  }
}

/** `featureUse` for a single use of one of the closed feature ids — the common case by far. */
export function trackFeature(feature: TelemetryFeature): void {
  track({ t: 'featureUse', feature, count: 1 })
}

/** The dwell enum, named here so call sites do not have to reach into the union themselves.
 *  It is the same set as the app's own `View` union (appViews.ts) — by construction, since a
 *  view the schema does not list cannot be reported at all. */
export type ViewDwellId = Extract<TelemetryEvent, { t: 'viewDwell' }>['view']

/**
 * A view id the dwell schema carries, or `null` for one it deliberately does not.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A HOLE IN "WIDEN THE SCHEMA FIRST" (JOS-45). A NEW ENUM
 * VALUE IS NOT ADDITIVE-SAFE. The app auto-updates itself and the ingest Lambda is deployed by
 * hand, so a shipped client regularly talks to an OLDER copy of this contract — and the shared
 * validator's first failure fails the WHOLE batch, which `telemetryPermanentRefusal` then
 * classes as a 400 and DROPS. So a client that reported `view: 'character'` before the deploy
 * landed would throw away every counter it was carrying, on every flush, until it did.
 *
 * That is a real cost for a view no user can reach: an UNRELEASED surface (devFlags.ts) is not
 * a product yet, and time spent on it belongs in no funnel. So it reports nothing until it
 * graduates — at which point it joins `TELEMETRY_VIEWS`, the Lambda is deployed, and this
 * function starts answering for it with no other change.
 *
 * A view id that is simply MISSPELLED lands here too and is silently not reported, which is the
 * one thing this weakens. The dwell enum and `View` are both closed unions, so a typo is a
 * compile error long before it is a missing counter.
 */
export function dwellView(view: string): ViewDwellId | null {
  return (TELEMETRY_VIEWS as readonly string[]).includes(view) ? (view as ViewDwellId) : null
}

/** Below this, a "view" was a pass-through — a click on the way to somewhere else. Recording
 *  those would make the dwell histogram mostly noise about how fast people can click. */
const MIN_DWELL_MS = 1_000

/**
 * Report how long each tab was on screen, once per switch (plan §2: "flushed on switch").
 *
 * Deliberately NOT a timer: it reads the clock when the view changes and again when the app
 * unmounts. A polling version would have to decide what "still looking at it" means while the
 * window is in the background, and it would produce an event per tick instead of per switch.
 *
 * `view` is typed as the closed `viewDwell` enum, so a view id this schema does not know cannot
 * be reported at all — the caller has to widen the schema first, which is the point. `null` is
 * the ONE deliberate exception: a view the schema does not carry ON PURPOSE (see `dwellView`).
 * The switch INTO such a view still flushes the view you left; only the unreported one is
 * skipped, so no other tab's dwell is distorted by the visit.
 */
export function useViewDwell(view: ViewDwellId | null): void {
  const since = useRef(Date.now())
  const current = useRef(view)

  useEffect(() => {
    const now = Date.now()
    const previous = current.current
    const ms = now - since.current
    since.current = now
    current.current = view
    if (previous !== null && previous !== view && ms >= MIN_DWELL_MS) {
      track({ t: 'viewDwell', view: previous, ms })
    }
  }, [view])

  // The LAST view of a session never gets a switch, so the unmount reports it. Reads the refs
  // rather than closing over `view`, so it stays a mount/unmount effect with no dependencies.
  useEffect(() => {
    return () => {
      const last = current.current
      const ms = Date.now() - since.current
      if (last !== null && ms >= MIN_DWELL_MS) track({ t: 'viewDwell', view: last, ms })
    }
  }, [])
}
