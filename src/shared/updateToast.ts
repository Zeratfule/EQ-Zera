// updateToast.ts — THE FOUR CARDS THE UPDATER DRAWS, as pure functions (EQ Zera, 2026-09-08).
//
// THE OWNER'S DIRECTION, which is the whole specification: "We also need a way to push updates to
// people's apps so they can see when there's an available update, click on the notification when
// there is one, and it will just automatically download and update from there."
//
// So the celebration overlay gains a kind that is not a celebration. `main/updater.ts` turns each
// electron-updater event into one of the payloads below and pushes it at the toast window itself —
// no renderer request, no validator, no producer in the app that could ask for one (shared/toast.ts
// keeps `update` out of `TOAST_KINDS` and omits `action` from `ToastRequest` precisely so that stays
// true). What crosses the wire is a finished card, exactly as a Sky reward's is.
//
// WHY THE BUILDERS ARE HERE AND NOT IN `main/updater.ts`. That file imports Electron and
// electron-updater at module scope, so nothing in it can be read by `node --test`. What a card SAYS
// and what its button DOES are the two things this feature is judged on — a title that names the
// wrong version, or a "Restart to install" that carries `updateDownload`, is a bug nobody would see
// until an actual release day. Pure module, relative imports, no Electron: `tests/updateToast.test.mts`
// pins every title, every action and the id that makes the refresh work.
//
// ONE ID FOR THE WHOLE LIFE OF ONE UPDATE, AND THAT IS THE STATE MACHINE. The card queue refreshes
// a card in place when a payload repeats its id (overlay/cardQueue.ts), so available → downloading →
// downloaded is ONE card that changes its words under the user, never three cards stacking up over a
// download they already answered. The failure card is the one deliberate exception: it has an id of
// its own because it can arrive when no version is known at all, and because "this went wrong" is a
// different card from "this is ready", not a later state of it.
//
// NO EM DASHES: these are user-facing strings and `tests/copyNoEmDash.test.mts` scans this directory.

import { TOAST_MAX_DURATION_MS, TOAST_MAX_TEXT, type ToastPayload, type ToastUpdateAction } from './toast'

/**
 * WHAT THE BUTTON SAYS, per action. Here rather than in `ToastCard.tsx` for the reason
 * `toastActionLabel` and `TOAST_INTRO_BODY` are in shared/toast.ts: a label on a control that
 * downloads or restarts is a PROMISE, and a promise belongs somewhere `npm test` can read it
 * without a window. Both are imperatives naming the whole outcome, because the card is on screen
 * for thirty seconds over a game and "Update" would be a word, not an offer.
 */
export function updateActionLabel(action: ToastUpdateAction): string {
  return action === 'updateInstall' ? 'Restart to install' : 'Download and install'
}

/** The kind every card here carries. Main-built only; the wire refuses it. */
const KIND = 'update' as const

/**
 * How long an update card holds: the MAXIMUM a card may ever hold (30 s), for the two states that
 * are asking for a click, and for the same reason the introduction card takes it (shared/toast.ts) —
 * long enough to read and act on, still bounded, because a card on screen is a card capturing the
 * mouse over the strip. An update that is ignored is not lost: the Preferences panel keeps the same
 * two buttons, and the next check offers it again.
 */
export const UPDATE_TOAST_MS = TOAST_MAX_DURATION_MS

/** The failure card's id. Its own, because a failure may name no version at all. */
export const UPDATE_TOAST_FAILED_ID = 'update:failed'

/**
 * The dedupe key for one update's card. Everything about one version's journey shares it, so the
 * queue REFRESHES rather than stacks (see the header).
 */
export function updateToastId(version: string | undefined): string {
  return `update:${version?.trim() ? version.trim() : 'pending'}`
}

/** The build, as the card names it. A version we were not told is still an update worth offering. */
function buildName(version: string | undefined): string {
  return version?.trim() ? `EQ Zera ${version.trim()}` : 'The EQ Zera update'
}

/** Every card is built through this, so the kind, the id and the hold cannot drift apart. */
function card(version: string | undefined, title: string, subtitle: string): ToastPayload {
  return {
    id: updateToastId(version),
    kind: KIND,
    title: title.slice(0, TOAST_MAX_TEXT),
    subtitle: subtitle.slice(0, TOAST_MAX_TEXT),
    durationMs: UPDATE_TOAST_MS
  }
}

/**
 * THE NOTIFICATION ITSELF: a new build exists and one click will fetch it.
 *
 * It carries `updateDownload`, which is the only reason the download is not already running:
 * `autoDownload` is off and stays off, so nothing has been pulled over the network until the person
 * looking at this card says so.
 */
export function updateAvailableToast(version: string | undefined): ToastPayload {
  return {
    ...card(version, `${buildName(version)} is ready`, 'Click to download and install'),
    action: 'updateDownload'
  }
}

/**
 * The same card, mid-download. NO ACTION on purpose: the click has been made and the answer is a
 * progress line, so re-offering the button would invite a second download of the file already
 * arriving.
 */
export function updateDownloadingToast(version: string | undefined, percent: number): ToastPayload {
  const pct = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)))
  return card(version, `${buildName(version)} is ready`, `Downloading… ${String(pct)}%`)
}

/**
 * Staged and waiting. `updateInstall` hands the process to the installer (silently, and it
 * relaunches), which is the second half of "it will just automatically download and update from
 * there" — and the only half that can take the app away mid-sentence, so it is still a click.
 */
export function updateDownloadedToast(version: string | undefined): ToastPayload {
  return {
    ...card(version, `${buildName(version)} downloaded`, 'Click to restart and install'),
    action: 'updateInstall'
  }
}

/**
 * It did not work, said in the updater's OWN sentence (`describeUpdateFailure`), with no action:
 * there is nothing here for a click to retry that the next scheduled check will not retry by
 * itself, and a button that re-runs a failing download is a button that fails twice.
 */
export function updateFailedToast(message: string | undefined): ToastPayload {
  const said = message?.trim() ? message.trim() : 'The update could not be downloaded.'
  return {
    id: UPDATE_TOAST_FAILED_ID,
    kind: KIND,
    title: 'Update failed',
    subtitle: said.slice(0, TOAST_MAX_TEXT),
    durationMs: UPDATE_TOAST_MS
  }
}
