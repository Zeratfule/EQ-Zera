// PER-ABILITY AA LEDGER — law 5's allocation identity, decomposed by ability instead of summed.
//
// WHAT THE LOG STATES AND THE OLD PANEL DID NOT SAY. Every AA purchase line names ONE
// (ability, rank) step: the quoted form is always rank 1 (`You have gained the ability
// "Innate Regeneration" at a cost of 1 ability points.`) and the improved form carries the rank
// it moved you TO (`You have improved Innate Regeneration 7 at a cost of 5 ability points.`).
// So the log states a LADDER per ability — and the flat purchases list rendered every rung as an
// unrelated row, ordered by date. Measured on the real log (post-epoch): 140 purchase lines
// collapse into 52 abilities; one of them (Innate Regeneration) is a 7-rung ladder whose rungs
// sat six rows apart in the flat list, and the total it cost you appeared nowhere.
//
// THE IDENTITY IS PRESERVED, NOT RE-DERIVED. The per-rank dedupe rule here is the SAME one
// `computeAAAccounting` applies (latest purchase per (ability, rank) wins; cost-0 auto-grants
// excluded from the money) — so Σ `invested` over these rows is EXACTLY `allocated`, and
// Σ `paidRanks` is EXACTLY `boughtCount`. tests/aaLedger.test.mts pins both equalities against
// the real log; if the ledger ever disagreed with the headline, one of them would be lying.
//
// WHAT IS DELIBERATELY *NOT* CLAIMED (law 1 / law 6). A rank below `topRank` with no purchase
// line in this log is reported as UNLOGGED, never as "missing" or "not owned": the log window is
// the only evidence there is, and `Symphonic Aura: Disabled` first appears at rank 9 with no
// rungs 1–8 anywhere in 1.35M lines. Whether those rungs were bought before logging started,
// granted, or renamed is a question the log cannot answer, so the row says the ranks were not
// logged and stops there. Likewise `rebuys` is stated as re-purchases, not as respecs: a
// second purchase of the SAME rank is the only refund signal the log carries (there is no
// refund line), so it is evidence OF a respec, not a count of them.

import type { AASpendLike } from './aa'

/** One rung of an ability's ladder, after respec dedupe. */
export interface AaRankRow {
  rank: number
  /** The LATEST purchase's cost for this rank — 0 means an auto-grant, never "free respec". */
  cost: number
  /** Timestamp of that latest purchase. */
  ts: number
  /** How many times this exact rank was purchased. >1 is the log's only refund evidence. */
  buys: number
}

/** One ability's full ladder. */
export interface AaAbilityRow {
  /** Base ability name with the rank suffix stripped (the family key). */
  name: string
  /** Rungs actually logged, ascending. */
  ranks: AaRankRow[]
  /** Highest rank ever logged for this ability. */
  topRank: number
  /** Σ latest cost per rank, cost-0 excluded — this ability's share of `allocated`. */
  invested: number
  /** Rungs that cost points. */
  paidRanks: number
  /** Rungs granted at cost 0. */
  autoRanks: number
  /** Σ (buys − 1) across rungs: how many purchases were re-purchases of a rank already owned. */
  rebuys: number
  /** Latest purchase instant across the ladder. */
  lastTs: number
  /** Ranks in 1..topRank with NO purchase line in this log (stated as unlogged, not missing). */
  unlogged: number[]
}

/** Ledger totals — the reconciliation line under the list. */
export interface AaLedgerSummary {
  abilities: number
  invested: number
  paidRanks: number
  autoRanks: number
  /** Abilities carrying at least one re-purchased rank. */
  rebought: number
  /** Abilities with at least one unlogged rung below their top rank. */
  partial: number
}

/**
 * The family key for a spend event. The improved form's `ability` already carries its rank
 * (`"Combat Fury 3"`), which is what makes that string a valid (ability, rank) dedupe key in
 * `computeAAAccounting`; here it is peeled back off so the rungs regroup under one name. The
 * quoted rank-1 form has no suffix and is returned as-is.
 */
export function aaBaseName(s: Pick<AASpendLike, 'ability' | 'rank'>): string {
  const { rank } = s
  if (rank === undefined) return s.ability
  const suffix = ` ${String(rank)}`
  return s.ability.endsWith(suffix) ? s.ability.slice(0, -suffix.length) : s.ability
}

/** Latest-purchase-wins merge of one rung (the rule `computeAAAccounting` uses, per rank). */
function mergeRank(byRank: Map<number, AaRankRow>, rank: number, s: AASpendLike): void {
  const prev = byRank.get(rank)
  if (!prev) {
    byRank.set(rank, { rank, cost: s.cost, ts: s.ts, buys: 1 })
    return
  }
  prev.buys++
  if (s.ts >= prev.ts) {
    prev.ts = s.ts
    prev.cost = s.cost
  }
}

/** Roll one ability's deduped rungs into its row. */
function toAbilityRow(name: string, byRank: Map<number, AaRankRow>): AaAbilityRow {
  const ranks = [...byRank.values()].sort((a, b) => a.rank - b.rank)
  const topRank = ranks[ranks.length - 1].rank
  const row: AaAbilityRow = {
    name,
    ranks,
    topRank,
    invested: 0,
    paidRanks: 0,
    autoRanks: 0,
    rebuys: 0,
    lastTs: 0,
    unlogged: []
  }
  for (const r of ranks) {
    if (r.cost > 0) {
      row.invested += r.cost
      row.paidRanks++
    } else row.autoRanks++
    row.rebuys += r.buys - 1
    if (r.ts > row.lastTs) row.lastTs = r.ts
  }
  for (let r = 1; r < topRank; r++) if (!byRank.has(r)) row.unlogged.push(r)
  return row
}

/**
 * Group the log-ordered purchase list into per-ability ladders.
 *
 * Ordering is BY POINTS INVESTED, descending — the ledger answers "where did my points go",
 * and date order is already the Recent progress feed's job. Ties fall back to the deeper ladder,
 * then the more recent purchase, then the name, so the order is total and stable across renders.
 */
export function aaLedger(spends: readonly AASpendLike[]): AaAbilityRow[] {
  const fams = new Map<string, Map<number, AaRankRow>>()
  for (const s of spends) {
    const name = aaBaseName(s)
    let byRank = fams.get(name)
    if (!byRank) {
      byRank = new Map<number, AaRankRow>()
      fams.set(name, byRank)
    }
    // The quoted form IS rank 1 (the improved form never logs below rank 2 — measured).
    mergeRank(byRank, s.rank ?? 1, s)
  }
  const rows = [...fams].map(([name, byRank]) => toAbilityRow(name, byRank))
  rows.sort(
    (a, b) =>
      b.invested - a.invested ||
      b.topRank - a.topRank ||
      b.lastTs - a.lastTs ||
      a.name.localeCompare(b.name)
  )
  return rows
}

/** Totals across the ledger — what the reconciliation caption prints. */
export function aaLedgerSummary(rows: readonly AaAbilityRow[]): AaLedgerSummary {
  const sum: AaLedgerSummary = {
    abilities: rows.length,
    invested: 0,
    paidRanks: 0,
    autoRanks: 0,
    rebought: 0,
    partial: 0
  }
  for (const r of rows) {
    sum.invested += r.invested
    sum.paidRanks += r.paidRanks
    sum.autoRanks += r.autoRanks
    if (r.rebuys > 0) sum.rebought++
    if (r.unlogged.length > 0) sum.partial++
  }
  return sum
}
