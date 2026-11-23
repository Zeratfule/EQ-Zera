// THE BUILD TAB'S BEST-IN-SLOT MATH, against the REAL committed corpus (src/main/data/items.json,
// the 2026-11-15 scrape: Castle Nektropos, Lake Nerius, Nektropos Undercrofts). The small-fixture
// arithmetic lives in buildOptimizer.test.mts; this file asks the questions only the real rows can
// answer, using the shipped builder (`buildGearIndex`) and the shipped era filter (`eraHides`, the
// Build tab's "In-era items only" default).
//
// WHAT IS PINNED (the 2026-11-23 BiS audit, one defect per block):
//   * a two-hander takes both hands: no best set pairs a 2H weapon with an off-hand, and the
//     upgrade list charges a two-hander for the off-hand it takes off;
//   * SV VOID is weighed like the other saves (Unbroken Golem Core states +38);
//   * melee profiles weigh the endurance pool the Nektropos melee gear is built on;
//   * the new zone's gear is in the candidate pool and wins where its numbers say it should.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import itemsJson from '../src/main/data/items.json'
import type { ItemDbFile } from '../src/main/itemsDb'
import { buildGearIndex } from '../src/main/planner/gearIndex'
import type { GearRow } from '../src/shared/planner/gear'
import type { ClassAbbr } from '../src/shared/classCombo'
import type { PlanSlotId } from '../src/shared/planner/types'
import { itemScore, profileWeights, type BuildProfile } from '../src/shared/build/profiles'
import { bestBuild, buildScore, isTwoHander, upgradesFor, type BuildContext } from '../src/shared/build/optimizer'
import { upgradeVerdict } from '../src/shared/build/upgradeFinder'
import { BUILD_CELLS } from '../src/shared/build/wornSet'
import { eraHides } from '../src/renderer/src/features/planner/plannerData'

const rows = buildGearIndex(itemsJson as unknown as ItemDbFile).rows
const byKey = new Map(rows.map((r) => [r.key, r]))

function real(key: string): GearRow {
  const r = byKey.get(key)
  assert.ok(r, `${key} is expected in the committed corpus`)
  return r
}

function ctxFor(classes: ClassAbbr[], profile: BuildProfile): BuildContext {
  return { classes, weights: profileWeights(profile, classes), excluded: (r) => eraHides(r, true) }
}

const COMBOS: [ClassAbbr[], BuildProfile][] = [
  [['WAR'], 'tank'],
  [['BER'], 'dps'],
  [['ROG'], 'dps'],
  [['MNK'], 'dps'],
  [['WIZ'], 'dps'],
  [['CLR'], 'heal'],
  [['PAL', 'CLR', 'WAR'], 'tank']
]

// ---- two hands -------------------------------------------------------------------------------

test('the skill fold reads the real two-handers and one-handers', () => {
  assert.equal(isTwoHander(real('worn great blade')), true, '2H Slashing, a Nektropos drop')
  assert.equal(isTwoHander(real('monsoon, sword of the swiftwind')), true, '2H Slashing')
  assert.equal(isTwoHander(real('cudgel of the fool')), true, '2H Blunt')
  assert.equal(isTwoHander(real('wellworn blade')), false, '1H Slashing')
  assert.equal(isTwoHander(real("handmaiden's handwrap")), false, 'Hand to Hand is one-handed')
  assert.equal(isTwoHander(real('cryptguard')), false, 'a shield states no weapon skill')
})

test('no best set pairs a two-hander with an off-hand, for any profile', () => {
  for (const [classes, profile] of COMBOS) {
    const best = bestBuild(rows, BUILD_CELLS, ctxFor(classes, profile))
    const main = best.get('PRIMARY') ?? null
    if (main !== null && isTwoHander(main)) {
      assert.equal(best.get('SECONDARY'), null, `${classes.join('/')} ${profile}: ${main.name} is two-handed`)
    }
  }
})

test('the hands resolve to whichever is worth more: the 2H alone, or 1H + off-hand', () => {
  // A hand-built pool of REAL rows. Monsoon (2H) outscores Corroded Spiked Club (1H, a Nektropos
  // drop) for a warrior tank, but the club with Cryptguard (a 30 AC Nektropos shield) beats Monsoon
  // as a pair — exactly the answer the old greedy pass could never give, because it took the 2H
  // AND the shield.
  const pool = [real('monsoon, sword of the swiftwind'), real('corroded spiked club'), real('cryptguard')]
  const ctx = { classes: ['WAR'] as ClassAbbr[], weights: profileWeights('tank', ['WAR']) }
  const w = ctx.weights
  const twoH = itemScore(pool[0].stats, w)
  const pair = itemScore(pool[1].stats, w) + itemScore(pool[2].stats, w)
  assert.ok(twoH > itemScore(pool[1].stats, w), 'the greedy pass would pick the 2H for PRIMARY')
  assert.ok(pair > twoH, 'and the pair is worth more than the 2H alone')
  const best = bestBuild(pool, ['PRIMARY', 'SECONDARY'], ctx)
  assert.equal(best.get('PRIMARY')?.name, 'Corroded Spiked Club')
  assert.equal(best.get('SECONDARY')?.name, 'Cryptguard')
  assert.equal(buildScore(best, w), pair)

  // Without the shield in the pool the 2H wins and SECONDARY stays empty.
  const alone = bestBuild([pool[0], pool[1]], ['PRIMARY', 'SECONDARY'], ctx)
  assert.equal(alone.get('PRIMARY')?.name, 'Monsoon, Sword of the Swiftwind')
  assert.equal(alone.get('SECONDARY'), null)
})

