// THE BUILD OPTIMIZER (EQ Zera, 2026-09-06): candidates per slot, the best reachable set, and the
// upgrades from here to there — pure functions over the gear index rows the Gear tab already has.
//
// One row is scored once per profile (`itemScore`); a set's score is the sum over its cells. The
// best set is greedy per cell, which is exact here because the cells are independent — with ONE
// coupling, modelled since 2026-11-23: a two-hander takes both hands. It used to be ignored, so
// the "best" set paired a 2H weapon in PRIMARY with a shield in SECONDARY — a set nobody can wear,
// and the ceiling every meter is a percentage of. `resolveHands` now picks whichever is worth more,
// the best two-hander alone or the best one-hander plus the best off-hand, and the upgrade lists
// charge a two-hander for the off-hand it would take off (`handsCost`).
// Paired cells (EAR/EAR2 …) take two DISTINCT rows: a lore item cannot be worn twice and
// the catalog does not say which items are lore reliably enough to special-case, so every item is
// treated as once-only.
//
// LOOPS, NOT `.filter`/`.sort` OVER ROWS: ruling 4 (eslint.domainMunging.mjs). The candidate list
// is sorted as `Scored` records, which is what a score is.

import type { ClassAbbr } from '../classCombo'
import type { GearRow } from '../planner/gear'
import { equipSlotOf, PAIRED_SLOTS, type PlanSlotId } from '../planner/types'
import { WEAPON_CATEGORY_MEMBERS, weaponTypeOf } from '../planner/weaponType'
import { itemScore, type BuildWeights } from './profiles'

export interface BuildContext {
  classes: readonly ClassAbbr[]
  weights: BuildWeights
  /** rows the current filters exclude (out of era, not owned, …) */
  excluded?: (row: GearRow) => boolean
  /** how many upgrade options `upgradesFor` lists per cell (default 3) */
  perCell?: number
}

const DEFAULT_PER_CELL = 3

export interface Scored {
  row: GearRow
  score: number
}

/** A row a member of this loadout can wear: a stated class list that names none of ours excludes it. */
export function wearable(row: GearRow, classes: readonly ClassAbbr[]): boolean {
  if (row.classes.length === 0 || classes.length === 0) return true
  return row.classes.some((c) => classes.includes(c))
}

/** Every row that fits `cell` under the context, best first. */
export function candidatesForCell(rows: readonly GearRow[], cell: PlanSlotId, ctx: BuildContext): Scored[] {
  const slot = equipSlotOf(cell)
  const out: Scored[] = []
  for (const row of rows) {
    if (slot !== null && !row.slots.includes(slot)) continue
    if (!wearable(row, ctx.classes)) continue
    if (ctx.excluded?.(row)) continue
    out.push({ row, score: itemScore(row.stats, ctx.weights) })
  }
  out.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
  return out
}

export type BuildSet = ReadonlyMap<PlanSlotId, GearRow | null>

/** The set's score under the weights: the sum over its filled cells. */
export function buildScore(set: BuildSet, weights: BuildWeights): number {
  let total = 0
  for (const row of set.values()) if (row) total += itemScore(row.stats, weights)
  return total
}

/**
 * The best set these rows can make for these cells: the top candidate per cell, with a paired
 * cell's second half taking the best row its first half did not.
 */
export function bestBuild(rows: readonly GearRow[], cells: readonly PlanSlotId[], ctx: BuildContext): Map<PlanSlotId, GearRow | null> {
  const out = new Map<PlanSlotId, GearRow | null>()
  const taken = new Set<string>()
  for (const cell of cells) {
    const slot = equipSlotOf(cell)
    const paired = slot !== null && (PAIRED_SLOTS as readonly string[]).includes(slot)
    let pick: GearRow | null = null
    for (const c of candidatesForCell(rows, cell, ctx)) {
      if (paired && taken.has(c.row.key)) continue
      pick = c.row
      break
    }
    if (pick) taken.add(pick.key)
    out.set(cell, pick)
  }
  resolveHands(out, rows, cells, ctx)
  return out
}

/** A two-handed weapon — by its stated skill (`2H Slashing` …), the weapon-type fold's own table. */
export function isTwoHander(row: GearRow): boolean {
  const type = weaponTypeOf(row.skill)
  return type !== null && WEAPON_CATEGORY_MEMBERS.TWO_HAND.includes(type)
}

