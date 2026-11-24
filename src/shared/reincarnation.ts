// reincarnation.ts — WHAT THE CHARACTER HAS REINCARNATED, kept, counted, and stated by hand.
//
// THE GAME (EQ Legends, Rulers of Kunark early access, official patch notes 2026-11-10): a capped
// three-class loadout holding a Token of Reincarnation can reincarnate. Its three classes AND its
// race go back to level 1, and each immediately gains one rank of its reincarnation AA —
// `Class Reincarnation: <Class>` (16) and `Race Reincarnation: <Race>` (17), three ranks each, the
// client's own dbstr names. `Reincarnation: Completionist` ranks up as EVERY class AA reaches rank
// 1, 2 and 3. Other loadouts sharing the race or a class are set to the lowest level of the four
// (eqstr 16113/16114) — nothing here models that.
//
// WHERE THE EVENTS COME FROM: the engine (engine/crates/fold/src/modules/reincarnation.rs) reads
// the grant lines and publishes `LevelingSnap.reincarnations`. The line shape is ASSUMED — no real
// reincarnation has been logged yet — and anything inferred is labelled so (law 1).
//
// WHY A PERSISTED RECORD. The log can rotate, and a reincarnation done before this app was watching
// is still a reincarnation. So confirmed events are MERGED into `ProgressState.reincarnation` and
// never removed by a re-fold (union by instant), and a player can state a count by hand — the
// correction wins over everything the log says and is labelled user-stated.
//
// HOW A COUNT IS READ. A class or race's count is the larger of (a) how many recorded lives named
// it and (b) the highest rank any grant line printed for it: rank 3 is three reincarnations even if
// this app saw only the third. A 4th+ prints no rank, so only (a) or a user statement can reach it.
//
// Pure, dependency-free (type imports only).

/** Which reincarnation AA a grant names. */
export type ReincarnationComponent = 'class' | 'race' | 'completionist'

/** One reincarnation AA rank, as a grant line printed it. */
export interface ReincarnationGrant {
  component: ReincarnationComponent
  /** The class or race as printed (`Shadow Knight`), `Completionist` for that AA. */
  name: string
  /** The `/who` code, for a class this build knows. */
  code?: string
  rank: number
}

/** One reincarnation, as the engine publishes it. */
export interface ReincarnationEvent {
  /** When the new life began: the first grant line, or the first statement proving it. */
  ts: number
  /** `[lo, hi]` brackets an inferred one; both equal `ts` for a confirmed one. */
  lo: number
  hi: number
  /** `aa` the grant lines; `levelDrop` a cap-to-fresh drop with one trio; `message` an unclaimed line. */
  source: 'aa' | 'levelDrop' | 'message'
  inferred: boolean
  grants: ReincarnationGrant[]
  /** For `levelDrop`: the classes both `/who` rows named. */
  whoClasses?: string[]
  /** The unclaimed line, when one was printed. */
  message?: string
}

/** One confirmed life, as persisted. */
export interface ReincarnationLife {
  ts: number
  grants: ReincarnationGrant[]
}

/** A hand-stated count — wins over the log, labelled user-stated. */
export interface ReincarnationCorrection {
  component: 'class' | 'race'
  name: string
  count: number
  /** When the user said it (`Date.now()` at the click). */
  setAt: number
}

/** `ProgressState.reincarnation`. */
export interface ReincarnationRecord {
  lives: ReincarnationLife[]
  corrections: ReincarnationCorrection[]
}

/** The 16 classes, in the client's AA spelling, with their `/who` codes. */
export const REINCARNATION_CLASSES: readonly { name: string; code: string }[] = [
  { name: 'Warrior', code: 'WAR' }, { name: 'Cleric', code: 'CLR' },
  { name: 'Paladin', code: 'PAL' }, { name: 'Ranger', code: 'RNG' },
  { name: 'Shadow Knight', code: 'SHD' }, { name: 'Druid', code: 'DRU' },
  { name: 'Monk', code: 'MNK' }, { name: 'Bard', code: 'BRD' },
  { name: 'Rogue', code: 'ROG' }, { name: 'Shaman', code: 'SHM' },
  { name: 'Necromancer', code: 'NEC' }, { name: 'Wizard', code: 'WIZ' },
  { name: 'Magician', code: 'MAG' }, { name: 'Enchanter', code: 'ENC' },
  { name: 'Beastlord', code: 'BST' }, { name: 'Berserker', code: 'BER' }
]

/** The 17 races, in the client's AA spelling. */
export const REINCARNATION_RACES: readonly string[] = [
  'Human', 'Barbarian', 'Erudite', 'Wood Elf', 'High Elf', 'Dark Elf', 'Half Elf', 'Dwarf', 'Troll',
  'Ogre', 'Halfling', 'Gnome', 'Iksar', 'Kerran', 'Froglok', 'Drakkin', 'Half Dark Elf'
]

