// storePatchNotes.ts — the one persisted preference behind the EverQuest Legends patch notes:
// whether a launch asks everquestlegends.com for new notes.
//
// Through the `settingsStore` door, like storeOverlaySnap.ts, because store.ts is at its ceiling.
// ADDITIVE + OPTIONAL => no schema bump, no migration: an absent key reads as ON, which is the
// shipped default. The notes themselves are not settings and live in their own cache file
// (src/main/patchNotes.ts), so a deleted cache costs a download, never a preference.

import { settingsStore } from './store'

export interface PatchNotesPrefs {
  /** Check for new notes on launch. */
  enabled: boolean
}

export function normalizePatchNotesPrefs(raw: unknown): PatchNotesPrefs {
  const enabled = typeof raw === 'object' && raw !== null ? (raw as { enabled?: unknown }).enabled : undefined
  return { enabled: typeof enabled === 'boolean' ? enabled : true }
}

export function getPatchNotesPrefs(): PatchNotesPrefs {
  return normalizePatchNotesPrefs(settingsStore.get('patchNotes'))
}

/** Set the switch; returns what was stored. Anything but a boolean leaves it as it was. */
export function setPatchNotesEnabled(enabled: unknown): PatchNotesPrefs {
  const next = typeof enabled === 'boolean' ? { enabled } : getPatchNotesPrefs()
  settingsStore.set('patchNotes', next)
  return next
}
