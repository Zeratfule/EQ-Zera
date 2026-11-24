// aaPlanner.ts — the AA planner's arithmetic: what you hold, what a plan costs, when you can
// afford it, and which steps are blocked. PURE: catalog + ledger rows + a plan in, rows out — no
// React, no storage, no clock — so tests/aaPlanner.test.mts drives every rule under plain node.
//
// WHAT "HELD" MEANS (law 1). EQ Legends has no AA export (shared/characterSheet.ts), so the log is
// the only evidence: a rank is held when a purchase line for it (or a higher rank) was seen —
// cost-0 auto-grants included, because `aaLedger` keeps those rungs. A respec prints no refund
// line, so a refunded rank still reads as held; and a rank bought before the log began is not seen
// at all. That second gap is what the user's own marks are for: `stated` is a rank the user says
// they hold, kept apart from `logged` and labelled as theirs. Held is the larger of the two.
//
// WHAT A PLAN STEP COSTS. The sum of the catalog's per-rank costs above the held rank. A rank the
// wiki writes as `?` adds nothing to the sum and is COUNTED instead, so a total can say "and two
// ranks of unknown cost" rather than look complete. Granted AAs (Special: reincarnation and
// achievements) are never a step — `sanitizeSteps` in aaPlanStore.ts drops them.
//
// WHEN YOU CAN AFFORD IT is an ESTIMATE: the shortfall over the points-per-hour the caller hands
// in (the AA pace, shared/aaPace.ts). Null pace ⇒ no ETA at all, never a guess.

import { aaKey, prereqRank, rankCost, rankLevel, type AaCatalogEntry, type AaSection } from './aaCatalog'
import type { ClassAbbr } from './classCombo'

/** One ability's held rank, with where each half came from. */
export interface AaHeld {
  /** highest rank a purchase line in the log names (0 = none seen) */
  logged: number
  /** the rank the user says they hold (0 = none stated) */
  stated: number
  /** max(logged, stated) */
  rank: number
}

/** The ledger shape the planner reads (structurally an `AaAbilityRow`). */
export interface AaLedgerLike {
  name: string
  topRank: number
}

export interface AaPlanStep {
  name: string
  target: number
}

export interface AaPlanContext {
  /** the level the log last stated, or null */
  level: number | null
  /** unspent points now */
  banked: number
  /** points allocated now (shared/aa.ts) — what a points-spent gate is measured against */
  allocated: number
  /** points per hour at the current pace, or null when there is no pace */
  pointsPerHour: number | null
}

export type AaReqStatus = 'met' | 'unmet' | 'unknown'

export interface AaReqCheck {
  kind: 'level' | 'prereq' | 'points' | 'text'
  status: AaReqStatus
  label: string
}

export interface AaPlanRow {
  step: number
  name: string
  entry: AaCatalogEntry | null
  from: number
  to: number
  /** points for ranks from+1..to whose cost is known */
  cost: number
  /** ranks in that span whose cost the wiki does not state */
  unknownRanks: number
  cumulative: number
  /** points still to earn before this step is affordable (0 = affordable now) */
  shortfall: number
  /** ESTIMATE: ms until `shortfall` is earned at the pace; null when there is no pace */
  etaMs: number | null
  checks: AaReqCheck[]
}

export interface AaPlanTotals {
  needed: number
  unknownRanks: number
  banked: number
  shortfall: number
  etaMs: number | null
}

const MS_PER_HOUR = 3_600_000

/** The join key for a log name: toggle AAs print their state (`Symphonic Aura: Enabled`). */
export function aaHeldKey(name: string): string {
  return aaKey(name.replace(/:\s*(enabled|disabled)$/i, ''))
}

export function catalogIndex(entries: readonly AaCatalogEntry[]): Map<string, AaCatalogEntry> {
  const out = new Map<string, AaCatalogEntry>()
  for (const e of entries) out.set(aaKey(e.name), e)
  return out
}

/**
 * Held ranks by catalog key, plus the log names the catalog does not know (said, not dropped).
 * `stated` is keyed by catalog name, as the store writes it.
 */
