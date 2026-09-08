// V5 — THE FOCUS FAMILY PARSER, against the REAL committed corpus.
//
// The Roman numeral in an effect's name is the ONLY magnitude signal the item corpus carries: no
// percent, no level, no magnitude field exists on any focus row. So the Focus tab's whole ordering
// — group by family, sort tier-desc, crown the best — stands on `parseFocusEffect` reading three
// characters correctly. A hand-written fixture would prove nothing about that; this runs the
// shipped parser over every focus effect name the shipped builder emits.
//
// TWO LAYERS, the same shape as the rest of the planner suite:
//   1. THE CORPUS SWEEP — every distinct focus name parses, no name loses its stem, and the
//      per-name results are printed so a rescrape that invents a new spelling is readable rather
//      than merely red.
//   2. THE HAND CASES — the three shapes the corpus contains (Roman rank, arabic bard modifier,
//      no rank at all) plus the ones it does not, which are the ones a future scrape might.
//
// LAW 1 IS THE POINT OF THE THIRD SHAPE: "Minion of Air" has no numeral, and that does NOT make it
// tier 0 of some guessed family. An unranked focus name IS its own family, at tier 1.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import itemsJson from '../src/main/data/items.json'
import type { ItemDbFile } from '../src/main/itemsDb'
import { buildPlannerDonors } from '../src/main/planner/effectIndex'
import { parseFocusEffect } from '../src/shared/planner/normalize'

const donors = buildPlannerDonors(itemsJson as unknown as ItemDbFile)
const focus = donors.filter((d) => d.socket === 'focus')
const names = [...new Set(focus.map((d) => d.effect))].sort()

test('every focus effect name in the corpus parses into a family and a tier', () => {
  const families = new Map<string, Set<number>>()
  for (const name of names) {
    const { family, tier } = parseFocusEffect(name)
    assert.ok(family !== '', `${name} parsed to an empty family`)
    assert.ok(tier >= 1, `${name} parsed to tier ${String(tier)} — tiers start at 1 (law 1)`)
    assert.ok(name.startsWith(family), `${name} does not start with its own family "${family}"`)
    const tiers = families.get(family) ?? new Set<number>()
    tiers.add(tier)
    families.set(family, tiers)
  }
  // Printed because THIS is what the Focus tab looks like — a wave that halves the family count
  // should be able to see that it did (AGENTS.md: frozen numbers rot, so nothing below is pinned).
  console.log('focus families', {
    rows: focus.length,
    names: names.length,
    families: families.size,
    detail: Object.fromEntries([...families].map(([f, t]) => [f, [...t].sort((a, b) => a - b)]))
  })
  // FLOORS, under the 2026-08-05 measurement (119 rows / 53 names / 29 families).
  assert.ok(names.length >= 40, `only ${String(names.length)} distinct focus effect names`)
  assert.ok(families.size >= 20, `only ${String(families.size)} focus families`)
})

test('a tiered family folds its ranks together and an untiered name stands alone', () => {
  const tiersOf = (family: string): number[] =>
    [...new Set(names.filter((n) => parseFocusEffect(n).family === family).map((n) => parseFocusEffect(n).tier))].sort()

  // The healer's family, and the one the design doc names: the corpus ships I and III, no II.
  assert.deepEqual(tiersOf('Improved Healing'), [1, 3])
  // Three ranks, all present — the shape the "crown the best" rule was written for.
  assert.deepEqual(tiersOf('Extended Enhancement'), [1, 2, 3])
  // No numeral anywhere in the pet families: five one-member families at tier 1, not one family
  // of five guessed tiers.
  for (const pet of ['Minion of Air', 'Servant of Fire']) {
    assert.deepEqual(parseFocusEffect(pet), { family: pet, tier: 1 })
    assert.ok(names.includes(pet), `${pet} is no longer in the corpus — re-measure this test`)
  }
})

test('only focus rows carry the family fields', () => {
  for (const d of focus) {
    assert.equal(d.family, parseFocusEffect(d.effect).family, `${d.name} / ${d.effect}`)
    assert.equal(d.familyTier, parseFocusEffect(d.effect).tier, `${d.name} / ${d.effect}`)
  }
  // Roman ranks are all over the proc corpus (System Shock V, Berserker Madness IV) and are
  // deliberately NOT parsed: "which is best" is a focus question, and the planner must not claim a
  // comparison the corpus never states.
  const ranked = donors.filter((d) => d.socket !== 'focus' && / [IVX]+$/.test(d.effect))
  assert.ok(ranked.length > 0, 'no ranked non-focus effect names at all — is the corpus still whole?')
  for (const d of ranked.slice(0, 50)) {
    assert.equal(d.family, undefined, `${d.socket} ${d.effect} was given a family`)
    assert.equal(d.familyTier, undefined, `${d.socket} ${d.effect} was given a tier`)
  }
})

test('the parser reads the three shapes, and refuses everything else', () => {
  assert.deepEqual(parseFocusEffect('Improved Healing III'), { family: 'Improved Healing', tier: 3 })
  assert.deepEqual(parseFocusEffect('Burning Affliction II'), { family: 'Burning Affliction', tier: 2 })
  assert.deepEqual(parseFocusEffect('Extended Enhancement'), { family: 'Extended Enhancement', tier: 1 })
  // The bard instrument modifiers: the number is the modifier's own scale, ranked inside its own
  // family and never against a Roman one.
  assert.deepEqual(parseFocusEffect('Percussion Resonance 14'), { family: 'Percussion Resonance', tier: 14 })
  // "Minor Improved Damage" is its OWN family — the name says minor, and folding it into Improved
  // Damage would rank a weaker focus against a stronger one (law 12: renames are knowledge).
  assert.deepEqual(parseFocusEffect('Minor Improved Damage I'), { family: 'Minor Improved Damage', tier: 1 })
  // Non-canonical Roman ("IIII"), a trailing word, and a bare numeral leave the name whole rather
  // than inventing a family: a one-member family is visible in the browser, a mis-tier is not.
  assert.deepEqual(parseFocusEffect('Improved Healing IIII'), { family: 'Improved Healing IIII', tier: 1 })
  assert.deepEqual(parseFocusEffect('Minion of Hate'), { family: 'Minion of Hate', tier: 1 })
  assert.deepEqual(parseFocusEffect('IV'), { family: 'IV', tier: 1 })
  assert.deepEqual(parseFocusEffect('  Spell Haste  II '), { family: 'Spell Haste', tier: 2 })
})
