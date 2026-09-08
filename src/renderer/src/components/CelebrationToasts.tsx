// components/CelebrationToasts.tsx — the two app-wide celebration snackbars.
//
// MOVED OUT OF App.tsx VERBATIM (JOS-284), for the reason App.tsx already states about
// `BottomStrips`: the app shell sits at the measured 400-line factoring ceiling, and this is a
// self-contained pair of snackbars that shares nothing with the shell but the two pieces of state
// that open them. No behaviour changed in the move — same markup, same anchors, same durations.
//
// They live at APP level rather than inside the tabs that detect them because they fire on ANY
// tab: `useAppCelebrations` holds the single always-mounted detector for each (a boss kill
// credited to you, a Sky turn-in that completes a quest), and these are its on-screen half.

import type { JSX } from 'react'
import { Alert, Snackbar } from '@mui/material'
import ShieldMoonIcon from '@mui/icons-material/ShieldMoon'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import type { TargetStatus } from '../features/bosses/bossStatus'

export default function CelebrationToasts({
  defeatToast,
  questToast,
  onDismissDefeat,
  onDismissQuest
}: {
  defeatToast: TargetStatus | null
  questToast: string | null
  onDismissDefeat: () => void
  onDismissQuest: () => void
}): JSX.Element {
  return (
    <>
      <Snackbar
        open={!!defeatToast}
        autoHideDuration={6000}
        onClose={onDismissDefeat}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity="success"
          variant="filled"
          icon={<EmojiEventsIcon fontSize="inherit" />}
          onClose={onDismissDefeat}
          sx={{ alignItems: 'center' }}
        >
          Raid target defeated: {defeatToast?.target.name}!
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!questToast}
        autoHideDuration={6000}
        onClose={onDismissQuest}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity="success"
          variant="filled"
          icon={<ShieldMoonIcon fontSize="inherit" />}
          onClose={onDismissQuest}
          sx={{ alignItems: 'center' }}
        >
          Quest complete: {questToast}
        </Alert>
      </Snackbar>
    </>
  )
}
