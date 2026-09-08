// storeProcessPriority.ts — the persisted half of "yield CPU to the game" (JOS-366).
//
// A FIFTH MODULE THROUGH THE `settingsStore` DOOR (uiScale.ts was the first, storeRespawn.ts the
// second, storeSoundPacks.ts the third, storeOverlaySnap.ts the fourth): store.ts sits at the
// repo's 400-code-line factoring ceiling and the stated answer to that is a split rather than a
// widened threshold. It owes the same discipline every accessor in store.ts follows and pays it —
// read through `normalizeProcessPriorityPrefs`, write back through the SAME normalizer.
//
// UNLIKE those four, this key DOES carry a schema bump (11 → 12, storeMigrations.ts). The
// additive-optional carve-out exists for keys whose absence already means today's behaviour; this
// one's absence means the OPPOSITE of what the feature ships (the default is ON), so a v12 store
// states the answer rather than leaving every reader to infer it.
//
// WHAT the setting means, which processes it reaches and why the GPU is not one of them all live
// in shared/processPriority.ts and src/main/processPriority.ts. This file is storage and nothing
// else.

import { settingsStore } from './store'
import {
  normalizeProcessPriorityPrefs,
  type ProcessPriorityPrefs
} from '../shared/processPriority'

/** The stored blob, defaulted. Never throws, never returns a partial. */
export function getProcessPriorityPrefs(): ProcessPriorityPrefs {
  return normalizeProcessPriorityPrefs(settingsStore.get('processPriority'))
}

/**
 * Merge-patch the blob; returns the stored (re-normalized) value, so no caller has to assume its
 * write landed on the value it sent. VALIDATED HERE because the renderer supplies it (the
 * `sounds:getData` rule).
 */
export function setProcessPriorityPrefs(patch: Partial<ProcessPriorityPrefs>): ProcessPriorityPrefs {
  const next = normalizeProcessPriorityPrefs({ ...getProcessPriorityPrefs(), ...patch })
  settingsStore.set('processPriority', next)
  return next
}
