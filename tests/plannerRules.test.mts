// PLANNER RULES TESTS — the exaltation mechanics as the wiki states them (design §1, R1–R4).
//
// The worked examples are the point: "a +4 proc costs 15 merge XP ≈ 15 D0 copies, or 1 D4 copy"
// is the sentence the Farm list prints, so it is asserted here as arithmetic derived from
// `expToNextTier` — never as a constant this file also hardcodes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractionCost,
  extractionTier,
  narrowedClasses,
  planWarnings,
  socketCompatibility,
  type DonorIndex
} from '../src/shared/planner/rules'
import type { ExaltPlan, PlannerDonor, SocketType } from '../src/shared/planner/types'
import { EXALTATION_SLOT_TYPES, expToNextTier } from '../src/shared/itemStats'

function donor(over: Partial<PlannerDonor> = {}): PlannerDonor {
  return {
    key: 'ghoulbane',
    name: 'Ghoulbane',
    slots: ['PRIMARY'],
    classes: ['WAR', 'PAL', 'RNG', 'SHD'],
    effect: 'Holy Might',
    socket: 'proc',
    tierRequired: 4,
    hasteLocked: false,
    quest: false,
    playerCrafted: false,
    ...over
  }
}

// ---- R1 --------------------------------------------------------------------------

test('extraction tiers come from the encoded slot table, not from this file', () => {
  assert.equal(extractionTier('focus'), 1)
  assert.equal(extractionTier('click'), 2)
  assert.equal(extractionTier('worn'), 3)
  assert.equal(extractionTier('proc'), 4)
  // The identity: each socket's extraction tier IS its unlock tier in EXALTATION_SLOT_TYPES, so
  // the conservative fallback inside extractionTier can never apply silently.
  for (const socket of ['focus', 'click', 'worn', 'proc'] as SocketType[]) {
    const row = EXALTATION_SLOT_TYPES.find((s) => s.type.toLowerCase() === socket)
    assert.ok(row, `${socket} must exist in EXALTATION_SLOT_TYPES`)
    assert.equal(extractionTier(socket), row.unlocksAt)
  }
})

// ---- R4 --------------------------------------------------------------------------

test('a +4 proc costs 15 merge XP — 15 D0 copies, or 1 D4 copy', () => {
  const proc = extractionCost(4)
  assert.deepEqual(proc, { tier: 4, xp: 15, d0Copies: 15, d4Copies: 1 })
  // Derived, not restated: 1 + 2 + 4 + 8 is exactly the curve itemStats encodes.
  assert.equal(proc.xp, [0, 1, 2, 3].reduce((n, t) => n + (expToNextTier(t) ?? 0), 0))
})

test('every extraction tier is 2^tier − 1, and a D4 drop is already there', () => {
  for (const tier of [1, 2, 3, 4] as const) {
    const cost = extractionCost(tier)
    assert.equal(cost.xp, 2 ** tier - 1, `tier ${tier} XP`)
    assert.equal(cost.d0Copies, cost.xp, 'a D0 copy is worth exactly 1 merge XP')
    // R4: D-tier drops arrive PRE-PLUSSED, so a D4 drop is at +4 before any merging — for every
    // tier the planner cares about, the first one you loot is already extractable.
    assert.equal(cost.d4Copies, 1, `tier ${tier} should need a single D4 copy`)
  }
  assert.equal(extractionCost(1).xp, 1, 'a focus effect extracts at +1')
  assert.equal(extractionCost(2).xp, 3)
  assert.equal(extractionCost(3).xp, 7)
})

// ---- R2 / R3 ---------------------------------------------------------------------

test('a transfer needs a shared slot and a shared class', () => {
  const d = donor()
  assert.deepEqual(socketCompatibility(d, ['PRIMARY'], ['PAL']), { ok: true })
  assert.deepEqual(socketCompatibility(d, ['SECONDARY'], ['PAL']), { ok: false, reason: 'slot' })
  assert.deepEqual(socketCompatibility(d, ['PRIMARY'], ['NEC']), { ok: false, reason: 'class' })
  // A 2H proc is PRIMARY-only; a host that can be either still matches on the overlap.
  assert.deepEqual(socketCompatibility(d, ['PRIMARY', 'SECONDARY'], ['WAR', 'CLR']), { ok: true })
})

test('haste never travels, whatever the slot and class say (R3)', () => {
  const hasted = donor({ effect: 'Haste', hasteLocked: true })
  assert.deepEqual(socketCompatibility(hasted, ['PRIMARY'], ['PAL']), { ok: false, reason: 'haste' })
})

test('an unstated slot or class list is not a pass', () => {
  assert.deepEqual(socketCompatibility(donor({ slots: [] }), ['PRIMARY'], ['PAL']), {
    ok: false,
    reason: 'slot'
  })
  assert.deepEqual(socketCompatibility(donor({ classes: [] }), ['PRIMARY'], ['PAL']), {
    ok: false,
    reason: 'class'
  })
  // …but a set with no trio chosen yet is asking for NO class filter, not for zero classes.
  assert.deepEqual(socketCompatibility(donor(), ['PRIMARY'], []), { ok: true })
})

