// GEAR TAB — EFFECTIVE HP, the second derived key in the sort/column vocabulary (JOS-336).
//
// WHAT THE OWNER ASKED FOR, verbatim in the ticket: *stamina plus raw HP, computed as if there were
// NO soft cap*. EverQuest discounts stamina above a level-dependent cap and converts what is left to
// hitpoints at a ratio this repo has never measured, so modelling either number would be an invented
// join. The ruling is to take the stated values as-is, and the honesty of the column is that it does
// not pretend to be the game's own answer — which makes the arithmetic the plainest sum there is and
// puts every remaining question on the EDGES, which is what this file is for:
//
//   1. THE DERIVATION, all three arms. Both stated → the sum. One stated → that one, because a
//      stated value is a value and the other key's silence is not a measured zero. NEITHER stated →
//      ABSENT, which is law 1 and is a different answer from 0.
//   2. IT RANKS LIKE ANY OTHER KEY, with absent LAST in both directions and the name as the
//      tiebreak, so a windowed list never re-shuffles under the scrollbar.
//   3. THE PLUS-STATE MOVES IT, AND CAN RE-RANK ON IT. This is the claim that made it a DERIVED key
//      (gearScale.ts) rather than a field summed once at build: both halves are `primary`-class
//      stats and `scalePrimary` treats them differently on either side of its ≤10 rule, so the
//      composition of a sum decides how fast it grows.
//
// A SEPARATE FILE FROM `gearFilter.test.mts`, which owns the rest of the table's model: that file is
// at the repo's 400-code-line factoring ceiling, and this is a subject of its own rather than more
// of its sort section. The fixtures below are SYNTHETIC and say so — nothing here asserts a number
// the corpus states; `tests/e2e/gearEffectiveHpSteps.mts` is where the claim meets the real 6,800
// rows, through the real render.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GearRow } from '../src/shared/planner/gear'
import { gearEffectiveHp } from '../src/shared/planner/gearScale'
import type { ItemUpgradeState } from '../src/shared/itemUpgrade'
import {
  DEFAULT_GEAR_FILTERS,
  gearTableRows,
  scaleAll,
  sortGearRows,
  sortValue
} from '../src/renderer/src/features/gear/gearFilter'
import { statText } from '../src/renderer/src/features/gear/gearColumns'

// =================================================================================
// FIXTURES
// =================================================================================

function row(over: Partial<GearRow> & Pick<GearRow, 'key' | 'name'>): GearRow {
  return {
    searchKey: over.name.toLowerCase(),
    slots: [],
    classes: [],
    races: ['ALL'],
    flags: [],
    quest: false,
    playerCrafted: false,
    stats: {},
    effects: [],
    ...over
  }
}

/** BOTH STATED. The AC rides along so "states nothing else" is never what a blank cell proves. */
const BOTH = row({ key: 'girdle of vitality', name: 'Girdle of Vitality', slots: ['WAIST'], stats: { HP: 40, STA: 12, AC: 5 } })
/** ONE STATED, each way. STA_ONLY ties BOTH at 52 on purpose — see the ranking test's tiebreak. */
const HP_ONLY = row({ key: 'band of health', name: 'Band of Health', slots: ['FINGER'], stats: { HP: 25 } })
const STA_ONLY = row({ key: 'belt of stamina', name: 'Belt of Stamina', slots: ['WAIST'], stats: { STA: 52 } })
/** NEITHER STATED, and both of them state something ELSE — the case is "no HP and no STA". */
const WEAPON = row({
  key: 'thelvorn, blade of light',
  name: 'Thelvorn, Blade of Light',
  slots: ['PRIMARY'],
  skill: '1H Slashing',
  stats: { WIS: 15, DMG: 20, DELAY: 26, WEIGHT: 3 }
})
const CAP = row({ key: 'cloth cap', name: 'Cloth Cap', slots: ['HEAD'], stats: { WEIGHT: 0.5 } })

/**
 * THE RE-RANK PAIR. `ONE_BIG` states a single HP 9 and out-ranks `TWO_SMALL`'s 4 + 4 at base — and
 * loses to it the moment the slider moves, because `scalePrimary` hands EVERY stated line at or
 * below 10 a flat `+full` and two stated lines therefore collect it twice. Nothing here is a
 * coincidence of the numbers: it is phase 0's ≤10 rule meeting law 1's "a stated value is a value".
 */
const ONE_BIG = row({ key: 'plain hoop', name: 'Plain Hoop', slots: ['EAR'], stats: { HP: 9 } })
const TWO_SMALL = row({ key: 'humble sash', name: 'Humble Sash', slots: ['WAIST'], stats: { HP: 4, STA: 4 } })

const ROWS = [BOTH, HP_ONLY, STA_ONLY, CAP, WEAPON]

/** "Tier 2   3 / 4" — the owner screenshot every phase-0 number in this repo is verified against. */
const CHECKPOINT: ItemUpgradeState = { full: 2, fraction: 3 }

const names = (rows: readonly GearRow[]): string[] => rows.map((r) => r.name)

// =================================================================================
// 1. THE DERIVATION
// =================================================================================

