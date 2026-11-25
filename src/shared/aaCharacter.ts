// aaCharacter.ts — two facts about the character the AA tab needs and the log cannot keep: its RACE
// and its last RESPEC. PURE (the renderer does the localStorage read/write around it), each stored
// per character beside the plan (`eq.aa.race.<name>@<server>`, `eq.aa.respec.<name>@<server>`) and
// read back through a parser that DEGRADES rather than errors (JOS-105).
//
// RACE. The only race-restricted AAs are the 17 `Race Reincarnation: <Race>` rows (granted, never
// bought). No served module publishes the race: the `/who` row prints one, but illusions change it
// (shared/logEvents.ts SelfWhoEvent) and the fold keeps none of it. The one line that states the
// race reliably is the game's own grant, `Race Reincarnation: <Race> N`, printed when a life begins
// — so that is the DETECTED race (the latest grant wins), and the user's pick on the tab wins over
// it. With neither, the race is unknown and every race's row is listed.
//
// RESPEC. A respec prints no refund line (shared/aa.ts), so a refunded rank keeps reading as held.
// The user says when they respecced; from then on a PAID purchase line counts only if it is LATER
// than that instant. A COST-0 line is kept whatever its date: an auto-grant or a reincarnation grant
// costs no points, a respec refunds points, so there is nothing for it to take back — the grant is
// still held after the respec exactly as it was before it. (A reincarnation AFTER the respec is
// later than it anyway, so either reading keeps it; the rule only decides the earlier ones.) The
// respec also clears the user's own "I hold" marks on bought AAs — they describe ranks the respec
// refunded — and remembers them, so Undo puts back exactly what it took. A new respec must be later
// than the one in force and not in the future (`respecRefusal`), so the history is one order and
// Undo always removes the one recorded last; a respec covers lines through the END of the second it
// names (`respecInstant`).

import type { AASpendLike } from './aa'
import { aaKey, type AaCatalogEntry } from './aaCatalog'
import { aaBaseName } from './aaLedger'
import { canonicalName, REINCARNATION_RACES, type ReincarnationLife } from './reincarnation'

type CharacterLike = { name: string; server: string } | null | undefined

function characterKey(prefix: string, character: CharacterLike): string | null {
  if (!character || character.name === '') return null
  return `eq.aa.${prefix}.${character.name.toLowerCase()}@${character.server.toLowerCase()}`
}

// ---- race ---------------------------------------------------------------------------------------

export function aaRaceStorageKey(character: CharacterLike): string | null {
  return characterKey('race', character)
}

const RACE_AA = /^race reincarnation:\s*(.+?)\s*$/i

/** The race a `Race Reincarnation: <Race>` AA belongs to, or null for any other AA. */
export function raceOfAa(name: string): string | null {
  const m = RACE_AA.exec(name.replace(/\s+\d+$/, ''))
  return m ? canonicalName('race', m[1]) : null
}

function knownRace(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const key = v.trim().toLowerCase()
  return REINCARNATION_RACES.find((r) => r.toLowerCase() === key) ?? null
}

/** A stored pick: one of the 17 races, else null (unset). Never throws. */
export function parseStoredRace(raw: string | null): string | null {
  if (raw === null) return null
  try {
    const v = JSON.parse(raw) as { v?: unknown; race?: unknown } | null
    return v !== null && typeof v === 'object' && v.v === 1 ? knownRace(v.race) : null
  } catch {
    return null
  }
}

export function serializeRace(race: string | null): string {
  return JSON.stringify({ v: 1, race })
}

/**
 * The race the log states: the latest `Race Reincarnation: <Race>` grant, read from the purchase
 * lines in this log and from the persisted reincarnation record (which outlives a rotated log).
 */
export function detectedRace(
  spends: readonly AASpendLike[],
  lives: readonly Pick<ReincarnationLife, 'ts' | 'grants'>[] = []
): { race: string; ts: number } | null {
  const seen: { name: string | null; ts: number }[] = spends.map((s) => ({ name: raceOfAa(aaBaseName(s)), ts: s.ts }))
  for (const l of lives) for (const g of l.grants) if (g.component === 'race') seen.push({ name: g.name, ts: l.ts })
  let best: { race: string; ts: number } | null = null
  for (const { name, ts } of seen) {
    const race = knownRace(name)
    if (race !== null && (best === null || ts >= best.ts)) best = { race, ts }
  }
  return best
}

/**
 * Is this AA listed for this race? Non-race AAs always are; with the race unknown every race row
 * is; otherwise only the character's own race row, plus any race row it already holds (a race
 * change after a reincarnation keeps the AA that life granted).
 */
export function raceAllows(entry: AaCatalogEntry, race: string | null, heldRank: number): boolean {
  const own = raceOfAa(entry.name)
  if (own === null || race === null || heldRank > 0) return true
  return own.toLowerCase() === race.toLowerCase()
}

// ---- respec -------------------------------------------------------------------------------------

export function aaRespecStorageKey(character: CharacterLike): string | null {
  return characterKey('respec', character)
}

