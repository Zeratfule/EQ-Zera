// The FACTION panel's pure rows (ROADMAP item 9).
//
// THE ONE LAW THIS FILE EXISTS TO PIN: the two faction sentences are NOT the same kind of fact.
// `has been adjusted by -3.` states a MAGNITUDE and is summed; `could not possibly get any worse.`
// states a RAIL and is COUNTED. A saturation line folded in as a zero would be a lie a chart would
// draw, so a faction whose every line was a rail must print the refusal and never `0`.
//
// Also pinned: the display spelling is the FIRST one the log used (never the key); the order is
// newest hit first with a stable tie-break; the search matches the display name; and the recent
// strip is filtered by the LOWERCASED spelling, because a row carries the spelling of its own line.
//
// Pure — no Electron, no renderer, no fixtures.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_STATED_CHANGE, factionRecent, factionRows } from '../src/renderer/src/features/character/factionRows'
import { EMPTY_FACTION_SNAP, type FactionSnap, type FactionTotals } from '../src/shared/factionTypes'

const T = 1_700_000_000_000

function totals(over: Partial<FactionTotals> & { display: string }): FactionTotals {
  return { delta: 0, hits: 0, maxed: 0, bottomed: 0, firstTs: T, lastTs: T, ...over }
}

const SNAP: FactionSnap = {
  v: 1,
  factions: {
    'frogloks of guk': totals({ display: 'Frogloks of Guk', delta: -45, hits: 9, lastTs: T + 3000 }),
    'clerics of tunare': totals({ display: 'Clerics of Tunare', delta: 120, hits: 4, lastTs: T + 1000 }),
    'guards of qeynos': totals({ display: 'Guards of Qeynos', maxed: 6, lastTs: T + 5000 }),
    'dark reflection': totals({ display: 'Dark Reflection', bottomed: 2, delta: -3, hits: 1, lastTs: T + 2000 })
  },
  recent: [
    { faction: 'Frogloks of Guk', delta: -5, ts: T + 1 },
    { faction: 'Clerics of Tunare', delta: 30, ts: T + 2 },
    { faction: 'frogloks of guk', delta: -5, ts: T + 3 },
    { faction: 'Guards of Qeynos', cap: 'max', ts: T + 4 },
    { faction: 'Dark Reflection', cap: 'min', ts: T + 5 }
  ]
}

test('no snapshot is an empty list, not a throw', () => {
  assert.deepEqual(factionRows(null), [])
  assert.deepEqual(factionRows(EMPTY_FACTION_SNAP), [])
  assert.deepEqual(factionRecent(null, 'frogloks of guk'), [])
})

test('rows come back NEWEST HIT FIRST', () => {
  assert.deepEqual(
    factionRows(SNAP).map((r) => r.name),
    ['Guards of Qeynos', 'Frogloks of Guk', 'Dark Reflection', 'Clerics of Tunare']
  )
})

test('the Σ is signed, and it is the moves this log WATCHED rather than a standing', () => {
  const rows = factionRows(SNAP)
  const guk = rows.find((r) => r.name === 'Frogloks of Guk')
  assert.ok(guk)
  assert.equal(guk.delta, -45)
  assert.equal(guk.deltaText, '-45')
  assert.equal(guk.hits, 9)
  const tunare = rows.find((r) => r.name === 'Clerics of Tunare')
  assert.equal(tunare?.deltaText, '+120')
})

test('A SATURATION LINE IS COUNTED, NEVER SUMMED — and never drawn as a zero', () => {
  const qeynos = factionRows(SNAP).find((r) => r.name === 'Guards of Qeynos')
  assert.ok(qeynos)
  assert.equal(qeynos.maxed, 6)
  assert.equal(qeynos.hits, 0)
  assert.equal(qeynos.delta, 0)
  // The whole point: `0` would claim the standing moved by nothing. It did not move AT ALL.
  assert.equal(qeynos.deltaText, NO_STATED_CHANGE)
})

test('…and a faction can be against a rail AND have stated moves; the two coexist on one row', () => {
  const dark = factionRows(SNAP).find((r) => r.name === 'Dark Reflection')
  assert.ok(dark)
  assert.equal(dark.bottomed, 2)
  assert.equal(dark.hits, 1)
  assert.equal(dark.deltaText, '-3')
})

test('the display spelling is the log’s, and the KEY is what the snapshot filed it under (law 2)', () => {
  const guk = factionRows(SNAP).find((r) => r.key === 'frogloks of guk')
  assert.equal(guk?.name, 'Frogloks of Guk')
  assert.equal(guk?.searchKey, 'frogloks of guk')
})

test('the search narrows on the display name, and an empty query admits everything', () => {
  assert.equal(factionRows(SNAP, '').length, 4)
  assert.deepEqual(
    factionRows(SNAP, 'guk').map((r) => r.name),
    ['Frogloks of Guk']
  )
  assert.deepEqual(factionRows(SNAP, 'nothing here'), [])
})

test('a row’s recent lines are NEWEST FIRST and match on the LOWERCASED spelling', () => {
  const lines = factionRecent(SNAP, 'frogloks of guk')
  assert.deepEqual(
    lines.map((l) => l.ts),
    [T + 3, T + 1]
  )
  // Both spellings of the same faction are the same faction.
  assert.deepEqual(
    lines.map((l) => l.text),
    ['-5', '-5']
  )
})

test('a recent line that stated a RAIL says which rail, and states no number', () => {
  assert.deepEqual(
    factionRecent(SNAP, 'guards of qeynos').map((l) => l.text),
    ['at max']
  )
  assert.deepEqual(
    factionRecent(SNAP, 'dark reflection').map((l) => l.text),
    ['at min']
  )
})

test('the recent strip is capped, oldest first out', () => {
  const many: FactionSnap = {
    v: 1,
    factions: { x: totals({ display: 'X', delta: 10, hits: 10 }) },
    recent: Array.from({ length: 40 }, (_, i) => ({ faction: 'X', delta: 1, ts: T + i }))
  }
  const lines = factionRecent(many, 'x', 5)
  assert.equal(lines.length, 5)
  assert.equal(lines[0].ts, T + 39)
})

test('no string here carries an em dash or an en dash (AGENTS.md, JOS-106)', () => {
  for (const row of factionRows(SNAP)) assert.equal(/[—–]/.test(row.deltaText), false, row.deltaText)
  assert.equal(/[—–]/.test(NO_STATED_CHANGE), false)
})
