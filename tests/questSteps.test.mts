// QUEST STEPS OUT OF THE COMMITTED WIKITEXT (EQ Zera, ROADMAP item 1, step 1).
//
// `quests.json` used to carry a quest's name, giver, zone, items and rewards but not what to DO —
// the quest-item pop-up needs the steps. They are extracted OFFLINE from the wikitext cache under
// scripts/sources/cache/quests/ by `extractSteps`, and these are that extractor's pins, run
// against committed pages verbatim, one per shape the wiki uses:
//
//   page-15127  "Quick List"           — bullet list with '''sub-quest''' titles and Note lines
//   page-15098  "Checklist"            — {{CheckboxList}} bullets
//   page-15165  Checklist + Short Walkthrough + Walkthrough — the most condensed one wins
//   page-15202  "High-level Checklist" — the heading VARIANT still counts as a checklist
//   page-15092  "Walkthrough" only     — hail/hand-in prose with `:NPC says` replies and facblocks
//   page-15860  no step heading at all — custom sections ("Obtaining the Orders", "The War")
//   page-60118  an ITEM page filed under Category:Quests — no headings, so no steps
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractSteps, parseQuestPage } from '../scripts/sources/questPage'

const CACHE = join(import.meta.dirname, '..', 'scripts', 'sources', 'cache', 'quests')
const page = (id: number): string => readFileSync(join(CACHE, `page-${id}.wikitext`), 'utf8')
// Links, bold, templates, tags. `<[a-z]` and not `<\w`: "Trivial <157" is a smithing note, not a tag.
const NO_MARKUP = /\[\[|\]\]|'''|\{\{|\}\}|<[a-z]/i

test('Quick List: bullets become steps, item links become plain names, sub-quest titles survive as lines', () => {
  const steps = extractSteps(page(15127))
  assert.ok(steps.length >= 12, `expected the three-part list, got ${steps.length}`)
  assert.equal(steps[0], 'Initiate Symbol of Tunare')
  assert.equal(steps[1], '(Optional) Northern Felwithe: Give Yeolarn Bronzeleaf 4x Bone Chips')
  assert.ok(steps.some((s) => s.startsWith('Lesser Faydark: Kill A rancorous ghast')), 'a kill step')
  assert.ok(steps.some((s) => s.startsWith('Note: The hearts can be MQ')), 'a Note line is kept — it is advice')
  for (const s of steps) {
    assert.doesNotMatch(s, NO_MARKUP, `wiki markup left in: ${s}`)
    assert.doesNotMatch(s, /^\*/, `bullet left in: ${s}`)
  }
})

test('Checklist: the {{CheckboxList}} template vanishes and each item line is a step', () => {
  const steps = extractSteps(page(15098))
  assert.equal(steps.length, 4)
  assert.equal(steps[0], 'Rune of Clay (Top) - From Findlegrob in Rathe Mountains')
  assert.equal(steps[3], 'Rune of Clay (Bottom) - From A Goblin Headmaster in Ocean of Tears')
})

test('PRECEDENCE: a Checklist beats a Short Walkthrough beats a Walkthrough; sub-headings become lines', () => {
  const steps = extractSteps(page(15165))
  assert.equal(steps[0], "Maestro's Symphony Page 24 Top:")
  assert.ok(steps[1].startsWith('Talk to Konia Swiftfoot in Western Karana'))
  assert.ok(!steps.some((s) => s.startsWith('The Quest starts in the Dreadlands')), 'the Short Walkthrough prose was not used')
  // A heading VARIANT still counts: "High-level Checklist" wins over that page's Short Walkthrough.
  const ragebringer = extractSteps(page(15202))
  assert.ok(ragebringer.length >= 5)
  assert.ok(!ragebringer.some((s) => s.startsWith('The quest starts out in the Qeynos Aqueducts')), 'checklist, not prose')
  // Synthetic: with no checklist the short one wins; with neither, "Walkthrough with Dialogue" counts.
  assert.deepEqual(extractSteps('== Walkthrough ==\nLong version\n== Short Walkthrough ==\n*Short version\n'), ['Short version'])
  assert.deepEqual(extractSteps('== Walkthrough with Dialogue ==\nHand him the [[Thing]].\n'), ['Hand him the Thing.'])
})

test('Walkthrough fallback: hails and hand-ins are steps; replies, faction lines and exp markers are not', () => {
  const steps = extractSteps(page(15092))
  assert.deepEqual(steps.slice(0, 3), ["You Say 'Hail Vurgo'", "You Say 'What harvester?'", 'Hand Vurgo the Shadowed Scythe'])
  assert.ok(steps.some((s) => s.startsWith('Hand Vurgo the Note from above, the Fungus Eye, the Shadowed Knife, and Fire Opal')))
  for (const s of steps) {
    assert.doesNotMatch(s, /^Vurgo says/, `NPC reply leaked: ${s}`)
    assert.doesNotMatch(s, /faction standing|You gain experience|Category:/i, `side-effect line leaked: ${s}`)
    assert.doesNotMatch(s, NO_MARKUP, `wiki markup left in: ${s}`)
  }
})

test('no step heading at all: every section that is not a reward/notes/related section, in order', () => {
  const steps = extractSteps(page(15860)) // 10th Coldain Ring Quest
  assert.equal(steps[0], 'Obtaining the Orders:')
  assert.ok(steps.length >= 8, `got ${steps.length}`)
  assert.ok(steps.includes('The War:'), 'custom sections become group lines')
  assert.ok(!steps.includes('Additional Rewards:'), 'a rewards section is never a step')
  for (const s of steps) assert.doesNotMatch(s, NO_MARKUP, `wiki markup left in: ${s}`)
})

test('an item page filed under Quests has no headings, so it has no steps (and no template debris)', () => {
  assert.deepEqual(extractSteps(page(60118)), []) // "A sealed letter"
  assert.deepEqual(extractSteps('== Reward ==\n{{:Some Sword}}\n'), [])
  assert.deepEqual(extractSteps('== Walkthrough ==\n=== Stage 1 ===\n'), [], 'a sub-heading with nothing under it')
})

test('parseQuestPage carries the steps', () => {
  assert.ok(parseQuestPage('Vurgo', page(15092)).steps.length >= 4)
})