export interface AaRespec {
  /** the instant the user says the respec happened (epoch ms, the log's clock) */
  at: number
  /** the "I hold" marks the respec cleared, by catalog name — what Undo restores */
  clearedStated: Record<string, number>
}

/** Every respec recorded, oldest first; the last one is in force. Undo pops it. */
export interface AaRespecHistory {
  respecs: AaRespec[]
}

export const EMPTY_RESPECS: AaRespecHistory = { respecs: [] }

function readMarks(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[k] = v
  }
  return out
}

function readRespec(item: unknown): AaRespec | null {
  if (typeof item !== 'object' || item === null) return null
  const { at, clearedStated } = item as { at?: unknown; clearedStated?: unknown }
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null
  return { at, clearedStated: readMarks(clearedStated) }
}

/** A stored history, validated; unreadable entries are dropped, order is by instant. Never throws. */
export function parseStoredRespecs(raw: string | null): AaRespecHistory {
  if (raw === null) return EMPTY_RESPECS
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return EMPTY_RESPECS
  }
  if (typeof v !== 'object' || v === null || (v as { v?: unknown }).v !== 1) return EMPTY_RESPECS
  const list = (v as { respecs?: unknown }).respecs
  if (!Array.isArray(list)) return EMPTY_RESPECS
  const respecs = (list as unknown[]).map(readRespec).filter((r): r is AaRespec => r !== null)
  return { respecs: respecs.sort((a, b) => a.at - b.at) }
}

export function serializeRespecs(h: AaRespecHistory): string {
  return JSON.stringify({ v: 1, respecs: h.respecs })
}

/** The respec in force, or null. */
export function lastRespec(h: AaRespecHistory): AaRespec | null {
  return h.respecs.at(-1) ?? null
}

/** The purchase lines that still describe what is held: paid ones after the respec, free ones always. */
export function spendsSinceRespec<T extends AASpendLike>(spends: readonly T[], respec: AaRespec | null): T[] {
  if (respec === null) return [...spends]
  return spends.filter((s) => s.cost === 0 || s.ts > respec.at)
}

/** Does a mark of `rank` on this AA describe points a respec refunds? Granted and free ranks do not. */
function refundable(entry: AaCatalogEntry | undefined, rank: number): boolean {
  if (!entry) return true
  if (entry.granted !== undefined) return false
  // a rank of unknown cost (null) may have cost points, so it counts as refundable
  return entry.costs.slice(0, rank).some((c) => c !== 0)
}

/**
 * The instant a respec typed as `localMs` (a `datetime-local` value read as local wall-clock ms)
 * covers: THROUGH THE END OF THAT SECOND. Log stamps are whole seconds, so a refunded purchase line
 * printed in the very second the user names is before the respec, never after it.
 */
export function respecInstant(localMs: number): number {
  return Math.floor(localMs / 1000) * 1000 + 999
}

/**
 * Why a respec at `at` cannot be recorded, or null when it can. Two refusals, both about keeping
 * ONE ORDER: a respec in the FUTURE has not happened, and one AT OR BEFORE the respec in force
 * would be a second opinion about the past (it would not be the one in force, so it could clear
 * nothing honestly, and Undo would no longer step back through what was recorded). Recordings are
 * therefore always the latest, and record order IS date order.
 */
export function respecRefusal(h: AaRespecHistory, at: number, now: number): string | null {
  if (!Number.isFinite(at) || at <= 0) return 'Pick a date and time.'
  if (at - 999 > now) return 'That time has not happened yet.'
  const last = lastRespec(h)
  if (last !== null && at <= last.at) return 'Your recorded respec is later than that. Undo it first to record an earlier one.'
  return null
}

/**
 * Record a respec at `at`. Returns the new history and the "I hold" marks that survive it (granted
 * and free ranks); the ones it cleared ride in the record for Undo. A respec at or before the one
 * in force is REFUSED here too (unchanged history and marks) — see `respecRefusal`.
 */
export function recordRespec(
  h: AaRespecHistory,
  at: number,
  stated: Readonly<Record<string, number>>,
  index: ReadonlyMap<string, AaCatalogEntry>
): { history: AaRespecHistory; stated: Record<string, number> } {
  const last = lastRespec(h)
  if (last !== null && at <= last.at) return { history: h, stated: { ...stated } }
  const kept: Record<string, number> = {}
  const cleared: Record<string, number> = {}
  for (const [name, rank] of Object.entries(stated)) {
    if (refundable(index.get(aaKey(name)), rank)) cleared[name] = rank
    else kept[name] = rank
  }
  return { history: { respecs: [...h.respecs, { at, clearedStated: cleared }] }, stated: kept }
}

/** Undo the respec in force: drop it and hand back the marks it cleared (current marks win). */
export function undoRespec(
  h: AaRespecHistory,
  stated: Readonly<Record<string, number>>
): { history: AaRespecHistory; stated: Record<string, number> } {
  const last = lastRespec(h)
  if (last === null) return { history: h, stated: { ...stated } }
  return { history: { respecs: h.respecs.slice(0, -1) }, stated: { ...last.clearedStated, ...stated } }
}
