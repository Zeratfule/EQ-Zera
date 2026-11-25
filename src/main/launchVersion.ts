// launchVersion.ts — the version the player LAST RAN, as this launch found it.
//
// The app stores no "last run version" as such. The nearest durable fact is `lastSeenNotesVersion`
// (src/main/store.ts): the newest release whose What's-new notes the install was SHOWN. It can only
// LAG the true last run (it is stamped when the panel opens or the teaser is dismissed), never lead
// it — except after a downgrade. Its one reader here is the tracker's tick reconcile
// (shared/questStepsSig.ts `legacyRule`), where a lag only widens the set of quests whose old
// unsigned ticks are dropped.
//
// CAPTURED BEFORE THIS SESSION CAN MOVE IT. The renderer stamps the key with THIS build's version as
// soon as the player opens the notes; read after that, it would claim the player last ran this build
// and keep ticks it must drop. So the value is captured on first ask, and the one write path
// (ipc/releaseNotes.ts) asks before it writes.

import { getLastSeenNotesVersion } from './store'

let captured: { version: string | null } | null = null

/** The stored What's-new version as this launch found it; null when the store never recorded one. */
export function launchNotesVersion(): string | null {
  captured ??= { version: getLastSeenNotesVersion() }
  return captured.version
}
