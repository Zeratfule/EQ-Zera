// storeGameFileHealth.ts — the persisted half of the game-file health check, through the
// `settingsStore` door like storeLuclin.ts. Two capped lists of short keys: the notices a player
// closed and the layouts already reported. A malformed store reads as empty, never as an error.

import { settingsStore } from './store'

/** Plenty for years of patches; the oldest key falls off first. */
const MAX_KEYS = 64
const KEY_RE = /^[A-Za-z0-9:_.-]{1,96}$/

type ListName = 'dismissed' | 'reported'

function lists(): { dismissed: string[]; reported: string[] } {
  const raw: unknown = settingsStore.get('gameFileHealth')
  const read = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)).slice(-MAX_KEYS) : []
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return { dismissed: read(o.dismissed), reported: read(o.reported) }
}

export function gameFileKeys(list: ListName): string[] {
  return lists()[list]
}

/** Add keys to one list (deduplicated, capped). Keys that are not key-shaped are dropped. */
export function addGameFileKeys(list: ListName, keys: readonly string[]): void {
  const now = lists()
  const merged = [...now[list].filter((k) => !keys.includes(k)), ...keys.filter((k) => KEY_RE.test(k))]
  settingsStore.set('gameFileHealth', { ...now, [list]: merged.slice(-MAX_KEYS) })
}
