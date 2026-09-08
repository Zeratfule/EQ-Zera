// PLANNER SOURCE-INDEX TESTS — the item→mob inversion of the committed catalog (design §4.2).
//
// The Farm rollup and every donor row's "where does this drop" line stand on this one index, so
// it is tested against the REAL `src/renderer/src/data/eqlegends/mobs.json` — no fixture, no
// hand-built catalog. Two layers:
//   1. FLOORS. The index must stay big. Counts are floors, never today's exact numbers
//      (AGENTS.md: frozen numbers rot) — a rescrape adds mobs, and that must never turn a test
//      red, but a build that quietly stops parsing `drops` must.
//   2. AN ANCHOR. One item, verified by hand against the catalog: Ghoulbane comes off "the
//      froglok shin lord" in Upper Guk. That pins the KEY (`+N` stripped, case folded — the same
//      spelling main serves as `PlannerDonor.key`) and the shape of the source record together.
//
// The lazy singleton is deliberately NOT exercised here: `buildSourceIndex` is exported as a pure
// function precisely so the test can call it with the catalog it read itself.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSourceIndex, sourceItemKey } from '../src/renderer/src/features/planner/sourceIndex'
import mobsJson from '../src/renderer/src/data/eqlegends/mobs.json'
import type { MobData } from '../src/shared/types'

const catalog = mobsJson as unknown as MobData
const index = buildSourceIndex(catalog.mobs)

test('the committed catalog inverts into a large item -> mobs index', () => {
  const withDrops = catalog.mobs.filter((m) => (m.drops?.length ?? 0) > 0)
  let links = 0
  for (const sources of index.values()) links += sources.length

  // Measured 2026-08-04: 7,872 pages, 4,410 with a loot list, 5,357 distinct keys, 32,822 links.
  assert.ok(withDrops.length >= 4_000, `only ${String(withDrops.length)} mobs state drops`)
  assert.ok(index.size >= 5_000, `only ${String(index.size)} distinct item keys`)
  assert.ok(links >= 30_000, `only ${String(links)} item->mob links`)
})

test('keys are the donor key: `+N` stripped and case folded', () => {
  assert.equal(sourceItemKey('Ghoulbane'), 'ghoulbane')
  assert.equal(sourceItemKey('Ghoulbane +4'), 'ghoulbane')
  // Every key in the index is already canonical — nothing round-trips to something else.
  for (const key of index.keys()) assert.equal(sourceItemKey(key), key)
})

test('ANCHOR — Ghoulbane comes off the froglok shin lord, in Upper Guk', () => {
  const sources = index.get('ghoulbane')
  assert.ok(sources && sources.length > 0, 'no source for ghoulbane')
  const shinLord = sources.find((s) => s.mob === 'the froglok shin lord')
  assert.ok(shinLord, `ghoulbane sources were ${sources.map((s) => s.mob).join(', ')}`)
  assert.deepEqual(shinLord.zones, ['Upper Guk'])
  assert.equal(shinLord.mobPage, 'The froglok shin lord')
  // The level text is kept VERBATIM — a range as often as a number (law 1).
  assert.equal(shinLord.levelText, '30')
})

test('a mob is listed once per item even when its page lists +N variants', () => {
  for (const [key, sources] of index) {
    const seen = new Set(sources.map((s) => `${s.mobPage ?? ''}|${s.mob}`))
    assert.equal(seen.size, sources.length, `duplicate source rows under ${key}`)
  }
})

test('an item nobody drops is absent, not an empty list', () => {
  assert.equal(index.has(sourceItemKey('a thing no mob has ever dropped')), false)
})