test('an upgrade to a two-hander is charged for the off-hand it takes off', () => {
  const great = real('worn great blade') // 2H, WAR PAL SHD BER
  const wellworn = real('wellworn blade') // 1H
  const shield = real('cryptguard') // PAL SHD WAR
  const ctx = { classes: ['WAR'] as ClassAbbr[], weights: profileWeights('dps', ['WAR']), perCell: 5 }
  const w = ctx.weights
  const set = new Map<PlanSlotId, GearRow | null>([
    ['PRIMARY', wellworn],
    ['SECONDARY', shield]
  ])
  const [primary] = upgradesFor([great], set, ['PRIMARY'], ctx)
  const raw = itemScore(great.stats, w) - itemScore(wellworn.stats, w)
  const expected = raw - itemScore(shield.stats, w)
  assert.ok(expected > 0 && expected < raw, 'still an upgrade for melee DPS, by less once the shield is counted')
  assert.equal(primary.options[0]?.delta, expected)

  // The upgrade finder answers the same way, and refuses an off-hand beside a worn two-hander.
  const verdict = upgradeVerdict(great, { classes: ['WAR'], weights: w, worn: set, unknownCells: new Set() })
  assert.equal(verdict?.delta, expected)
  // An off-hand we cannot score is a gain we cannot state (law 1).
  assert.equal(upgradeVerdict(great, { classes: ['WAR'], weights: w, worn: set, unknownCells: new Set<PlanSlotId>(['SECONDARY']) }), null)
  const wearing2H = new Map<PlanSlotId, GearRow | null>([
    ['PRIMARY', great],
    ['SECONDARY', null]
  ])
  assert.equal(upgradeVerdict(shield, { classes: ['WAR'], weights: w, worn: wearing2H, unknownCells: new Set() }), null)
  assert.deepEqual(upgradesFor([shield], wearing2H, ['SECONDARY'], ctx)[0].options, [])
})

// ---- the new stats the weights now read ----------------------------------------------------------

test('SV VOID is weighed like the other saves (Unbroken Golem Core, +38)', () => {
  const core = real('unbroken golem core')
  assert.equal(core.stats.SV_VOID, 38)
  for (const profile of ['tank', 'dps', 'heal'] as const) {
    const w = profileWeights(profile, ['WIZ'])
    assert.equal(w.SV_VOID, w.SV_FIRE, `${profile}: void weighs what fire weighs`)
    assert.equal(w.SV_ALL, (w.SV_FIRE ?? 0) * 5, 'SV ALL stays the five classic saves')
  }
})

test('melee profiles weigh the endurance pool; casters do not', () => {
  const gauntlets = real('bloodsoaked gauntlets') // HP +130 Mana +95 END +95, WAR PAL SHD BER
  assert.equal(gauntlets.stats.END, 95)
  assert.ok((profileWeights('tank', ['WAR']).END ?? 0) > 0)
  assert.ok((profileWeights('dps', ['BER']).END ?? 0) > 0)
  assert.equal(profileWeights('dps', ['WIZ']).END, undefined)
  assert.equal(profileWeights('tank', ['WIZ']).END, undefined)
})

// ---- the new zone's gear is in the pool, and wins where it should --------------------------------

test('Castle Nektropos gear is in the candidate pool and in era', () => {
  for (const key of ['bloodsoaked gauntlets', 'layered guards', 'pyrosilk robe', 'unbroken golem core', "warstaff of hope's demise"]) {
    assert.equal(eraHides(real(key), true), false, `${key} is hidden by the in-era filter`)
  }
})

test('the new items take the slots their numbers earn', () => {
  const war = bestBuild(rows, BUILD_CELLS, ctxFor(['WAR'], 'tank'))
  assert.equal(war.get('HANDS')?.name, 'Bloodsoaked Gauntlets')
  assert.equal(war.get('ARMS')?.name, 'Layered Guards')
  const wiz = bestBuild(rows, BUILD_CELLS, ctxFor(['WIZ'], 'dps'))
  assert.equal(wiz.get('PRIMARY')?.name, "Warstaff of Hope's Demise")
  assert.equal(wiz.get('SECONDARY')?.name, 'Unbroken Golem Core')
  const ber = bestBuild(rows, BUILD_CELLS, ctxFor(['BER'], 'dps'))
  assert.equal(ber.get('ARMS')?.name, 'Scars of the Indomitable')
})
