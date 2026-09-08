import { useCallback, useMemo, useSyncExternalStore } from 'react'

// A small localStorage-backed store of favorited item names (lowercased), shared
// across every list so a star toggled in one view updates everywhere at once.

const KEY = 'eq.favorites'

function load(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    const list: unknown[] = Array.isArray(raw) ? raw : []
    return new Set(list.map((s) => String(s).toLowerCase()))
  } catch {
    return new Set()
  }
}

let favorites: Set<string> = load()
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function snapshot(): Set<string> {
  return favorites
}

export function toggleFavorite(name: string): void {
  const key = name.toLowerCase()
  const next = new Set(favorites)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  favorites = next
  localStorage.setItem(KEY, JSON.stringify([...favorites]))
  emit()
}

export interface UseFavorites {
  favorites: Set<string>
  isFavorite: (name: string) => boolean
  toggle: (name: string) => void
}

/**
 * IDENTITY IS PART OF THE CONTRACT (JOS-206). This hook used to hand back a fresh `isFavorite`
 * closure and a fresh result object on EVERY render, and that is not a cosmetic detail: the Sky
 * tab passes `isFavorite` down to one component per quest, so a fresh closure per keystroke is a
 * changed prop on every row, which defeats any `React.memo` on the row and makes every character
 * typed into the search box a full re-render of every mounted accordion (measured: 82 ms per
 * keystroke at the default page cap, 179 ms with "show all"). The store already only changes when
 * a star is toggled — `favs` is a new Set exactly then — so the closure and the object can be
 * pinned to it and nothing else. Same values, same behaviour, a reference a memo can trust.
 */
export function useFavorites(): UseFavorites {
  const favs = useSyncExternalStore(subscribe, snapshot)
  const isFavorite = useCallback((name: string) => favs.has(name.toLowerCase()), [favs])
  return useMemo(
    () => ({ favorites: favs, isFavorite, toggle: toggleFavorite }),
    [favs, isFavorite]
  )
}
