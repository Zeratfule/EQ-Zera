// planner/gearEffectValue.ts — what an item's EFFECT is worth in numbers, read once at gear-index
// build so the Build tab can score procs, focus and worn effects (owner, 2026-11-23: "we should
// account for endurance and procs both").
//
// WHERE THE NUMBERS COME FROM: the committed spell catalog (`spells.json`), joined by the exact,
// case-folded effect name `effectIndex.ts buildSpellFacts` already joins on (first page wins). No
// scrape, no client file, no hand-typed table: every magnitude here is a line a spell page prints,
// read by the readers this repo already trusts for those lines —
//   * PROC DAMAGE is `spellMetricsAt(...).damage`: direct damage plus every DoT tick over the
//     catalog duration, lifetaps counted on their damage side, `Decrease HP when cast` skipped as the
//     duplicate rendering spellMetrics.ts documents. Read at REFERENCE_LEVEL.
//   * FOCUS is `parseWornFocus` (spell damage, healing) plus `Decrease Spell Mana Cost` read the same
//     way: the midpoint of the band, scaled by `focusLevelScale` for a spell of REFERENCE_LEVEL —
//     the level a capped character's top spells sit at. Spell haste, duration, range, reagent and
//     instrument focus have no number this scoring can weigh, and carry no value.
//   * WORN lines map onto the stat vector, read by `magnitudeAt` (ramps at REFERENCE_LEVEL, ranges at
//     their midpoint). Vision, breathing, movement and every other utility line map to nothing.
//
// REFERENCE_LEVEL IS THE PLAYER LEVEL CAP, 50 (shared/resistFormula.ts states it): a level ramp has to
// be read somewhere, and the Build tab is a best-in-slot planner, which is a capped character's
// question. A low-level reader sees ramps read above where they stand; the label says "~".
//
// THE PROC RATE IS NOT HERE. A rate is a fact about the swing, not the spell, and it lives beside the
// score that uses it (`shared/build/effectScore.ts`). This file only records the item's own
// `Rate +N%` modifier, which the wiki prints in the effect's parenthetical (`Combat, Rate +64%`).
//
// Pure over its arguments (the committed join is built once, below), and `tests/buildEffects.test.mts` drives this over the real bytes.

import type { ItemEffect } from '../../shared/itemStats'
import type { GearEffectValue, GearStatKey, GearStats } from '../../shared/planner/gear'
import type { SpellDbFile, SpellEntry } from '../../shared/types'
import { magnitudeAt, parseHpLine, spellMetricsAt, ticksOf } from '../../shared/spellMetrics'
import { focusLevelScale, parseWornFocus } from '../../shared/wornFocus'
// Committed data with one right answer, imported the way effectIndex.ts imports it.
import spellsJson from '../data/spells.json'

/** The player level cap (shared/resistFormula.ts): where every level ramp here is read. */
export const REFERENCE_LEVEL = 50

export type SpellPages = ReadonlyMap<string, SpellEntry>

/** Case-folded exact names, FIRST page wins — `buildSpellFacts`'s join, for the full entries. */
export function spellPages(spells: readonly SpellEntry[]): SpellPages {
  const out = new Map<string, SpellEntry>()
  for (const s of spells) {
    const key = s.name.trim().toLowerCase()
    if (key !== '' && !out.has(key)) out.set(key, s)
  }
  return out
}

/** The committed catalog, joined once for this process. */
export const COMMITTED_SPELL_PAGES: SpellPages = spellPages((spellsJson as SpellDbFile).spells)

const RATE = /\brate\s*([+-]?\d+)\s*%/i

/**
 * The DoT half of a proc, read with the same line reader `spellMetricsAt` folds with: the summed
 * per-tick damage, over the line's own tick count or the catalog duration. The score needs it apart
 * because a DoT re-landed by the next proc REFRESHES rather than stacks (effectScore.ts).
 */
