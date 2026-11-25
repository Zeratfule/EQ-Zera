// spellsUsSemantics.ts — DO THE FIELDS SAY WHAT THE FIELD MAP SAYS THEY ARE? Pure over a string, so
// the worker runs it beside the parse and tests drive it with synthetic rows.
//
// A ROW WIDTH IS NOT A LAYOUT. A patch can move columns and keep the width (one in, one out), and
// `realign` will then read every field between the two one off without a murmur. So the health
// check asks every column 0..76, and the fields after 77 the parser reads, whether they look like
// themselves, over every realigned row.
//
// HOW A CHECK IS CHOSEN. A one-column move makes column c read column c-1 (or c+1). A range check
// cannot see that where neighbours share a range (resist type 0..9 next to 0..2), so each column's
// predicate is picked so that its NEIGHBOUR fails it, measured on the owner's install (2026-11-25,
// 74,024 rows, 190 fields, realigned). The real share and the floor, by column:
//
//   0 id, increasing               100%   .95      1 name, non-empty, not a number   100%  .95
//   2 = 0                         99.7%   .95      3 empty or text                   100%  .95
//   4 multiple of 10, non-zero    80.9%   .70      5 = 0                            83.1%  .75
//   6, 7 = 0                    97.4-98.7 .90      8 multiple of 50, non-zero       35.0%  .25
//   9 in {0, 1500}                98.7%   .95     10 not in {0, 1500}               26.6%  .15
//  11 not a multiple of 50        51.7%   .30     12 multiple of 10                 75.3%  .65
//  13 = 0                         99.2%   .95     14 non-zero                       29.4%  .20
//  15..18, 23..26 = -1          98.5-100  .90     19..22 = 1                    99.8-100%  .95
//  27 = 0                         96.6%   .90     28 = 1                            51.3%  .40
//  29 >= 3                        15.7%   .08     30 in {5, 6}                      78.0%  .60
//  31 = 0                         69.4%   .60     32 non-zero                       99.9%  .90
//  33..35 = 0                   97.9-100  .95     36..51 in {254, 255}          96.7-99.2  .90
//  52 in 30..60                   87.3%   .80     53 in {0, 13}                     92.6%  .85
//  54 = 0                         99.7%   .95     55 = -1                           21.4%  .10
//  56..74 = 0                   99.8-100  .95     75 = 100                          60.5%  .40
//  76 not in {0, 100}             ~98%    .90
//
// and after 77, as before: resist type 29 in 0..9, target type 30 in 0..60, the slot field's
// `n|n|` grammar (100%), category 86 in 0..300 (100%; column 85 holds ids like 200303) and
// aemaxtargets 143 in 0..50 (99.99%; column 142 is -1 on 97%).
//
// WHAT NO CHECK CAN SEE, AND WHY IT IS HARMLESS: a move entirely inside the run of all-zero
// columns 56..74 swaps a zero for a zero. The bytes barely change, the parser reads none of those
// columns, and the resulting table is identical; tests/spellsUsShiftSweep.test.mts proves both
// halves over every insert/remove pair.

import { realign } from './spellsUsParse'
import type { SpellsUsSemantics } from '../../shared/gameFileDetect'

/** Bump when a check or a floor changes: the layout sidecar is keyed on it. */
export const SEMANTICS_VERSION = 2

/**
 * The key a layout sidecar is stored under (resist/spellsUsMeta.ts): which parser measured it. Any
 * change to the cache version, the widths the parser reads or these checks makes a new key, so a
 * new build never trusts an old build's measurement.
 */
export function spellsUsMetaKey(cacheVersion: number, known: ReadonlySet<number>, semantics = SEMANTICS_VERSION): string {
  return `v${String(cacheVersion)}|${[...known].sort((a, b) => a - b).join(',')}|s${String(semantics)}`
}

const INT = /^-?\d+$/
const SLOT_HEAD = /^\d+\|-?\d+\|/

type Test = (v: string | undefined) => boolean
const isInt = (v: string | undefined): v is string => v !== undefined && INT.test(v)
const eq =
  (x: string): Test =>
  (v) =>
    v === x
const oneOf =
  (...xs: string[]): Test =>
  (v) =>
    v !== undefined && xs.includes(v)
const notOneOf =
  (...xs: string[]): Test =>
  (v) =>
    isInt(v) && !xs.includes(v)
const within =
  (lo: number, hi: number): Test =>
  (v) =>
    isInt(v) && Number(v) >= lo && Number(v) <= hi
