// THE BUILD OPTIMIZER (EQ Zera, 2026-09-06): candidates per slot, the best reachable set, and the
// upgrades from here to there — pure functions over the gear index rows the Gear tab already has.
//
// One row is scored once per profile (`rowScore`: its stats plus its effects, effectScore.ts); a
// set's score is the sum over its cells (`setScore`). The best set is greedy per cell, which is exact
// here because the cells are independent — with TWO couplings:
//   * A TWO-HANDER TAKES BOTH HANDS (since 2026-11-23). It used to be ignored, so the "best" set paired
//     a 2H weapon in PRIMARY with a shield in SECONDARY — a set nobody can wear, and the ceiling every
//     meter is a percentage of. `resolveHands` picks whichever is worth more, the best two-hander alone
//     or the best one-hander plus the best off-hand, and the upgrade lists charge a two-hander for the
//     off-hand it would take off (`handsCost`).
//   * FOCUS DOES NOT STACK (since effects are scored, 2026-11-23). A focus adds only what it holds
//     above the best of its group elsewhere in the set (effectScore.ts `FocusCover`). The greedy pass
//     scores each cell against the cover of the cells already chosen, then one refinement pass
//     re-picks every cell against the cover of all the OTHER cells, so a cell that took a focus the
//     rest of the set also holds gives the slot back to its best stats.
// Every cell takes a DISTINCT row: a lore item cannot be worn twice and the catalog does not say
// which items are lore reliably enough to special-case, so every item is treated as once-only — in
// paired cells (EAR/EAR2 …) and across the hands and RANGE alike (an idol that fits all three is one
// idol).
//
// LOOPS, NOT `.filter`/`.sort` OVER ROWS: ruling 4 (eslint.domainMunging.mjs). The candidate list
// is sorted as `Scored` records, which is what a score is.

import type { ClassAbbr } from '../classCombo'
import type { GearRow } from '../planner/gear'
import { equipSlotOf, type PlanSlotId } from '../planner/types'
import { WEAPON_CATEGORY_MEMBERS, weaponTypeOf } from '../planner/weaponType'
import type { BuildWeights } from './profiles'
import { focusCover, rowScore, setScore, type FocusCover } from './effectScore'

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

/** Every row that fits `cell` under the context, best first, each focus scored above `cover`. */
export function candidatesForCell(rows: readonly GearRow[], cell: PlanSlotId, ctx: BuildContext, cover?: FocusCover): Scored[] {
  const slot = equipSlotOf(cell)
  const out: Scored[] = []
  for (const row of rows) {
    if (slot !== null && !row.slots.includes(slot)) continue
    if (!wearable(row, ctx.classes)) continue
    if (ctx.excluded?.(row)) continue
    // A Temporary item (a mage's summoned bauble) vanishes on logout: never a set to plan around,
    // however well its focus scores. A worn one is still scored where it sits.
    if (row.flags.includes('Temporary')) continue
    out.push({ row, score: rowScore(row, ctx.weights, cover) })
  }
  out.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
  return out
}

export type BuildSet = ReadonlyMap<PlanSlotId, GearRow | null>

/** The set's score under the weights: every filled cell, each focus group counted once. */
export function buildScore(set: BuildSet, weights: BuildWeights): number {
  return setScore(set.values(), weights)
}

/** The focus cover of every cell of `set` but the ones named. */
export function coverExcept(set: BuildSet, skip: readonly PlanSlotId[]): Map<string, number> {
  const rows: (GearRow | null)[] = []
  for (const [cell, row] of set) if (!skip.includes(cell)) rows.push(row)
  return focusCover(rows)
}

/** The best candidate for one cell that no other cell has taken. */
function pickFor(rows: readonly GearRow[], cell: PlanSlotId, ctx: BuildContext, q: { taken: ReadonlySet<string>; cover: FocusCover }): GearRow | null {
  for (const c of candidatesForCell(rows, cell, ctx, q.cover)) if (!q.taken.has(c.row.key)) return c.row
  return null
}

/** Fold one row's focus into a running cover. */
function raiseCover(cover: Map<string, number>, row: GearRow): void {
  for (const [g, pct] of focusCover([row])) if (pct > (cover.get(g) ?? 0)) cover.set(g, pct)
}

/** Keys worn anywhere in `set` but `cell`. */
function takenExcept(set: BuildSet, cell: PlanSlotId): Set<string> {
  const out = new Set<string>()
  for (const [c, row] of set) if (c !== cell && row) out.add(row.key)
  return out
}

