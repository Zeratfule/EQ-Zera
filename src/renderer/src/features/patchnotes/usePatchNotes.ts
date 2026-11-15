// usePatchNotes — the EverQuest Legends patch notes view, as main holds it, kept current by push.
//
// The tab, the nav badge, the launch notice and the Preferences switch each call this; every one
// is a read of the same main-side state (src/main/patchNotes), so four subscriptions cannot
// disagree. Null until the first answer lands.

import { useEffect, useState } from 'react'
import type { PatchNotesView } from '@shared/patchNotes'

export function usePatchNotes(): PatchNotesView | null {
  const [view, setView] = useState<PatchNotesView | null>(null)
  useEffect(() => {
    let alive = true
    let pushed = false
    const off = window.eq.onPatchNotes((v) => {
      pushed = true
      setView(v)
    })
    void window.eq
      .getPatchNotes()
      .then((v) => {
        // A push that landed first is newer than this answer.
        if (alive && !pushed) setView(v)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      off()
    }
  }, [])
  return view
}

const SELECTED_KEY = 'eq.patchnotes.selected'

/** The note the tab last showed. A renderer pref, because the tab unmounts on every switch. */
export function loadSelectedNote(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

export function rememberSelectedNote(pageName: string): void {
  try {
    localStorage.setItem(SELECTED_KEY, pageName)
  } catch {
    // A pref that cannot be stored is a pref that defaults next time.
  }
}
