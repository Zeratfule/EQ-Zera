// THE EFFECT HALF OF A SCORE (EQ Zera, 2026-11-23; owner: "we should account for endurance and procs
// both"). `itemScore` weighs a row's STATS; this file weighs what its EFFECTS do, in the same
// HP-equivalent units, from the magnitudes main read off the spell pages at index build
// (src/main/planner/gearEffectValue.ts). `rowScore` is the sum, and it is what the optimizer, the
// upgrade finder and the Build tab's numbers all use, so an effect counts the same everywhere.
//
// ── PROCS: estimated DPS, on the basis the profile already prices weapon damage ──────────────────
//
// THE RATE is the classic procs-per-minute model, EQEmu `Mob::GetProcChances` with its defaults
// (common/ruletypes.h: `AdjustProcPerMinute` true, `AvgProcsPerMinute` 2.0):
//     chance per swing = weapon_speed_ms x 2.0 / 60000, times (100 + item ProcRate) / 100
// (`Mob::TryWeaponProc`: `WPC = ProcChance * (100 + weapon->ProcRate) / 100`). Swings per minute are
// 60000 / weapon_speed_ms, so the delay cancels and so does haste:
//     procs per minute = 2.0 x (1 + rate / 100)
// The DEX term (`ProcPerMinDexContrib` 0.075 per point, so +19% at 255) is LEFT OUT because a row
// does not know the wearer's DEX; the estimate leans low by that much.
//
// THE CONVERSION. The DPS profile prices a weapon at `RATIO` x DMG / DELAY, DELAY in tenths of a
// second. A swing lands about its DMG: EQEmu `Mob::MeleeMitigation` multiplies the base damage (the
// weapon's DMG) by a roll from a 0.1..2.0 table centred near 1, and `ApplyDamageTable`'s bonus only
// starts past level 50. So one point of ratio is about 10 white DPS, and a proc is priced as
//     score = RATIO x (procs per minute x damage per proc / 60) / 10
// i.e. exactly the ratio a weapon would need to deal the proc's damage with white swings. Only a row
// with a weapon DELAY can swing; a profile with no RATIO weight (tank, healer, a pure caster's DPS)
// scores procs at zero, as it scores weapon damage at zero. A DoT proc counts only the ticks that
// land before the next proc refreshes it (`procDps`). Resists and the target's level are not
// modelled. A proc that deals no damage (a slow, a snare, a stun alone, a buff) has no number this
// scoring can ground, and is listed as not scored rather than given one.
//
// ── FOCUS: a percent of a reference mana pool (profiles.ts REFERENCE_MANA_POOL) ──────────────────
// ── WORN: the effect's lines, weighed as the stats they state ───────────────────────────────────
//
// A worn haste line counts only what it adds ABOVE the row's own `Haste:` stat: haste does not
// stack, and Ragebringer states `Haste: 40%` AND a worn `Seething Fury` of 40% that are one haste.
//
// ── FOCUS DOES NOT STACK, AND THE SET SCORE SAYS SO ─────────────────────────────────────────────
//
// The best qualifying focus applies and the rest do nothing (wornFocus.ts carries the evidence from
// the owner's own log). Scored as a plain sum, three spell damage focuses on one set counted three
// times, and the first cut of this file picked exactly that set for a wizard. So a focus is scored
// against a COVER: the best percent the REST of the set already holds per focus ENTRY (`focusEntry`:
// the figure moved, the polarity it is limited to, and its duration limit). One spell takes one
// focus per figure, so entries of one figure whose spells OVERLAP do not stack: Mana Preservation
// (any spell), Jolum's Abatement (detrimental only) and an over-time-only mana focus all touch a
// DoT, and only the best of them applies to it. Entries whose spells are DISJOINT do add (a nuke
// focus beside a DoT focus, a detrimental beside a beneficial one). So a figure's worth is the best
// set of pairwise-disjoint entries (`focusValue`), and a focus adds only what it moves that worth
// above its cover. A focus alone is worth its percent times its weight, exactly as before.
// `setScore` is the exact set total; a candidate scored against the cover of the other cells gains
// exactly what swapping it in would change.
//
// WHAT THIS DOES NOT MODEL, said once here: worn effects of the same name do not stack in game
// either (two Aura of Battle are one buff), and a worn haste line beside another item's `Haste:` is
// one haste. Those are summed, as two `Haste:` stats always have been.

