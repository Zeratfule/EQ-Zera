// GameFileNotice — the one quiet line a launch shows when a game patch changed a file this build
// cannot read (src/main/gameFileHealth, shared/gameFileHealth.ts).
//
// Main decides everything: which reader, which sentence, and which keys a close dismisses (one per
// reader, file version and layout, so the NEXT patch earns its own line). This card only states it.
// WHERE IT SITS, AND WHY. The bottom edge is taken: bottom-right is the patch-notes, log-switch and
// celebration toasts (bottom 24, up to two lines), and bottom-centre is the first-run and what's-new
// strips, which span the window (left/right 16, bottom 16). So this line sits at the LEFT of the
// content column, past the permanent nav rail (`DRAWER_WIDTH`, never covered), and ABOVE that band
// (`BAND_CLEARANCE`), which is what keeps it off every one of them at any window width rather than
// only at wide ones.
// No auto-hide (a line that vanishes on its own was never shown to anyone who looked away),
// clickaway ignored, never a modal.

import { type JSX, useEffect, useState } from 'react'
import { Alert, Snackbar } from '@mui/material'
import type { GameFileHealthView } from '@shared/gameFileHealth'
import { DRAWER_WIDTH } from '../../components/NavDrawer'

/** The content column's left edge plus the app's usual 16px gutter. */
const GUTTER_LEFT = DRAWER_WIDTH + 16
/** Above the bottom band: a two-line toast at bottom 24 tops out near 94px. */
const BAND_CLEARANCE = 104

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
    <Snackbar
      open
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      // Stated PER BREAKPOINT, and that is load-bearing: MUI's own anchor rules sit in a
      // `(min-width: 600px)` block that is emitted after a plain sx value and beats it (measured:
      // a flat `left` here was ignored and the line sat on the rail at left 24).
      sx={{
        left: { xs: GUTTER_LEFT, sm: GUTTER_LEFT },
        right: { xs: 'auto', sm: 'auto' },
        bottom: { xs: BAND_CLEARANCE, sm: BAND_CLEARANCE }
      }}
      data-testid="gamefile-notice"
    >
      <Alert severity="warning" variant="filled" onClose={dismiss} sx={{ alignItems: 'center', maxWidth: 460 }}>
        <span data-testid="gamefile-notice-text">
          {notice.sentence}
          {more}
        </span>
      </Alert>
    </Snackbar>
  )
}
