// preview.ts — what the alert row's ▶ actually does, as a pure function.
//
// WHY THIS EXISTS. "Preview plays what a real firing plays" was a comment in three files and an
// assertion in none, and it was FALSE: with the old global voice switch off, pressing ▶ on a row
// whose output said "Voice (spoken)" played the pack sound — the same sound it played before you
// changed anything — so the control that was supposed to let you audition your choice was the one
// control guaranteed not to reflect it. The switch is gone (see lib/speech.ts `speechPlan`), and
// the equality is now pinned here rather than asserted in prose.
//
// PREVIEW IS A FIRING WITH TWO FIELDS FORCED, AND NOTHING ELSE (`previewDef`):
//   `enabled: true`    — a disabled alert must still be auditionable; that is what the button is
//                        for while you are setting one up.
//   `alwaysPlay: true` — the cross-alert audio throttle (audioThrottle.ts) must never swallow a
//                        button the user just pressed. A ▶ that does nothing because an unrelated
//                        alert fired 1s ago reads as a broken sound file.
// Every other field — `audio`, `sound`, `speech`, `volume` — is carried through untouched, which
// is exactly why `previewPlan` and `speechPlan` agree by construction (tests/alertPreview.test.mts
// pins that they do, channel by channel).
//
// NO FIRING CONTEXT, ON PURPOSE. A preview has no matched event, so the spell modes resolve
// through `speechTextFor`'s documented fallback to the alert's NAME — which is the honest answer:
// it is precisely what the user will hear whenever the trigger turns out to name no spell.
//
// MUTE IS NOT AN EXCEPTION. The alerts master mute is a promise that the app makes no noise, and
// a preview is noise. It stays a parameter here rather than a lookup so this module has no state.
//
// Value imports stay RELATIVE (AGENTS.md toolchain gotchas) — node:test loads this file.

import type { AlertDef } from '@shared/types'
import { speechPlan, type SpeechPlan } from '../../lib/speech'

/** The def a preview fires, given the def the row is showing. See the header for the two forces. */
export function previewDef(def: AlertDef): AlertDef {
  return { ...def, enabled: true, alwaysPlay: true }
}

/**
 * What pressing ▶ on this row resolves to — the SAME `SpeechPlan` a real firing of it produces,
 * because it is produced by the same function from the same fields.
 */
export function previewPlan(def: AlertDef, muted: boolean): SpeechPlan {
  return speechPlan(previewDef(def), null, muted)
}