/**
 * The best set these rows can make for these cells: the top candidate per cell that no earlier cell
 * took, scored against the focus the earlier cells hold — then one pass re-picking each cell against
 * everything else the set holds (see the header).
 */
export function bestBuild(rows: readonly GearRow[], cells: readonly PlanSlotId[], ctx: BuildContext): Map<PlanSlotId, GearRow | null> {
  const out = new Map<PlanSlotId, GearRow | null>()
  const taken = new Set<string>()
  const cover = new Map<string, number>()
  for (const cell of cells) {
    const pick = pickFor(rows, cell, ctx, { taken, cover })
    if (pick) {
      taken.add(pick.key)
      raiseCover(cover, pick)
    }
    out.set(cell, pick)
  }
  for (const cell of cells) out.set(cell, pickFor(rows, cell, ctx, { taken: takenExcept(out, cell), cover: coverExcept(out, [cell]) }))
  resolveHands(out, rows, cells, ctx)
  return out
}

/** A two-handed weapon — by its stated skill (`2H Slashing` …), the weapon-type fold's own table. */
export function isTwoHander(row: GearRow): boolean {
  const type = weaponTypeOf(row.skill)
  return type !== null && WEAPON_CATEGORY_MEMBERS.TWO_HAND.includes(type)
}

/** The best PRIMARY candidate that leaves the off-hand free and is not worn elsewhere. */
function bestOneHander(rows: readonly GearRow[], ctx: BuildContext, q: { taken: ReadonlySet<string>; cover: FocusCover }): Scored | null {
  for (const c of candidatesForCell(rows, 'PRIMARY', ctx, q.cover)) if (!isTwoHander(c.row) && !q.taken.has(c.row.key)) return c
  return null
}

/**
 * The one hands coupling: a two-hander in PRIMARY leaves SECONDARY empty. When the greedy pass put
 * one there, keep it only if it outscores the best ONE-hander plus the off-hand the greedy pass
 * already chose; otherwise swap the one-hander in. Either way the set is wearable.
 */
function resolveHands(out: Map<PlanSlotId, GearRow | null>, rows: readonly GearRow[], cells: readonly PlanSlotId[], ctx: BuildContext): void {
  const main = out.get('PRIMARY') ?? null
  if (main === null || !isTwoHander(main) || !cells.includes('SECONDARY')) return
  const off = out.get('SECONDARY') ?? null
  const cover = coverExcept(out, ['PRIMARY', 'SECONDARY'])
  const oneHand = bestOneHander(rows, ctx, { taken: takenExcept(out, 'PRIMARY'), cover })
  const pair = (oneHand?.score ?? 0) + (off === null ? 0 : rowScore(off, ctx.weights, cover))
  if (oneHand !== null && pair > rowScore(main, ctx.weights, cover)) out.set('PRIMARY', oneHand.row)
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
    return off === null ? 0 : rowScore(off, weights, coverExcept(set, ['PRIMARY', 'SECONDARY']))
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

/**
 * For every cell, what would improve it — the candidates that score above what is worn there, both
 * scored against the focus the rest of the set holds, so a gain is what the swap would change.
 */
export function upgradesFor(rows: readonly GearRow[], set: BuildSet, cells: readonly PlanSlotId[], ctx: BuildContext): CellUpgrade[] {
  const perCell = ctx.perCell ?? DEFAULT_PER_CELL
  const out: CellUpgrade[] = []
  const worn = new Set<string>()
  for (const row of set.values()) if (row) worn.add(row.key)
  for (const cell of cells) {
    const current = set.get(cell) ?? null
    const cover = coverExcept(set, [cell])
    const currentScore = current ? rowScore(current, ctx.weights, cover) : 0
    out.push({ cell, current, currentScore, options: cellOptions(rows, cell, { ctx, set, currentScore, worn, perCell, cover }) })
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
  /** the focus the rest of the set holds */
  cover: FocusCover
}

/**
 * One cell's upgrade options. The gain is the candidate's score minus what it takes off the body:
 * the worn item in this cell, plus the off-hand when it is a two-hander (`handsCost`). Because that
 * charge varies per candidate the list is ranked by GAIN, not by raw score — the early exit is still
 * safe, since no candidate can gain more than its own score minus the worn item's.
 */
function cellOptions(rows: readonly GearRow[], cell: PlanSlotId, q: CellQuery): CellUpgrade['options'] {
  const options: CellUpgrade['options'] = []
  for (const c of candidatesForCell(rows, cell, q.ctx, q.cover)) {
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
