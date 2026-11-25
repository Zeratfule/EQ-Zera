// spellsUsSemantics.ts — DO THE FIELDS SAY WHAT THE FIELD MAP SAYS THEY ARE? Pure over a string, so
// the worker runs it beside the parse and tests drive it with synthetic rows.
//
// A ROW WIDTH IS NOT A LAYOUT. A patch can move columns and keep the width (one in, one out), and
// `realign` will then read every field between the two one off without a murmur. So the health
// check asks columns of the realigned row whether they look like themselves.
//
// THE CHECKS ARE DATA, SHARED WITH THE ENGINE: src/shared/spellsUsChecks.json. The engine parses the
// same file for itself (engine/crates/fold/src/spells_us/health.rs reads the same JSON at compile
// time), so the two readers cannot disagree about which files they trust. The JSON's header states
// how every check and floor was chosen; in short, a check stays only if a one-column move makes it
// fail (its share when reading column c-1 or c+1 is under its floor), and its floor sits between
// the real share and the shifted one. Measured on the owner's install, 2026-11-25.
//
// WHAT NO CHECK CAN SEE, AND WHY IT IS HARMLESS: a move inside a run of identical columns (the
// all-zero run 56..74, the 255 class block) swaps like for like; the parse is identical, which
// tests/spellsUsShiftSweep.test.mts asserts for every insert/remove pair it does not catch.

import { realign } from './spellsUsParse'
import CHECKS_JSON from '../../shared/spellsUsChecks.json'
import type { SpellsUsSemantics } from '../../shared/gameFileDetect'

interface CheckSpec {
  name: string
  col: number
  kind: string
  args?: string[]
  floor: number
}

/** The checks' version: the layout sidecar is keyed on it, so a changed check re-measures. */
export const SEMANTICS_VERSION: number = (CHECKS_JSON as { version: number }).version

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

/** One `kind` of the JSON, as a predicate. The engine's health.rs implements the same list. */
function compile(kind: string, a: readonly string[]): Test {
  const n = (i: number): number => Number(a[i])
  switch (kind) {
    case 'eq':
      return (v) => v === a[0]
    case 'oneOf':
      return (v) => v !== undefined && a.includes(v)
    case 'notOneOf':
      return (v) => isInt(v) && !a.includes(v)
    case 'within':
      return (v) => isInt(v) && Number(v) >= n(0) && Number(v) <= n(1)
    case 'multipleOf':
      return (v) => isInt(v) && Number(v) % n(0) === 0
    case 'multipleOfNonZero':
      return (v) => isInt(v) && v !== '0' && Number(v) % n(0) === 0
    case 'notMultipleOf':
      return (v) => isInt(v) && Number(v) % n(0) !== 0
    case 'nonZero':
      return (v) => isInt(v) && v !== '0'
    case 'name':
      return (v) => v !== undefined && v.trim() !== '' && !INT.test(v.trim())
    case 'emptyOrText':
      return (v) => v !== undefined && !INT.test(v)
    case 'slotGrammar':
      return (v) => (v ?? '').trim() === '' || SLOT_HEAD.test((v ?? '').trim())
    default:
      throw new Error(`spellsUsChecks.json: unknown kind ${kind}`)
  }
}

/** The compiled table: name, column, predicate, floor. Exported for the measurement tests. */
export const SPELLS_US_CHECKS: readonly { name: string; col: number; test: Test; floor: number }[] = (
  CHECKS_JSON as { checks: CheckSpec[] }
).checks.map((c) => ({ name: c.name, col: c.col, test: compile(c.kind, c.args ?? []), floor: c.floor }))

/** Passing rows per check, and the passes each needs, over every realigned row. Counts only. */
export function spellsUsSemantics(text: string): SpellsUsSemantics {
  const pass: Record<string, number> = {}
  for (const c of SPELLS_US_CHECKS) pass[c.name] = 0
  let rows = 0
  for (const line of text.split('\n')) {
    const f = line ? realign(line.split('^')) : null
    if (f === null) continue
    rows++
    for (const c of SPELLS_US_CHECKS) if (c.test(f[c.col])) pass[c.name]++
  }
  const need: Record<string, number> = {}
  for (const c of SPELLS_US_CHECKS) need[c.name] = Math.ceil(rows * c.floor)
  return { rows, pass, need }
}
