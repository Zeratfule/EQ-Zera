// factionRows.ts — the `faction` snapshot, as rows the Character tab can draw. Pure, node-tested.
//
// ── THE TWO SENTENCES ARE NOT THE SAME KIND OF FACT, AND THE ROWS KEEP THEM APART ─────────────
//
// `has been adjusted by -3.`          states a MAGNITUDE → summed into `delta`
// `could not possibly get any worse.` states a RAIL      → counted into `bottomed`
//
// factionTypes.ts states the law; this file is what obeying it looks like on a screen. A row prints
// a Σ and a hit COUNT for the first, and CHIPS for the second, and nothing here ever adds a
// saturation line to a total or renders it as a zero. A faction whose every line was a rail
// therefore shows `no stated change` rather than `0` - "the standing did not move because it is
// already at the rail" and "the standing moved by nothing" are different claims.
//
// AND `delta` IS NOT YOUR STANDING. No line EverQuest prints states an absolute standing, so the Σ
// is the moves THIS FOLD WATCHED. The column is headed "Σ change" for that reason, and the panel
// says so once rather than footnoting every row (the tooltip-diet rule).
//
// ── RULING 4: THE SORT IS OVER *OUR* ROWS, NEVER OVER `FactionTotals` ─────────────────────────
//
// `FactionTotals` and `FactionHitRow` are declared in `src/shared/factionTypes.ts`, so they are
// domain data and the renderer may not sort or filter arrays of them. The projection below walks
// the snapshot's record with a for-loop into `FactionPanelRow` — this file's own type — and the
// ordering happens there, on rows nothing outside this feature has an opinion about.

import type { FactionSnap } from '../../../../shared/factionTypes'

/** One faction, as the panel draws it. OUR row type — see the header. */
export interface FactionPanelRow {
  /** the lowercased key the snapshot filed it under; the react key and the expand handle. */
  key: string
  /** the FIRST spelling the log used — display, never a lookup key (law 2). */
  name: string
  /** Σ of every STATED adjustment. Not your standing. */
  delta: number
  /** that sum, signed and worded: `+120`, `-45`, or the honest refusal when nothing stated one. */
  deltaText: string
  /** how many lines stated a magnitude. `delta` is the sum of exactly these. */
  hits: number
  /** how many said the standing could not get any BETTER. Counted, never summed. */
  maxed: number
  /** …and any WORSE. */
  bottomed: number
  lastTs: number
  /** lowercased name, computed once per data change (the search idiom). */
  searchKey: string
}

/** One line of a faction's recent strip, worded. OUR row type. */
export interface FactionHitLine {
  key: string
  ts: number
  /** `-5`, or `at max` / `at min` when the line stated a rail instead of a number. */
  text: string
}

/** What a row prints when every line about this faction was a saturation line. */
export const NO_STATED_CHANGE = 'no stated change'

/** `+120` / `-45`. Signed on purpose: an unsigned faction number is unreadable. */
function signed(n: number): string {
  return n > 0 ? `+${String(n)}` : String(n)
}

/**
 * Every faction in the snapshot, NEWEST HIT FIRST, narrowed by `query`.
 *
 * The query is matched against the display name alone. `query` arrives already normalised (trim +
 * lowercase — `lib/search.normalizeQuery`); an empty one admits everything.
 */
export function factionRows(snap: FactionSnap | null, query = ''): FactionPanelRow[] {
  if (!snap) return []
  const rows: FactionPanelRow[] = []
  for (const [key, totals] of Object.entries(snap.factions)) {
    const searchKey = totals.display.toLowerCase()
    if (query !== '' && !searchKey.includes(query)) continue
    rows.push({
      key,
      name: totals.display,
      delta: totals.delta,
      deltaText: totals.hits === 0 ? NO_STATED_CHANGE : signed(totals.delta),
      hits: totals.hits,
      maxed: totals.maxed,
      bottomed: totals.bottomed,
      lastTs: totals.lastTs,
      searchKey
    })
  }
  // OUR rows, so this is a projection being ordered rather than served data being re-derived.
  // The name breaks the tie so the order is a function of the bytes and not of enumeration luck.
  rows.sort((a, b) => b.lastTs - a.lastTs || a.name.localeCompare(b.name))
  return rows
}

/**
 * The recent strip, filtered to one faction, NEWEST FIRST and capped.
 *
 * `recent` is `FactionHitRow[]` — shared, so this is a for-loop walking it backwards rather than a
 * `.filter().reverse()`. It matches on the LOWERCASED spelling because a row carries the spelling
 * of ITS OWN line, which need not be the display spelling (factionTypes.ts).
 */
export function factionRecent(snap: FactionSnap | null, key: string, limit = 12): FactionHitLine[] {
  if (!snap) return []
  const out: FactionHitLine[] = []
  const rows = snap.recent
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const row = rows[i]
    if (row.faction.toLowerCase() !== key) continue
    const text = row.delta === undefined ? (row.cap === 'max' ? 'at max' : 'at min') : signed(row.delta)
    out.push({ key: `${String(row.ts)}:${String(i)}`, ts: row.ts, text })
  }
  return out
}