export function heldRanks(
  ledger: readonly AaLedgerLike[],
  stated: Readonly<Record<string, number>>,
  index: ReadonlyMap<string, AaCatalogEntry>
): { held: Map<string, AaHeld>; unmatched: string[] } {
  const held = new Map<string, AaHeld>()
  const unmatched: string[] = []
  const slot = (key: string): AaHeld => {
    let h = held.get(key)
    if (!h) {
      h = { logged: 0, stated: 0, rank: 0 }
      held.set(key, h)
    }
    return h
  }
  for (const row of ledger) {
    const key = aaHeldKey(row.name)
    if (!index.has(key)) {
      unmatched.push(row.name)
      continue
    }
    const h = slot(key)
    h.logged = Math.max(h.logged, row.topRank)
    h.rank = Math.max(h.logged, h.stated)
  }
  for (const [name, rank] of Object.entries(stated)) {
    const h = slot(aaKey(name))
    h.stated = rank
    h.rank = Math.max(h.logged, h.stated)
  }
  return { held, unmatched: unmatched.sort((a, b) => a.localeCompare(b)) }
}

export function heldRank(held: ReadonlyMap<string, AaHeld>, name: string): number {
  return held.get(aaKey(name))?.rank ?? 0
}

export interface AaPlannerSection {
  section: AaSection
  entries: AaCatalogEntry[]
}

const SECTION_ORDER: readonly AaSection[] = ['general', 'archetype', 'class', 'special']

function matchesSearch(e: AaCatalogEntry, q: string): boolean {
  return q === '' || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
}

/** Is this AA one the trio can use? An unknown trio (no classes) shows every class AA. */
function usable(e: AaCatalogEntry, classes: readonly ClassAbbr[]): boolean {
  if (e.removed === true) return false
  if (e.section !== 'class' || classes.length === 0) return true
  return (e.classes ?? []).some((c) => classes.includes(c))
}

/**
 * The catalog cut to what the trio can use, in section order, each section alphabetical.
 *
 * ARCHETYPE AAs ARE NOT CUT: the wiki says only that the in-game Archetype tab shows the ones your
 * combo gets, and names no class or archetype on any row, so every one is listed and the surface
 * says so rather than guessing a mapping.
 */
export function plannerSections(
  entries: readonly AaCatalogEntry[],
  classes: readonly ClassAbbr[],
  search: string
): AaPlannerSection[] {
  const q = search.trim().toLowerCase()
  const by = new Map<AaSection, AaCatalogEntry[]>()
  for (const e of entries) {
    if (!usable(e, classes) || !matchesSearch(e, q)) continue
    const list = by.get(e.section) ?? []
    list.push(e)
    by.set(e.section, list)
  }
  const out: AaPlannerSection[] = []
  for (const section of SECTION_ORDER) {
    const list = by.get(section)
    if (list) out.push({ section, entries: list.sort((a, b) => a.name.localeCompare(b.name)) })
  }
  return out
}

/** Points for ranks from+1..to, and how many of those ranks have no stated cost. */
export function spanCost(entry: AaCatalogEntry, from: number, to: number): { cost: number; unknownRanks: number } {
  let cost = 0
  let unknownRanks = 0
  for (let r = from + 1; r <= Math.min(to, entry.maxRank); r++) {
    const c = rankCost(entry, r)
    if (c === null) unknownRanks++
    else cost += c
  }
  return { cost, unknownRanks }
}

/** The next rank's cost, or null when maxed, granted or unstated. */
export function nextRankCost(entry: AaCatalogEntry, held: number): number | null {
  if (entry.granted !== undefined || held >= entry.maxRank) return null
  return rankCost(entry, held + 1)
}

function levelCheck(entry: AaCatalogEntry, from: number, to: number, level: number | null): AaReqCheck {
  let need: number | null = null
  for (let r = from + 1; r <= to; r++) {
    const lv = rankLevel(entry, r)
    if (lv !== null) need = Math.max(need ?? 0, lv)
  }
  if (need === null) return { kind: 'level', status: 'unknown', label: 'level requirement unknown' }
  if (level === null) return { kind: 'level', status: 'unknown', label: `needs level ${String(need)} (your level is unknown)` }
  return { kind: 'level', status: level >= need ? 'met' : 'unmet', label: `needs level ${String(need)}` }
}