const multipleOf =
  (m: number, nonZero = false): Test =>
  (v) =>
    isInt(v) && Number(v) % m === 0 && (!nonZero || v !== '0')
const nonZero: Test = (v) => isInt(v) && v !== '0'
const name: Test = (v) => v !== undefined && v.trim() !== '' && !INT.test(v.trim())
const emptyOrText: Test = (v) => v !== undefined && !INT.test(v)

/** [name, column, test, floor]: one row of the table in the header. */
type ColumnCheck = readonly [string, number, Test, number]

function columns(): ColumnCheck[] {
  const out: ColumnCheck[] = [
    ['c1name', 1, name, 0.95],
    ['c2', 2, eq('0'), 0.95],
    ['c3', 3, emptyOrText, 0.95],
    ['c4', 4, multipleOf(10, true), 0.7],
    ['c5', 5, eq('0'), 0.75],
    ['c6', 6, eq('0'), 0.9],
    ['c7', 7, eq('0'), 0.9],
    ['c8', 8, multipleOf(50, true), 0.25],
    ['c9', 9, oneOf('0', '1500'), 0.95],
    ['c10', 10, notOneOf('0', '1500'), 0.15],
    ['c11', 11, (v) => isInt(v) && Number(v) % 50 !== 0, 0.3],
    ['c12', 12, multipleOf(10), 0.65],
    ['c13', 13, eq('0'), 0.95],
    ['c14', 14, nonZero, 0.2],
    ['c27', 27, eq('0'), 0.9],
    ['c28', 28, eq('1'), 0.4],
    ['c29', 29, within(3, 9), 0.08],
    ['resistType', 29, within(0, 9), 0.95],
    ['c30', 30, oneOf('5', '6'), 0.6],
    ['targetType', 30, within(0, 60), 0.95],
    ['c31', 31, eq('0'), 0.6],
    ['c32', 32, nonZero, 0.9],
    ['c52', 52, within(30, 60), 0.8],
    ['c53', 53, oneOf('0', '13'), 0.85],
    ['c54', 54, eq('0'), 0.95],
    ['c55', 55, eq('-1'), 0.1],
    ['c75', 75, eq('100'), 0.4],
    ['c76', 76, notOneOf('0', '100'), 0.9],
    ['category', 86, within(0, 300), 0.95],
    ['aeTargets', 143, within(0, 50), 0.95]
  ]
  for (const c of [15, 16, 17, 18, 23, 24, 25, 26]) out.push([`c${String(c)}`, c, eq('-1'), 0.9])
  for (const c of [19, 20, 21, 22]) out.push([`c${String(c)}`, c, eq('1'), 0.95])
  for (const c of [33, 34, 35]) out.push([`c${String(c)}`, c, eq('0'), 0.95])
  for (let c = 36; c <= 51; c++) out.push([`c${String(c)}`, c, oneOf('254', '255'), 0.9])
  for (let c = 56; c <= 74; c++) out.push([`c${String(c)}`, c, eq('0'), 0.95])
  return out
}

const COLUMN_CHECKS = columns()
const SLOTS = 172

/** Score one realigned row into `pass`; returns the id the next row must exceed. */
function scoreRow(f: readonly string[], pass: Record<string, number>, lastId: number): number {
  const id = isInt(f[0]) ? Number(f[0]) : NaN
  if (id > lastId) pass.c0id++
  const s = (f[SLOTS] ?? '').trim()
  if (s === '' || SLOT_HEAD.test(s)) pass.slots++
  for (const [k, col, test] of COLUMN_CHECKS) if (test(f[col])) pass[k]++
  return Number.isNaN(id) ? lastId : id
}

/** Passing rows per check, and the passes each needs, over every realigned row. Counts only. */
export function spellsUsSemantics(text: string): SpellsUsSemantics {
  const pass: Record<string, number> = { c0id: 0, slots: 0 }
  for (const [k] of COLUMN_CHECKS) pass[k] = 0
  let rows = 0
  let lastId = -Infinity
  for (const line of text.split('\n')) {
    const f = line ? realign(line.split('^')) : null
    if (f === null) continue
    rows++
    lastId = scoreRow(f, pass, lastId)
  }
  const need: Record<string, number> = { c0id: Math.ceil(rows * 0.95), slots: Math.ceil(rows * 0.95) }
  for (const [k, , , floor] of COLUMN_CHECKS) need[k] = Math.ceil(rows * floor)
  return { rows, pass, need }
}
