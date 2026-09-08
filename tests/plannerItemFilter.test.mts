// THE ITEM FILTER: WHICH EFFECTS CAN GO IN THE THING I AM HOLDING? (JOS-210, the feature half.)
//
// `itemFits` is the whole rule behind both doors into the narrowed browser — the Inventory tab's
// socket click (V8's preset) and the filter bar's item picker, which reaches any item the committed
// DB carries. It is deliberately NOT a second opinion about compatibility: R3 and R2's slot half
// come straight out of `socketCompatibility` (shared/planner/rules.ts) and the class half out of
// `classesMismatch`, so a donor hidden here and a donor warned about on the Board can never drift.
//
// WHAT ONLY A TEST CAN PIN is the one place a FILTER must disagree with the lint: an UNKNOWN.
// `socketCompatibility` refuses to pass a donor whose page states no class list, because a planned
// socket has to report which fact is missing; a browser filter that did the same would hide real
// answers on the strength of a sentence the wiki never wrote (law 1). Both directions of that
// unknown are asserted below, in both dimensions, because the asymmetry is the design.
//
// A FIXTURE rather than the real corpus (the plannerFilter.test.mts precedent): four hand-written
// donors can state "haste", "wrong slot" and "no class list stated" in a way no scraped row would
// let a test name.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemFits, type ItemFocus } from '../src/renderer/src/features/planner/plannerPreset'
import type { ClassAbbr } from '../src/shared/classCombo'
import type { EquipSlot, PlannerDonor } from '../src/shared/planner/types'

interface Spec {
  name: string
  slots?: EquipSlot[]
  classes?: ClassAbbr[]
  hasteLocked?: boolean
}

function donor(spec: Spec): PlannerDonor {
  return {
    key: spec.name.toLowerCase(),
    name: spec.name,
    slots: spec.slots ?? ['PRIMARY'],
    classes: spec.classes ?? ['WAR'],
    effect: `${spec.name} Effect`,
    socket: 'proc',
    tierRequired: 4,
    hasteLocked: spec.hasteLocked ?? false,
    quest: false,
    playerCrafted: false
  }
}

function item(spec: { slots?: EquipSlot[]; classes?: ClassAbbr[] }): ItemFocus {
  return {
    key: 'host',
    name: 'Host Item',
    slots: spec.slots ?? ['PRIMARY'],
    classes: spec.classes ?? ['WAR']
  }
}

const SWORD = donor({ name: 'Sword', slots: ['PRIMARY', 'SECONDARY'], classes: ['WAR', 'PAL'] })
const RING = donor({ name: 'Ring', slots: ['FINGER'], classes: ['WAR'] })
const HASTE = donor({ name: 'Haste Belt', slots: ['PRIMARY'], classes: ['WAR'], hasteLocked: true })
const SILENT = donor({ name: 'Silent Blade', slots: ['PRIMARY'], classes: [] })
const SLOTLESS = donor({ name: 'Potion', slots: [], classes: ['WAR'] })

test('R2 slot half: the donor and the item must share a place on the body', () => {
  const primary = item({ slots: ['PRIMARY'] })
  assert.equal(itemFits(SWORD, primary), true)
  assert.equal(itemFits(RING, primary), false)
  // The item's OWN slots are what R2 asks about, so a two-slot host takes a donor that shares
  // either one — this is the case a cell-shaped filter (one slot per cell) could not express.
  assert.equal(itemFits(donor({ name: 'Offhand', slots: ['SECONDARY'] }), item({ slots: ['PRIMARY', 'SECONDARY'] })), true)
})

test('a donor whose page states NO slot can never donate, whatever the host is', () => {
  // Same rule as the browser's non-equippable filter: it shares a slot with nothing (R2).
  assert.equal(itemFits(SLOTLESS, item({ slots: ['PRIMARY'] })), false)
  assert.equal(itemFits(SLOTLESS, item({ slots: [] })), false)
})

test('an item whose slots are UNKNOWN narrows nothing rather than matching nothing', () => {
  // The picker only offers items that state a slot, so this is a preset host the index does not
  // carry — and blanking the browser over a gap in our own data would be law 1 backwards.
  const unknown = item({ slots: [], classes: [] })
  assert.equal(itemFits(SWORD, unknown), true)
  assert.equal(itemFits(RING, unknown), true)
})

test('R3: haste never travels, whatever else lines up', () => {
  assert.equal(itemFits(HASTE, item({ slots: ['PRIMARY'], classes: ['WAR'] })), false)
})

test('R2 class half: a provable disagreement hides the row, an unknown never does', () => {
  assert.equal(itemFits(SWORD, item({ classes: ['PAL'] })), true)
  assert.equal(itemFits(SWORD, item({ classes: ['CLR'] })), false)
  // Neither side's silence is a mismatch (law 1) — the row is shown, and chipped elsewhere.
  assert.equal(itemFits(SILENT, item({ classes: ['CLR'] })), true)
  assert.equal(itemFits(SWORD, item({ classes: [] })), true)
})