/** The level a loadout must reach before it can reincarnate. */
export const LEVEL_CAP = 50

/** Every reincarnation AA has three ranks. */
export const MAX_AA_RANK = 3

/** Where a count came from. */
export type CountSource = 'log' | 'user'

/** One class or race's reincarnation count. */
export interface ComponentCount {
  component: 'class' | 'race'
  name: string
  code?: string
  count: number
  source: CountSource
  /** The instants of the recorded lives that named it, ascending. */
  timestamps: number[]
}

export const EMPTY_RECORD: ReincarnationRecord = { lives: [], corrections: [] }

/** The canonical spelling of a class or race (case-insensitive; `Shadowknight` → `Shadow Knight`). */
export function canonicalName(component: 'class' | 'race', name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, ' ')
  if (component === 'class') {
    const hit = REINCARNATION_CLASSES.find(
      (c) => c.name.toLowerCase() === key || c.code.toLowerCase() === key || (key === 'shadowknight' && c.code === 'SHD')
    )
    return hit?.name ?? name.trim()
  }
  return REINCARNATION_RACES.find((r) => r.toLowerCase() === key) ?? name.trim()
}

/** The class name for a `/who` code, or null. */
export function classNameOf(code: string): string | null {
  return REINCARNATION_CLASSES.find((c) => c.code === code.toUpperCase())?.name ?? null
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isName(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '' && v.length <= 40
}

/** An integer in [lo, 99]. */
function isCount(v: unknown, lo: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= 99
}

function isComponent(v: unknown): v is ReincarnationComponent {
  return v === 'class' || v === 'race' || v === 'completionist'
}

function sanitizeGrant(v: unknown): ReincarnationGrant | null {
  if (!isObj(v)) return null
  const { component, name, rank, code } = v
  if (!isComponent(component) || !isName(name) || !isCount(rank, 1)) return null
  const g: ReincarnationGrant = { component, name: name.trim(), rank }
  if (typeof code === 'string' && /^[A-Z]{3}$/.test(code)) g.code = code
  return g
}

function sanitizeLife(v: unknown): ReincarnationLife | null {
  if (!isObj(v) || typeof v.ts !== 'number' || !Number.isFinite(v.ts)) return null
  const grants = Array.isArray(v.grants) ? v.grants.map(sanitizeGrant).filter((g) => g !== null) : []
  return { ts: v.ts, grants: grants.slice(0, 8) }
}

function sanitizeCorrection(v: unknown): ReincarnationCorrection | null {
  if (!isObj(v)) return null
  const { component, name, count, setAt } = v
  if (component !== 'class' && component !== 'race') return null
  if (!isName(name) || !isCount(count, 0)) return null
  if (typeof setAt !== 'number' || !Number.isFinite(setAt)) return null
  return { component, name: canonicalName(component, name), count, setAt }
}

/** The stored record, validated both ways (a store file is hand-editable). A fixed point. */
export function sanitizeReincarnationRecord(raw: unknown): ReincarnationRecord {
  if (!isObj(raw)) return { lives: [], corrections: [] }
  const lives = Array.isArray(raw.lives) ? raw.lives.map(sanitizeLife).filter((l) => l !== null) : []
  const corrections = Array.isArray(raw.corrections)
    ? raw.corrections.map(sanitizeCorrection).filter((c) => c !== null)
    : []
  return { lives: mergeLives([], lives).slice(-500), corrections: latestPerName(corrections) }
}

function latestPerName(list: readonly ReincarnationCorrection[]): ReincarnationCorrection[] {
  const by = new Map<string, ReincarnationCorrection>()
  for (const c of list) {
    const k = `${c.component}:${c.name.toLowerCase()}`
    const held = by.get(k)
    if (!held || c.setAt >= held.setAt) by.set(k, c)
  }
  return [...by.values()]
}

/**
 * Confirmed events merged into the held lives: a UNION BY INSTANT, so a re-fold adds nothing twice
 * and a rotated log removes nothing. Inferred events are never persisted — they are a suggestion
 * the player confirms with a correction.
 */
export function mergeLives(
  held: readonly ReincarnationLife[],
  detected: readonly (ReincarnationEvent | ReincarnationLife)[]
): ReincarnationLife[] {
  const byTs = new Map<number, ReincarnationLife>()
  for (const l of held) byTs.set(l.ts, l)
  for (const e of detected) {
    if ('inferred' in e && e.inferred) continue
    const prior = byTs.get(e.ts)
    // The same instant seen again keeps the fuller grant list (a burst read mid-way, then whole).
    if (!prior || e.grants.length > prior.grants.length) byTs.set(e.ts, { ts: e.ts, grants: [...e.grants] })
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts)
}

/** The confirmed events as the lives the recorder hands to main (inferred ones never persist). */
export function confirmedLives(events: readonly ReincarnationEvent[] | undefined): ReincarnationLife[] {
  return (events ?? []).filter((e) => !e.inferred).map((e) => ({ ts: e.ts, grants: e.grants }))
}

/** True when the record would change by merging these events — the recorder's "is it news". */
export function hasNewLives(
  held: readonly ReincarnationLife[],
  detected: readonly (ReincarnationEvent | ReincarnationLife)[]
): boolean {
  const merged = mergeLives(held, detected)
  return merged.length !== held.length || merged.some((l, i) => l.grants.length !== held[i].grants.length)
}

/** State (count) or take back (`count: null`) one class or race's count. */
export function applyCorrection(
  record: ReincarnationRecord,
  stated: { component: 'class' | 'race'; name: string; count: number | null; setAt: number }
): ReincarnationRecord {
  const { component, name, count, setAt } = stated
  const canon = canonicalName(component, name)
  const rest = record.corrections.filter(
    (c) => !(c.component === component && c.name.toLowerCase() === canon.toLowerCase())
  )
  if (count === null) return { ...record, corrections: rest }
  return sanitizeReincarnationRecord({ ...record, corrections: [...rest, { component, name: canon, count, setAt }] })
}

interface Tally {
  component: 'class' | 'race'
  name: string
  lives: number
  rank: number
  timestamps: number[]
}

function tallyLives(lives: readonly ReincarnationLife[]): Map<string, Tally> {
  const out = new Map<string, Tally>()
  for (const life of lives) {
    for (const g of life.grants) {
      if (g.component === 'completionist') continue
      const name = canonicalName(g.component, g.name)
      const key = `${g.component}:${name.toLowerCase()}`
      const t = out.get(key) ?? { component: g.component, name, lives: 0, rank: 0, timestamps: [] }
      if (!t.timestamps.includes(life.ts)) {
        t.lives++
        t.timestamps.push(life.ts)
      }
      t.rank = Math.max(t.rank, g.rank)
      out.set(key, t)
    }
  }
  return out
}

/** Every class and race with a count, the user's statements winning. Sorted classes first. */
export function reincarnationCounts(record: ReincarnationRecord): ComponentCount[] {
  const tallies = tallyLives(record.lives)
  const out = new Map<string, ComponentCount>()
  for (const [key, t] of tallies) {
    out.set(key, { component: t.component, name: t.name, count: Math.max(t.lives, t.rank), source: 'log', timestamps: t.timestamps })
  }
  for (const c of record.corrections) {
    const key = `${c.component}:${c.name.toLowerCase()}`
    out.set(key, { component: c.component, name: c.name, count: c.count, source: 'user', timestamps: out.get(key)?.timestamps ?? [] })
  }
  const rows = [...out.values()].map((r) => {
    const code = r.component === 'class' ? REINCARNATION_CLASSES.find((c) => c.name === r.name)?.code : undefined
    return code ? { ...r, code } : r
  })
  return rows.sort((a, b) => (a.component === b.component ? a.name.localeCompare(b.name) : a.component === 'class' ? -1 : 1))
}

/** A component's count, 0 when it has none. */
export function countOf(counts: readonly ComponentCount[], component: 'class' | 'race', name: string): ComponentCount | null {
  const canon = canonicalName(component, name).toLowerCase()
  return counts.find((c) => c.component === component && c.name.toLowerCase() === canon) ?? null
}

/** The reincarnation AAs held: rank = min(count, 3) per class/race, and Completionist progress. */
export interface ReincarnationAas {
  rows: { component: 'class' | 'race'; name: string; rank: number; count: number; source: CountSource }[]
  /** Completionist rank: the LOWEST class rank over all 16 class AAs. */
  completionist: number
  /** How many of the 16 class AAs already sit above the Completionist rank (toward the next one). */
  classesTowardNext: number
}

export function reincarnationAas(counts: readonly ComponentCount[]): ReincarnationAas {
  const rows = counts
    .filter((c) => c.count > 0)
    .map((c) => ({ component: c.component, name: c.name, rank: Math.min(c.count, MAX_AA_RANK), count: c.count, source: c.source }))
  const classRank = (name: string): number => rows.find((r) => r.component === 'class' && r.name === name)?.rank ?? 0
  const ranks = REINCARNATION_CLASSES.map((c) => classRank(c.name))
  const completionist = Math.min(...ranks)
  return { rows, completionist, classesTowardNext: ranks.filter((r) => r > completionist).length }
}

/**
 * Which life an event begins, when its grants say so: the highest class rank it printed + 1 (rank 2
 * is the loadout's second reincarnation, so its third life). Null when no class rank was printed.
 */
export function lifeOf(event: Pick<ReincarnationEvent, 'grants'>): number | null {
  const ranks = event.grants.filter((g) => g.component === 'class').map((g) => g.rank)
  return ranks.length ? Math.max(...ranks) + 1 : null
}
