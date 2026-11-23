// The Combat tab's panel sizes - the STORAGE half (combatLayout.ts is the vocabulary).
//
// Persisted through `useRawPref`, the same localStorage primitive every combat view pref uses, so
// a size survives the tab switch that unmounts this view (AGENTS.md: a `useState` here would be
// the JOS-90/97/116 bug again) and a restart alike, and every mounted reader hears a write.
//
// A DRAG IS A PREVIEW, A RELEASE IS ONE WRITE. The preview is component state in whichever reader
// owns the handle being dragged, so a drag re-renders that one layout component (whose panels are
// element props, and therefore skip the render) and touches storage exactly once, on release.

import { useCallback, useMemo, useState } from 'react'
import {
  DEFAULT_LAYOUT,
  LAYOUT_KEY,
  isDefaultLayout,
  parseLayout,
  resetSplit,
  serializeLayout,
  withSplit,
  type CombatLayout,
  type SplitKey
} from './combatLayout'
import { useRawPref } from './useCombatPrefs'

export interface CombatLayoutApi {
  /** what to draw: the preview while a handle is held, else the stored layout. */
  layout: CombatLayout
  preview: (k: SplitKey, v: number) => void
  commit: (k: SplitKey, v: number) => void
  /** one split back to its default (a handle's double-click / Enter). */
  reset: (k: SplitKey) => void
  /** every split back to its default - which is an absent key. */
  resetAll: () => void
  isDefault: boolean
}

export function useCombatLayout(): CombatLayoutApi {
  const [raw, setRaw] = useRawPref(LAYOUT_KEY)
  const stored = useMemo(() => parseLayout(raw), [raw])
  const [draft, setDraft] = useState<CombatLayout | null>(null)

  const preview = useCallback(
    (k: SplitKey, v: number) => {
      setDraft((d) => withSplit(d ?? stored, k, v))
    },
    [stored]
  )
  const commit = useCallback(
    (k: SplitKey, v: number) => {
      setDraft(null)
      setRaw(serializeLayout(withSplit(stored, k, v)))
    },
    [stored, setRaw]
  )
  const reset = useCallback(
    (k: SplitKey) => {
      setDraft(null)
      setRaw(serializeLayout(resetSplit(stored, k)))
    },
    [stored, setRaw]
  )
  const resetAll = useCallback(() => {
    setDraft(null)
    setRaw(serializeLayout(DEFAULT_LAYOUT))
  }, [setRaw])

  return { layout: draft ?? stored, preview, commit, reset, resetAll, isDefault: isDefaultLayout(stored) }
}
