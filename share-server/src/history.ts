// history.ts — how the character CHANGED, kept beside the share it belongs to.
//
// A share link is re-published under the SAME id (PUT /api/v1/shares/:id) every time the sharer
// re-shares that character, and until now the state it replaced was simply gone. That is the one
// thing a reader of a share page actually asks that the page could not answer: "what did they
// change?" So every PUT pushes the state it is REPLACING onto `hist:<id>` — a JSON array, newest
// first, capped at `HISTORY_CAP` — and the page renders the difference between each stored state
// and the one after it.
//
// A SNAPSHOT IS NOT A PROFILE. It is the handful of facts a difference can be stated in: the
// moment that state was written, the AC total, the four scores, the level, the classes, and each
// worn slot's verbatim item name. No stat blocks, no effects, no card. Thirty full profiles under
// one key would be a megabyte of KV nobody reads; thirty of these are a few kilobytes, and
// everything the History panel says is derivable from them.
//
// THE CLOCK IS THE SHARE'S. The key carries the same 180-day TTL as the record and the card and
// is rewritten by the same `touch` (store.ts), so a share's three keys always expire together —
// a history that outlived its share would be a row nobody can reach, and one that died first
// would empty the panel while the page still served.
//
// AND IT IS READ BACK THROUGH A SANITIZER. KV is a place, not a type (store.ts says the same).
// Every string on this path reaches a rendered page, so what comes out of the namespace is
// rebuilt field by field and clamped, exactly as the envelope is.

import type { CharacterProfileShare, ShareCell, ShareScores } from '../../src/shared/characterShare'
import { SHARE_LIMITS } from '../../src/shared/shareSchema'
import { HISTORY_CAP, KEY_HISTORY, SHARE_TTL_SECONDS, type Env } from './env'

/** One worn slot, as a past state remembers it. `item` is the Name column verbatim, ` +N` and all. */
export interface HistoryItem {
  slot: string
  item: string
  /** the ` +N` the name stated; carried for the app's use, the page reads the verbatim name */
  tier?: number
}

/** One past state of a share, small enough that thirty of them are still a small row. */
export interface Snapshot {
  /** ISO-8601 of the write this state was published by */
  at: string
  ac: number
  scores?: ShareScores
  level?: number
  classes: string[]
  items: HistoryItem[]
}

/** An ISO-8601 instant is 24 characters; the clamp is a bound on a string, not a date parser. */
const MAX_AT_CHARS = 40

function itemOf(cell: ShareCell): HistoryItem {
  return {
    slot: cell.slot,
    item: cell.item,
    ...(cell.tier === undefined ? {} : { tier: cell.tier })
  }
}

/**
 * The sanitized profile, reduced to what a difference can be stated in.
 *
 * `at` is passed in rather than read from the profile: the profile's own `capturedAt` is when the
 * APP built the body, and the history is about when this service PUBLISHED it — for the state a
 * PUT replaces that is the record's `updatedAt`, which is the moment the page had been showing it
 * from.
 */
export function snapshotOf(profile: CharacterProfileShare, at: number): Snapshot {
  return {
    at: new Date(at).toISOString(),
    ac: profile.totals.ac,
    ...(profile.scores ? { scores: { ...profile.scores } } : {}),
    ...(profile.level === undefined ? {} : { level: profile.level }),
    classes: [...profile.classes],
    items: profile.cells.map(itemOf)
  }
}

/** Untrusted → a finite integer, or null. Every number on this path was a JSON value once. */
function intOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null
}

function scoresFrom(raw: unknown): ShareScores | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const parts = [intOf(r.tank), intOf(r.dps), intOf(r.heal), intOf(r.solo)]
  if (parts.some((n) => n === null)) return undefined
  const [tank, dps, heal, solo] = parts as [number, number, number, number]
  return { tank, dps, heal, solo }
}

function itemsFrom(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return []
  const out: HistoryItem[] = []
  for (const one of raw) {
    if (out.length >= SHARE_LIMITS.maxCharacterCells) break
    if (!one || typeof one !== 'object') continue
    const r = one as Record<string, unknown>
    if (typeof r.slot !== 'string' || typeof r.item !== 'string') continue
    const tier = intOf(r.tier)
    out.push({
      slot: r.slot.slice(0, SHARE_LIMITS.maxNameChars),
      item: r.item.slice(0, SHARE_LIMITS.maxNameChars),
      ...(tier === null ? {} : { tier })
    })
  }
  return out
}

function classesFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is string => typeof c === 'string')
    .slice(0, SHARE_LIMITS.maxCharacterClasses)
    .map((c) => c.slice(0, SHARE_LIMITS.maxNameChars))
}

/** One stored entry, rebuilt, or null when it is not a snapshot at all. */
function snapshotFrom(raw: unknown): Snapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const ac = intOf(r.ac)
  if (typeof r.at !== 'string' || ac === null) return null
  const scores = scoresFrom(r.scores)
  const level = intOf(r.level)
  return {
    at: r.at.slice(0, MAX_AT_CHARS),
    ac,
    ...(scores ? { scores } : {}),
    ...(level === null ? {} : { level }),
    classes: classesFrom(r.classes),
    items: itemsFrom(r.items)
  }
}

/** The stored list, newest first, rebuilt and capped. An absent or unreadable key is no history. */
export async function readHistory(env: Env, id: string): Promise<Snapshot[]> {
  const raw = await env.SHARES.get(KEY_HISTORY(id), 'json')
  if (!Array.isArray(raw)) return []
  const out: Snapshot[] = []
  for (const one of raw.slice(0, HISTORY_CAP)) {
    const snapshot = snapshotFrom(one)
    if (snapshot) out.push(snapshot)
  }
  return out
}

async function writeHistory(env: Env, id: string, list: readonly Snapshot[]): Promise<void> {
  await env.SHARES.put(KEY_HISTORY(id), JSON.stringify(list), {
    expirationTtl: SHARE_TTL_SECONDS
  })
}

/**
 * Push the state a re-publish is replacing onto the front of the list, dropping the oldest past
 * the cap. Called ONLY from a PUT: a create has nothing to remember, and writing an empty array
 * on every POST would be a KV row per share that almost none of them ever need.
 */
export async function pushHistory(env: Env, id: string, snapshot: Snapshot): Promise<void> {
  const list = await readHistory(env, id)
  await writeHistory(env, id, [snapshot, ...list].slice(0, HISTORY_CAP))
}

/**
 * A view's effect on this key: the same bytes, a fresh TTL, so the history cannot age out from
 * under a share that is still being read. Nothing is written when there is no history yet, which
 * is why a share that has never been re-published still costs exactly two writes per refresh.
 */
export async function touchHistory(env: Env, id: string): Promise<void> {
  const raw = await env.SHARES.get(KEY_HISTORY(id), 'text')
  if (raw === null) return
  await env.SHARES.put(KEY_HISTORY(id), raw, { expirationTtl: SHARE_TTL_SECONDS })
}
