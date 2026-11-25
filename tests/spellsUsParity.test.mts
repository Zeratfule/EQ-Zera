// THE APP AND THE ENGINE JUDGE spells_us.txt THE SAME WAY (EQ Zera, 2026-11-25).
//
// Both readers gate on the same width rule and the same field checks (src/shared/spellsUsChecks.json,
// which the engine embeds with include_str!). The app's verdict decides the notice and whether the
// resist table is served; the engine's decides whether its own copy of the table (spell search, the
// spell card's client figures) is served. If they disagreed, one surface would show numbers the
// notice calls paused. This test holds the app's verdict on a set of synthetic files to the expected
// one; engine/crates/fold/src/spells_us/layout.rs reads the SAME files and the same expected.json.
// Both sides judge them with the field checks on at any size (the production minimum is a real
// file's size; these files are 30 rows).
//
// Regenerate the files with EQZ_WRITE_PARITY=1 when the shape or the set changes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { caretLayout, spellsUsHealth } from '../src/shared/gameFileDetect'
import { KNOWN_ROW_LENGTHS, parseSpellsUs } from '../src/main/resist/spellsUsParse'
import { spellsUsSemantics } from '../src/main/resist/spellsUsSemantics'
import { parityFixtures } from './spellsUsShape.mjs'

const DIR = join(import.meta.dirname, 'fixtures', 'spellsUsShape')
const set = parityFixtures()

if (process.env.EQZ_WRITE_PARITY === '1') {
  mkdirSync(DIR, { recursive: true })
  for (const [name, f] of Object.entries(set)) writeFileSync(join(DIR, `${name}.txt`), f.text, 'latin1')
  const expected = Object.fromEntries(Object.entries(set).map(([k, v]) => [k, v.verdict]))
  writeFileSync(join(DIR, 'expected.json'), `${JSON.stringify(expected, null, 2)}\n`)
}

test('the committed parity files are exactly what the generator makes', () => {
  const expected = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as Record<string, string>
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(set).sort())
  for (const [name, f] of Object.entries(set)) {
    assert.equal(readFileSync(join(DIR, `${name}.txt`), 'latin1'), f.text, name)
    assert.equal(expected[name], f.verdict, name)
  }
})

test("the app's verdict on every parity file is the expected one", () => {
  for (const [name, f] of Object.entries(set)) {
    const m = { layout: caretLayout(f.text), semantics: spellsUsSemantics(f.text), version: 'v' }
    const entries = Object.keys(parseSpellsUs(f.text)).length
    const verdict = spellsUsHealth({ ...m, entries }, KNOWN_ROW_LENGTHS, 0).status
    assert.equal(verdict === 'ok' ? 'ok' : 'unrecognised', f.verdict, name)
  }
})
