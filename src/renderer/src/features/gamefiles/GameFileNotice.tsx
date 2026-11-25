// GameFileNotice — the one quiet line a launch shows when a game patch changed a file this build
// cannot read (src/main/gameFileHealth, shared/gameFileHealth.ts).
//
// Main decides everything: which reader, which sentence, and which keys a close dismisses (one per
// reader, file version and layout, so the NEXT patch earns its own line). This card only states it.
// A Snackbar along the bottom-LEFT edge, because bottom-right is where the patch-notes and celebration
// toasts stack and bottom-centre is the first-run and what's-new strips: it never covers either.
// No auto-hide (a line that vanishes on its own was never shown to anyone who looked away), clickaway
// ignored, never a modal.

import { type JSX, useEffect, useState } from 'react'
import { Alert, Snackbar } from '@mui/material'
import type { GameFileHealthView } from '@shared/gameFileHealth'

function useGameFileHealth(): GameFileHealthView | null {
  const [view, setView] = useState<GameFileHealthView | null>(null)
  useEffect(() => {
    let alive = true
    let pushed = false
    const off = window.eq.onGameFileHealth((v) => {
      pushed = true
      setView(v)
    })
    void window.eq
      .getGameFileHealth()
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

export function GameFileNotice(): JSX.Element | null {
  const notice = useGameFileHealth()?.notice ?? null
  if (notice === null) return null
  const dismiss = (): void => void window.eq.dismissGameFileNotice(notice.dismissKeys)
  const more = notice.more > 0 ? ` (and ${String(notice.more)} more)` : ''
  return (
    <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} data-testid="gamefile-notice">
      <Alert severity="warning" variant="filled" onClose={dismiss} sx={{ alignItems: 'center', maxWidth: 460 }}>
        <span data-testid="gamefile-notice-text">
          {notice.sentence}
          {more}
        </span>
      </Alert>
    </Snackbar>
  )
}