function procDot(spell: SpellEntry): GearEffectValue['procDot'] {
  let perTick = 0
  let ticks = 0
  for (const raw of spell.effects ?? []) {
    const line = parseHpLine(raw, REFERENCE_LEVEL)
    if (line?.direction !== 'down' || !line.perTick) continue
    perTick += line.amount
    ticks = Math.max(ticks, line.statedTicks ?? ticksOf(spell.durationMs))
  }
  return perTick > 0 && ticks > 0 ? { perTick, ticks } : undefined
}

function procValue(effect: ItemEffect, spell: SpellEntry): GearEffectValue | undefined {
  const damage = spellMetricsAt(spell, REFERENCE_LEVEL)?.damage
  if (damage === undefined || damage <= 0) return undefined
  const rate = RATE.exec(effect.detail ?? '')
  const dot = procDot(spell)
  return { procDamage: damage, ...(dot ? { procDot: dot } : {}), ...(rate ? { procRate: Number(rate[1]) } : {}) }
}

const MANA_HEAD = /^decrease\s+spell\s+mana\s+cost\s+by\s+(\d+)%(?:\s+to\s+(\d+)%)?/i
const MAX_LEVEL = /^limit:?\s*max\s+level:?\s*\(?(\d+)\)?/i

/** `Decrease Spell Mana Cost by 1% to 10%`, read the way wornFocus.ts reads its two heads. */
function manaFocusPct(lines: readonly string[]): number | null {
  const head = MANA_HEAD.exec(lines[0]?.trim() ?? '')
  if (!head) return null
  const lo = Number(head[1])
  const hi = head[2] === undefined ? lo : Number(head[2])
  let cap: number | undefined
  for (const line of lines) {
    const m = MAX_LEVEL.exec(line.trim())
    if (m) cap = Number(m[1])
  }
  return ((lo + hi) / 2) * focusLevelScale(cap, REFERENCE_LEVEL)
}

type FocusValue = NonNullable<GearEffectValue['focus']>

const LIMIT_EFFECT = /^limit:?\s*effect:?\s*(.+?)\s*$/i
const POLARITY = /^limit:?\s*type:?\s*(detrimental|beneficial)\s*$/i
const INSTANT_ONLY = /^limit:?\s*max\s+duration:?\s*0(?:\.0+)?\s*s/i
const OVER_TIME_ONLY = /^limit:?\s*min\s+duration\b/i

/**
 * The limit lines that decide WHICH spells a focus touches, read for scoring. `null` when a
 * `Limit Effect:` names something other than hit points: Reanimation Efficiency and Summoning
 * Efficiency are pet-summon mana focus (`Limit Effect: Summon Skeleton Pet` / `Summon Pet`), and a
 * wizard's nukes would never see them. An `Exclude ...` effect limit narrows, it does not redirect.
 */
function focusScope(lines: readonly string[]): Pick<FocusValue, 'polarity' | 'scope'> | null {
  const out: Pick<FocusValue, 'polarity' | 'scope'> = {}
  for (const raw of lines) {
    const line = raw.trim()
    const effect = LIMIT_EFFECT.exec(line)
    if (effect && !/^exclude\b/i.test(effect[1]) && effect[1].toLowerCase() !== 'current hp') return null
    const pol = POLARITY.exec(line)
    if (pol) out.polarity = pol[1].toLowerCase() as FocusValue['polarity']
    if (INSTANT_ONLY.test(line)) out.scope = 'instant'
    if (OVER_TIME_ONLY.test(line)) out.scope = 'over-time'
  }
  return out
}

function focusValue(effect: ItemEffect, spell: SpellEntry): GearEffectValue | undefined {
  const lines = spell.effects ?? []
  const scope = focusScope(lines)
  if (scope === null) return undefined
  const focus = parseWornFocus(effect.name, '', lines)
  if (focus) {
    const pct = ((focus.minPct + focus.maxPct) / 2) * focusLevelScale(focus.maxLevel, REFERENCE_LEVEL)
    return pct > 0 ? { focus: { kind: focus.kind, pct, ...scope } } : undefined
  }
  const mana = manaFocusPct(lines)
  return mana !== null && mana > 0 ? { focus: { kind: 'mana', pct: mana, ...scope } } : undefined
}

