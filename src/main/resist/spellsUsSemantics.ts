// spellsUsSemantics.ts — DO THE FIELDS SAY WHAT THE FIELD MAP SAYS THEY ARE? Pure over a string, so
// the worker runs it beside the parse and tests drive it with synthetic rows.
//
// A ROW WIDTH IS NOT A LAYOUT. A patch can move columns and keep the width (one in before 77, one
// out of the unused 173..188), and `realign` will then read every field after the move one off
// without a murmur. So the health check also asks the fields the parser reads whether they look
// like themselves, over every realigned row.
//
// THE CHECKS AND THEIR REAL FRACTIONS (owner's install, 2026-11-25, 74,024 rows, 190 fields):
//
//   check          predicate                               aligned    read one column early
//   resistType     29 is an integer 0..9                   100%       100%
//   targetType     30 is an integer 0..60                  100%       100%
//   classes        36..51 are integers 0..255              100%       100%
//   slots          the last field is empty or `n|n|...`    100%       0%
//   category       86 is an integer 0..300                 100%       7.4%  (85 holds ids like 200303)
//   aeTargets      143 is an integer 0..50                 99.99%     3.2%  (142 is -1 on 97%)
//
// The first three guard the columns before 77, the last three the columns after it, which is where
// every move so far has happened. A check passes at `SEMANTIC_FLOOR` (95%), far under every aligned
// fraction and far over every shifted one.

import { realign } from './spellsUsParse'
import type { SpellsUsSemantics } from '../../shared/gameFileDetect'

const INT = /^-?\d+$/
const SLOT_HEAD = /^\d+\|-?\d+\|/

function intIn(v: string | undefined, lo: number, hi: number): boolean {
  if (v === undefined || !INT.test(v)) return false
  const n = Number(v)
  return n >= lo && n <= hi
}

const CHECKS: Record<string, (f: readonly string[]) => boolean> = {
  resistType: (f) => intIn(f[29], 0, 9),
  targetType: (f) => intIn(f[30], 0, 60),
  classes: (f) => f.slice(36, 52).every((v) => intIn(v, 0, 255)),
  slots: (f) => {
    const s = (f[172] ?? '').trim()
    return s === '' || SLOT_HEAD.test(s)
  },
  category: (f) => intIn(f[86], 0, 300),
  aeTargets: (f) => intIn(f[143], 0, 50)
}

/** Passing rows per check, over every realigned row. Counts only; the shared detector judges. */
export function spellsUsSemantics(text: string): SpellsUsSemantics {
  const pass: Record<string, number> = Object.fromEntries(Object.keys(CHECKS).map((k) => [k, 0]))
  let rows = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    const f = realign(line.split('^'))
    if (f === null) continue
    rows++
    for (const [name, ok] of Object.entries(CHECKS)) if (ok(f)) pass[name]++
  }
  return { rows, pass }
}
