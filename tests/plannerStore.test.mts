// EXALTATION PLANNER — persistence (docs/plans/exaltation-planner.md D4).
//
// Two promises are under test, and neither can be seen from the renderer:
//
//  1. `ProgressState.exaltPlans` is ADDITIVE. No schema bump, no migration step — so a store
//     written by every build that shipped before the planner must load in today's build
//     BYTE-FOR-BYTE UNCHANGED, and a store carrying plans must survive a build that has never
//     heard of them. That is the whole justification for not shipping a migration with a
//     persisted-shape change, so it gets pinned rather than asserted in a commit message.
//  2. The VALIDATOR is the only door. `store.getExaltPlans` runs it on the way out and
//     `IPC.plannerSetPlans` runs it on the way in, so a valid plan must round-trip untouched
//     (a fixed point) and anything else must be stripped field by field rather than rejected
//     wholesale — losing a user's other nine sets to one bad field is the failure mode.
//
// No Electron: `sanitizeExaltPlans` is pure and `migrateStoreFile` takes a path, so this suite
// is as cheap and as unskippable as storeMigrations'. `src/main/store.ts` itself cannot be
// imported here (electron-store constructs at module scope), which is exactly why its two
// accessors are one line each over the pure functions exercised below.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURRENT_SCHEMA_VERSION } from '../src/main/storeMigrations'
// The FILE half is its own module since JOS-272 — same function, one import line further down.
import { migrateStoreFile } from '../src/main/storeFile'
import { sanitizeExaltPlans } from '../src/main/planner/validate'
import type { ExaltPlan } from '../src/shared/planner/types'

const STORE = 'everquest-companion-progress.json'

