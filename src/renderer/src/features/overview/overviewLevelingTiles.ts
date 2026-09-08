// overviewLevelingTiles — the SHAPES the Overview leveling panel draws with: the stat tiles and
// the hour's sparkline. Pure, so `tests/overviewLeveling.test.mts` drives both under plain node.
//
// WHY IT IS A SEPARATE FILE FROM overviewLevelingData.ts. That module answers "what is true";
// this one answers "what does the panel put on screen". They are different rates of change — a
// new tile is a layout decision, a new rule is a world-model decision — and keeping them apart
// also keeps each inside the measured 400-code-line ceiling.
//
// IMPORT DISCIPLINE (the same rule overviewData.ts states): VALUE imports are RELATIVE, never
// `@shared/*` — that alias exists only inside the vite build and the node test runner would not
// resolve it. Type-only imports keep the alias because tsx erases them.
//
// NOTHING HERE INVENTS A NUMBER. A tile whose fact the log cannot state is OMITTED, never
// rendered as a zero: no ding observed ⇒ no level tile, a blocked projection ⇒ no ETA tile. The
// panel is a row of facts, and a row of three facts is a better answer than four with one lie in
// it. The one deliberate exception is a MEASURED zero — "0 AA this hour" counts gain LINES in the
// window, and zero of them is a real count rather than an unknown.

import type { RangeStats } from '@shared/progressionStats'
import type { ProgressionSnap } from '@shared/types'
import { zoneColor } from '../leveling/zoneBands'
import { fmtDuration } from '../leveling/levelChartGeometry'
import { withActiveTime } from '../leveling/rangeStatsRows'
import type { LevelEta, LevelingWindow } from './overviewLevelingData'

/**
 * One stat tile: a big number, the words under it, and a sentence on hover.
 *
 * `value` is ALREADY formatted (tabular-nums is applied at the render site, not here) and
 * `unit` is the small suffix that rides on the same baseline — split so '1.42' can be large
 * while 'lvl/hr' stays small, which is the whole reason a tile beats a sentence.
 */
export interface LevelingTile {
  /** stable id — the render key, and the e2e's handle (`overview-leveling-tile-<id>`). */
  id: 'level' | 'rate' | 'aa' | 'eta'
  value: string
  /** small suffix on the value's baseline; '' when the value stands alone. */
  unit: string
  /** the words under the number — what this measures. */
  label: string
  /** hover sentence. ALWAYS present: every tile here is a window or an estimate, and which
   *  one it is must be answerable without leaving the card. */
  title: string
}

/** How many buckets the hour's sparkline is drawn in — 12, so each column is five minutes. */
export const SPARK_BUCKETS = 12

/** One column of the sparkline. */
export interface SparkBucket {
  /** Σ stated level-bar percent / 100 inside the bucket — "levels of progress", never xp. */
  value: number
  /** RAW zone name covering the bucket's midpoint; '' when the log had named none yet. */
  zone: string
  /** the bucket's start instant, for the hover clock. */
  t0: number
}

/**
 * The hour, in columns.
 *
 * `stated` / `unstated` are the honesty half: a column reading zero because nothing was killed
 * is a MEASUREMENT, and a column reading zero because every experience line in the hour stated
 * no percentage (the at-cap shape) is an UNKNOWN. They must not draw the same, so the counts
 * ride along and the card refuses to draw bars at all when the hour stated nothing.
 */
export interface LevelingSpark {
  buckets: SparkBucket[]
  /** the tallest bucket — 0 when the hour holds no stated progress at all. */
  peak: number
  /** experience lines in the window that stated a percentage. */
  stated: number
  /** experience lines in the window that stated none (expFlag bit 1 — at the cap). */
  unstated: number
}

/** The RAW zone name covering `t`, or '' when no interval does. Zone columns are ascending and
 *  contiguous, so a backwards walk finds it in a step or two on a live snapshot. */
function zoneAtTs(snap: ProgressionSnap, t: number): string {
  for (let i = snap.zoneStart.length - 1; i >= 0; i--) {
    if (snap.zoneStart[i] > t) continue
    const end = snap.zoneEnd[i]
    return end === 0 || t < end ? snap.zoneName[i] : ''
  }
  return ''
}

/**
 * The hour bucketed into `SPARK_BUCKETS` columns of stated progress, each tinted by the zone it
 * was earned in.
 *
 * THE COLOUR IS THE LEVELING CHART'S OWN (`zoneBands.zoneColor`), not a second palette: the
 * column for the hour you spent in Sebilis is the same hue as that zone's band on the Leveling
 * tab and its swatch in the range table. A second opinion about a zone's colour would make two
 * surfaces disagree about the same camp.
 */
