// questStepsSig.ts — A HAND TICK IS A STEP INDEX, SO IT IS ONLY TRUE OF THE STEP LIST IT WAS MADE ON.
//
// The tracker stores the steps a player ticked by hand as bare indexes (shared/questPins.ts). When a
// quest's step list changes under them — a parser fix, a wiki edit, a refresh — index 1 names a
// different step and the tick becomes a claim the player never made. MEASURED: Harvester Quest went
// from 4 to 7 steps on 2026-11-25 (its `== Checklist =={{CheckboxList}}` heading became readable),
// so an old tick on "You Say 'What harvester?'" would now tick "Shadowed Scythe (drops off a shadowed
// man)" as had.
//
// SO EVERY PIN CARRIES THE SIGNATURE OF THE LIST ITS TICKS WERE MADE ON (`QuestPin.stepsSig`: the
// step count and a hash of the texts), and the read path drops a quest's hand ticks when the
// catalog's list no longer matches. Only HAND ticks: the log's own ticks are re-derived from the
// evidence on every read (shared/questProgress.ts) and never stored. The completion note
// (`doneAt`) is not a step and stays.
//
// A PIN STORED BEFORE SIGNATURES has nothing to compare, and the old text is gone. The only quests
// whose step list moved in this release are listed in `STEPS_CHANGED_THIS_RELEASE` — computed by
// diffing every quest's steps in v1.30.1's quests.json against this one: 26 quests' texts changed,
// 25 of them only by re-rendering a step in place (a `{{Loc}}` point written out, a heading line
// reformatted), same count and every step at its index; Harvester Quest alone moved its steps. A
// legacy pin on a listed page loses its hand ticks once; every other legacy pin adopts the current
// signature with its ticks intact. Either way the pin then carries a signature, so this is a
// one-time step per pin, applied lazily on read (main's store accessor writes the result back).
//
// THE WRITE PATH ADOPTS: the renderer's ticks were made against the catalog this build ships, so
// what it writes is stamped with the current signature, never judged against an older one.
//
// PURE; tests/questStepsSig.test.mts.

import type { QuestPin, QuestPins } from './questPins'

/** Pages whose step LIST (not just a step's wording) changed since the previous release, v1.30.1. */
export const STEPS_CHANGED_THIS_RELEASE: ReadonlySet<string> = new Set(['Harvester Quest'])

/** `count:fnv1a32(texts)`. A step list's identity, short enough to store on every pin. */
export function stepsSignature(steps: readonly string[]): string {
  // The unit separator cannot occur in a step's text; escaped, never written raw (AGENTS.md).
  const text = steps.join('\u001f')
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${String(steps.length)}:${h.toString(16).padStart(8, '0')}`
}

/** The well-formed shape, for the sanitizer. */
export const STEPS_SIG_RE = /^\d{1,4}:[0-9a-f]{8}$/

type StepsOf = (page: string) => readonly string[] | undefined

/** One pin, read against the catalog. Null when nothing about it changes. */
function reconcileOne(pin: QuestPin, stepsOf: StepsOf, changed: ReadonlySet<string>): QuestPin | null {
  const steps = stepsOf(pin.page)
  if (steps === undefined) return null
  const sig = stepsSignature(steps)
  if (pin.stepsSig === sig) return null
  const stale = pin.stepsSig !== undefined || changed.has(pin.page)
  return { ...pin, ticks: stale ? [] : pin.ticks, stepsSig: sig }
}

/**
 * THE READ PATH: drop the hand ticks of every pin whose list changed, adopt the current signature.
 * Returns the SAME array when nothing changed, so the caller can skip a write.
 */
export function reconcileQuestTicks(pins: QuestPins, stepsOf: StepsOf, changed: ReadonlySet<string> = STEPS_CHANGED_THIS_RELEASE): QuestPins {
  let moved = false
  const out = pins.map((p) => {
    const next = reconcileOne(p, stepsOf, changed)
    if (next === null) return p
    moved = true
    return next
  })
  return moved ? out : pins
}

/** THE WRITE PATH: every pin on a catalog quest carries the current list's signature; no tick dropped. */
export function adoptStepsSignatures(pins: QuestPins, stepsOf: StepsOf): QuestPins {
  return pins.map((p) => {
    const steps = stepsOf(p.page)
    return steps === undefined ? p : { ...p, stepsSig: stepsSignature(steps) }
  })
}
