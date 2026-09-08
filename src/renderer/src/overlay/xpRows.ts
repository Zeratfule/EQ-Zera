// xpRows.ts — the PURE shaping behind the XP overlay (JOS-195): a progression snapshot, this
// character's loot, and one slice, turned into the exact strings that window prints.
//
// No React, no MUI, no `window.eqOverlay`. VALUE imports are RELATIVE, never `@shared/*` — that
// alias exists only inside the vite build and the node runner would not resolve it — so
// tests/xpOverlay.test.mts drives every rule here under plain tsx. Same constraint
// aaPaceRows.ts / rangeStatsRows.ts / overviewLevelingData.ts already document.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// IT DERIVES NOTHING OF ITS OWN. Every number below already exists somewhere:
//
//   the pace      `rangeStats` (shared/progressionStats.ts) — the drag-select panel's own query
//   the slice     `resolveSlice` (shared/timeslice.ts) — the Leveling tab's own control, JOS-130
//   the level ETA `levelEta` (shared/levelEta.ts) — the Overview card's own four gates
//   the AA read   `aaEta` (shared/aaPace.ts) — JOS-36/11, the read that survives the cap
//   the motes     `moteRates` → `windowItemRows` (shared/lootRates.ts) — JOS-78's own rate
//
// So a number in this window and the same number on the Leveling tab cannot disagree: there is
// one arithmetic and this file only chooses the words. That is the whole point of the ticket's
// "fed from the same selectors the Leveling tab uses".
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// AA IS A SECOND PACE, NOT A CONSOLATION PRIZE FOR THE CAP (JOS-202).
//
// The first cut swapped the pace row's SUBJECT at the cap: levels while the bar was stated, AA once
// it was not. That is the wrong shape, because the two are not alternatives — a character in their
// forties is filling a level bar and an AA bar at the same time, and the owner wants both read at a
// glance. So the pace checklist entry draws ONE ROW PER MEASURE THE LOG STATES, exactly as the
// motes entry draws one row per tier observed:
//
//   'xp'  levels of progress per hour — while the game is still stating a level-bar percentage.
//   'aa'  AA completions per hour, with the ability points they paid riding as the row's detail.
//
// WHEN EACH ONE IS THERE, and why:
//   · the levels row goes away AT THE CAP (`atCap`) and only there — every levels number is built
//     on stated percentages, and at max level the game stops stating them. A permanent em-dash is
//     a row a capped character closes the window over.
//   · the AA row is drawn ALWAYS (owner ruling, 2026-08-10). AAs are earned below the cap in this
//     game, so "no completion in this slice" is not "AA does not apply to you" — it is a measured
//     0.00, exactly the reading the cap case has always printed, and exactly what the levels row
//     does below the cap when an hour of farming moved no bar. Gating it on a completion made the
//     row appear and disappear under a user who is watching a rate, which is the one thing a rate
//     display must not do. (The Leveling tab's `aaRateText` still says nothing about AA in a
//     silent window; that is a page with other things on it, this is a four-row meter whose
//     subject is pace.)
//
// The two rates are the same denominator (active time, stated once under the rows), so they read
// against each other, and the AA pair (completions · points) is printed together for the reason the
// Leveling tab prints it together: they are equal until an item-shop bottle is running and diverge
// while one is, and that divergence is the whole reading.
//
// The PROJECTION row still switches: 'Next level' while there is a bar to finish, 'Next AA' once
// there is not. It is one row and one question ("what lands next"), and at the cap the level half
// of it has no answer at all.
//
// THE AA WAIT IS INFERRED AND WEARS THE WORD (`AA_EST`). The log carries no AA-experience line
// anywhere — there is no bar position to sum — so it is projected from the rhythm of recent
// completions. The level ETA is a different kind of claim (a sum of stated percentages divided by
// a measured pace) and does not wear it; both are still `~`.

