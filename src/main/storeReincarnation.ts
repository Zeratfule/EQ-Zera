// storeReincarnation.ts — the REINCARNATION RECORD's store accessors.
//
// Split out of store.ts for file mass (it sits at the 400-code-line ceiling), the
// storeItemOverrides.ts precedent: `setProgress` is still the one write path into `byCharacter`,
// and every rule — what a life is, how merging works, what a correction may say — lives in the pure
// `shared/reincarnation.ts`, which the renderer folds with too.
//
// NO SCHEMA BUMP AND NO MIGRATION: `reincarnation` is an ADDITIVE optional key every reader
// defaults on.

import {
  applyCorrection,
  hasNewLives,
  mergeLives,
  sanitizeReincarnationRecord,
  type ReincarnationRecord
} from '../shared/reincarnation'
import { getProgress, setProgress } from './store'
import type { ProgressState } from '../shared/types'

/** This character's record (empty when it has none, or the stored value is unusable). */
export function getReincarnationRecord(charId: string): ReincarnationRecord {
  return sanitizeReincarnationRecord(getProgress(charId).reincarnation)
}

/**
 * Merge confirmed lives the log showed. A union by instant: nothing already recorded is ever
 * removed, so a rotated log or a re-fold cannot lower a count. `lives` is untrusted. Writes (and
 * reports `changed`) only when the merge added something.
 */
export function recordReincarnations(charId: string, lives: unknown): { progress: ProgressState; changed: boolean } {
  const p = getProgress(charId)
  const held = sanitizeReincarnationRecord(p.reincarnation)
  const incoming = sanitizeReincarnationRecord({ lives, corrections: [] }).lives
  if (!hasNewLives(held.lives, incoming)) return { progress: p, changed: false }
  const next: ReincarnationRecord = { ...held, lives: mergeLives(held.lives, incoming) }
  return { progress: setProgress(charId, { ...p, reincarnation: next }), changed: true }
}

/** State (count) or take back (null) one class or race's count, dated now. */
export function setReincarnationCount(
  charId: string,
  component: 'class' | 'race',
  name: string,
  count: number | null
): ProgressState {
  const p = getProgress(charId)
  const held = sanitizeReincarnationRecord(p.reincarnation)
  const next = applyCorrection(held, { component, name, count, setAt: Date.now() })
  return setProgress(charId, { ...p, reincarnation: next })
}