test('socketing narrows the host class list to the overlap', () => {
  assert.deepEqual(narrowedClasses(['WAR', 'PAL', 'RNG', 'SHD', 'BRD', 'ROG'], ['WAR', 'PAL', 'RNG', 'SHD']), [
    'WAR',
    'PAL',
    'RNG',
    'SHD'
  ])
  assert.deepEqual(narrowedClasses(['WAR'], ['CLR']), [], 'no overlap narrows to nobody')
  // An empty list is UNKNOWN, so it narrows nothing rather than claiming an empty intersection.
  assert.deepEqual(narrowedClasses([], ['WAR', 'PAL']), ['WAR', 'PAL'])
  assert.deepEqual(narrowedClasses(['WAR', 'PAL'], []), ['WAR', 'PAL'])
})

// ---- set lint --------------------------------------------------------------------

function plan(over: Partial<ExaltPlan> = {}): ExaltPlan {
  return {
    id: 'p1',
    name: 'Tank',
    classes: ['WAR', 'PAL', 'SHD'],
    createdAt: 0,
    updatedAt: 0,
    slots: {},
    ...over
  }
}

const index = (donors: PlannerDonor[]): DonorIndex => {
  const m = new Map<string, PlannerDonor[]>()
  for (const d of donors) m.set(d.key, [...(m.get(d.key) ?? []), d])
  return m
}

test('a clean plan warns about nothing', () => {
  const p = plan({
    slots: {
      PRIMARY: { hostKey: 'fiery avenger', hostName: 'Fiery Avenger', sockets: { proc: { effect: 'Holy Might', donorKey: 'ghoulbane' } } }
    }
  })
  assert.deepEqual(planWarnings(p, index([donor()])), [])
})

test('the set lint names every unreachable socket', () => {
  const p = plan({
    classes: ['NEC', 'WIZ', 'ENC'],
    slots: {
      // wrong classes for the trio, and no host picked
      PRIMARY: { sockets: { proc: { effect: 'Holy Might', donorKey: 'ghoulbane' } } },
      // donor exists but belongs on a weapon
      HEAD: { hostKey: 'crown', sockets: { proc: { effect: 'Holy Might', donorKey: 'ghoulbane' } } },
      // haste can't be moved at all
      WRIST: { hostKey: 'bracer', sockets: { worn: { effect: 'Haste', donorKey: 'flowing black robe' } } },
      // the donor key isn't in the database
      NECK: { hostKey: 'chain', sockets: { click: { effect: 'Gate', donorKey: 'no such item' } } }
    }
  })
  const donors = index([
    donor(),
    donor({
      key: 'flowing black robe',
      name: 'Flowing Black Robe',
      effect: 'Haste',
      socket: 'worn',
      tierRequired: 3,
      hasteLocked: true,
      slots: ['CHEST', 'WRIST'],
      classes: ['NEC', 'WIZ', 'ENC', 'MAG']
    })
  ])
  const kinds = planWarnings(p, donors)
    .map((w) => `${w.slot}:${w.kind}`)
    .sort()
  assert.deepEqual(kinds, ['HEAD:slot', 'NECK:unknown-donor', 'PRIMARY:class', 'PRIMARY:no-host', 'WRIST:haste'])
  // Messages state the situation, not the method (UI convention), and name the donor.
  const haste = planWarnings(p, donors).find((w) => w.kind === 'haste')
  assert.ok(haste?.message.includes('Flowing Black Robe'))
  assert.equal(haste.socket, 'worn')
})

test('the lint runs per CELL, and R2 is still asked about the SLOT (JOS-67)', () => {
  // A ring donor planned into BOTH ring cells is legal twice over: `equipSlotOf('FINGER2')` is
  // FINGER, so the compatibility question is unchanged, and the two cells are two sockets rather
  // than one. Before JOS-67 the second one could not be expressed at all.
  const ring = donor({
    key: 'ring of pureblood',
    name: 'Ring of Pureblood',
    effect: 'Improved Healing II',
    socket: 'focus',
    tierRequired: 1,
    slots: ['FINGER'],
    classes: ['PAL', 'CLR']
  })
  const both = plan({
    classes: ['PAL'],
    slots: {
      FINGER: { hostKey: 'ring a', sockets: { focus: { effect: ring.effect, donorKey: ring.key } } },
      FINGER2: { hostKey: 'ring b', sockets: { focus: { effect: ring.effect, donorKey: ring.key } } }
    }
  })
  assert.deepEqual(planWarnings(both, index([ring])), [])

  // …and when a cell IS wrong, the message names the cell the user is looking at, not the slot.
  const misplaced = plan({
    classes: ['PAL'],
    slots: {
      FINGER2: { hostKey: 'ring b', sockets: { proc: { effect: 'Holy Might', donorKey: 'ghoulbane' } } }
    }
  })
  const [warning] = planWarnings(misplaced, index([donor()]))
  assert.equal(warning.slot, 'FINGER2')
  assert.equal(warning.kind, 'slot')
  assert.ok(warning.message.includes('FINGER 2'), warning.message)
})