import type { LootEvent, ProgressionSnap } from '@shared/types'
import type { RangeStats } from '@shared/progressionStats'
import type { Timeslice } from '@shared/timeslice'
import { rangeStats } from '../../../shared/progressionStats'
import { ETA_ABSURD_MS, atCap, levelEta } from '../../../shared/levelEta'
// The header's level is the STATED fact now (JOS-192) — the later of your last ding and your own
// `/who` row — because the ding series says nothing across a loadout swap, which is the one moment
// the number on a floating window is most likely to be wrong.
import { currentLevelRead, type LevelStatement } from '../../../shared/currentLevel'
import { aaEta } from '../../../shared/aaPace'
import { moteRates, xpRowVisible, type XpRowId } from '../../../shared/xpOverlay'
// WHICH HOUR (JOS-288). The union, the default and the just-arrived gate live in
// shared/rateBasis.ts; this file picks halves of pairs and chooses words. The REFUSAL SENTENCE that
// lives there too is no longer read here — it was a row hover, and JOS-358 took those.
import {
  RATE_BASIS_DEFAULT,
  basisRead,
  pickRate,
  type BasisRead,
  type RateBasis
} from '../../../shared/rateBasis'
import { AA_EST, aaEtaValue } from '../features/leveling/aaPaceRows'
import { NONE, basisSpanText } from '../features/leveling/rangeStatsRows'
import { fmtDuration } from '../features/leveling/levelChartGeometry'
import { formatAaRate, formatDropRate, formatLevelRate, formatPointRate } from '../lib/formatRate'

/**
 * One printed row: a label, a number, its unit, and a dim trailing detail.
 *
 * THERE IS NO HOVER FIELD ANY MORE (JOS-358, owner ruling from hands-on testing: the overlay
 * windows keep tooltips only in the title bar, and the bars get none). Every row here used to carry
 * a `title` clause — what it measures, or why it was withheld — and this file built four of them.
 * They are DELETED rather than left unread: a view-model field nothing renders is the "hide it"
 * the ruling forbids, and the next reader would wire it back.
 *
 * WHAT REPLACED THEM, so the honesty is not quietly gone with the strings:
 *   · a withheld rate is still an EM-DASH and the window still prints `· too short to rate` beside
 *     the span, in the open (XpOverlay.tsx `xp-too-short`) — the reason a reader can act on;
 *   · an inferred wait still wears `AA_EST` on the row itself;
 *   · the full sentences live on the Leveling tab, which is the surface with room for them
 *     (`ETA_BLOCKED_TITLE` is unchanged and still read by the Overview card).
 */
export interface XpOverlayRow {
  /** stable id — the React key and the e2e's handle (`xp-row-<id>`). */
  id: string
  /** which checklist entry switches this row off (shared/xpOverlay.ts). */
  row: XpRowId
  label: string
  /** the number itself, or the em-dash. Never '0' for something unknown. */
  value: string
  /** small suffix on the value's baseline; '' when the value stands alone. */
  unit: string
  /** dim trailing context — 'to 44', '12×'. '' when there is none. */
  detail: string
  /** true ⇒ the row wears `AA_EST`. Only ever the AA wait — see the header. */
  inferred: boolean
}

export interface XpOverlayView {
  rows: XpOverlayRow[]
  /**
   * 'over 1h 0m elapsed' — ONE span for the whole window, stated once rather than repeated on every
   * row (the WindowDropsPanel rule). A rate that never stated its span lets one drop in five
   * minutes read as a confident 12/hr.
   *
   * IT IS THE TIME SPENT IN THIS SCOPE (owner ruling 2, JOS-288) and it is the DENOMINATOR the rates
   * above divided by, which are the same number by construction — the window states one hour and
   * measures over it, rather than showing a span and dividing by something else.
   */
  span: string
  /** Which hour is in force — what the toggle renders as its state. */
  basis: RateBasis
  /**
   * false ⇒ this stretch is under `RATE_MIN_MS` and every rate on the window is an em-dash with its
   * reason. Surfaced so the window can say so once, beside the span, instead of leaving four blanks.
   */
  measurable: boolean
  /** The level the log last STATED, or null (the header chip is omitted). */
  level: number | null
  /** '/who' or 'Nh ago' beside that number, '' when the bare number is the whole fact. */
  levelCue: string
  /** The header chip's hover: which line stated the level, and how long ago. '' when there is
   *  no level to state. */
  levelTitle: string
  /** The slice gained experience the log stated no percentage for — this window speaks AA. */
  atCap: boolean
}