interface PrereqCtx {
  held: ReadonlyMap<string, AaHeld>
  index: ReadonlyMap<string, AaCatalogEntry>
  /** the highest rank each AA reaches in the plan BEFORE the step being checked */
  planned: ReadonlyMap<string, { rank: number; step: number }>
}

function prereqChecks(entry: AaCatalogEntry, from: number, to: number, ctx: PrereqCtx): AaReqCheck[] {
  const out: AaReqCheck[] = []
  for (const p of entry.req.prereqs) {
    let need = 0
    for (let r = from + 1; r <= to; r++) need = Math.max(need, prereqRank(p, r))
    const key = aaKey(p.name)
    const label = `needs ${p.name} rank ${String(need)}`
    if (!ctx.index.has(key)) {
      out.push({ kind: 'prereq', status: 'unknown', label: `${label} (not in the catalog)` })
      continue
    }
    const plannedHere = ctx.planned.get(key)
    if ((ctx.held.get(key)?.rank ?? 0) >= need) out.push({ kind: 'prereq', status: 'met', label })
    else if (plannedHere && plannedHere.rank >= need) {
      out.push({ kind: 'prereq', status: 'met', label: `${label} (step ${String(plannedHere.step)})` })
    } else out.push({ kind: 'prereq', status: 'unmet', label })
  }
  return out
}

function gateChecks(entry: AaCatalogEntry, spentBefore: number): AaReqCheck[] {
  const out: AaReqCheck[] = []
  const gate = entry.req.pointsSpent
  if (gate !== null) {
    const status: AaReqStatus = spentBefore >= gate ? 'met' : 'unmet'
    out.push({ kind: 'points', status, label: `needs ${String(gate)} points spent` })
  }
  for (const u of entry.req.unparsed) out.push({ kind: 'text', status: 'unknown', label: u })
  return out
}

function etaFor(shortfall: number, pointsPerHour: number | null): number | null {
  if (shortfall <= 0) return 0
  if (pointsPerHour === null || pointsPerHour <= 0) return null
  return (shortfall / pointsPerHour) * MS_PER_HOUR
}

/** Every plan step, in plan order, with its cost, the running total, the ETA and its checks. */
export function evaluatePlan(
  steps: readonly AaPlanStep[],
  index: ReadonlyMap<string, AaCatalogEntry>,
  held: ReadonlyMap<string, AaHeld>,
  ctx: AaPlanContext
): { rows: AaPlanRow[]; totals: AaPlanTotals } {
  const rows: AaPlanRow[] = []
  const planned = new Map<string, { rank: number; step: number }>()
  let cumulative = 0
  let unknownRanks = 0
  steps.forEach((s, i) => {
    const key = aaKey(s.name)
    const entry = index.get(key) ?? null
    const from = Math.max(held.get(key)?.rank ?? 0, planned.get(key)?.rank ?? 0)
    const to = Math.max(from, s.target)
    const span = entry ? spanCost(entry, from, to) : { cost: 0, unknownRanks: to - from }
    const spentBefore = ctx.allocated + cumulative
    const checks = entry
      ? [levelCheck(entry, from, to, ctx.level), ...prereqChecks(entry, from, to, { held, index, planned }), ...gateChecks(entry, spentBefore)]
      : [{ kind: 'text' as const, status: 'unknown' as const, label: 'not in the catalog' }]
    cumulative += span.cost
    unknownRanks += span.unknownRanks
    const shortfall = Math.max(0, cumulative - ctx.banked)
    rows.push({ step: i + 1, name: entry?.name ?? s.name, entry, from, to, ...span, cumulative, shortfall, etaMs: etaFor(shortfall, ctx.pointsPerHour), checks })
    planned.set(key, { rank: to, step: i + 1 })
  })
  const shortfall = Math.max(0, cumulative - ctx.banked)
  return {
    rows,
    totals: { needed: cumulative, unknownRanks, banked: ctx.banked, shortfall, etaMs: etaFor(shortfall, ctx.pointsPerHour) }
  }
}

/** Does any check on this row say it cannot be bought yet? */
export function rowBlocked(row: AaPlanRow): boolean {
  return row.checks.some((c) => c.status === 'unmet')
}