/** A scratch store file, cleaned up when `fn` returns. */
function withStore(body: unknown, fn: (path: string, before: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-planner-store-'))
  try {
    const path = join(dir, STORE)
    const text = `${JSON.stringify(body, null, 2)}\n`
    writeFileSync(path, text, 'utf8')
    fn(path, text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The shape a current build writes for a character that has never opened the Planner. */
const prePlannerStore = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  byCharacter: {
    primitive_freeport: {
      inventory: { 'rusty short sword': 2 },
      completedQuests: ['ROG::Test of Stealth'],
      inventorySource: { path: 'C:/eq/Primitive-Inventory.txt', loadedAt: '2026-08-01T10:00:00Z' },
      combo: { corrections: [] }
    }
  },
  activeLogPath: 'C:/eq/Logs/eqlog_Primitive_freeport.txt'
}

/** A fully-populated, VALID plan — the fixed point the round trip must not touch. */
const goodPlan: ExaltPlan = {
  id: '5e2f0d3a-8b91-4c2f-9b7e-1f0c9d4a2b31',
  name: 'Sky clearing set',
  classes: ['PAL', 'ROG', 'BER'],
  createdAt: 1_754_200_000_000,
  updatedAt: 1_754_300_000_000,
  slots: {
    PRIMARY: {
      hostKey: 'ghoulbane',
      hostName: 'Ghoulbane',
      sockets: {
        proc: { effect: 'Nullify Undead', donorKey: 'ghoulbane' },
        focus: { effect: 'Improved Healing I', donorKey: 'emissary mask' }
      }
    },
    FINGER: { hostKey: 'ring of the shissar', sockets: {} },
    // JOS-67 — the SECOND ring, keyed by a cell that is not an equip-slot name. It is in the
    // fixed-point fixture rather than a test of its own because "a plan may say this" is the
    // claim: if the validator ever stopped allowing it, every set carrying a second ring would
    // lose it silently on the next read.
    FINGER2: {
      hostKey: 'ring of pureblood',
      hostName: 'Ring of Pureblood',
      sockets: { focus: { effect: 'Improved Healing II', donorKey: 'ring of pureblood' } }
    },
    // JOS-104 — an ANY SLOT, the other cell key that is not an equip-slot name, and here for the
    // same reason: the widening is additive in both directions, so a plan naming a place the
    // eighteen do not have must survive the round trip untouched. Note the host is a CHEST item,
    // which is what an any-slot is FOR.
    ANY1: {
      hostKey: 'brigandine tunic',
      hostName: 'Brigandine Tunic',
      sockets: { worn: { effect: 'Improved Healing III', donorKey: 'brigandine tunic' } }
    }
  }
}

// ------------------------------------------------------------------ additive key

test('a pre-planner store loads UNCHANGED — the key is additive, no migration runs', () => {
  withStore(prePlannerStore, (path, before) => {
    const result = migrateStoreFile(path)
    assert.equal(result.status, 'up-to-date', 'a current store must need no step')
    assert.equal(result.wrote, false, 'nothing may be rewritten')
    assert.equal(readFileSync(path, 'utf8'), before, 'the file must be byte-identical')
  })
  // …and the reader's answer for a character that has no key at all is the empty list, never
  // undefined: `getExaltPlans` is `sanitizeExaltPlans(progress.exaltPlans)`.
  assert.deepEqual(sanitizeExaltPlans(undefined), [])
})

test('a store WITH plans survives a build that has never heard of them', () => {
  // The downgrade half of the promise: unknown keys are left alone (migrateStoreData never
  // rewrites a store it does not have to), so plans written today are still there tomorrow.
  const withPlans = {
    ...prePlannerStore,
    byCharacter: {
      primitive_freeport: {
        ...prePlannerStore.byCharacter.primitive_freeport,
        exaltPlans: [goodPlan]
      }
    }
  }
  withStore(withPlans, (path, before) => {
    const result = migrateStoreFile(path)
    assert.equal(result.status, 'up-to-date')
    assert.equal(readFileSync(path, 'utf8'), before)
    const reread = JSON.parse(readFileSync(path, 'utf8')) as typeof withPlans
    assert.deepEqual(
      sanitizeExaltPlans(reread.byCharacter.primitive_freeport.exaltPlans),
      [goodPlan],
      'the stored plan must read back exactly as written'
    )
  })
})

// ------------------------------------------------------------------ the validator

test('a valid set round-trips untouched (get/set is a fixed point)', () => {
  const once = sanitizeExaltPlans([goodPlan])
  assert.deepEqual(once, [goodPlan])
  // Sanitizing twice — which is what a write does (handler, then store) — must change nothing.
  assert.deepEqual(sanitizeExaltPlans(once), once)
})

test('malformed input is STRIPPED field by field, never thrown and never wholesale', () => {
  const now = 1_754_400_000_000
  const cleaned = sanitizeExaltPlans(
    [
      // dropped entirely: no id to CRUD it by
      { name: 'no id', classes: ['PAL'], slots: {} },
      'not an object',
      null,
      {
        id: 'plan-2',
        // name missing → a placeholder, never an empty chip
        classes: ['PAL', 'NOPE', 'ROG', 'PAL', 'CLR', 'WAR'], // unknown + duplicate + over the trio cap
        createdAt: 'yesterday', // → now
        updatedAt: Number.NaN, // → createdAt
        slots: {
          PRIMARY: {
            hostKey: 'ghoulbane',
            sockets: {
              proc: { effect: 'Nullify Undead', donorKey: 'ghoulbane' },
              ornament: { effect: 'Sparkles', donorKey: 'x' }, // not one of the four (R5)
              worn: { effect: 'Strength' }, // no donor → unfarmable, dropped
              click: { donorKey: 'ghoulbane' } // no effect → says nothing, dropped
            }
          },
          CHARM: { hostKey: 'nope', sockets: {} }, // not a slot in this corpus
          BOOTS: { hostKey: 'nope', sockets: {} }, // never a slot name at all
          HEAD2: { hostKey: 'nope', sockets: {} }, // JOS-67: only EAR/WRIST/FINGER have a second
          ANY3: { hostKey: 'nope', sockets: {} }, // JOS-104: the game gives exactly two any-slots
          FEET: { sockets: {} } // empty cell: no host, no sockets
        }
      }
    ],
    now
  )

  assert.equal(cleaned.length, 1, 'only the entry with an id survives')
  const plan = cleaned[0]
  assert.equal(plan.id, 'plan-2')
  assert.equal(plan.name, 'Untitled set')
  assert.deepEqual(plan.classes, ['PAL', 'ROG', 'CLR'], 'unknown dropped, dupes folded, capped at 3')
  assert.equal(plan.createdAt, now)
  assert.equal(plan.updatedAt, now, 'a NaN stamp falls back rather than poisoning every sort')
  assert.deepEqual(Object.keys(plan.slots), ['PRIMARY'])
  assert.deepEqual(Object.keys(plan.slots.PRIMARY?.sockets ?? {}), ['proc'])

  // Non-arrays and hostile shapes answer with [], never a throw — this runs on a READ path too.
  for (const bad of [undefined, null, 42, 'plans', {}, { length: 3 }]) {
    assert.deepEqual(sanitizeExaltPlans(bad), [])
  }
})

test('classesProvenance survives when stated and stays ABSENT when it is not (V2)', () => {
  // The field is additive in exactly the way `exaltPlans` itself is (D4): absent means `user` to
  // every reader, so the validator must not write one in. If it did, every set stored before V2
  // would gain a byte on the next save — a persisted-shape change with no migration behind it.
  assert.equal('classesProvenance' in sanitizeExaltPlans([goodPlan])[0], false)

  for (const value of ['detected', 'user'] as const) {
    assert.equal(sanitizeExaltPlans([{ ...goodPlan, classesProvenance: value }])[0].classesProvenance, value)
  }
  // Anything else is not repaired into a guess about where the trio came from — it is dropped
  // back to the documented default.
  for (const bad of ['who', '', 42, null, {}]) {
    assert.equal('classesProvenance' in sanitizeExaltPlans([{ ...goodPlan, classesProvenance: bad }])[0], false)
  }
})

test('duplicate plan ids keep the first, and the batch is bounded', () => {
  const dupes = sanitizeExaltPlans([
    { ...goodPlan, name: 'first' },
    { ...goodPlan, name: 'second' }
  ])
  assert.equal(dupes.length, 1)
  assert.equal(dupes[0].name, 'first')

  const many = Array.from({ length: 500 }, (_, i) => ({ ...goodPlan, id: `plan-${i}` }))
  const kept = sanitizeExaltPlans(many)
  assert.ok(kept.length > 0 && kept.length < many.length, 'a runaway write must be capped')
})
