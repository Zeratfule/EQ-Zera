// THE BUILD PROFILES (EQ Zera, 2026-09-06) — what "tankier", "more DPS" and "heals better" MEAN
// as numbers, so the Build tab can score an item, a slot and a whole set the same way.
//
// A profile is a weight per stat, in HP-EQUIVALENTS: one point of HP is worth 1, and every other
// stat is "how many HP is one point of this worth to somebody playing this role". The weights are
// a heuristic, stated here in one table so they can be argued with; nothing else in the app
// re-derives them. They are CLASS-AWARE where the game is: a caster's DPS comes from INT/mana, a
// priest's healing from WIS/mana, a knight's tanking from AC/HP with a little mana.
//
// THE SOLO METER is a second heuristic, also stated here: a class KIT (heal, sustain, escape,
// control, pet — each 0..1, classic-era EQ, one row per class; a loadout takes the best of its
// classes on each axis, because the character has all of them) blended with the three gear meters.
//
// Both are honest about being heuristics: the UI prints the parts, never just the number.

import type { ClassAbbr } from '../classCombo'
import type { GearStatKey, GearStats } from '../planner/gear'
import { gearRatio } from '../planner/gearScale'

export type BuildProfile = 'tank' | 'dps' | 'heal'
export const BUILD_PROFILES: readonly BuildProfile[] = ['tank', 'dps', 'heal']
export const PROFILE_LABEL: Record<BuildProfile, string> = { tank: 'Tank', dps: 'DPS', heal: 'Healer' }

/**
 * What a FOCUS effect is weighed by, per percent (effectScore.ts reads them; `itemScore` never does):
 * a spell damage focus, a healing focus, a mana-cost focus.
 */
export type FocusWeightKey = 'FOCUS_DAMAGE' | 'FOCUS_HEAL' | 'FOCUS_MANA'

/** A weight per stat, plus RATIO (damage/delay) for weapon rows and the focus weights. HP-equivalents. */
export type BuildWeights = Partial<Record<GearStatKey | 'RATIO' | FocusWeightKey, number>>

const INT_CASTERS: readonly ClassAbbr[] = ['WIZ', 'MAG', 'NEC', 'ENC']
const PRIESTS: readonly ClassAbbr[] = ['CLR', 'DRU', 'SHM']
const WIS_HYBRIDS: readonly ClassAbbr[] = ['PAL', 'RNG', 'BST']
const INT_HYBRIDS: readonly ClassAbbr[] = ['SHD']
const MELEE: readonly ClassAbbr[] = ['WAR', 'MNK', 'ROG', 'BER', 'BRD', 'RNG', 'PAL', 'SHD', 'BST']

export interface Archetype {
  melee: boolean
  intCaster: boolean
  priest: boolean
  /** which mental stat this loadout's mana comes from */
  manaStat: 'WIS' | 'INT' | null
  rogue: boolean
}

/** What a loadout IS, for the weights: a class list of any length, any mix. */
export function archetypeOf(classes: readonly ClassAbbr[]): Archetype {
  const has = (list: readonly ClassAbbr[]): boolean => classes.some((c) => list.includes(c))
  const wis = has(PRIESTS) || has(WIS_HYBRIDS)
  const int = has(INT_CASTERS) || has(INT_HYBRIDS)
  return {
    melee: has(MELEE),
    intCaster: has(INT_CASTERS),
    priest: has(PRIESTS),
    manaStat: wis && !int ? 'WIS' : int && !wis ? 'INT' : wis && int ? 'WIS' : null,
    rogue: classes.includes('ROG')
  }
}

// SV_VOID IS A SAVE LIKE THE OTHER FIVE (2026-11-23). It was left out when this table was written,
// when two pages stated it; the 2026-11-15 rescrape's Castle Nektropos gear states it outright
// (Unbroken Golem Core +38, Blood's Unity +25, Robe of the Betrayed +4), and every upgraded item
// that triggers `synthesizesVoidSave` gains it too. Leaving it unweighted scored those lines zero.
const SAVES: readonly GearStatKey[] = ['SV_FIRE', 'SV_COLD', 'SV_MAGIC', 'SV_DISEASE', 'SV_POISON', 'SV_VOID']

