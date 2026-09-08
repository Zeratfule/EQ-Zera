// THE FLAT WISH LIST — persistence (JOS-326).
//
// The `tests/plannerStore.test.mts` / `tests/gearSetStore.test.mts` suite, for the third planner
// document. The same two promises, neither visible from the renderer:
//
//  1. `ProgressState.wishlist` is ADDITIVE. No schema bump, no migration step — so a store written
//     by every build that shipped before the wish list must load in today's build BYTE-FOR-BYTE
//     UNCHANGED, and a store carrying a wish list must survive a build that has never heard of one.
//  2. The VALIDATOR is the only door. `storePlans.getWishlist` runs it on the way out and
//     `IPC.wishlistSet` runs it on the way in, so a valid list round-trips untouched (a fixed
//     point) and anything else is stripped entry by entry rather than rejected wholesale — losing
//     a user's other forty wishes to one bad line is the failure mode.
//
// AND TWO PROMISES THIS DOCUMENT HAS THAT NEITHER OF THE OTHERS DOES:
//  * THE EFFECT CONTEXT IS DONOR-ONLY. An effect name on a row that says it is not about an effect
//    is a contradiction, not extra information, so a gear entry carrying one comes back without it.
//  * A DISMISSAL CANNOT OUTLIVE ITS ROW. `clearedDone` is a statement about an entry; a tombstone
//    that survived the entry would swallow the wish if it were ever added again.
//
// No Electron: `sanitizeWishlist` is pure and `migrateStoreFile` takes a path.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CURRENT_SCHEMA_VERSION } from '../src/main/storeMigrations'
import { migrateStoreFile } from '../src/main/storeFile'
import { sanitizeWishlist } from '../src/main/planner/validate'
import { MAX_WISHES, type WishList } from '../src/shared/planner/wishlist'

const STORE = 'everquest-companion-progress.json'