test('an ANY cell lets every SLOT through and still enforces class and haste (JOS-104)', () => {
  // The two any-slots are places, not slots: `hostSlotsOf('ANY1')` is all eighteen, so the slot
  // half of R2 cannot fail there. That is the fix — a v0.12.0 player reported the cells missing
  // entirely, and a cell that then refused the chest piece they are wearing in it would be worse
  // than no cell at all.
  const ghoulbane = donor() // PRIMARY only, WAR/PAL/RNG/SHD
  const anywhere = plan({
    classes: ['PAL'],
    slots: {
      ANY1: { hostKey: 'brigandine tunic', sockets: { proc: { effect: 'Holy Might', donorKey: 'ghoulbane' } } },
      ANY2: { hostKey: 'midnight clad straps', sockets: { proc: { effect: 'Holy Might', donorKey: 'ghoulbane' } } }
    }
  })
  assert.deepEqual(planWarnings(anywhere, index([ghoulbane])), [], 'a PRIMARY donor is legal in an any-cell')
  // The same donor in the CHEST cell is not, which is what makes the line above a real difference
  // rather than the lint having gone quiet everywhere.
  const chest = plan({
    classes: ['PAL'],
    slots: { CHEST: { hostKey: 'brigandine tunic', sockets: { proc: { effect: 'Holy Might', donorKey: 'ghoulbane' } } } }
  })
  assert.equal(planWarnings(chest, index([ghoulbane]))[0]?.kind, 'slot')

  // …and "no slot restriction" is not "no restriction". Class overlap and the haste lock are
  // properties of the donor and the set, and an any-slot is not a permit for either.
  const wrongClass = plan({
    classes: ['ENC'],
    slots: { ANY1: { hostKey: 'robe', sockets: { proc: { effect: 'Holy Might', donorKey: 'ghoulbane' } } } }
  })
  assert.equal(planWarnings(wrongClass, index([ghoulbane]))[0]?.kind, 'class')

  const hasted = donor({
    key: 'flowing black robe',
    name: 'Flowing Black Robe',
    effect: 'Haste',
    socket: 'worn',
    tierRequired: 3,
    hasteLocked: true,
    slots: ['CHEST'],
    classes: ['ENC']
  })
  const hasteInAny = plan({
    classes: ['ENC'],
    slots: { ANY2: { hostKey: 'robe', sockets: { worn: { effect: 'Haste', donorKey: hasted.key } } } }
  })
  assert.equal(planWarnings(hasteInAny, index([hasted]))[0]?.kind, 'haste')

  // A donor whose page states NO slot still fails everywhere, any-cell included: R2 needs a shared
  // slot and it shares none (law 1 — an absent fact is not a pass).
  const slotless = donor({ key: 'potion', name: 'Potion', effect: 'Gate', socket: 'click', tierRequired: 2, slots: [] })
  const slotlessInAny = plan({
    classes: [],
    slots: { ANY1: { hostKey: 'brigandine tunic', sockets: { click: { effect: 'Gate', donorKey: 'potion' } } } }
  })
  assert.equal(planWarnings(slotlessInAny, index([slotless]))[0]?.kind, 'slot')

  // The message names the CELL the user is looking at, in the client's own words.
  assert.ok(planWarnings(slotlessInAny, index([slotless]))[0].message.includes('ANY SLOT 1'))
})

test('an empty slot with no sockets is quiet, not an error', () => {
  const p = plan({ slots: { HEAD: { sockets: {} }, CHEST: { hostKey: 'robe', sockets: {} } } })
  assert.deepEqual(planWarnings(p, index([])), [])
})

test('a donor key that carries several effects resolves by effect name', () => {
  const multi = [
    donor({ key: 'multi', name: 'Multi', effect: 'Holy Might', socket: 'proc', tierRequired: 4 }),
    donor({ key: 'multi', name: 'Multi', effect: 'Gate', socket: 'click', tierRequired: 2 })
  ]
  const p = plan({
    slots: {
      PRIMARY: {
        hostKey: 'host',
        sockets: {
          proc: { effect: 'Holy Might', donorKey: 'multi' },
          click: { effect: 'Gate', donorKey: 'multi' }
        }
      }
    }
  })
  assert.deepEqual(planWarnings(p, index(multi)), [])
  // …and an effect that item does not carry is an unknown donor, not a silent pass.
  const wrong = plan({
    slots: { PRIMARY: { hostKey: 'host', sockets: { proc: { effect: 'Lifetap', donorKey: 'multi' } } } }
  })
  assert.deepEqual(planWarnings(wrong, index(multi)).map((w) => w.kind), ['unknown-donor'])
})
