// aaPlanStore.ts — the AA plan as a stored value: its key, its schema, and the edits the planner
// makes to it. PURE (the renderer does the localStorage read/write around it), so the validation
// is unit-tested: a stored plan is read back through `parseStoredPlan`, which DEGRADES rather than
// errors (AGENTS.md, JOS-105) — a corrupt value, an AA the catalog no longer has, a target past
// the max rank or a granted AA are each dropped or clamped, and the rest of the plan survives.

import { aaKey, type AaCatalogEntry } from './aaCatalog'
import { rowBlocked, type AaPlanRow, type AaPlanStep, type AaPlanTotals } from './aaPlanner'

export const AA_PLAN_VERSION = 1

export interface AaPlan {
  /** the order the user wants to buy in */
  steps: AaPlanStep[]
  /** ranks the user says they hold that the log did not see, by catalog name */
  stated: Record<string, number>
}

export const EMPTY_AA_PLAN: AaPlan = { steps: [], stated: {} }

/** One plan per character: `eq.aa.plan.<name>@<server>`. Null with no character. */
export function aaPlanStorageKey(character: { name: string; server: string } | null | undefined): string | null {
  if (!character || character.name === '') return null
  return `eq.aa.plan.${character.name.toLowerCase()}@${character.server.toLowerCase()}`
}

function intIn(v: unknown, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null
}

/** One stored step, or null when it names nothing plannable. Targets past the max are clamped. */
function readStep(item: unknown, index: ReadonlyMap<string, AaCatalogEntry>): AaPlanStep | null {
  if (typeof item !== 'object' || item === null) return null
  const { name, target } = item as { name?: unknown; target?: unknown }
  const entry = typeof name === 'string' ? index.get(aaKey(name)) : undefined
  if (!entry || entry.granted !== undefined || entry.removed === true) return null
  const t = intIn(target, 1, Number.MAX_SAFE_INTEGER)
  return t === null ? null : { name: entry.name, target: Math.min(t, entry.maxRank) }
}

function readSteps(raw: unknown, index: ReadonlyMap<string, AaCatalogEntry>): AaPlanStep[] {
  if (!Array.isArray(raw)) return []
  const out: AaPlanStep[] = []
  const seen = new Set<string>()
  for (const item of raw as unknown[]) {
    const step = readStep(item, index)
    if (!step || seen.has(aaKey(step.name))) continue
    seen.add(aaKey(step.name))
    out.push(step)
  }
  return out
}

function readStated(raw: unknown, index: ReadonlyMap<string, AaCatalogEntry>): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [name, rank] of Object.entries(raw as Record<string, unknown>)) {
    const entry = index.get(aaKey(name))
    const r = entry ? intIn(rank, 1, entry.maxRank) : null
    if (entry && r !== null) out[entry.name] = r
  }
  return out
}

/** A stored plan, validated. Anything unreadable is the empty plan; never throws. */
export function parseStoredPlan(raw: string | null, index: ReadonlyMap<string, AaCatalogEntry>): AaPlan {
  if (raw === null) return EMPTY_AA_PLAN
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return EMPTY_AA_PLAN
  }
  if (typeof v !== 'object' || v === null || (v as { v?: unknown }).v !== AA_PLAN_VERSION) return EMPTY_AA_PLAN
  const o = v as { steps?: unknown; stated?: unknown }
  return { steps: readSteps(o.steps, index), stated: readStated(o.stated, index) }
}

export function serializePlan(plan: AaPlan): string {
  return JSON.stringify({ v: AA_PLAN_VERSION, steps: plan.steps, stated: plan.stated })
}

/**
 * Set an AA's target rank. A target at or below what is held removes the step; a new AA is added
 * at the END of the plan; an existing step keeps its place.
 */
export function setTarget(plan: AaPlan, entry: AaCatalogEntry, target: number, held: number): AaPlan {
  if (entry.granted !== undefined || entry.removed === true) return plan
  const key = aaKey(entry.name)
  const t = Math.min(Math.max(0, Math.floor(target)), entry.maxRank)
  const at = plan.steps.findIndex((s) => aaKey(s.name) === key)
  const steps = [...plan.steps]
  if (t <= held) {
    if (at >= 0) steps.splice(at, 1)
  } else if (at >= 0) steps[at] = { name: entry.name, target: t }
  else steps.push({ name: entry.name, target: t })
  return { ...plan, steps }
}

/** Move a step up (-1) or down (+1); out of range is a no-op. */
export function moveStep(plan: AaPlan, index: number, delta: -1 | 1): AaPlan {
  const to = index + delta
  if (index < 0 || index >= plan.steps.length || to < 0 || to >= plan.steps.length) return plan
  const steps = [...plan.steps]
  ;[steps[index], steps[to]] = [steps[to], steps[index]]
  return { ...plan, steps }
}

/** Mark (or, with 0, clear) a rank the user says they hold. */
export function setStated(plan: AaPlan, entry: AaCatalogEntry, rank: number): AaPlan {
  const r = Math.min(Math.max(0, Math.floor(rank)), entry.maxRank)
  const stated: Record<string, number> = {}
  for (const [name, v] of Object.entries(plan.stated)) if (name !== entry.name) stated[name] = v
  if (r > 0) stated[entry.name] = r
  return { ...plan, stated }
}

/** A step's target, or 0 when the AA is not in the plan. */
export function targetOf(plan: AaPlan, name: string): number {
  const key = aaKey(name)
  return plan.steps.find((s) => aaKey(s.name) === key)?.target ?? 0
}

/** "2h 05m" style, coarse: the ETA is an estimate and reads like one. */
export function formatEtaMs(ms: number): string {
  if (ms <= 0) return 'now'
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${String(Math.max(1, mins))}m`
  const h = Math.floor(mins / 60)
  if (h >= 48) return `${String(Math.round(h / 24))} days`
  return `${String(h)}h ${String(mins % 60).padStart(2, '0')}m`
}

function stepLine(r: AaPlanRow): string {
  const unknown = r.unknownRanks > 0 ? ` + ${String(r.unknownRanks)} rank(s) of unknown cost` : ''
  const blocked = rowBlocked(r) ? ` [blocked: ${r.checks.filter((c) => c.status === 'unmet').map((c) => c.label).join(', ')}]` : ''
  return `${String(r.step)}. ${r.name} ${String(r.from)} -> ${String(r.to)}: ${String(r.cost)} pts${unknown} (total ${String(r.cumulative)})${blocked}`
}

/** The plan as plain text for the clipboard. */
export function planText(rows: readonly AaPlanRow[], totals: AaPlanTotals): string {
  const lines = ['AA plan (EQ Zera)', ...rows.map(stepLine)]
  lines.push(`Needed ${String(totals.needed)} pts, banked ${String(totals.banked)}, short ${String(totals.shortfall)}.`)
  if (totals.etaMs !== null && totals.shortfall > 0) lines.push(`Estimated ${formatEtaMs(totals.etaMs)} at the current pace.`)
  return lines.join('\n')
}
