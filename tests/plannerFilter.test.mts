// THE EFFECT BROWSER'S FILTER, AND WHAT IT OWES YOU WHEN IT HIDES EVERYTHING (JOS-67).
//
// `filterDonors` is six rules in a row and two of them are TOGGLES the user did not set: the
// current-era filter is on by default and the no-slot filter is off by default. Either can empty a
// search that was typed perfectly, and until this ticket the pane answered "No effects match these
// filters" and stopped there. A player hit exactly that — the Golem Metal Wand's click was real,
// legal for the shield they wanted it in, and invisible because its page states its slot on a line
// the scrape cannot key, so the row arrived slotless and the default filter dropped it (feedback
// 01KZCGXY8WC6YCD8W44W7EAS5H). The data half is fixed in the curated layer; THIS half is the
// promise that the next one says so out loud.
//
// A FIXTURE, like plannerGroups.test.mts beside it: the numbers here are about the FOLD, and four
// hand-written rows can state "slotless", "out of era" and "both at once" in a way the real corpus
// would never let a test name. The corpus's own slot half is `itemsResearchLayer.test.mts`.
//
// `hiddenByView` reports PER TOGGLE — "turn this one off and you would see N" — rather than one
// total, because the two mean different things (era is "not on this server yet", no-slot is "R2
// says never") and only the per-toggle answer is something a person can act on.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_FILTERS,
  DEFAULT_VIEW,
  filterDonors,
  hiddenByView,
  type DonorRow,
  type DonorView
} from '../src/renderer/src/features/planner/plannerData'
import type { EquipSlot } from '../src/shared/planner/types'

interface Spec {
  name: string
  slots?: EquipSlot[]
  /** the page-top banner — the only era witness a fixture row can carry (no catalog zones exist) */
  eraTag?: string
}

function row(spec: Spec): DonorRow {
  const name = spec.name
  return {
    key: name.toLowerCase(),
    name,
    slots: spec.slots ?? ['PRIMARY'],
    classes: [],
    effect: `${name} Effect`,
    socket: 'click',
    tierRequired: 2,
    hasteLocked: false,
    quest: false,
    playerCrafted: false,
    eraTag: spec.eraTag,
    searchKey: `${name} ${name} effect`.toLowerCase()
  }
}

// Four rows spanning the two toggles: in-era + slotted (the only one visible by default), slotless,
// out-of-era, and one that is both.
const PLAIN = row({ name: 'Plain Wand', eraTag: 'Classic' })
const SLOTLESS = row({ name: 'Slotless Potion', slots: [], eraTag: 'Classic' })
const LATER = row({ name: 'Later Wand', eraTag: 'Velious' })
const BOTH = row({ name: 'Later Potion', slots: [], eraTag: 'Velious' })
const ROWS: DonorRow[] = [PLAIN, SLOTLESS, LATER, BOTH]

/** The browser's own defaults: click tab (these rows' socket), no text, no slot, no trio. */
const FILTERS = { ...DEFAULT_FILTERS, socket: 'click' as const }
const names = (view: DonorView): string[] =>
  filterDonors(ROWS, FILTERS, [], view).map((d) => d.name)

test('the two view toggles are the ones that hide a legal answer', () => {
  // DEFAULT_VIEW is era-on, slots-off — the state every user meets on their first visit.
  assert.deepEqual(names(DEFAULT_VIEW), ['Plain Wand'])
  assert.deepEqual(names({ eraOnly: false, nonEquip: false }), ['Plain Wand', 'Later Wand'])
  assert.deepEqual(names({ eraOnly: true, nonEquip: true }), ['Plain Wand', 'Slotless Potion'])
  assert.deepEqual(names({ eraOnly: false, nonEquip: true }), ROWS.map((r) => r.name))
})

test('an empty list can say which toggle is holding the answers back', () => {
  // Search for the slotless row by name: it matches, and the default view drops it. This is the
  // reported case, in miniature.
  const filters = { ...FILTERS, text: 'slotless' }
  assert.equal(filterDonors(ROWS, filters, [], DEFAULT_VIEW).length, 0)
  assert.deepEqual(hiddenByView(ROWS, filters, [], DEFAULT_VIEW), { era: 0, nonEquip: 1 })

  // The other toggle, on its own.
  const later = { ...FILTERS, text: 'later wand' }
  assert.deepEqual(hiddenByView(ROWS, later, [], DEFAULT_VIEW), { era: 1, nonEquip: 0 })

  // Both at once: the row that is out of era AND slotless is counted by each toggle, because
  // releasing either one alone is what each number promises.
  const both = { ...FILTERS, text: 'later potion' }
  assert.deepEqual(hiddenByView(ROWS, both, [], DEFAULT_VIEW), { era: 1, nonEquip: 1 })
})

test('a toggle already released never claims to be hiding anything', () => {
  // The counts are about what RELEASING a filter would reveal, so a filter that is off contributes
  // zero — otherwise the empty state would blame a control the user already turned off.
  const filters = { ...FILTERS, text: 'later potion' }
  assert.deepEqual(hiddenByView(ROWS, filters, [], { eraOnly: false, nonEquip: true }), {
    era: 0,
    nonEquip: 0
  })
})

test('a genuine miss reports nothing hidden — the honest empty state stays honest', () => {
  const filters = { ...FILTERS, text: 'no such thing' }
  assert.deepEqual(hiddenByView(ROWS, filters, [], DEFAULT_VIEW), { era: 0, nonEquip: 0 })
})