/** The best PRIMARY candidate that leaves the off-hand free. */
function bestOneHander(rows: readonly GearRow[], ctx: BuildContext): Scored | null {
  for (const c of candidatesForCell(rows, 'PRIMARY', ctx)) if (!isTwoHander(c.row)) return c
  return null
}

/**
 * The one coupling between cells: a two-hander in PRIMARY leaves SECONDARY empty. When the greedy
 * pass put one there, keep it only if it outscores the best ONE-hander plus the off-hand the
 * greedy pass already chose; otherwise swap the one-hander in. Either way the set is wearable.
 */
function resolveHands(out: Map<PlanSlotId, GearRow | null>, rows: readonly GearRow[], cells: readonly PlanSlotId[], ctx: BuildContext): void {
  const main = out.get('PRIMARY') ?? null
  if (main === null || !isTwoHander(main) || !cells.includes('SECONDARY')) return
  const off = out.get('SECONDARY') ?? null
  const oneHand = bestOneHander(rows, ctx)
  const pair = (oneHand?.score ?? 0) + (off === null ? 0 : itemScore(off.stats, ctx.weights))
  if (oneHand !== null && pair > itemScore(main.stats, ctx.weights)) out.set('PRIMARY', oneHand.row)
  else out.set('SECONDARY', null)
}

/**
 * What else comes off the body when `row` goes into `cell`, in score — or `null` when the cell is
 * not free to take anything. A two-hander into PRIMARY takes the off-hand with it; an off-hand
 * cannot go on beside a worn two-hander (that is a two-item swap, not an upgrade to one cell).
 */
export function handsCost(row: GearRow, cell: PlanSlotId, set: BuildSet, weights: BuildWeights): number | null {
  if (cell === 'PRIMARY' && isTwoHander(row)) {
    const off = set.get('SECONDARY') ?? null
    return off === null ? 0 : itemScore(off.stats, weights)
  }
  if (cell === 'SECONDARY') {
    const main = set.get('PRIMARY') ?? null
    if (main !== null && isTwoHander(main)) return null
  }
  return 0
}

export interface CellUpgrade {
  cell: PlanSlotId
  current: GearRow | null
  currentScore: number
  /** the candidates that beat what is worn, best first, each with its gain */
  options: (Scored & { delta: number })[]
}

/** For every cell, what would improve it — the candidates that score above what is worn there. */
export function upgradesFor(rows: readonly GearRow[], set: BuildSet, cells: readonly PlanSlotId[], ctx: BuildContext): CellUpgrade[] {
  const perCell = ctx.perCell ?? DEFAULT_PER_CELL
  const out: CellUpgrade[] = []
  const worn = new Set<string>()
  for (const row of set.values()) if (row) worn.add(row.key)
  for (const cell of cells) {
    const current = set.get(cell) ?? null
    const currentScore = current ? itemScore(current.stats, ctx.weights) : 0
    out.push({ cell, current, currentScore, options: cellOptions(rows, cell, { ctx, set, currentScore, worn, perCell }) })
  }
  return out
}

interface CellQuery {
  ctx: BuildContext
  set: BuildSet
  currentScore: number
  /** keys already worn somewhere in the set — never offered again */
  worn: ReadonlySet<string>
  perCell: number
}

/**
 * One cell's upgrade options. The gain is the candidate's score minus what it takes off the body:
 * the worn item in this cell, plus the off-hand when it is a two-hander (`handsCost`). Because that
 * charge varies per candidate the list is ranked by GAIN, not by raw score — the early exit is still
 * safe, since no candidate can gain more than its own score minus the worn item's.
 */
function cellOptions(rows: readonly GearRow[], cell: PlanSlotId, q: CellQuery): CellUpgrade['options'] {
  const options: CellUpgrade['options'] = []
  for (const c of candidatesForCell(rows, cell, q.ctx)) {
    if (c.score <= q.currentScore) break
    if (q.worn.has(c.row.key)) continue
    const cost = handsCost(c.row, cell, q.set, q.ctx.weights)
    if (cost === null) break
    const delta = c.score - q.currentScore - cost
    if (delta > 0) options.push({ ...c, delta })
  }
  options.sort((a, b) => b.delta - a.delta || a.row.name.localeCompare(b.row.name))
  return options.slice(0, q.perCell)
}
