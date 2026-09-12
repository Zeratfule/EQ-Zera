// storeAwayAlerts.ts — the persisted half of AWAY ALERTS (shared/awayAlerts.ts).
//
// ANOTHER MODULE THROUGH THE `settingsStore` DOOR (uiScale.ts was the first, then storeRespawn.ts,
// storeSoundPacks.ts, storeOverlaySnap.ts, storeCloseToTray.ts, storeDiscord.ts): store.ts sits at
// the repo's 400-code-line factoring ceiling and the stated answer to that is a split rather than a
// widened threshold. It owes the same discipline every accessor in store.ts follows and pays it —
// read through `sanitizeAwayAlertsPrefs`, write back through the SAME filter.
//
// ADDITIVE + OPTIONAL ⇒ NO SCHEMA BUMP, NO MIGRATION — the `closeToTray` / `respawn` /
// `discordChannels` carve-out storeShape.ts documents, and this key is the easy case of it: the
// default is OFF with nothing selected, so an ABSENT key is exactly the behaviour of every build
// that predates the feature (this install posts nothing anywhere). Nothing downstream ever needs to
// tell a stored default from an inherited one — which is the condition `processPriority` failed and
// took a migration for — so there is nothing for a migration step to decide.
//
// RE-VALIDATED ON EVERY READ, not only on the way in. A settings file is a file on a disk somebody
// else can also write to, and two of these fields are about to steer a network post: the channel id
// is handed to `pickDiscordChannel`, and the idle threshold decides whether a message goes at all.
// "We wrote it, so it is fine" is not a property of a JSON file.

import { settingsStore } from './store'
import { sanitizeAwayAlertsPrefs, type AwayAlertsPrefs } from '../shared/awayAlerts'

/** The one key. */
const KEY = 'awayAlerts'

/** The stored preference, defaulted. Never throws, never returns a partial. */
export function getAwayAlerts(): AwayAlertsPrefs {
  return sanitizeAwayAlertsPrefs(settingsStore.get(KEY))
}

/**
 * Replace it, and answer what was ACTUALLY stored — so the Preferences card renders main's reply
 * rather than assuming its request landed.
 *
 * A WHOLE-VALUE WRITE rather than `closeToTray`'s merge-patch, and the reason is `alertIds`: a
 * merge cannot express "now select nothing", because an absent field and an empty list would have
 * to mean the same thing. The card holds the whole preference anyway (one card, one owner), so the
 * honest shape is a replace with a filter on it.
 */
export function setAwayAlerts(raw: unknown): AwayAlertsPrefs {
  const next = sanitizeAwayAlertsPrefs(raw)
  settingsStore.set(KEY, next)
  return next
}
