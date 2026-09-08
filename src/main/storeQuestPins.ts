// storeQuestPins.ts — THE QUEST TRACKER'S store accessors (EQ Zera).
//
// SPLIT OUT OF store.ts FOR FILE MASS, NOT FOR SCOPE — the roster.ts/windows.ts/perf.ts rule this
// repo states in four places now, and `storePlans.ts` is the nearest precedent: `src/main/store.ts`
// sits at the measured 400-code-line ceiling, and the answer to that is a SPLIT rather than a
// widened threshold. This wave needed one more read/write pair than that file had room for.
//
// WHAT MOVED IS CODE, NOT AUTHORITY. `setProgress` is still the one write path into `byCharacter`
// and it is imported from store.ts; both directions run through the ONE pure validator in
// `../shared/questPins.ts`, so "what a stored pin may contain" has exactly one definition and the
// round trip is a fixed point (`tests/questPins.test.mts` asserts it).
//
// NO SCHEMA BUMP AND NO MIGRATION. `questPins` is an ADDITIVE optional key: nothing that already
// exists changes meaning, every reader defaults on a missing key, and electron-store rewrites the
// whole parsed object so the key survives a round trip through an older build. The store-migration
// law asks for a step when a persisted shape CHANGES; adding a key every reader already defaults
// is the case it explicitly does not cover.
//
// Per character, like every other key on `ProgressState`: a quest is run by one character.
// Whole-list writes — the tracker is small (capped at MAX_QUEST_PINS) and the renderer edits it as
// one document.

import { sanitizeQuestPins, type QuestPins } from '../shared/questPins'
import { getProgress, setProgress } from './store'

/** This character's tracked quests ([] when it has none, or the stored value is unusable). */
export function getQuestPins(charId: string): QuestPins {
  return sanitizeQuestPins(getProgress(charId).questPins)
}

/** Replace the whole tracker for a character. Returns what was actually stored. */
export function setQuestPins(charId: string, pins: QuestPins): QuestPins {
  const next = sanitizeQuestPins(pins)
  setProgress(charId, { ...getProgress(charId), questPins: next })
  return next
}
