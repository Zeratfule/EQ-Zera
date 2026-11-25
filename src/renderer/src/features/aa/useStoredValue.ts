// useStoredValue — one per-character renderer pref (the AA plan, race, respec history): re-read when
// the key changes, written on every edit. The parse/serialize pair is pure and node-tested in
// src/shared; a value that cannot be read or written degrades to the parser's empty answer.

import { useCallback, useState } from 'react'

export interface StoredCodec<T> {
  parse: (raw: string | null) => T
  serialize: (v: T) => string
}

function load<T>(key: string | null, codec: StoredCodec<T>): T {
  if (key === null) return codec.parse(null)
  try {
    return codec.parse(localStorage.getItem(key))
  } catch {
    return codec.parse(null)
  }
}

function save<T>(key: string | null, codec: StoredCodec<T>, v: T): void {
  if (key === null) return
  try {
    localStorage.setItem(key, codec.serialize(v))
  } catch {
    // A value that cannot be written is a value that is not remembered, never an error.
  }
}

export function useStoredValue<T>(key: string | null, codec: StoredCodec<T>): [T, (fn: (v: T) => T) => void] {
  const [state, setState] = useState(() => ({ key, value: load(key, codec) }))
  // Adjusting state while rendering (React's documented pattern) rather than in an effect: the
  // character module can answer after mount, and an effect would draw one frame of the old value.
  let current = state
  if (state.key !== key) {
    current = { key, value: load(key, codec) }
    setState(current)
  }
  const update = useCallback(
    (fn: (v: T) => T) => {
      setState((prev) => {
        const value = fn(prev.value)
        save(prev.key, codec, value)
        return { key: prev.key, value }
      })
    },
    [codec]
  )
  return [current.value, update]
}