import type { GearEffect, GearRow, GearStats } from '../planner/gear'
import { itemScore, type BuildWeights, type FocusWeightKey } from './profiles'

/** EQEmu's `AvgProcsPerMinute` default (see the header). */
export const AVG_PROCS_PER_MINUTE = 2
/** White DPS per point of DMG/DELAY: DELAY is in tenths of a second, a swing lands about its DMG. */
export const WHITE_DPS_PER_RATIO = 10

const SECONDS_PER_MINUTE = 60

/** One scored effect: what it added, and the words the Build tab prints beside it. */
export interface EffectPart {
  label: string
  score: number
}

export interface EffectReading {
  parts: EffectPart[]
  /** labels of the effects this scoring could not put a number on */
  unscored: string[]
  total: number
}

const KIND_LABEL: Partial<Record<GearEffect['kind'], string>> = { combat: 'Proc', proc: 'Proc', focus: 'Focus', worn: 'Worn' }

type FocusValue = NonNullable<NonNullable<GearEffect['value']>['focus']>

/**
 * Which weight prices a focus. Damage and healing focus are their own; a MANA-cost focus is priced
 * by what it is limited to: `Limit Type: Detrimental` makes it a damage-spell focus (Jolum's
 * Abatement, Affliction Efficiency), `Beneficial` a healing one, and no limit both (Mana Preservation).
 */
function focusWeightKey(f: FocusValue): FocusWeightKey {
  if (f.kind === 'damage') return 'FOCUS_DAMAGE'
  if (f.kind === 'heal') return 'FOCUS_HEAL'
  if (f.polarity === 'detrimental') return 'FOCUS_DAMAGE'
  return f.polarity === 'beneficial' ? 'FOCUS_HEAL' : 'FOCUS_MANA'
}

/** One EQ tick, in seconds. */
const TICK_SECONDS = 6

type ProcValue = Pick<NonNullable<GearEffect['value']>, 'procDamage' | 'procDot' | 'procRate'>

/**
 * A proc's estimated DPS under the model above.
 *
 * A DoT IS CAPPED AT THE GAP BETWEEN PROCS. The same caster's same DoT landing again refreshes the
 * one already ticking rather than stacking beside it, so a proc whose DoT outlasts the average gap
 * (60 / procs-per-minute seconds: 30 at the base rate) only ever delivers that gap's worth of ticks.
 * Scourge on Blight, Hammer of the Scourge runs twelve ticks; at two procs a minute five of them land.
 */
export function procDps(v: ProcValue): number {
  const damage = v.procDamage ?? 0
  const ppm = AVG_PROCS_PER_MINUTE * (1 + (v.procRate ?? 0) / 100)
  if (damage <= 0 || ppm <= 0) return 0
  const dot = v.procDot
  const gapTicks = SECONDS_PER_MINUTE / ppm / TICK_SECONDS
  const lost = dot === undefined ? 0 : dot.perTick * Math.max(0, dot.ticks - gapTicks)
  return (ppm * (damage - lost)) / SECONDS_PER_MINUTE
}

/**
 * A row whose proc fires on the melee swings the model counts: a weapon that can be held. A RANGE-
 * only row (a bow, a thrown item) procs on ranged attacks, whose rate is a matter of how often the
 * player fires, and that is no number this file has; its proc is listed as not scored.
 */
function swings(row: GearRow): boolean {
  return (row.stats.DELAY ?? 0) > 0 && (row.slots.includes('PRIMARY') || row.slots.includes('SECONDARY'))
}

