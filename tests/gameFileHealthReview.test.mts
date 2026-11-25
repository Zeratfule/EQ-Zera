// GAME-FILE HEALTH: THE ALARMS THE FIRST VERSION MISSED, AND THE ONES IT RAISED FOR NOTHING
// (EQ Zera, 2026-11-25, independent review of the first cut).
//
//   1. A patch that DROPS a column makes every row 172 wide. 172 was accepted (a leftover of the
//      old `length < 172` filter), so the file read "ok" with every field after the drop one off.
//   2. A patch that moves columns but keeps the width (one in before 77, one out of 173..188) reads
//      at a known width; only the fields themselves can say they are wrong.
//   3. A 0-byte or half-written file during a patch is not a layout change: it is pending, never a
//      notice and never a permanent report.
//   4. The report's counts must survive the error report's redaction (five-digit numbers become <n>).
//   6. A reader that does not matter to this player files nothing; eqclient.ini without the mode
//      keys is a fresh install, not a layout change.
//
// Synthetic rows only. The semantic values below mirror the shapes measured on the owner's install
// (2026-11-25, 74,024 rows): category 86 is 0..300 on 100% of rows, aemaxtargets 143 is 0..50 on
// 99.99%, while the column before each (85, 142) holds ids like 200303 and -1.

import test from 'node:test'
import assert from 'node:assert/strict'
import { caretLayout, dbstrHealth, eqclientIniHealth, modelsHealth, spellsUsHealth } from '../src/shared/gameFileDetect'
import { gameFileNotice, reportMessage, shouldReport, type GameFileReport } from '../src/shared/gameFileHealth'
import { redactMessage } from '../src/shared/errorReport'
import { KNOWN_ROW_LENGTHS, parseSpellsUs } from '../src/main/resist/spellsUsParse'
import { spellsUsSemantics } from '../src/main/resist/spellsUsSemantics'

/** One row on the 173-field map with the columns the sanity checks read set to real-looking values. */
function mapRow(i: number): string[] {
  const f = new Array<string>(173).fill('0')
  f[0] = String(1000 + i)
  f[1] = `Synthetic ${String(i)}`
  f[29] = '2'
  f[30] = '5'
  for (let c = 36; c < 52; c++) f[c] = '255'
  f[40] = '1'
  f[85] = '200303'
  f[86] = '125'
  f[87] = '42'
  f[142] = '-1'
  f[143] = '0'
  f[172] = '1|0|-4|0|101|8'
  return f
}

/** The same row as the 2026-11-24 client writes it: 190 fields. */
function row190(i: number): string[] {
  const f = mapRow(i)
  f.splice(77, 0, '0')
  f.splice(f.length - 1, 0, ...new Array<string>(16).fill('0'))
  return f
}

const file = (rows: string[][]): string => rows.map((r) => r.join('^')).join('\r\n')
const twenty = <T,>(make: (i: number) => T): T[] => Array.from({ length: 20 }, (_, i) => make(i))

function verdict(text: string): GameFileReport {
  return spellsUsHealth({ layout: caretLayout(text), semantics: spellsUsSemantics(text), version: '1-2' }, KNOWN_ROW_LENGTHS)
}

test('1: a file whose rows all lost one column (172 wide) is unrecognised, and the parser reads none of it', () => {
  assert.equal(KNOWN_ROW_LENGTHS.has(172), false)
  const text = file(twenty((i) => mapRow(i).slice(0, 172)))
  assert.equal(verdict(text).status, 'unrecognised')
  assert.deepEqual(parseSpellsUs(text), {})
})

test('2: the real 190 layout passes the field sanity checks', () => {
  const r = verdict(file(twenty(row190)))
  assert.equal(r.status, 'ok', JSON.stringify(r))
})

test('2: columns moved at the same width (one in before 77, one out of 173..188) is unrecognised', () => {
  const shifted = twenty((i) => {
    const f = row190(i)
    f.splice(40, 0, '0')
    f.splice(180, 1)
    return f
  })
  assert.equal(shifted[0].length, 190)
  const r = verdict(file(shifted))
  assert.equal(r.status, 'unrecognised', JSON.stringify(r))
  assert.equal(r.signature, 'fields-190-moved')
})

test('3: empty and half-written files are pending, never a notice and never a report', () => {
  const pending = [
    verdict(''),
    dbstrHealth('', 'v'),
    modelsHealth({ a: { head: new Uint8Array(0), size: 0 } }, 'v'),
    modelsHealth({ a: { head: new Uint8Array([0x00, 0x10, 0, 0, 0x50, 0x46, 0x53, 0x20]), size: 100 } }, 'v')
  ]
  for (const r of pending) {
    assert.equal(r.status, 'pending', JSON.stringify(r))
    assert.equal(shouldReport(r, [], () => true), false)
  }
  assert.equal(gameFileNotice(pending, []), null)
})

test('4: the report message keeps its useful numbers through redaction', () => {
  const r: GameFileReport = {
    id: 'spellsUs',
    status: 'unrecognised',
    signature: 'fields-200',
    facts: { rows: 74024, rowsRead: 0, rowsSkipped: 74024, fields: 200 },
    histogram: { '200': 74024 },
    version: '40752305-1794869464000'
  }
  const redacted = redactMessage(reportMessage(r))
  assert.doesNotMatch(redacted, /<n>/, redacted)
  assert.match(redacted, /rows=74k/)
  assert.match(redacted, /rowsSkipped=100%/)
  assert.match(redacted, /200x100%/)
})

test('6: only readers that matter to this player file a report', () => {
  const luclin: GameFileReport = { id: 'globalLoad', status: 'unrecognised', signature: 'no-anchor', facts: {}, version: 'v' }
  assert.equal(shouldReport(luclin, [], () => false), false, 'Luclin models off')
  assert.equal(shouldReport(luclin, [], () => true), true, 'Luclin models on')
  const ini: GameFileReport = { id: 'eqclientIni', status: 'unrecognised', signature: 'no-sections', facts: {}, version: 'v' }
  assert.equal(shouldReport(ini, [], () => true), false, 'eqclient.ini never notices, so never files')
})

test('6: eqclient.ini without the mode keys is a fresh install, not a layout change', () => {
  assert.equal(eqclientIniHealth('[Defaults]\r\nSound=1\r\n', false, 'v').status, 'missing')
  assert.equal(eqclientIniHealth('', false, 'v').status, 'pending')
})
