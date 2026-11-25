// THE TWO spells_us.txt READERS ACCEPT THE SAME ROW WIDTHS (EQ Zera, 2026-11-25).
//
// The app parses the file for the resist table (src/main/resist/spellsUsParse.ts) and the engine
// parses it again for the con card, the spell catalogue and its own resist fold
// (engine/crates/fold/src/spells_us.rs). The game-file health check judges the file against the
// app's list, so a width one reader learns and the other does not is a silent misread in the one
// that did not, which is exactly how the engine read the 190-field file at the August offsets for a
// day. This test reads the engine's own pin out of its source and holds the two lists equal.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KNOWN_ROW_LENGTHS } from '../src/main/resist/spellsUsParse'

test('the engine pins the same row widths the app accepts', () => {
  const rust = readFileSync(join(import.meta.dirname, '..', 'engine', 'crates', 'fold', 'src', 'spells_us', 'layout.rs'), 'utf8')
  const pin = /assert_eq!\(KNOWN_ROW_LENGTHS, \[([\d, ]+)\]\)/.exec(rust)
  assert.ok(pin, 'spells_us/layout.rs still pins KNOWN_ROW_LENGTHS in a test')
  const engine = pin[1].split(',').map((s) => Number(s.trim()))
  assert.deepEqual(engine, [...KNOWN_ROW_LENGTHS].sort((a, b) => a - b))
})
