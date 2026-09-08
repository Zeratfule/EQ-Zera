// GEAR SETS — persistence (JOS-286, phase 5 of the gear planner).
//
// The `tests/plannerStore.test.mts` suite, for the other document. Two promises, neither visible
// from the renderer:
//
//  1. `ProgressState.gearSets` is ADDITIVE. No schema bump, no migration step — so a store written
//     by every build that shipped before gear sets must load in today's build BYTE-FOR-BYTE
//     UNCHANGED, and a store carrying sets must survive a build that has never heard of them.
//  2. The VALIDATOR is the only door. `store.getGearSets` runs it on the way out and
//     `IPC.gearSetSets` runs it on the way in, so a valid set round-trips untouched (a fixed
//     point) and anything else is stripped field by field rather than rejected wholesale — losing
//     a user's other nine loadouts to one bad cell is the failure mode.
//
// AND ONE PROMISE THIS DOCUMENT HAS THAT THE OTHER DOES NOT: a plus-state that is not a state the
// game can be in is CLAMPED by phase 0's own `normalizeUpgradeState` rather than by a range check
// the validator invents. Tier 0 and tier 10 bank nothing; a fraction lives in 0..2^full-1.
//
// No Electron: `sanitizeGearSets` is pure and `migrateStoreFile` takes a path.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURRENT_SCHEMA_VERSION } from '../src/main/storeMigrations'
import { migrateStoreFile } from '../src/main/storeFile'
import { sanitizeGearSets } from '../src/main/planner/validate'
import type { GearSet } from '../src/shared/planner/gearSet'

const STORE = 'everquest-companion-progress.json'

