// lib/outputFreshness.ts — the words on the right-hand end of an `/outputfile` line (JOS-44).
//
// `OutputFileLine` renders three states in ONE slot, and this is the whole rule for which:
//
//   never run  — no file exists, so there is no age to claim and we say that in words.
//   fresh      — "updated just now" / "updated 12m ago".
//   stale      — "updated 3d ago", which is the SAME rendering. There is deliberately no
//                staleness threshold: EverQuest does not define one (a dump is stale the moment
//                you swap an item and fine for a week if you do not), so inventing "⚠ stale after
//                6h" would be the app asserting a game fact nobody measured. The number is the
//                warning, and it is coarse on purpose.
//
// AND SINCE JOS-253 THERE IS A SECOND SLOT BESIDE IT, answering the other half of the question:
// the age above says when the PLAYER wrote the dump, and this says when THIS APP read it. They
// were one number for a long time and it was the wrong one — `inventorySource.loadedAt` is the
// file's mtime, so a surface rendering it was reporting the file's age while looking like it was
// reporting its own. The reported case is what that costs: a dump written between sessions is
// "updated just now" and not loaded at all, and nothing on screen could tell the two apart.
//
// STALENESS IS THE GAP, and it is the only place this file makes a judgement. There is still no
// age threshold (the note above stands — EverQuest defines none), but "the file on disk is newer
// than the copy we read" is not a matter of taste: it is two instants we hold, and one of them is
// behind. `outputIsStale` is that comparison and nothing more.
//
// Pure and React-free so the states are pinned by `tests/outputsRegistry.test.mts` without a DOM,
// and so the component stays a layout.

import { formatAge } from './formatDate'

/** ISO → epoch millis, or undefined when the string is absent or unparseable (never `0`). */
export function outputUpdatedMillis(iso: string | undefined): number | undefined {
  if (iso === undefined) return undefined
  const t = Date.parse(iso)
  return Number.isNaN(t) ? undefined : t
}

/** The age slot's text for a dump last written at `at` (epoch millis), or never. */
export function outputAgeLabel(at: number | undefined, now: number = Date.now()): string {
  if (at === undefined) return 'not yet run'
  return `updated ${formatAge(at, now)}`
}

/**
 * The load slot's text: when this app last read the dump, or that it has not.
 *
 * "not loaded yet" is a DIFFERENT statement from the age slot's "not yet run" and both can be on
 * screen at once — a file the player wrote that we have never opened is precisely the state that
 * has to be sayable, and it is the one a reader of JOS-253 was in.
 */
export function outputLoadedLabel(readAt: number | undefined, now: number = Date.now()): string {
  if (readAt === undefined) return 'not loaded yet'
  return `loaded ${formatAge(readAt, now)}`
}

/**
 * Is the dump on disk newer than what we read? True only when we hold BOTH instants and the file's
 * is later — an unknown answer is never rendered as a warning.
 *
 * ONE SECOND OF SLACK, because the two clocks are the same clock read at different moments: the
 * mtime is stamped by the OS as the game finishes writing and `readAt` by us a settle-threshold
 * later, so they land within a second of each other on every normal load and the ordering between
 * them is not meaningful at that scale. Anything past that is a real gap — the file moved and we
 * did not.
 */
export function outputIsStale(updatedAt: number | undefined, readAt: number | undefined): boolean {
  if (updatedAt === undefined || readAt === undefined) return false
  return updatedAt - readAt > 1000
}