/** A scratch store file, cleaned up when `fn` returns. */
function withStore(body: unknown, fn: (path: string, before: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'eqc-wishlist-store-'))
  try {
    const path = join(dir, STORE)
    const text = `${JSON.stringify(body, null, 2)}\n`
    writeFileSync(path, text, 'utf8')
    fn(path, text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The shape a current build writes for a character that has never opened the Wish list tab. */
const preWishStore = {
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
 * A fully-populated, VALID list — the fixed point the round trip must not touch. It names all
 * three things a stored list can carry: a hand-typed gear wish, a seeded donor wish with its
 * effect context, and a dismissal for one of them, under a set seed flag.
 */
const goodList: WishList = {
  entries: [
    {
      itemKey: 'thelvorn, blade of light',
      name: 'Thelvorn, Blade of Light',
      kind: 'gear',
      addedAt: 1_754_200_000_000,
      source: 'user'
    },
    {
      itemKey: 'batfang headband',
      name: 'Batfang Headband',
      kind: 'donor',
      effect: 'Bat Fang',
      socket: 'proc',
      addedAt: 1_754_300_000_000,
      source: 'planImport'
    }
  ],
  clearedDone: ['thelvorn, blade of light'],
  seededFromPlans: true
}

// ------------------------------------------------------------------ additive key

test('a pre-wish-list store loads UNCHANGED — the key is additive, no migration runs', () => {
  withStore(preWishStore, (path, before) => {
    const result = migrateStoreFile(path)
    assert.equal(result.status, 'up-to-date', 'a current store must need no step')
    assert.equal(result.wrote, false, 'nothing may be rewritten')
    assert.equal(readFileSync(path, 'utf8'), before, 'the file must be byte-identical')
  })
  // …and the reader's answer for a character with no key at all is the EMPTY list, never undefined.
  assert.deepEqual(sanitizeWishlist(undefined), { entries: [], clearedDone: [] })
})

test('a store WITH a wish list survives a build that has never heard of one', () => {
  const withList = {
    ...preWishStore,
    byCharacter: {
      primitive_freeport: { ...preWishStore.byCharacter.primitive_freeport, wishlist: goodList }
    }
  }
  withStore(withList, (path, before) => {
    const result = migrateStoreFile(path)
    assert.equal(result.status, 'up-to-date')
    assert.equal(readFileSync(path, 'utf8'), before)
    const reread = JSON.parse(readFileSync(path, 'utf8')) as typeof withList
    assert.deepEqual(
      sanitizeWishlist(reread.byCharacter.primitive_freeport.wishlist),
      goodList,
      'the stored list must read back exactly as written'
    )
  })
})

// ------------------------------------------------------------------ the validator

test('a valid list round-trips untouched (get/set is a fixed point)', () => {
  const once = sanitizeWishlist(goodList)
  assert.deepEqual(once, goodList)
  // Sanitizing twice — which is what a write does (handler, then store) — must change nothing.
  assert.deepEqual(sanitizeWishlist(once), once)
})

test('an unseeded list keeps its flag ABSENT — writing `false` in would change bytes for no meaning', () => {
  const list = sanitizeWishlist({ entries: [], clearedDone: [] })
  assert.equal('seededFromPlans' in list, false)
  assert.deepEqual(sanitizeWishlist({ entries: [], clearedDone: [], seededFromPlans: false }), {
    entries: [],
    clearedDone: []
  })
})

test('malformed input is STRIPPED entry by entry, never thrown and never wholesale', () => {
  const now = 1_754_400_000_000
  const cleaned = sanitizeWishlist(
    {
      entries: [
        null,
        'not an entry',
        { name: 'no key at all' },
        { itemKey: '   ' },
        // A real one, with everything defaulted: no name (falls back to the key), no kind (the
        // shape that claims the least), no source (the app must not claim it imported this), and
        // a NaN instant (which would sort a row out of existence).
        { itemKey: 'batfang headband', addedAt: Number.NaN, kind: 'nonsense', source: 'somewhere' },
        // …and a duplicate, which keeps the FIRST occurrence.
        { itemKey: 'batfang headband', name: 'Second Try', kind: 'donor' }
      ],
      clearedDone: [42, '', 'batfang headband', 'batfang headband']
    },
    now
  )
  assert.deepEqual(cleaned, {
    entries: [{ itemKey: 'batfang headband', name: 'batfang headband', kind: 'gear', addedAt: now, source: 'user' }],
    clearedDone: ['batfang headband']
  })
})

test('the effect context is DONOR-ONLY — a gear wish carrying one comes back without it', () => {
  const cleaned = sanitizeWishlist({
    entries: [
      { itemKey: 'a helm', name: 'A Helm', kind: 'gear', effect: 'Bat Fang', socket: 'proc', addedAt: 1, source: 'user' },
      // …and a donor wish with an UNKNOWN socket keeps the effect and drops only the bad half:
      // the closed four are the allowlist, and a fifth would state a merge tier nobody defined.
      { itemKey: 'a ring', name: 'A Ring', kind: 'donor', effect: 'Bone', socket: 'ornament', addedAt: 2, source: 'user' }
    ],
    clearedDone: []
  })
  assert.deepEqual(cleaned.entries[0], {
    itemKey: 'a helm',
    name: 'A Helm',
    kind: 'gear',
    addedAt: 1,
    source: 'user'
  })
  assert.deepEqual(cleaned.entries[1], {
    itemKey: 'a ring',
    name: 'A Ring',
    kind: 'donor',
    effect: 'Bone',
    addedAt: 2,
    source: 'user'
  })
})

test('a dismissal cannot outlive its row — a tombstone would swallow the wish on re-add', () => {
  const cleaned = sanitizeWishlist({
    entries: [{ itemKey: 'a helm', name: 'A Helm', kind: 'gear', addedAt: 1, source: 'user' }],
    clearedDone: ['a helm', 'an item nobody wished for']
  })
  assert.deepEqual(cleaned.clearedDone, ['a helm'])
})

test('the batch is bounded — a runaway write cannot store an unbounded list', () => {
  const entries = Array.from({ length: MAX_WISHES + 25 }, (_, i) => ({
    itemKey: `item ${String(i)}`,
    name: `Item ${String(i)}`,
    kind: 'gear',
    addedAt: 1,
    source: 'user'
  }))
  assert.equal(sanitizeWishlist({ entries, clearedDone: [] }).entries.length, MAX_WISHES)
})

test('a value that is not a wish list at all reads as the empty list, never as a throw', () => {
  for (const junk of [null, 42, 'nope', [], { entries: 'no' }]) {
    assert.deepEqual(sanitizeWishlist(junk), { entries: [], clearedDone: [] })
  }
})