test('EFFECTIVE HP is HP plus STA, and law 1 decides both of the interesting arms', () => {
  // BOTH STATED: the plain sum. No cap modelled, no conversion ratio invented.
  assert.equal(gearEffectiveHp(BOTH.stats), 52, '40 HP + 12 STA, taken raw')
  assert.equal(sortValue(BOTH, 'EFF_HP'), 52, 'and the sort reads the shared derivation, not a copy of it')

  // ONE STATED: the sum IS that one. Folding either row into `undefined` for want of its partner
  // would delete a number the corpus actually printed.
  assert.equal(sortValue(HP_ONLY, 'EFF_HP'), 25, 'HP alone is an effective HP of 25')
  assert.equal(sortValue(STA_ONLY, 'EFF_HP'), 52, 'and STA alone is an effective HP of 52')

  // NEITHER STATED: absent, which renders BLANK and sorts LAST. Both rows state OTHER numbers, so
  // what is pinned is "no HP and no STA", never "no stats at all".
  assert.equal(sortValue(WEAPON, 'EFF_HP'), undefined, 'a weapon with WIS, DMG and DELAY states neither')
  assert.equal(sortValue(CAP, 'EFF_HP'), undefined, 'nor does a cap that states only a weight')
  assert.equal(gearEffectiveHp({}), undefined)

  // AND A STATED ZERO IS STILL A STATEMENT — the same distinction every other key draws.
  assert.equal(gearEffectiveHp({ HP: 0 }), 0, 'an item that states HP 0 has an effective HP of 0')
  assert.equal(gearEffectiveHp({ HP: 0, STA: 0 }), 0)
  assert.equal(gearEffectiveHp({ HP: -5, STA: 20 }), 15, 'a penalty is a stated number too')
})

test('a cell states a PLAIN INTEGER, and a blank means the item stated neither', () => {
  assert.equal(statText(66, 'EFF_HP'), '66', 'no decimal point, no unit')
  assert.equal(statText(0, 'EFF_HP'), '0')
  assert.equal(statText(undefined, 'EFF_HP'), '')
})

// =================================================================================
// 2. IT RANKS LIKE ANY OTHER KEY
// =================================================================================

test('effective HP ranks both ways, with absent LAST either way and the name as the tiebreak', () => {
  const desc = sortGearRows(ROWS, { key: 'EFF_HP', dir: 'desc' })
  // The Belt (52, stated once) and the Girdle (52, stated twice) read the same number, so the NAME
  // breaks it — the total-order law, which is what keeps a windowed list still under the scrollbar.
  assert.deepEqual(names(desc), [
    'Belt of Stamina',
    'Girdle of Vitality',
    'Band of Health',
    'Cloth Cap',
    'Thelvorn, Blade of Light'
  ])

  const asc = sortGearRows(ROWS, { key: 'EFF_HP', dir: 'asc' })
  assert.deepEqual(names(asc).slice(0, 3), ['Band of Health', 'Belt of Stamina', 'Girdle of Vitality'])
  assert.deepEqual(names(asc).slice(3), ['Cloth Cap', 'Thelvorn, Blade of Light'], 'the two silent rows, still last')
})

// =================================================================================
// 3. THE PLUS-STATE MOVES IT — the reason it is derived from the SCALED vector
// =================================================================================

test('THE SLIDER MOVES IT, and can RE-RANK on it', () => {
  // At base, one stated HP 9 out-ranks two stated 4s.
  assert.equal(sortValue(ONE_BIG, 'EFF_HP'), 9)
  assert.equal(sortValue(TWO_SMALL, 'EFF_HP'), 8)
  assert.deepEqual(names(sortGearRows([ONE_BIG, TWO_SMALL], { key: 'EFF_HP', dir: 'desc' })), ['Plain Hoop', 'Humble Sash'])

  // At the checkpoint the order INVERTS: 9 → 11 against 4 + 4 → 6 + 6. A real ranking change
  // produced by the plus-state alone, which a sum computed once at build could never have shown.
  const [big, small] = scaleAll([ONE_BIG, TWO_SMALL], CHECKPOINT)
  assert.equal(sortValue(big, 'EFF_HP'), 11)
  assert.equal(sortValue(small, 'EFF_HP'), 12)
  assert.deepEqual(names(sortGearRows([big, small], { key: 'EFF_HP', dir: 'desc' })), ['Humble Sash', 'Plain Hoop'])
})

test('the sum is of the SCALED halves, never a scaled sum', () => {
  // The Girdle's halves sit on the OTHER arm of `scalePrimary` (base > 10 is proportional): 40 → 51
  // and 12 → 15. Putting 52 through the rule in one piece happens to reach 66 here too — and would
  // be wrong the moment either half crossed the ≤10 boundary, which is why the derivation reads the
  // scaled VECTOR rather than scaling its own answer.
  const [girdle] = scaleAll([BOTH], CHECKPOINT)
  assert.equal(girdle.stats.HP, 51)
  assert.equal(girdle.stats.STA, 15)
  assert.equal(sortValue(girdle, 'EFF_HP'), 66)

  // A row that states neither is still absent at every plus — there is nothing for a tier to grow.
  assert.equal(sortValue(scaleAll([WEAPON], CHECKPOINT)[0], 'EFF_HP'), undefined)

  // THE WHOLE PIPELINE, in one call: scale → filter → sort, ranked by the derived key. Every stated
  // row's number moved and the ranking was recomputed on the moved numbers — which is exactly what
  // the e2e's slider step watches happen on the real corpus.
  const filters = { ...DEFAULT_GEAR_FILTERS, eraOnly: false }
  const ranked = gearTableRows(ROWS, CHECKPOINT, { filters, sort: { key: 'EFF_HP', dir: 'desc' } })
  assert.deepEqual(ranked.map((r) => sortValue(r, 'EFF_HP')), [66, 66, 32, undefined, undefined])
  assert.deepEqual(names(ranked).slice(0, 3), ['Belt of Stamina', 'Girdle of Vitality', 'Band of Health'])
})
