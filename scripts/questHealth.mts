/**
 * questHealth.mts — the PURE quest data HEALTH GATE: is a freshly built quest catalog thinner than
 * the one it replaces, or thinner than the wiki pages it was built from?
 *
 * WHY IT EXISTS. On 2026-11-23 the quest parser silently lost the walkthroughs of 21 quests (the
 * Nektropos-patch pages: level-1 `= Heading =`, `= Summary =` checklists, a "Starts In" label). The
 * refresh wrote the thinner quests.json, the diff said "21 changed", and nobody noticed until a
 * player looked. This gate turns that into a non-zero exit with the list. The runner is
 * scripts/check-quest-health.mts (standalone: `npm run check:quests`; and inside
 * `npm run refresh:data`'s quests step); this module only judges, so tests/questHealth.test.mts
 * drives every rule with synthetic before/after catalogs in milliseconds.
 *
 * THE RULES. Each finding names its rule; a finding fails the gate unless the REVIEWED allowlist
 * (scripts/sources/quest-health-allowlist.json) names that page and rule, with a reason.
 *
 *   Against the previous catalog (a regression is a change, so these need a `prev`):
 *     quest-removed        a quest the previous catalog had is gone
 *     lost-steps           it had steps and has none
 *     steps-halved         its step count fell by more than half
 *     lost-start-zone / lost-giver / lost-rewards / lost-required-items / lost-ground-spawns
 *                          it had the field and lost it
 *   Absolute (true of the new catalog alone):
 *     no-steps             a quest with no steps at all (the allowlist names the pages that truly have
 *                          none: an item page, a disambiguation hub, a template page)
 *     floor                a catalog-wide share fell under its measured floor (FLOORS)
 *   Against the wikitext (scripts/sources/questPageAudit.ts): unparsed-heading,
 *     unread-step-heading, unread-list, unknown-label, unread-reward.
 *
 * A STALE ALLOWLIST ENTRY FAILS TOO, WHATEVER ITS RULE: an exception that no longer fires is one
 * nobody re-reviewed, and the list only stays honest if it only shrinks by deletion. For a
 * COMPARISON rule that means the exception lives for exactly the one refresh that needed it — add
 * it, run the refresh, delete it in the same commit — because left in place it would silently cover
 * the NEXT loss of that field on that page (review 2026-11-25).
 */
import type { QuestEntry } from '../src/shared/questTypes'
import type { PageFinding, PageRule } from './sources/questPageAudit'

export type CompareRule =
  | 'quest-removed'
  | 'lost-steps'
  | 'steps-halved'
  | 'lost-start-zone'
  | 'lost-giver'
  | 'lost-rewards'
  | 'lost-required-items'
  | 'lost-ground-spawns'
export type HealthRule = CompareRule | PageRule | 'no-steps' | 'floor'

export interface HealthFinding {
  /** the quest page, or `(catalog)` for a floor */
  page: string
  rule: HealthRule
  detail: string
}

export interface AllowEntry {
  page: string
  rule: HealthRule
  /** why this is legitimate — reviewed, never blank */
  reason: string
}

/** A catalog-wide floor: at least `min` of the quests (a share) or `minCount` of them (a count). */
export interface Floor {
  name: string
  /** quests that count toward it */
  has: (q: QuestEntry) => boolean
  /** minimum share of all quests, 0..1 */
  min?: number
  /** minimum number of quests */
  minCount?: number
}

/**
 * MEASURED 2026-11-25 on the committed catalog (916 quests): steps 911 (99.5%), start zone 893
 * (97.5%), giver 892 (97.4%), required items 759 (82.9%), rewards 593 (64.7%), step coordinates 434
 * (47.4%), ground spawns 2 quests. The catalog the 2026-11-23 parser shipped (bc62e60) had steps
 * 901 (98.4%) and start zone 882 (96.3%): the steps floor sits between the two, so that loss fails
 * here as well as on its pages; the rest sit 1.5-3 points under today, so the wiki's own churn
 * passes. Floors are the backstop — the per-quest rules above name the pages.
 */
export const FLOORS: readonly Floor[] = [
  { name: 'quests', has: () => true, minCount: 880 },
  { name: 'with steps', has: (q) => (q.steps?.length ?? 0) > 0, min: 0.99 },
  { name: 'with a start zone', has: (q) => q.startZone !== undefined, min: 0.96 },
  { name: 'with a giver', has: (q) => q.giver !== undefined, min: 0.96 },
  { name: 'with required items', has: (q) => (q.requiredItems?.length ?? 0) > 0, min: 0.8 },
  { name: 'with rewards', has: (q) => (q.rewards?.length ?? 0) > 0, min: 0.62 },
  { name: 'with step coordinates', has: (q) => q.stepLocs !== undefined, min: 0.44 },
  { name: 'with ground spawns', has: (q) => (q.groundSpawns?.length ?? 0) > 0, minCount: 2 }
]

const count = (a: readonly unknown[] | undefined): number => a?.length ?? 0

/** The fields whose loss is a finding: had something, now nothing. */
const LOSSES: readonly [CompareRule, (q: QuestEntry) => boolean][] = [
  ['lost-start-zone', (q) => q.startZone !== undefined],
  ['lost-giver', (q) => q.giver !== undefined],
  ['lost-rewards', (q) => count(q.rewards) > 0],
  ['lost-required-items', (q) => count(q.requiredItems) > 0],
  ['lost-ground-spawns', (q) => count(q.groundSpawns) > 0]
]

