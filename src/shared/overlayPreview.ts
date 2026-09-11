// overlayPreview — THE SAMPLE EACH STRIP SHOWS SO YOU CAN SEE WHERE IT LANDS (2026-09-10).
//
// THE GAP THIS CLOSES. The three strips (the celebration toast, the alert banner, the con card)
// are invisible until something happens, so "where does it sit" has never been a question the app
// could answer on demand: you moved a dashed frame, pressed Done, and then waited for a boss to
// die to find out whether you had put it somewhere sensible. Preferences, Overlays now has a
// Preview button per strip, and this module is what it shows.
//
// PURE, AND IN `shared/` RATHER THAN IN MAIN, for the reason `introToastPayload` and
// `introBannerPayload` are: a sample card is a PROMISE the app makes on screen, and `npm test` can
// pin a promise in a module with no Electron in it. Main owns only the push (main/overlayMove.ts).
//
// ONE FILE FOR THREE KINDS because the three payloads are one feature, and the thing that must not
// drift between them is the DURATION: six seconds is long enough to look at the strip and short
// enough that a preview never becomes a card you have to dismiss.
//
// A PREVIEW IS NOT AN EVENT. Nothing here is written to any history, ledger or count - these
// payloads go straight at the overlay window that draws them, exactly as the update card does, and
// no producer, detector or store is involved on either side. The con card's sample names a mob
// that does not exist, which is deliberate: a real creature's card would be a claim about the log.

import { introToastPayload, type ToastPayload } from './toast'
import type { AlertBannerPayload } from './alertBanner'
import { blankChip, type ConCardPayload } from './conCard'
import { RESIST_AXES } from './resistTypes'

/**
 * How long a preview holds, in ms.
 *
 * Shorter than any of the three kinds' own defaults on purpose. A preview is a glance at a
 * rectangle, not something to read: the person pressing the button is looking at where the card
 * is, and six seconds is the difference between "I saw it" and "I now have to close it".
 */
export const OVERLAY_PREVIEW_MS = 6_000

/** The preview's queue identity on the celebration strip. Stable, so pressing Preview twice
 *  REFRESHES the card that is up rather than stacking a second one. */
export const TOAST_PREVIEW_ID = 'overlay-preview'

/** …the same on the banner, and the alert id it reports itself under (there is no alert). */
export const BANNER_PREVIEW_ID = 'alert-banner-preview'

/** …and on the con card, where the id is normally the mob key. */
export const CON_CARD_PREVIEW_ID = 'con-card-preview'

/** The line the banner preview prints. Says what the strip is FOR, in the place it will say it. */
export const BANNER_PREVIEW_TEXT = 'Preview: your alert text lands here'

/** The mob the con card's sample is about - one that cannot exist, so the card is never mistaken
 *  for something the log said. */
export const CON_CARD_PREVIEW_NAME = 'a preview mob'

/** …at a level, because the identity line prints one and a card with no level is not what a real
 *  `/con` looks like. Any level would do; this one is mid-game. */
export const CON_CARD_PREVIEW_LEVEL = 35

/** …and where the identity line prints the zone, which is where this card says what it is. */
export const CON_CARD_PREVIEW_ZONE = 'Preview'

/**
 * THE CELEBRATION STRIP'S SAMPLE: the introduction card, on a preview clock.
 *
 * It is the INTRODUCTION rather than a fourth piece of copy because the introduction already says
 * the two things a preview has to say - what this window is, and that it belongs to EQ Zera and not
 * to EverQuest - and a second wording of that would be a second answer. What the preview changes is
 * the queue id (so a press refreshes rather than stacks, and so it can never be mistaken for the
 * once-per-install introduction) and the hold.
 */
export function previewToastPayload(): ToastPayload {
  return { ...introToastPayload(), id: TOAST_PREVIEW_ID, durationMs: OVERLAY_PREVIEW_MS }
}

/** The alert banner's sample line. `alertId` is the preview's own id: no alert fired. */
export function previewBannerPayload(now: number): AlertBannerPayload {
  return {
    id: BANNER_PREVIEW_ID,
    alertId: BANNER_PREVIEW_ID,
    ts: now,
    text: BANNER_PREVIEW_TEXT,
    holdMs: OVERLAY_PREVIEW_MS
  }
}

/**
 * The con card's sample: a made-up mob with five EMPTY chips.
 *
 * EMPTY, NEVER INVENTED (world-model law 1). A preview card exists to show a rectangle, and five
 * chips carrying numbers nobody measured would be the app stating resist guidance about a creature
 * that does not exist. The empty chip is the shape this wire already has for "nothing has been
 * seen", and it is asked for rather than written out (`blankChip`, shared/conCard.ts).
 */
export function previewConCardPayload(now: number): ConCardPayload {
  return {
    id: CON_CARD_PREVIEW_ID,
    ts: now,
    name: CON_CARD_PREVIEW_NAME,
    level: CON_CARD_PREVIEW_LEVEL,
    zone: CON_CARD_PREVIEW_ZONE,
    chips: RESIST_AXES.map((axis) => blankChip(axis)),
    spellData: true,
    // ITS OWN CLOCK, because this kind's is the user's: `autoHideMs: 0` means "until I close it",
    // and a preview that had to be closed would be a worse version of the problem it solves.
    holdMs: OVERLAY_PREVIEW_MS
  }
}
