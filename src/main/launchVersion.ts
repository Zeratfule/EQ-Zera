// launchVersion.ts — the version the player LAST RAN before this build, for the tracker's tick
// reconcile (shared/questStepsSig.ts `legacyRule`).
//
// The app stores no "last run version" as such. The nearest durable fact is `lastSeenNotesVersion`
// (src/main/store.ts): the newest release whose What's-new notes the install was SHOWN. It can only
// LAG the true last run (it is stamped when the panel opens or the teaser is dismissed), never lead
// it — except after a downgrade — and a lag only widens the set of quests whose old unsigned ticks
// are dropped.
//
// TWO CAPTURES, BECAUSE TWO THINGS MOVE IT:
//   1. THIS SESSION. The renderer stamps the key with this build's version as soon as the player
//      opens the notes; read after that it would claim they last ran this build. So the value is
//      captured on first ask (`launchNotesVersion`), and the one write path (ipc/releaseNotes.ts)
//      asks before it writes.
//   2. A LATER LAUNCH OF THE SAME BUILD. A character's pins are reconciled when that character is
//      first opened, which may be days after the update; by then the stamp says this build. So the
//      value this build's FIRST launch found is stored with the build it belongs to
//      (`pinsLegacyBaseline`), and every later launch of the same build reads it back
//      (`legacyBaseline`); a newer build captures its own. The rule is pure and tested:
//      shared/questStepsSig.ts `resolveLegacyBaseline`.
//
// "This build" is the newest release-notes entry — the running version in every published build
// (shared/releaseNotes.ts says why `app.getVersion()` is not).

import { latestReleaseVersion } from '../shared/releaseNotes'
import { resolveLegacyBaseline } from '../shared/questStepsSig'
import { getLastSeenNotesVersion, settingsStore } from './store'

let captured: { version: string | null } | null = null

/** The stored What's-new version as this launch found it; null when the store never recorded one. */
export function launchNotesVersion(): string | null {
  captured ??= { version: getLastSeenNotesVersion() }
  return captured.version
}

let baseline: { version: string | null } | null = null

/** The last-run version this BUILD's first launch found (null = unknown); stored on first ask. */
export function legacyBaseline(): string | null {
  if (baseline) return baseline.version
  const r = resolveLegacyBaseline(settingsStore.get('pinsLegacyBaseline'), latestReleaseVersion(), launchNotesVersion())
  if (r.write) settingsStore.set('pinsLegacyBaseline', r.write)
  baseline = { version: r.baseline }
  return r.baseline
}