function procScore(row: GearRow, e: GearEffect, w: BuildWeights): number {
  const ratio = w.RATIO ?? 0
  if (e.value?.procDamage === undefined || ratio <= 0 || !swings(row)) return 0
  return (ratio * procDps(e.value)) / WHITE_DPS_PER_RATIO
}

/** What the rest of a set already holds, per focus group: the best percent in each. */
export type FocusCover = ReadonlyMap<string, number>

const NO_COVER: FocusCover = new Map()

/**
 * A focus effect's entry: the figure it moves, then the polarity and duration limit of the spells it
 * touches (`any` where unlimited). Two ranks of one focus are one entry, and within an entry the
 * best percent wins outright. Keyed `figure|polarity|scope` so `focusValue` can price an entry and
 * tell which entries overlap from the key alone.
 */
function focusEntry(e: GearEffect): string | null {
  const focus = e.value?.focus
  if (e.kind !== 'focus' || focus === undefined) return null
  return `${focus.kind}|${focus.polarity ?? 'any'}|${focus.scope ?? 'any'}`
}

/** Two limits overlap unless both are stated and differ. */
function meets(a: string, b: string): boolean {
  return a === 'any' || b === 'any' || a === b
}

/** Do two entries of one figure touch a common spell? */
function overlaps(a: readonly string[], b: readonly string[]): boolean {
  return meets(a[1], b[1]) && meets(a[2], b[2])
}

interface PricedEntry {
  parts: string[]
  value: number
}

/** One entry's worth on its own: percent times the weight that prices it. */
function entryValue(parts: readonly string[], pct: number, w: BuildWeights): number {
  const polarity = parts[1] === 'any' ? undefined : parts[1]
  const key = focusWeightKey({ kind: parts[0], polarity } as FocusValue)
  return pct * (w[key] ?? 0)
}

/** Can entry `i` join the entries already in `mask`? */
function fitsMask(list: readonly PricedEntry[], mask: number, i: number): boolean {
  for (let j = 0; j < list.length; j++) if (mask & (1 << j) && overlaps(list[i].parts, list[j].parts)) return false
  return true
}

/** The best total of pairwise-disjoint entries: every subset, built up one entry at a time. */
function bestDisjoint(list: readonly PricedEntry[]): number {
  const sums = new Map<number, number>([[0, 0]])
  let best = 0
  for (let i = 0; i < list.length; i++) {
    for (const [mask, sum] of [...sums]) {
      if (!fitsMask(list, mask, i)) continue
      const next = sum + list[i].value
      sums.set(mask | (1 << i), next)
      if (next > best) best = next
    }
  }
  return best
}

/**
 * The focus worth of a cover: per figure, the best set of pairwise-disjoint entries (one spell takes
 * one focus per figure). A figure has at most nine entries (three polarities by three scopes), so
 * trying every disjoint subset is cheap and exact.
 */
export function focusValue(cover: FocusCover, w: BuildWeights): number {
  const byFigure = new Map<string, PricedEntry[]>()
  for (const [key, pct] of cover) {
    const parts = key.split('|')
    const list = byFigure.get(parts[0]) ?? []
    list.push({ parts, value: entryValue(parts, pct, w) })
    byFigure.set(parts[0], list)
  }
  let total = 0
  for (const list of byFigure.values()) total += bestDisjoint(list)
  return total
}

/** The cover plus one focus effect: the best percent per entry. */
function withFocus(cover: FocusCover, e: GearEffect): FocusCover {
  const g = focusEntry(e)
  const pct = e.value?.focus?.pct ?? 0
  if (g === null || pct <= (cover.get(g) ?? 0)) return cover
  return new Map(cover).set(g, pct)
}

/** The cover these rows give: the best percent per focus group. */
export function focusCover(rows: Iterable<GearRow | null>): Map<string, number> {
  const out = new Map<string, number>()
  for (const row of rows) {
    if (row === null) continue
    for (const e of row.effects) {
      const g = focusEntry(e)
      const pct = e.value?.focus?.pct ?? 0
      if (g !== null && pct > (out.get(g) ?? 0)) out.set(g, pct)
    }
  }
  return out
}

