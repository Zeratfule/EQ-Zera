// useQuestToastPrefs — the STORAGE half of the quest-item pop-up's three preferences (ROADMAP §1).
//
// The `useCombatPrefs.ts` idiom, verbatim and for the same two reasons:
//
//   * A same-document `localStorage.setItem` fires NO 'storage' event, so the Preferences card and
//     anything else mounted beside it would go stale on a write. The module-level listener set
//     below closes that: one write notifies every reader in this window.
//   * The 'storage' event covers the OTHER direction — every window of this app is one origin, so a
//     second renderer entry reading these same keys stays current with no IPC of its own.
//
// THE SNAPSHOT IS CACHED ON THE THREE RAW STRINGS, and that is not an optimisation: `useSyncExternalStore`
// compares snapshots by identity, so building a fresh `QuestToastPrefs` object per call would report
// a change on every render and loop forever. The cache is module-level because the store is.

import { useCallback, useSyncExternalStore } from 'react'
import {
  DEFAULT_QUEST_TOAST_PREFS,
  QUEST_TOAST_KEYS,
  readQuestToastPrefs,
  type QuestToastPrefs
} from './questToastPrefs'

const listeners = new Set<() => void>()

function notifyAll(): void {
  for (const l of [...listeners]) l()
}

/**
 * One 'storage' listener for the whole module, attached while anything is subscribed. That event
 * fires ONLY for writes made in ANOTHER document of this origin (the spec excludes the writer),
 * which is exactly the cross-window half.
 */
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (listeners.size === 1) window.addEventListener('storage', notifyAll)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) window.removeEventListener('storage', notifyAll)
  }
}

/** `localStorage.getItem` that can never throw — the degrade rule starts at the read. */
function item(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** The three raw strings as ONE comparable token — `JSON.stringify` so a stored value that
 *  happens to contain the separator cannot forge a cache hit. */
let cachedKey = ''
let cached: QuestToastPrefs = DEFAULT_QUEST_TOAST_PREFS

/** The parsed prefs, the SAME object until one of the three stored strings actually moves. */
function getSnapshot(): QuestToastPrefs {
  const byKey = new Map<string, string | null>([
    [QUEST_TOAST_KEYS.enabled, item(QUEST_TOAST_KEYS.enabled)],
    [QUEST_TOAST_KEYS.myClasses, item(QUEST_TOAST_KEYS.myClasses)],
    [QUEST_TOAST_KEYS.repeatMin, item(QUEST_TOAST_KEYS.repeatMin)]
  ])
  const key = JSON.stringify([...byKey.values()])
  if (key === cachedKey) return cached
  cached = readQuestToastPrefs((k) => byKey.get(k) ?? null)
  cachedKey = key
  return cached
}

/** Write the keys a patch names, then notify this document (the other windows get 'storage'). */
function writePatch(patch: Partial<QuestToastPrefs>): void {
  try {
    if (patch.enabled !== undefined) localStorage.setItem(QUEST_TOAST_KEYS.enabled, patch.enabled ? '1' : '0')
    if (patch.myClasses !== undefined) localStorage.setItem(QUEST_TOAST_KEYS.myClasses, patch.myClasses ? '1' : '0')
    if (patch.repeatMin !== undefined) localStorage.setItem(QUEST_TOAST_KEYS.repeatMin, String(patch.repeatMin))
  } catch {
    // A store that refuses writes is a preference that does not persist, not a crash. The reader
    // above degrades to the defaults either way.
  }
  notifyAll()
}

/**
 * The quest-item pop-up's three preferences, live across every mounted reader in this window and
 * every other window of this origin. The setter takes a PATCH so a card can move one switch
 * without restating the other two.
 */
export function useQuestToastPrefs(): [QuestToastPrefs, (patch: Partial<QuestToastPrefs>) => void] {
  const value = useSyncExternalStore<QuestToastPrefs>(subscribe, getSnapshot, () => DEFAULT_QUEST_TOAST_PREFS)
  const set = useCallback((patch: Partial<QuestToastPrefs>) => {
    writePatch(patch)
  }, [])
  return [value, set]
}