/** `SV ALL` is the five classic saves at once; void is not part of it. */
const SV_ALL_COUNT = 5

function withSaves(w: BuildWeights, each: number): BuildWeights {
  for (const k of SAVES) w[k] = each
  w.SV_ALL = each * SV_ALL_COUNT
  return w
}

// ENDURANCE, FOR THE CLASSES THAT SPEND IT (2026-11-23). EQ Legends gear states an endurance pool
// (END on 66 pages; the Nektropos melee drops carry +45 to +95) and players spend it on combat
// abilities (general chat in the owner's log, 2026-08-16: "it only uses endurance vs mana"). It is
// weighted the way the tank profile weighs a hybrid's mana pool: a little, per point.
//
// WHO SPENDS IT IS MEASURED, not assumed from "melee". The client's own `spells_us.txt` carries an
// endurance cost in field 97 (owner's install, 2026-11-23: 3,020 rows state one, 21,792 state a
// mana cost in field 14, and only 16 state both, so it is a second pool and not a copy of mana:
// Provoke 85, Bellow 175, Sneak Attack 325, Phantom Wind 175, Disrupting Shot 75, Skull Bash 125).
// Of the rows a class can learn at or below the level cap of 50, the ones with an endurance cost
// belong to exactly five classes: WAR (Provoke, and War Cry from the class data), MNK (Phantom
// Zephyr, Phantom Wind), ROG (Sneak Attack), BER (Tendon Slice, Skull Bash, Head Pummel and more)
// and RNG (Disrupting Shot, a Legends-only row). PAL, SHD, BRD and BST learn none below 51, and no
// priest or caster learns any — so those weigh endurance at zero, which is a narrowing of the first
// cut (2026-11-23 audit), when every melee class weighed it.
//
// WHICH PROFILES: tank and DPS. Provoke and War Cry are aggro tools and the rest are attacks; none of
// the five classes' endurance abilities heals, so the healer profile weighs it at zero for everyone.
const ENDURANCE_USERS: readonly ClassAbbr[] = ['WAR', 'MNK', 'ROG', 'BER', 'RNG']
const END_WEIGHTS: BuildWeights = { END: 0.15, END_REGEN: 10 }

/** Does this loadout have an ability that costs endurance (see above)? */
export function spendsEndurance(classes: readonly ClassAbbr[]): boolean {
  return classes.some((c) => ENDURANCE_USERS.includes(c))
}

// A FOCUS PERCENT IS WEIGHED AS THAT PERCENT OF A MANA POOL (2026-11-23). A spell damage focus of p%
// is p% more damage out of the same mana, which is what p% more mana would buy; a healing focus is
// the same for heals, and a mana-cost focus of p% is p% more casts out of the same pool. So one
// percent is worth one percent of a reference pool, at the profile's own MP weight.
//
// THE REFERENCE POOL is the classic client mana formula (EQEmu `Client::CalcBaseMana`, the classic
// branch: `max_m = ((5 * (MindFactor + 20)) / 2) * 3 * level / 40` for a mental stat over 100, where
// the part of the stat above 199 counts half) read at the level cap of 50 and a mental stat of 200,
// the point where it stops paying full rate: 9.375 x 220 = 2,062.5 mana. Gear mana and regen are left
// out, so this leans LOW for a long fight. An estimate, and the Build tab prints it with a `~`.
export const REFERENCE_MANA_POOL = 2062.5

/** One focus percent, at a profile's MP weight. */
function focusWeight(mp: number): number {
  return (REFERENCE_MANA_POOL / 100) * mp
}