/** What one focus adds above `cover`: the change it makes to the cover's focus worth. */
function focusScore(e: GearEffect, w: BuildWeights, cover: FocusCover): number {
  const next = withFocus(cover, e)
  return next === cover ? 0 : Math.max(0, focusValue(next, w) - focusValue(cover, w))
}

function wornScore(row: GearRow, e: GearEffect, w: BuildWeights): number {
  const stats = e.value?.stats
  if (stats === undefined) return 0
  const own = row.stats.HASTE ?? 0
  const adjusted: GearStats = { ...stats }
  if (adjusted.HASTE !== undefined) adjusted.HASTE = Math.max(0, adjusted.HASTE - own)
  // The vector never carries a weapon block, so RATIO reads nothing here.
  return itemScore(adjusted, w)
}

/** One effect's score under these weights; 0 where it states nothing this profile weighs. */
function partScore(row: GearRow, e: GearEffect, w: BuildWeights, cover: FocusCover): number {
  if (e.kind === 'combat' || e.kind === 'proc') return procScore(row, e, w)
  if (e.kind === 'worn') return wornScore(row, e, w)
  return focusScore(e, w, cover)
}

/** The effect half of a row's score against a cover (see the header), no labels — the hot path. */
export function effectScore(row: GearRow, weights: BuildWeights, cover: FocusCover = NO_COVER): number {
  // A row's own focuses join the cover as they are counted, so two on one row never double up.
  let total = 0
  let held = cover
  for (const e of row.effects) {
    total += partScore(row, e, weights, held)
    held = withFocus(held, e)
  }
  return total
}

/** A row's whole worth: its stats (`itemScore`) plus its effects, focus above `cover` only. */
export function rowScore(row: GearRow, weights: BuildWeights, cover: FocusCover = NO_COVER): number {
  return itemScore(row.stats, weights) + effectScore(row, weights, cover)
}

/** A whole set's worth: every row's stats and procs and worn lines, and each focus group's best once. */
export function setScore(rows: Iterable<GearRow | null>, weights: BuildWeights): number {
  let total = 0
  const list: GearRow[] = []
  for (const row of rows) if (row !== null) list.push(row)
  for (const row of list) {
    total += itemScore(row.stats, weights)
    for (const e of row.effects) if (focusEntry(e) === null) total += partScore(row, e, weights, NO_COVER)
  }
  return total + focusValue(focusCover(list), weights)
}

/** Is this a proc this file could have scored, were the row a held weapon? */
function rangedProc(row: GearRow, e: GearEffect): boolean {
  return (e.kind === 'combat' || e.kind === 'proc') && e.value?.procDamage !== undefined && !swings(row)
}

/**
 * The breakdown the Build tab prints. Only the three kinds that fire without a press are read; an
 * effect of one of them whose page gave no number is `unscored` (a slow proc, spell haste, a vision
 * line), as is a damage proc on a row that is never swung. One that HAS a number this profile does
 * not weigh (a proc for the healer), or a focus the rest of the set already covers, is neither: it
 * is worth nothing here, which is what the score already says.
 */
export function effectReading(row: GearRow, weights: BuildWeights, cover: FocusCover = NO_COVER): EffectReading {
  const parts: EffectPart[] = []
  const unscored: string[] = []
  let total = 0
  let held = cover
  for (const e of row.effects) {
    const here = held
    held = withFocus(held, e)
    const kind = KIND_LABEL[e.kind]
    if (kind === undefined) continue
    const label = `${kind}: ${e.name}`
    if (e.value === undefined || rangedProc(row, e)) {
      unscored.push(label)
      continue
    }
    const score = partScore(row, e, weights, here)
    if (score === 0) continue
    parts.push({ label, score })
    total += score
  }
  return { parts, unscored, total }
}

/** `~+120 from Proc: Lightning Storm` — the estimate marker is part of the words. */
export function effectPartText(part: EffectPart): string {
  const n = Math.round(part.score)
  return `~${n >= 0 ? '+' : ''}${n.toLocaleString()} from ${part.label}`
}
