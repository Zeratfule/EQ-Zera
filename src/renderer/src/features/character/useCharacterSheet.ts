// character/useCharacterSheet — the sheet's transport, and nothing else.
//
// Same contract as `usePlannerInventory` (features/planner/plannerInventory.ts), for the same
// reason: the dump is a file the player rewrites mid-session on purpose, so nothing is cached
// and the hook re-asks main whenever `inventory:autoReloaded` fires. Type `/outputfile
// inventory` in game with this tab open and the sheet fills itself, no click anywhere.
//
// `ready` is a data-availability flag, not an error. A REJECT resolves to the same "no sheet"
// state as a null answer, and that branch OUTLIVED THE REASON IT WAS WRITTEN. It existed because
// the handler behind `character:sheet` was gated (src/main/unreleased.ts) and simply absent from a
// packaged build; JOS-327 released the tab and the handler is registered everywhere now. The catch
// stays anyway: an invoke can fail for reasons nobody planned, and a transport whose designed
// answer for "no dump" is already `null` has no business turning any of them into a red box.

import { useCallback, useEffect, useState } from 'react'
import type { CharacterSheet } from '@shared/characterSheet'

export interface CharacterSheetState {
  /** the joined sheet, or null when this character has never written a dump */
  sheet: CharacterSheet | null
  /** false until the first read settles */
  ready: boolean
}

export function useCharacterSheet(): CharacterSheetState {
  const [state, setState] = useState<CharacterSheetState>({ sheet: null, ready: false })

  const read = useCallback((alive: () => boolean) => {
    void window.eq
      .characterSheet()
      .then((sheet) => {
        if (alive()) setState({ sheet, ready: true })
      })
      .catch(() => {
        if (alive()) setState({ sheet: null, ready: true })
      })
  }, [])

  useEffect(() => {
    let alive = true
    const live = (): boolean => alive
    read(live)
    // The push carries path + mtime and we deliberately ignore both: main is the only thing
    // that knows which dump belongs to the active character, so the answer is re-asked.
    const off = window.eq.onInventoryReload(() => read(live))
    return () => {
      alive = false
      off()
    }
  }, [read])

  return state
}
