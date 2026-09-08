// logTailMark.ts — where the tail had read to when this app last shut down CLEANLY (JOS-57).
//
// One number per character, and the next launch subtracts it from the log's current end to learn
// how many bytes it had to read COLD (`src/main/log/coldRead.ts` states that rule and refuses the
// two cases that have no answer). It is the discriminator the fleet startup reading was missing:
// every other number it carries scales with the WHOLE log, while the leading hypothesis for a slow
// first launch — an on-access scanner reading pages the OS has never cached — scales with the part
// of it nobody has read yet.
//
// IT LIVES HERE rather than beside the other accessors because `src/main/store.ts` is AT the
// repo's 400-code-line factoring ceiling, and the house answer to that is a split
// (`src/main/uiScale.ts` is the precedent, `windows.ts → windowErrors.ts` the original). What
// stayed behind is the only thing that could not move: the key's place in `StoreShape`.
//
// NO SCHEMA BUMP. The key is additive and optional, every reader treats an absent or unreadable
// entry as UNKNOWN, and the whole file is disposable — delete it by hand and the only consequence
// is one launch that reports no delta. The `eqDiscoveredRoot` precedent, stated in StoreShape.

import { settingsStore } from './store'
import type { LogTailMark } from './storeShape'

/**
 * The mark left by the last clean shutdown for `charId`, or undefined when there is none.
 *
 * SHAPE-CHECKED ON THE WAY OUT, like every accessor in this family: the store file is editable by
 * hand and a string where a byte offset should be must not reach the measurement. "Unknown" is a
 * first-class answer here anyway, so a value that fails the check simply becomes one.
 */
export function getLogTailMark(charId: string): LogTailMark | undefined {
  const held = settingsStore.get('logTailMarks', {})[charId]
  if (!held || typeof held.offset !== 'number' || !Number.isFinite(held.offset)) return undefined
  if (held.offset < 0) return undefined
  return { offset: Math.round(held.offset), at: typeof held.at === 'number' ? held.at : 0 }
}

/**
 * Record where the tail had read to, for `charId`. Called from `stopSession` on the way out, so it
 * is best-effort by nature: a launch that is killed writes nothing and the next one reports no
 * delta. A negative or non-finite offset is refused rather than written — the only thing worse
 * than an unmeasured launch is a mismeasured one.
 */
export function setLogTailMark(charId: string, offset: number): void {
  if (!charId || !Number.isFinite(offset) || offset < 0) return
  const all = settingsStore.get('logTailMarks', {})
  all[charId] = { offset: Math.round(offset), at: Date.now() }
  settingsStore.set('logTailMarks', all)
}
