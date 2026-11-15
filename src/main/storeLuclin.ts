// storeLuclin.ts - the persisted half of "Luclin character models", through the `settingsStore`
// door like storeCloseToTray.ts (store.ts is at the factoring ceiling). Read through
// `mergeLuclinPrefs`, written back through the same function.

import { settingsStore } from './store'
import { mergeLuclinPrefs, type LuclinPrefs } from '../shared/luclinModels'

export function getLuclinPrefs(): LuclinPrefs {
  return mergeLuclinPrefs(settingsStore.get('luclinModels'))
}

/** Merge-patch the prefs; returns what was actually stored. The patch is `unknown` (it arrives over IPC). */
export function setLuclinPrefs(patch: unknown): LuclinPrefs {
  const next = mergeLuclinPrefs(patch, getLuclinPrefs())
  settingsStore.set('luclinModels', next)
  return next
}
