// EXALTATION PLANNER — the set's class trio is a FILTER, not a rule (planner-v2 V2).
//
// The rules under test are the ones a screenshot cannot show: WHEN a set's trio follows live
// class-combo inference, when it stops, when the app is allowed to offer a different answer, and
// what happens to work already in the build when the filter moves under it. All four were the
// owner's report — a planner stuck on `rog pal ber` hours after the truth became `pal enc mnk`,
// with no way to say so — so they are pinned here rather than left to the view that draws them.
//
// Pure: `plannerClasses.ts` takes relative value imports and touches no React, no storage and no
// corpus (the plannerGroups precedent), so this suite loads nothing and never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ClassAbbr } from '../src/shared/classCombo'
import type { ExaltPlan } from '../src/shared/planner/types'
import {
  boundClasses,
  classesMismatch,
  detectedOffer,
  provenanceOf,
  sameClasses
} from '../src/renderer/src/features/planner/plannerClasses'

/** Only the two fields these rules read — the functions take exactly that much of a plan. */
type Trio = Pick<ExaltPlan, 'classes' | 'classesProvenance'>

const following = (classes: ClassAbbr[]): Trio => ({ classes, classesProvenance: 'detected' })
const pinned = (classes: ClassAbbr[]): Trio => ({ classes, classesProvenance: 'user' })

// ------------------------------------------------------------------ provenance

test('a set with no stated provenance is PINNED — the pre-V2 store is authored work', () => {
  assert.equal(provenanceOf({}), 'user')
  assert.equal(provenanceOf({ classesProvenance: 'detected' }), 'detected')
  assert.equal(provenanceOf({ classesProvenance: 'user' }), 'user')
})

test('trios compare as SETS — pick order is an editing artefact, never a difference', () => {
  assert.ok(sameClasses(['PAL', 'ENC', 'MNK'], ['MNK', 'PAL', 'ENC']))
  assert.ok(!sameClasses(['PAL', 'ENC'], ['PAL', 'ENC', 'MNK']))
  assert.ok(sameClasses([], []))
})

// ------------------------------------------------------------------ the binding

test('a FOLLOWING set takes the detected trio when the two disagree', () => {
  assert.deepEqual(boundClasses(following(['ROG', 'PAL', 'BER']), ['PAL', 'ENC', 'MNK']), [
    'PAL',
    'ENC',
    'MNK'
  ])
})

test('the binding settles: once they agree there is nothing to write', () => {
  assert.equal(boundClasses(following(['PAL', 'ENC', 'MNK']), ['MNK', 'ENC', 'PAL']), null)
})

test('a PINNED set is never rewritten by detection', () => {
  assert.equal(boundClasses(pinned(['ROG', 'PAL', 'BER']), ['PAL', 'ENC', 'MNK']), null)
  // …and a set that predates the field is pinned by that rule alone.
  assert.equal(boundClasses({ classes: ['ROG'] }, ['PAL', 'ENC', 'MNK']), null)
})

test('an UNRESOLVED combo writes nothing — an empty filter means "all classes", never "none"', () => {
  // Law 1 at its sharpest: detection knowing nothing must not widen the set's filter to everything.
  assert.equal(boundClasses(following(['ROG', 'PAL', 'BER']), []), null)
})

// ------------------------------------------------------------------ the disagree chip

test('the chip is offered only on a pinned set that disagrees with detection', () => {
  assert.deepEqual(detectedOffer(pinned(['ROG', 'PAL', 'BER']), ['PAL', 'ENC', 'MNK']), [
    'PAL',
    'ENC',
    'MNK'
  ])
  assert.equal(detectedOffer(pinned(['PAL', 'ENC', 'MNK']), ['MNK', 'PAL', 'ENC']), null)
  assert.equal(detectedOffer(pinned(['ROG']), []), null)
  // A following set has already taken the answer — offering it back would be noise.
  assert.equal(detectedOffer(following(['ROG', 'PAL', 'BER']), ['PAL', 'ENC', 'MNK']), null)
})

// ------------------------------------------------------------------ the mismatch

test('a mismatch needs BOTH lists to be stated — silence is never a mismatch', () => {
  assert.ok(classesMismatch(['ENC', 'MAG'], ['PAL', 'ROG', 'BER']))
  assert.ok(!classesMismatch(['ENC', 'PAL'], ['PAL', 'ROG', 'BER']))
  // A donor whose page stated no class list, and a set with no trio picked: both unknown (law 1).
  assert.ok(!classesMismatch([], ['PAL']))
  assert.ok(!classesMismatch(['PAL'], []))
})
