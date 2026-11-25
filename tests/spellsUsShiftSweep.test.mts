// EVERY ONE-IN, ONE-OUT COLUMN MOVE IN spells_us.txt IS CAUGHT, OR IS PROVABLY HARMLESS
// (EQ Zera, 2026-11-25, second review of the game-file health check).
//
// A patch can insert a column and remove another and keep the row width, so `realign` reads the
// fields between the two one off. The sweep: for every insert position p in 0..76 and every removal
// q in 61..188 (q != p), the verdict on a real-SHAPED synthetic file (tests/spellsUsShape.mts) must
// be `unrecognised` - with one class of exception, asserted rather than ignored: a move that stays
// inside the run of all-zero columns 56..74 swaps a zero for a zero, and there the shifted file must
// parse to EXACTLY the same table as the unshifted one (the parser reads none of those columns).
// The unmodified file must stay `ok`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { caretLayout, spellsUsHealth } from '../src/shared/gameFileDetect'
import { KNOWN_ROW_LENGTHS, parseSpellsUs } from '../src/main/resist/spellsUsParse'
import { spellsUsSemantics } from '../src/main/resist/spellsUsSemantics'
import { joinRows, shaped190 } from './spellsUsShape.mjs'

const ROWS = 40
const base = Array.from({ length: ROWS }, (_, i) => shaped190(i))

function verdictOf(text: string): string {
  return spellsUsHealth({ layout: caretLayout(text), semantics: spellsUsSemantics(text), version: 'v' }, KNOWN_ROW_LENGTHS).status
}

/** Insert a '0' column at p and remove what was column q, in the unshifted row's coordinates. */
function moved(p: number, q: number): string {
  return joinRows(
    base.map((row) => {
      const f = [...row]
      f.splice(p, 0, '0')
      f.splice(q >= p ? q + 1 : q, 1)
      return f
    })
  )
}

test('the unmodified real-shaped 190-field file is ok', () => {
  assert.equal(verdictOf(joinRows(base)), 'ok')
})

test('every insert in 0..76 paired with a removal in 61..188 is unrecognised, or provably harmless', () => {
  const original = JSON.stringify(parseSpellsUs(joinRows(base)))
  const removals = Array.from({ length: 188 - 61 + 1 }, (_, i) => 61 + i)
  const harmless: string[] = []
  const missed: string[] = []
  for (let p = 0; p <= 76; p++) {
    for (const q of removals) {
      if (q === p) continue
      const text = moved(p, q)
      if (verdictOf(text) === 'unrecognised') continue
      const inZeroRun = Math.min(p, q) >= 56 && Math.max(p, q) <= 75
      if (inZeroRun && JSON.stringify(parseSpellsUs(text)) === original) harmless.push(`${String(p)}/${String(q)}`)
      else missed.push(`${String(p)}/${String(q)}`)
    }
  }
  assert.deepEqual(missed, [], `moves read as ok that change what the parser reads: ${missed.slice(0, 20).join(' ')}`)
  // The exceptions are exactly the zero-for-zero swaps, and there are not many of them.
  assert.ok(harmless.length < 300, `${String(harmless.length)} harmless moves`)
})
