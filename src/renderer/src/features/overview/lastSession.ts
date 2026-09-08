// lastSession.ts — THE SESSION BEFORE THIS ONE, summarised. Pure, node-tested, no React.
//
// ── WHAT "THE PREVIOUS SESSION" IS, EXACTLY ───────────────────────────────────────────────────
//
// `progression.offlineStart/offlineEnd` are the absences the log STATED: ascending, disjoint, and
// never open-ended, because a row exists only once the login line that ENDED the absence has been
// written (progressionTypes.ts's own honesty rule). So the sessions are the stretches BETWEEN
// them, and the previous one is bounded by two rows this app can see:
//
//     … [ gap n-2 ] ←  the previous session  → [ gap n-1 ] … the session you are in now
//                  t0 = offlineEnd[n-2]      t1 = offlineStart[n-1]
//
// With fewer than two stated gaps there is no such stretch. That is an EMPTY STATE and not a
// fallback: a log with one logout in it has a current session and a prologue that reaches back to
// wherever the file happens to begin, and calling that prologue "your last session" would be
// inventing a boundary the log never drew (law 1).
//
// ── COIN IS SUMMED PER DENOMINATION AND NEVER CONVERTED ───────────────────────────────────────
//
// `12p 5g`, never `12.5p`. EverQuest's platinum/gold/silver/copper ladder appears in no line the
// client prints, so a converted total is a number this repo cannot source (coinTypes.ts states the
// law for the snapshot; `shared/acquireEvents.ts` for the event). A denomination the rows never
// named is simply absent from the string — "the lines did not say" is not "you got none".
//
// ── AND IT NEVER MUNGES A SERVED ROW (ruling 4) ───────────────────────────────────────────────
//
// `CoinRow`, `DeathRecap` and `ZoneRangeRow` are shared-declared, so every walk over them here is
// a for-loop and every result is projected into this file's own types before anything is ordered.

import type { CoinRow, CoinSnap } from '../../../../shared/coinTypes'
import type { DeathSnap } from '../../../../shared/deathTypes'
import type { ProgressionSnap } from '../../../../shared/progressionTypes'
import { rangeStats } from '../../../../shared/progressionStats'
import { fmtDuration } from '../leveling/levelChartGeometry'

/** Most zone names the card prints before it starts counting the rest. */
export const LAST_SESSION_ZONE_CAP = 4

/** One stat tile. OUR row type; the leveling card's `LevelingTile` is that card's, not this one's. */
export interface LastSessionTile {
  id: 'duration' | 'kills' | 'levels' | 'drops' | 'deaths'
  value: string
  label: string
}

/** The previous session, as the card draws it. */
export interface LastSessionView {
  /** when it started and when the log says it ended. */
  t0: number
  t1: number
  durationMs: number
  tiles: LastSessionTile[]
  /** `12p 5g`, or '' when no coin line landed inside the range. */
  coin: string
  /** `Guk · Befallen · +2 more`, or '' before the scan ever reached a zone line. */
  zones: string
}

/** What `lastSessionView` reads. One object, because three modules answer three halves of it. */
export interface LastSessionInput {
  progression: ProgressionSnap | null
  coin: CoinSnap | null
  deaths: DeathSnap | null
}

/** The previous session's bounds, or null when the log states fewer than two absences. */
function previousSessionRange(snap: ProgressionSnap): { t0: number; t1: number } | null {
  const n = Math.min(snap.offlineStart.length, snap.offlineEnd.length)
  if (n < 2) return null
  const t0 = snap.offlineEnd[n - 2]
  const t1 = snap.offlineStart[n - 1]
  return t1 > t0 ? { t0, t1 } : null
}

/** How many timestamps of an ascending column land in `[t0, t1)`. A walk, never a filter. */
function countIn(column: number[], t0: number, t1: number): number {
  let n = 0
  for (const ts of column) {
    if (ts >= t0 && ts < t1) n++
  }
  return n
}

/** How many deaths the recap ring holds inside the range. */
function deathsIn(deaths: DeathSnap | null, t0: number, t1: number): number {
  if (!deaths) return 0
  let n = 0
  for (const recap of deaths.recaps) {
    if (recap.ts >= t0 && recap.ts < t1) n++
  }
  return n
}

/** Σ per denomination, in the only arithmetic the log supports: within one denomination. */
function sumCoin(rows: readonly CoinRow[], t0: number, t1: number): number[] {
  const totals = [0, 0, 0, 0]
  for (const row of rows) {
    if (row.ts < t0 || row.ts >= t1) continue
    totals[0] += row.platinum ?? 0
    totals[1] += row.gold ?? 0
    totals[2] += row.silver ?? 0
    totals[3] += row.copper ?? 0
  }
  return totals
}

const COIN_SUFFIX = ['p', 'g', 's', 'c']

/** `12p 5g`. A denomination nothing named is absent — see the header. */
export function coinText(coin: CoinSnap | null, t0: number, t1: number): string {
  if (!coin) return ''
  const totals = sumCoin(coin.rows, t0, t1)
  const parts: string[] = []
  for (let i = 0; i < totals.length; i++) {
    if (totals[i] > 0) parts.push(`${String(totals[i])}${COIN_SUFFIX[i]}`)
  }
  return parts.join(' ')
}

/** The zones the range covered, in the order `rangeStats` grouped them, capped and counted. */
function zoneText(zones: { zone: string }[]): string {
  const names: string[] = []
  for (const row of zones) {
    if (row.zone !== '' && !names.includes(row.zone)) names.push(row.zone)
  }
  if (names.length === 0) return ''
  if (names.length <= LAST_SESSION_ZONE_CAP) return names.join(' · ')
  const shown = names.slice(0, LAST_SESSION_ZONE_CAP).join(' · ')
  return `${shown} · +${String(names.length - LAST_SESSION_ZONE_CAP)} more`
}

/**
 * The previous session, or null when the log does not state one.
 *
 * `levelEquiv` is Σ of the STATED level-bar percentages / 100 — "levels of progress", the feature's
 * own words, and not a claim about how many times you dinged.
 */
export function lastSessionView(input: LastSessionInput): LastSessionView | null {
  const prog = input.progression
  if (!prog) return null
  const range = previousSessionRange(prog)
  if (!range) return null
  const stats = rangeStats({ snap: prog, range })
  const tiles: LastSessionTile[] = [
    { id: 'duration', value: fmtDuration(stats.durationMs), label: 'played' },
    { id: 'kills', value: String(stats.kills), label: 'kills' },
    { id: 'levels', value: stats.levelEquiv.toFixed(2), label: 'levels of progress' },
    { id: 'drops', value: String(countIn(prog.lootTs, range.t0, range.t1)), label: 'drops' },
    { id: 'deaths', value: String(deathsIn(input.deaths, range.t0, range.t1)), label: 'deaths' }
  ]
  return {
    t0: range.t0,
    t1: range.t1,
    durationMs: stats.durationMs,
    tiles,
    coin: coinText(input.coin, range.t0, range.t1),
    zones: zoneText(stats.zones)
  }
}
