// EVERY spells_us.txt FIELD CHECK'S FLOOR SITS BETWEEN WHAT A MOVE DOES AND WHAT A PARTLY WRITTEN
// FILE DOES (EQ Zera, 2026-11-25, final review of the game-file health check).
//
// src/shared/spellsUsChecks.json carries, beside each floor, the shares measured on the owner's
// install: the real share, the share when the column reads its left or right neighbour (a one-column
// move), and the lowest share over the first 1k..60k rows (a file a patcher is still writing in
// place: the real file is not uniform, c55 is 21% overall and 2.2% in its first 1,000 rows). A floor
// above a prefix's share pauses the data while the game patches; a floor at or under both shifted
// shares cannot see a move. This test holds every floor strictly between the two, with margin.
//
// WHY NOT A PREFIX SWEEP ON THE SYNTHETIC FIXTURE: tests/spellsUsShape.mts cycles each column's
// values uniformly, so every prefix of it has the whole file's shares and such a sweep would pass
// trivially. The ordering skew that makes prefixes dangerous exists only in the real file, so its
// measurement is what is committed (numbers only, nothing of the file itself).

import test from 'node:test'
import assert from 'node:assert/strict'
import CHECKS from '../src/shared/spellsUsChecks.json'

interface Measured {
  real: number
  left: number
  right: number
  prefixMin: number
}
const checks = (CHECKS as { checks: { name: string; floor: number; measured?: Measured }[] }).checks

test('every check carries its measurements', () => {
  for (const c of checks) assert.ok(c.measured, c.name)
})

test('no floor sits above the share of any measured prefix of the real file (a file being written)', () => {
  for (const c of checks) {
    const m = c.measured as Measured
    assert.ok(c.floor <= m.prefixMin - 0.005, `${c.name}: floor ${String(c.floor)} vs prefix minimum ${String(m.prefixMin)}`)
  }
})

test('every floor still sees a one-column move in at least one direction', () => {
  for (const c of checks) {
    const m = c.measured as Measured
    assert.ok(Math.min(m.left, m.right) < c.floor - 0.005, `${c.name}: floor ${String(c.floor)} vs shifted ${String(m.left)}/${String(m.right)}`)
  }
})