/** The tank weights: AC and HP first, a hybrid's mana pool and an endurance user's pool a little. */
function tankWeights(a: Archetype, endurance: boolean): BuildWeights {
  const mana: BuildWeights = a.manaStat === null ? {} : { [a.manaStat]: 0.5, MP: 0.15, FOCUS_MANA: focusWeight(0.15) }
  return withSaves(
    { AC: 12, HP: 1, STA: 10, AGI: 3, STR: 1, DEX: 1, HP_REGEN: 20, HASTE: 8, ATTACK: 2, ...mana, ...(endurance ? END_WEIGHTS : {}) },
    2
  )
}

/** The weights for a profile, for this loadout. */
export function profileWeights(profile: BuildProfile, classes: readonly ClassAbbr[]): BuildWeights {
  const a = archetypeOf(classes)
  const endurance = spendsEndurance(classes)
  if (profile === 'tank') return tankWeights(a, endurance)
  if (profile === 'heal') {
    const stat: GearStatKey = a.manaStat ?? 'WIS'
    const focus = focusWeight(1.2)
    return withSaves({ [stat]: 8, MP: 1.2, MANA_REGEN: 40, CHA: 0.5, HP: 0.5, STA: 3, AC: 3, FOCUS_HEAL: focus, FOCUS_MANA: focus }, 1.5)
  }
  // DPS: melee and caster halves, both present when the loadout is both.
  const w: BuildWeights = { HP: 0.4, STA: 2, AC: 2 }
  if (a.melee || !a.intCaster) {
    Object.assign(w, { RATIO: 350, DMG_BONUS: 40, HASTE: 25, ATTACK: 6, STR: 4, DEX: 4, AGI: 1, STA: 3, AC: 3 })
    if (a.rogue) w.BACKSTAB = 25
  }
  if (endurance) Object.assign(w, END_WEIGHTS)
  if (a.intCaster || a.priest) {
    const stat: GearStatKey = a.manaStat ?? 'INT'
    w[stat] = (w[stat] ?? 0) + 8
    w.MP = 1.2
    w.MANA_REGEN = 40
    w.FOCUS_DAMAGE = focusWeight(1.2)
    w.FOCUS_MANA = focusWeight(1.2)
  }
  return withSaves(w, 1)
}

const FOCUS_KEYS: ReadonlySet<string> = new Set<FocusWeightKey>(['FOCUS_DAMAGE', 'FOCUS_HEAL', 'FOCUS_MANA'])

/** One item's STATS under a profile: Σ weight × stat, plus the weapon ratio where it has one. */
export function itemScore(stats: GearStats, weights: BuildWeights): number {
  let total = 0
  for (const [key, w] of Object.entries(weights) as [GearStatKey | 'RATIO' | FocusWeightKey, number][]) {
    if (key === 'RATIO') {
      const ratio = gearRatio(stats)
      if (ratio !== undefined) total += w * ratio
      continue
    }
    if (FOCUS_KEYS.has(key)) continue
    const v = stats[key as GearStatKey]
    if (v !== undefined) total += w * v
  }
  return total
}

/** A meter: where a score sits against the best the same rules could reach, 0..100. */
export function meterPercent(current: number, best: number): number {
  if (best <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((current / best) * 100)))
}

// ---------------------------------------------------------------------------------------------
// The solo meter
// ---------------------------------------------------------------------------------------------

export interface SoloKit {
  /** can this loadout heal itself — 1 is a cleric */
  heal: number
  /** regen, mend, cannibalize, lifetaps: staying in the fight without a healer */
  sustain: number
  /** feign death, snare-and-run, evac, invis: leaving a fight it is losing */
  escape: number
  /** root, snare, mez, fear, slow: deciding the fight's pace */
  control: number
  /** a pet that tanks or adds damage */
  pet: number
}