/** One quest, before and after. */
function compareQuest(before: QuestEntry, after: QuestEntry): HealthFinding[] {
  const out: HealthFinding[] = []
  const page = before.page
  const [b, a] = [count(before.steps), count(after.steps)]
  if (b > 0 && a === 0) out.push({ page, rule: 'lost-steps', detail: `${String(b)} steps -> none` })
  else if (b >= 2 && a < b / 2) out.push({ page, rule: 'steps-halved', detail: `${String(b)} steps -> ${String(a)}` })
  for (const [rule, has] of LOSSES) {
    if (has(before) && !has(after)) out.push({ page, rule, detail: 'present before, absent now' })
  }
  return out
}

/** Every regression from `prev` to `next`. */
export function compareCatalogs(prev: readonly QuestEntry[], next: readonly QuestEntry[]): HealthFinding[] {
  const after = new Map(next.map((q) => [q.page, q]))
  const out: HealthFinding[] = []
  for (const before of prev) {
    const now = after.get(before.page)
    if (now === undefined) out.push({ page: before.page, rule: 'quest-removed', detail: 'in the previous catalog, not in this one' })
    else out.push(...compareQuest(before, now))
  }
  return out
}

/** The absolute checks: every quest has steps (or is allowlisted), and every floor holds. */
export function absoluteFindings(next: readonly QuestEntry[], floors: readonly Floor[] = FLOORS): HealthFinding[] {
  const out: HealthFinding[] = next
    .filter((q) => count(q.steps) === 0)
    .map((q) => ({ page: q.page, rule: 'no-steps' as const, detail: 'the catalog has no steps for this quest' }))
  for (const f of floors) {
    const n = next.filter(f.has).length
    const share = next.length === 0 ? 0 : n / next.length
    const pct = `${(share * 100).toFixed(1)}%`
    if (f.minCount !== undefined && n < f.minCount) {
      out.push({ page: '(catalog)', rule: 'floor', detail: `${f.name}: ${String(n)}, floor ${String(f.minCount)}` })
    }
    if (f.min !== undefined && share < f.min) {
      out.push({ page: '(catalog)', rule: 'floor', detail: `${f.name}: ${String(n)}/${String(next.length)} (${pct}), floor ${(f.min * 100).toFixed(0)}%` })
    }
  }
  return out
}

export interface HealthResult {
  ok: boolean
  /** findings no allowlist entry covers — each one fails the gate */
  failures: HealthFinding[]
  /** findings an entry covers, with its reason */
  allowed: (HealthFinding & { reason: string })[]
  /** allowlist entries that matched nothing — each one fails (see "A STALE ALLOWLIST ENTRY") */
  stale: AllowEntry[]
  /** the floors, measured, for the report */
  measured: string[]
}

const key = (page: string, rule: HealthRule): string => `${page}\u0000${rule}`

/** Judge the findings against the allowlist. */
export function applyAllowlist(findings: readonly HealthFinding[], allow: readonly AllowEntry[]): Omit<HealthResult, 'measured'> {
  const byKey = new Map(allow.map((e) => [key(e.page, e.rule), e]))
  const used = new Set<string>()
  const failures: HealthFinding[] = []
  const allowed: HealthResult['allowed'] = []
  for (const f of findings) {
    const e = byKey.get(key(f.page, f.rule))
    if (e === undefined || e.reason.trim() === '') failures.push(f)
    else {
      used.add(key(e.page, e.rule))
      allowed.push({ ...f, reason: e.reason })
    }
  }
  const stale = allow.filter((e) => !used.has(key(e.page, e.rule)))
  return { ok: failures.length === 0 && stale.length === 0, failures, allowed, stale }
}

/** The floors as numbers, for the report: `with steps 911/916 (99.5%, floor 98%)`. */
export function measureFloors(next: readonly QuestEntry[], floors: readonly Floor[] = FLOORS): string[] {
  return floors.map((f) => {
    const n = next.filter(f.has).length
    const share = next.length === 0 ? 0 : (n / next.length) * 100
    const floor = f.min !== undefined ? `floor ${(f.min * 100).toFixed(0)}%` : `floor ${String(f.minCount ?? 0)}`
    return `${f.name}: ${String(n)}/${String(next.length)} (${share.toFixed(1)}%, ${floor})`
  })
}

/** The whole gate: comparisons (when there is a previous catalog), absolutes, page findings. */
export function judgeQuestHealth(args: {
  prev: readonly QuestEntry[] | null
  next: readonly QuestEntry[]
  pageFindings: readonly PageFinding[]
  allow: readonly AllowEntry[]
  floors?: readonly Floor[]
}): HealthResult {
  const findings = [
    ...(args.prev === null ? [] : compareCatalogs(args.prev, args.next)),
    ...absoluteFindings(args.next, args.floors),
    ...args.pageFindings
  ]
  return { ...applyAllowlist(findings, args.allow), measured: measureFloors(args.next, args.floors) }
}

/** The report, one line each. Failures first and loud; the allowed and the floors after. */
export function formatHealth(r: HealthResult): string[] {
  const out: string[] = []
  out.push(r.ok ? 'quest data health: PASS' : 'quest data health: FAIL')
  for (const f of r.failures) out.push(`  FAIL ${f.rule}: ${f.page} - ${f.detail}`)
  for (const e of r.stale) out.push(`  FAIL stale-allowlist: ${e.page} (${e.rule}) no longer fires - delete the entry`)
  out.push(`  allowed by the reviewed allowlist: ${String(r.allowed.length)}`)
  for (const m of r.measured) out.push(`  ${m}`)
  if (!r.ok) {
    out.push('  A FAIL means this catalog is thinner than the one before it or than its wiki pages. Fix the')
    out.push('  parser (scripts/sources/questPage.ts); an exception goes in scripts/sources/quest-health-allowlist.json')
    out.push('  with a reason, after reading the page.')
  }
  return out
}