export function levelingSpark(snap: ProgressionSnap, window: LevelingWindow): LevelingSpark {
  const span = Math.max(1, window.t1 - window.t0)
  const width = span / SPARK_BUCKETS
  const buckets: SparkBucket[] = []
  for (let i = 0; i < SPARK_BUCKETS; i++) {
    const t0 = window.t0 + i * width
    buckets.push({ value: 0, zone: zoneAtTs(snap, t0 + width / 2), t0 })
  }
  let stated = 0
  let unstated = 0
  for (let i = snap.expTs.length - 1; i >= 0; i--) {
    const ts = snap.expTs[i]
    if (ts < window.t0) break
    if (ts > window.t1) continue
    if ((snap.expFlag[i] & 1) !== 0) {
      unstated++
      continue
    }
    stated++
    const b = Math.min(SPARK_BUCKETS - 1, Math.floor((ts - window.t0) / width))
    buckets[b].value += snap.expPct[i] / 100
  }
  return { buckets, peak: Math.max(0, ...buckets.map((b) => b.value)), stated, unstated }
}

/** A bucket's fill. An hour that reaches back before the first zone line has no camp to name,
 *  and gets the neutral grey rather than a hue that would claim one. */
export function sparkColor(zone: string): string {
  return zone === '' ? '#8ca0b3' : zoneColor(zone)
}

/**
 * '1.42 lvl/hr' → `{ value: '1.42', unit: 'lvl/hr' }`; '—' → `{ value: '—', unit: '' }`.
 *
 * The rate formatters (`lib/formatRate`) are the ONE place a rate is worded, and their output is
 * `<number> <word>` with no space inside the number — so splitting at the first space recovers
 * the two halves without a second formatter that could drift from them.
 */
export function splitRate(s: string): { value: string; unit: string } {
  const i = s.indexOf(' ')
  return i < 0 ? { value: s, unit: '' } : { value: s.slice(0, i), unit: s.slice(i + 1) }
}

/** The AA tile's caption. Σ of the gain lines, not the earned/spent identity — that reservation
 *  is the Leveling tab's to reconcile, and it stays out of a hover (AGENTS.md tooltip diet). */
const AA_TITLE = 'Ability points from the gain lines in this hour.'

/** The ETA tile's caption when there IS one; the blocked reasons are `etaTitle`'s job. */
function etaTileTitle(toLevel: number, progress: number): string {
  return `${String(Math.round(progress * 100))}% of the current level since your last level-up, projected at the last hour's pace.`
}

/** Everything `levelingTiles` needs, already measured. One object so the argument list cannot
 *  drift out of order as tiles are added. */
export interface LevelingTileInput {
  /** the level the log last STATED, or null (nothing has stated one yet). */
  level: number | null
  /** that statement's provenance + age, already worded (shared/currentLevel.ts). */
  levelTitle: string
  /** the visible cue for it ('/who', '3d 4h ago'), or '' when the number stands alone. */
  levelCue: string
  /** window A's stats — the same object the headline rate came from. */
  hour: RangeStats
  /** the projection, or the reason there is none. */
  eta: LevelEta
  /** window A's rate, ALREADY worded by `formatLevelRate` (or the em-dash). */
  rateText: string
}

/**
 * The level tile. Omitted entirely when nothing has stated a level: the log states your level
 * only when it changes, and "level —" is a worse answer than three tiles.
 *
 * The hover is the STATEMENT's own sentence (JOS-192) rather than the flat "the level the log
 * last reported" it carried before — because which line said it, and how long ago, is the
 * difference between a fact and a fact that has since been overtaken by an unlogged swap.
 */
function levelTile(level: number | null, title: string, cue: string): LevelingTile[] {
  if (level == null) return []
  return [
    {
      id: 'level',
      value: String(level),
      unit: '',
      label: cue ? `level · ${cue}` : 'level',
      title
    }
  ]
}

/** The projection tile. Blocked ⇒ no tile: `state.eta`/`etaTitle` already carry the refusal and
 *  its reason, and a tile reading '—' would spend a quarter of the row saying so twice. */
function etaTile(eta: LevelEta): LevelingTile[] {
  if (eta.blocked !== null) return []
  const absurd = eta.ms > 24 * 3_600_000
  return [
    {
      id: 'eta',
      value: absurd ? '>1 day' : `~${fmtDuration(eta.ms)}`,
      unit: '',
      label: `to level ${String(eta.toLevel)}`,
      title: etaTileTitle(eta.toLevel, eta.progress)
    }
  ]
}

/**
 * The tile row: level, pace, AA, next level — in that order, and only the ones the data supports.
 * Two is the floor (pace and AA are always measurable once the window exists) and four the cap,
 * which is exactly the range a single row can hold at every width the Overview grid offers.
 */
export function levelingTiles(input: LevelingTileInput): LevelingTile[] {
  const { value, unit } = splitRate(input.rateText)
  return [
    ...levelTile(input.level, input.levelTitle, input.levelCue),
    {
      id: 'rate',
      value,
      unit: unit || 'lvl/hr',
      label: 'last hour',
      // The one tile on this card whose denominator is active time, so it says what that is
      // (JOS-249) — the Leveling tab's own sentence, not a second wording.
      title: withActiveTime('Levels of progress per hour of active time.')
    },
    {
      id: 'aa',
      value: String(input.hour.aaGained),
      unit: '',
      label: 'AA this hour',
      title: AA_TITLE
    },
    ...etaTile(input.eta)
  ]
}