/** '1.42 lvl/hr' → `{ value: '1.42', unit: 'lvl/hr' }`; '—' → `{ value: '—', unit: '' }`. The
 *  aaPaceRows split, applied to the same rate vocabulary. */
function split(s: string): { value: string; unit: string } {
  const i = s.indexOf(' ')
  return i < 0 ? { value: s, unit: '' } : { value: s.slice(0, i), unit: s.slice(i + 1) }
}

/**
 * A rate, or the em-dash. Null is "the log did not state it", never zero.
 *
 * SINCE JOS-288 IT IS ALSO WHERE THE JUST-ARRIVED GATE FIRES, and this is the right seam for it:
 * `pickRate` returns null when the denominator in force is under `RATE_MIN_MS`, so the em-dash rule
 * this function already enforced covers the new refusal without a second branch anywhere. The gate
 * is a DISPLAY decision and stays here — `rangeStats` keeps measuring, and the golden windows keep
 * pinning what it measured.
 */
function rate(n: number | null, fmt: (v: number) => string): string {
  return n == null ? NONE : fmt(n)
}

// JOS-358 DELETED THE ROW HOVERS from this file: `XP_TITLE`, `AA_RATE_TITLE` and the `rowTitle`
// wrapper that appended the refusal to a withheld row. See `XpOverlayRow` for the argument and for
// where each of those sentences still lives. The WORD for the hour in force is on the footer's
// basis toggle, which is where a reader can also change it.

/** The LEVELS pace. Drawn while the game is still stating a level-bar percentage; see the header
 *  for why it is absent at the cap rather than an em-dash. */
function levelsRow(stats: RangeStats, read: BasisRead): XpOverlayRow {
  const r = split(rate(pickRate(read, stats.levelsPerHourActive, stats.levelsPerHourWall), formatLevelRate))
  return {
    id: 'xp',
    row: 'xp',
    label: 'XP',
    value: r.value,
    unit: r.unit || 'lvl/hr',
    detail: '',
    inferred: false
  }
}

/**
 * The AA pace — completions per hour, with the points those completions paid as the row's detail.
 *
 * BOTH NUMBERS ARE THE LEVELING TAB'S (`aaPerHourActive` / `aaPointsPerHourActive`, the pair
 * `aaRateText` prints in one chip), in the tab's own spellings. Nothing is divided here.
 * The detail is empty rather than an em-dash when the slice has no active time to divide by: a
 * dim trailing '-' beside a value that is already an em-dash says the same nothing twice.
 */
function aaRow(stats: RangeStats, read: BasisRead): XpOverlayRow {
  const r = split(rate(pickRate(read, stats.aaPerHourActive, stats.aaPerHourWall), formatAaRate))
  const points = pickRate(read, stats.aaPointsPerHourActive, stats.aaPointsPerHourWall)
  return {
    id: 'aa',
    row: 'xp',
    label: 'AA',
    value: r.value,
    unit: r.unit || 'AA/hr',
    detail: points == null ? '' : formatPointRate(points),
    inferred: false
  }
}

/**
 * The PACE rows — one per measure the log is stating (JOS-202). The order is levels then AA: the
 * bar you are watching first, the bar you are also filling second, and at the cap only the second
 * one exists.
 */
