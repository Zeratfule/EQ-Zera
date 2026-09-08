// THE BUILD OPTIMIZER (EQ Zera, 2026-09-06): candidates per slot, the best reachable set, and the
// upgrades from here to there — pure functions over the gear index rows the Gear tab already has.
//
// One row is scored once per profile (`itemScore`); a set's score is the sum over its cells. The
// best set is greedy per cell, which is exact here because the cells are independent — the one
// coupling this ignores is a two-hander taking both weapon cells, which the UI states rather than
// models. Paired cells (EAR/EAR2 …) take two DISTINCT rows: a lore item cannot be worn twice and
// the catalog does not say which items are lore reliably enough to special-case, so every item is
// treated as once-only.
//
// LOOPS, NOT `.filter`/`.sort` OVER ROWS: ruling 4 (eslint.domainMunging.mjs). The candidate list
// is sorted as `Scored` records, which is what a score is.

import type { ClassAbbr } from '../classCombo'
import type { GearRow } from '../planner/gear'
import { equipSlotOf, PAIRED_SLOTS, type PlanSlotId } from '../planner/types'
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
  return out
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
    const options: CellUpgrade['options'] = []
    for (const c of candidatesForCell(rows, cell, ctx)) {
      if (options.length >= perCell) break
      if (c.score <= currentScore) break
      if (worn.has(c.row.key)) continue
      options.push({ ...c, delta: c.score - currentScore })
    }
    out.push({ cell, current, currentScore, options })
  }
  return out
}