/** A scratch store file, cleaned up when `fn` returns. */
function withStore(body: unknown, fn: (path: string, before: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-gearset-store-'))
  try {
    const path = join(dir, STORE)
    const text = `${JSON.stringify(body, null, 2)}\n`
    writeFileSync(path, text, 'utf8')
    fn(path, text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The shape a current build writes for a character that has never opened the Gear tab. */
const preGearStore = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  byCharacter: {
    primitive_freeport: {
      inventory: { 'rusty short sword': 2 },
      completedQuests: ['ROG::Test of Stealth'],
      combo: { corrections: [] }
    }
  },
  activeLogPath: 'C:/eq/Logs/eqlog_Primitive_freeport.txt'
}

/**
 * A fully-populated, VALID set — the fixed point the round trip must not touch. It names all four
 * kinds of cell on purpose: an ordinary slot, the second of a pair (JOS-67), an any-slot
 * (JOS-104), and an item planned at a state with a fraction in it.
 */
const goodSet: GearSet = {
  id: 'a0b1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  name: 'Raid set',
  createdAt: 1_754_200_000_000,
  updatedAt: 1_754_300_000_000,
  slots: {
    PRIMARY: { key: 'thelvorn, blade of light', name: 'Thelvorn, Blade of Light', state: { full: 5, fraction: 17 } },
    FINGER2: { key: 'ring of pureblood', name: 'Ring of Pureblood', state: { full: 0, fraction: 0 } },
    ANY1: { key: 'brigandine tunic', name: 'Brigandine Tunic', state: { full: 10, fraction: 0 } }
  }
}

// ------------------------------------------------------------------ additive key

test('a pre-gear-set store loads UNCHANGED — the key is additive, no migration runs', () => {
  withStore(preGearStore, (path, before) => {
    const result = migrateStoreFile(path)
    assert.equal(result.status, 'up-to-date', 'a current store must need no step')
    assert.equal(result.wrote, false, 'nothing may be rewritten')
    assert.equal(readFileSync(path, 'utf8'), before, 'the file must be byte-identical')
  })
  // …and the reader's answer for a character with no key at all is the empty list, never undefined.
  assert.deepEqual(sanitizeGearSets(undefined), [])
})

test('a store WITH gear sets survives a build that has never heard of them', () => {
  const withSets = {
    ...preGearStore,
    byCharacter: {
      primitive_freeport: { ...preGearStore.byCharacter.primitive_freeport, gearSets: [goodSet] }
    }
  }
  withStore(withSets, (path, before) => {
    const result = migrateStoreFile(path)
    assert.equal(result.status, 'up-to-date')
    assert.equal(readFileSync(path, 'utf8'), before)
    const reread = JSON.parse(readFileSync(path, 'utf8')) as typeof withSets
    assert.deepEqual(
      sanitizeGearSets(reread.byCharacter.primitive_freeport.gearSets),
      [goodSet],
      'the stored set must read back exactly as written'
    )
  })
})

// ------------------------------------------------------------------ the validator

test('a valid set round-trips untouched (get/set is a fixed point)', () => {
  const once = sanitizeGearSets([goodSet])
  assert.deepEqual(once, [goodSet])
  // Sanitizing twice — which is what a write does (handler, then store) — must change nothing.
  assert.deepEqual(sanitizeGearSets(once), once)
})

test('malformed input is STRIPPED cell by cell, never thrown and never wholesale', () => {
  const now = 1_754_400_000_000
  const cleaned = sanitizeGearSets(
    [
      { name: 'no id', slots: {} }, // dropped: no id to CRUD it by
      'not an object',
      null,
      {
        id: 'set-2',
        // name missing → a placeholder, never an empty picker entry
        createdAt: 'yesterday', // → now
        updatedAt: Number.NaN, // → createdAt
        slots: {
          HEAD: { key: 'helm', name: 'Helm', state: { full: 2, fraction: 1 } },
          CHARM: { key: 'nope', name: 'Nope', state: {} }, // not a cell in this corpus
          HEAD2: { key: 'nope', name: 'Nope', state: {} }, // JOS-67: only EAR/WRIST/FINGER pair
          ANY3: { key: 'nope', name: 'Nope', state: {} }, // JOS-104: the game gives exactly two
          FEET: { name: 'A name and nothing to join it by' }, // no key → nothing to look up
          BACK: 'not an assignment'
        }
      }
    ],
    now
  )

  assert.equal(cleaned.length, 1, 'only the entry with an id survives')
  const set = cleaned[0]
  assert.equal(set.id, 'set-2')
  assert.equal(set.name, 'Untitled set')
  assert.equal(set.createdAt, now)
  assert.equal(set.updatedAt, now, 'a NaN stamp falls back rather than poisoning every sort')
  assert.deepEqual(Object.keys(set.slots), ['HEAD'])

  // Non-arrays and hostile shapes answer with [], never a throw — this runs on a READ path too.
  for (const bad of [undefined, null, 42, 'sets', {}, { length: 3 }]) {
    assert.deepEqual(sanitizeGearSets(bad), [])
  }
})

test('a plus-state is CLAMPED to one the game can be in — phase 0`s normalizer, not a new rule', () => {
  const states = sanitizeGearSets([
    {
      id: 'set-3',
      slots: {
        HEAD: { key: 'a', name: 'A', state: { full: 99, fraction: 99 } }, // tier caps at 10, which banks nothing
        CHEST: { key: 'b', name: 'B', state: { full: -4, fraction: 3 } }, // tier 0 banks nothing either
        LEGS: { key: 'c', name: 'C', state: { full: 3, fraction: 99 } }, // 2^3 - 1 = 7
        FEET: { key: 'd', name: 'D', state: 'nonsense' }, // unreadable ⇒ base
        HANDS: { key: 'e', name: 'E' } // absent ⇒ base
      }
    }
  ])[0].slots

  assert.deepEqual(states.HEAD?.state, { full: 10, fraction: 0 })
  assert.deepEqual(states.CHEST?.state, { full: 0, fraction: 0 })
  assert.deepEqual(states.LEGS?.state, { full: 3, fraction: 7 })
  assert.deepEqual(states.FEET?.state, { full: 0, fraction: 0 })
  assert.deepEqual(states.HANDS?.state, { full: 0, fraction: 0 })
})

test('an assignment with no name falls back to its key rather than rendering blank', () => {
  const slots = sanitizeGearSets([{ id: 'set-4', slots: { HEAD: { key: 'cloak of flames' } } }])[0].slots
  assert.equal(slots.HEAD?.name, 'cloak of flames')
})

test('duplicate set ids keep the first, and the batch is bounded', () => {
  const dupes = sanitizeGearSets([
    { ...goodSet, name: 'first' },
    { ...goodSet, name: 'second' }
  ])
  assert.equal(dupes.length, 1)
  assert.equal(dupes[0].name, 'first')

  const many = Array.from({ length: 500 }, (_, i) => ({ ...goodSet, id: `set-${String(i)}` }))
  const kept = sanitizeGearSets(many)
  assert.ok(kept.length > 0 && kept.length < many.length, 'a runaway write must be capped')
})