function paceRows(stats: RangeStats, capped: boolean, read: BasisRead): XpOverlayRow[] {
  const rows: XpOverlayRow[] = []
  if (!capped) rows.push(levelsRow(stats, read))
  // UNCONDITIONAL (see the header): a slice holding no completion reads a measured 0.00, never a
  // missing row. Nothing about the cap enters this decision — and nothing about the JOS-288 gate
  // does either: the row is always DRAWN, and what changes is whether it has earned a number.
  rows.push(aaRow(stats, read))
  return rows
}

/** The AA half of the projection row — inferred, and labelled so (see the header). */
function aaWaitRow(snap: ProgressionSnap, stats: RangeStats): XpOverlayRow {
  const n = snap.aaGainTs.length
  // The anchor is the LOG'S last completion measured against the LOG'S clock — `aaGainTs` is one
  // of the snapshot's uncapped columns, so its tail is always the real last one, and `lastTs` is
  // never `Date.now()` (this window is read while alt-tabbed out of a game that is not running).
  const eta = aaEta(stats, n > 0 ? snap.aaGainTs[n - 1] : null, snap, snap.lastTs)
  const value = aaEtaValue(eta)
  return {
    id: 'eta',
    row: 'eta',
    label: 'Next AA',
    value: value ?? NONE,
    unit: '',
    detail: value === null ? '' : AA_EST,
    inferred: true
  }
}

/**
 * The PROJECTION row: time to the next level, or (at cap) the wait for the next AA.
 *
 * A blocked estimate is an EM-DASH — never a number. The one-clause reason used to ride the row's
 * hover (`ETA_BLOCKED_TITLE`); JOS-358 took every hover off these rows, and the constant is
 * untouched and still read by the Overview card, so the two surfaces refuse in the same words
 * wherever there is room to print them.
 */
function etaRow(
  snap: ProgressionSnap,
  stats: RangeStats,
  level: LevelStatement | null | undefined,
  read: BasisRead
): XpOverlayRow {
  // `capped` is `atCap(stats)`, recomputed rather than passed: this function is at the repo's
  // measured `max-params` ceiling of 4 and the answer is a pure function of an argument it has.
  const capped = atCap(stats)
  // THE PROJECTION IS GATED WITH THE PACE IT IS BUILT ON (JOS-288). `levelEta` divides by
  // `levelsPerHourWall` — the very rate the row above just refused to quote — so a window showing
  // an em-dash for the pace and '~4m to 12' underneath it would be refusing and asserting the same
  // measurement in two lines. The AA wait is projected from completion GAPS rather than from a rate
  // and keeps its own gates (`AA_ETA_MIN_EVENTS`), so it is deliberately not caught here.
  if (!capped && !read.measurable) {
    return {
      id: 'eta',
      row: 'eta',
      label: 'Next level',
      value: NONE,
      unit: '',
      detail: '',
      inferred: false
    }
  }
  if (capped) return aaWaitRow(snap, stats)
  const eta = levelEta(snap, stats, level)
  if (eta.blocked !== null) {
    return {
      id: 'eta',
      row: 'eta',
      label: 'Next level',
      value: NONE,
      unit: '',
      detail: '',
      inferred: false
    }
  }
  // Past a day the estimate is a HORIZON rather than a duration — the Overview card's own rule,
  // spelled for a two-column row instead of a sentence.
  const absurd = eta.ms > ETA_ABSURD_MS
  return {
    id: 'eta',
    row: 'eta',
    label: 'Next level',
    value: absurd ? '>1 day' : `~${fmtDuration(eta.ms)}`,
    unit: '',
    detail: `to ${eta.toLevel}`,
    inferred: false
  }
}

/**
 * The MOTE rows — one per type observed, most-looted first.
 *
 * THE ORDER IS THE OBSERVATION (shared/xpOverlay.ts states the whole argument): nothing in this
 * repo ranks the ten tiers, so the row at the top is the one that dropped most and never the one
 * anything here thinks is best.
 *
 * A slice with no mote gets ONE row saying so rather than nothing at all: a silently missing
 * section reads as a broken window, and "none here" is a measurement over a span the caption
 * beside it already states.
 */