/** A worn line's head -> the stat it states. Order matters: `Max Hitpoints` before `Hitpoints`. */
const WORN_LINES: readonly [RegExp, GearStatKey][] = [
  [/^(increase|decrease)\s+attack\s+speed\b/i, 'HASTE'],
  [/^(increase|decrease)\s+max\s+hit\s?points\b/i, 'HP'],
  [/^(increase|decrease)\s+max\s+mana\b/i, 'MP'],
  [/^(increase|decrease)\s+hp\s+regen\b/i, 'HP_REGEN'],
  [/^(increase|decrease)\s+mp\s+regen\b/i, 'MANA_REGEN'],
  [/^(increase|decrease)\s+mana\b(?=.*\bper\s+tick\b)/i, 'MANA_REGEN'],
  [/^(increase|decrease)\s+endurance\b(?=.*\bper\s+tick\b)/i, 'END_REGEN'],
  [/^(increase|decrease)\s+atk\b/i, 'ATTACK'],
  [/^(increase|decrease)\s+ac\b/i, 'AC'],
  [/^(increase|decrease)\s+(str|sta|agi|dex|wis|int|cha)\b/i, 'STR'],
  [/^(increase|decrease)\s+(fire|cold|magic|disease|poison)\s+resist\b/i, 'SV_FIRE']
]

/** The two families whose key is the matched word, not the table's placeholder. */
function keyOf(m: RegExpExecArray, key: GearStatKey): GearStatKey {
  if (key === 'STR') return m[2].toUpperCase() as GearStatKey
  if (key === 'SV_FIRE') return `SV_${m[2].toUpperCase()}` as GearStatKey
  return key
}

/** One worn line -> [key, signed amount], or null when it states nothing the vector holds. */
function wornLine(raw: string): [GearStatKey, number] | null {
  const line = raw.trim()
  const hp = parseHpLine(line, REFERENCE_LEVEL)
  if (hp?.perTick === true && hp.direction === 'up') return ['HP_REGEN', hp.amount]
  for (const [re, key] of WORN_LINES) {
    const m = re.exec(line)
    if (!m) continue
    // `by 2% (L1) to 35% (L49)`: the percent sign sits between a value and its breakpoint.
    const read = magnitudeAt(line.slice(m[0].length).replace(/%/g, ''), REFERENCE_LEVEL)
    if (read === null) return null
    const sign = m[1].toLowerCase() === 'decrease' ? -1 : 1
    return [keyOf(m, key), sign * Math.abs(read.value)]
  }
  return null
}

function wornValue(spell: SpellEntry): GearEffectValue | undefined {
  const stats: GearStats = {}
  let any = false
  for (const raw of spell.effects ?? []) {
    const read = wornLine(raw)
    if (read === null) continue
    stats[read[0]] = (stats[read[0]] ?? 0) + read[1]
    any = true
  }
  return any ? { stats } : undefined
}

/**
 * One effect line -> what it is worth, or undefined when its page is missing or states nothing this
 * scoring can weigh. Only the three kinds whose firing needs no press: a combat proc, a focus, a worn
 * effect. A clicky needs the player to use it, and a bare `Effect:` line never said which it is.
 */
export function effectValueOf(effect: ItemEffect, pages: SpellPages): GearEffectValue | undefined {
  const spell = pages.get(effect.name.trim().toLowerCase())
  if (spell === undefined) return undefined
  // `proc` is the corpus's rarer spelling of the same thing (`Rod of Understanding`: "Proc").
  if (effect.kind === 'combat' || effect.kind === 'proc') return procValue(effect, spell)
  if (effect.kind === 'focus') return focusValue(effect, spell)
  if (effect.kind === 'worn') return wornValue(spell)
  return undefined
}