export const SOLO_AXES: readonly (keyof SoloKit)[] = ['heal', 'sustain', 'escape', 'control', 'pet']
export const SOLO_AXIS_LABEL: Record<keyof SoloKit, string> = {
  heal: 'Self-healing',
  sustain: 'Sustain',
  escape: 'Escape',
  control: 'Control',
  pet: 'Pet'
}

/** Classic-era kits, one row per class. A heuristic; argue with the table, not the code. */
const CLASS_KIT: Record<ClassAbbr, SoloKit> = {
  WAR: { heal: 0, sustain: 0.2, escape: 0.1, control: 0.1, pet: 0 },
  CLR: { heal: 1, sustain: 0.5, escape: 0.2, control: 0.3, pet: 0 },
  PAL: { heal: 0.6, sustain: 0.4, escape: 0.2, control: 0.3, pet: 0 },
  RNG: { heal: 0.4, sustain: 0.3, escape: 0.5, control: 0.4, pet: 0 },
  SHD: { heal: 0.2, sustain: 0.6, escape: 0.4, control: 0.3, pet: 0.5 },
  DRU: { heal: 0.8, sustain: 0.6, escape: 0.7, control: 0.7, pet: 0.2 },
  MNK: { heal: 0, sustain: 0.4, escape: 0.8, control: 0.1, pet: 0 },
  BRD: { heal: 0.2, sustain: 0.5, escape: 0.8, control: 0.6, pet: 0 },
  ROG: { heal: 0, sustain: 0.1, escape: 0.5, control: 0.1, pet: 0 },
  SHM: { heal: 0.7, sustain: 0.6, escape: 0.3, control: 0.6, pet: 0.5 },
  NEC: { heal: 0.3, sustain: 0.7, escape: 0.6, control: 0.6, pet: 0.9 },
  WIZ: { heal: 0, sustain: 0.2, escape: 0.6, control: 0.4, pet: 0 },
  MAG: { heal: 0.1, sustain: 0.4, escape: 0.3, control: 0.2, pet: 1 },
  ENC: { heal: 0.1, sustain: 0.5, escape: 0.4, control: 1, pet: 0.7 },
  BST: { heal: 0.5, sustain: 0.5, escape: 0.3, control: 0.4, pet: 0.8 },
  BER: { heal: 0, sustain: 0.2, escape: 0.2, control: 0.2, pet: 0 }
}

/** The loadout's kit: the best of its classes on each axis, since the character has all of them. */
export function soloKit(classes: readonly ClassAbbr[]): SoloKit {
  const kit: SoloKit = { heal: 0, sustain: 0, escape: 0, control: 0, pet: 0 }
  for (const c of classes) {
    const k = CLASS_KIT[c]
    for (const axis of SOLO_AXES) kit[axis] = Math.max(kit[axis], k[axis])
  }
  return kit
}

export interface SoloReading {
  percent: number
  /** the class-kit half, 0..100 */
  kitPercent: number
  /** the gear half, 0..100 — tank and DPS meters, with the healer meter counting as far as the kit can heal */
  gearPercent: number
}

const KIT_WEIGHT: Record<keyof SoloKit, number> = { heal: 0.25, sustain: 0.2, escape: 0.2, control: 0.2, pet: 0.15 }

/** Blend the kit with the three gear meters: 45% what the classes can do, 55% what the gear does. */
export function soloReading(kit: SoloKit, meters: { tank: number; dps: number; heal: number }): SoloReading {
  let kitScore = 0
  for (const axis of SOLO_AXES) kitScore += KIT_WEIGHT[axis] * kit[axis]
  const healShare = 0.2 * Math.max(kit.heal, 0.3)
  const gear = (0.4 * meters.tank + 0.4 * meters.dps + healShare * meters.heal) / (0.8 + healShare)
  const kitPercent = Math.round(kitScore * 100)
  const gearPercent = Math.round(gear)
  return { percent: Math.round(0.45 * kitPercent + 0.55 * gearPercent), kitPercent, gearPercent }
}