function moteRows(
  loot: readonly LootEvent[],
  slice: Timeslice,
  stats: RangeStats,
  read: BasisRead
): XpOverlayRow[] {
  const rows = moteRates({
    events: loot,
    t0: slice.range.t0,
    t1: slice.range.t1,
    // BOTH halves of the slice (JOS-130). `spans` is already the zone's own time when the slice
    // carries a zone, so counting every zone's drops against it would put a rate under a
    // denominator it was never measured over.
    spans: stats,
    zoneKey: slice.zoneKey,
    zoneExactKey: slice.zoneExactKey
  })
  if (rows.length === 0) {
    return [
      {
        id: 'motes-none',
        row: 'motes',
        label: 'Motes',
        value: NONE,
        unit: '',
        detail: 'none here',
        inferred: false
      }
    ]
  }
  return rows.map((m) => {
    const r = split(rate(pickRate(read, m.perHourActive, m.perHourWall), formatDropRate))
    // THE COUNT IS NEVER GATED, only the rate. "3 looted in Befallen this session" is a fact about
    // the log that a short stretch does not make less true; "3.00 drops/hr" over ninety seconds is
    // the extrapolation. So the detail and the hover keep stating what was observed.
    return {
      id: `mote-${m.key}`,
      row: 'motes' as const,
      label: m.tier,
      value: r.value,
      unit: r.unit || 'drops/hr',
      detail: `${m.drops.toLocaleString()}×`,
      inferred: false
    }
  })
}

export interface XpRowsArgs {
  snap: ProgressionSnap
  /** Every loot event this character has, oldest first (the `loot` module's snapshot). */
  loot: readonly LootEvent[]
  /** The slice in force — range, zone filter and wording, travelling as one object. */
  slice: Timeslice
  /** The user's row checklist. `undefined` ⇒ every row (shared/xpOverlay.ts). */
  visible: XpRowId[] | undefined
  /** `CharacterSnap.level` — the stated level fact. Absent ⇒ the ding tail stands in. */
  level?: LevelStatement | null
  /** WHICH HOUR the rates are per (JOS-288). Absent ⇒ `RATE_BASIS_DEFAULT`, which is `elapsed`. */
  basis?: RateBasis
}

/**
 * The whole window, from one snapshot and one slice. EXACTLY ONE `rangeStats` call: the pace row,
 * the projection and the motes' denominator all read the same object, so nothing on screen can be
 * measured over a different stretch than the caption claims.
 */
export function xpOverlayView(args: XpRowsArgs): XpOverlayView {
  const { snap, loot, slice, visible, level } = args
  // BOTH halves of the zone membership travel (JOS-130 / JOS-291) — the tier key is null unless
  // the window is on `this tier`, so the default is the read this window has always given.
  const stats = rangeStats({
    snap,
    range: slice.range,
    zoneKey: slice.zoneKey,
    zoneExactKey: slice.zoneExactKey
  })
  const capped = atCap(stats)
  // ONE BASIS READ FOR THE WHOLE WINDOW, resolved beside the one `rangeStats` call and handed to
  // every row: the span line under the rows states the denominator, and a row measured over a
  // different one than the caption claims is the exact drift that line exists to prevent.
  const basis = basisRead(args.basis ?? RATE_BASIS_DEFAULT, stats)
  const rows: XpOverlayRow[] = []
  if (xpRowVisible('xp', visible)) rows.push(...paceRows(stats, capped, basis))
  if (xpRowVisible('eta', visible)) rows.push(etaRow(snap, stats, level, basis))
  if (xpRowVisible('motes', visible)) rows.push(...moteRows(loot, slice, stats, basis))
  const read = currentLevelRead(level, snap)
  return {
    rows,
    span: basisSpanText(basis),
    basis: basis.basis,
    measurable: basis.measurable,
    level: read?.level ?? null,
    levelCue: read?.cue ?? '',
    levelTitle: read?.title ?? '',
    atCap: capped
  }
}
