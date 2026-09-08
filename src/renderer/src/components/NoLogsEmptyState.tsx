// NoLogsEmptyState — the fresh-machine answer, lifted out of App.tsx (JOS-43).
//
// It moved for the reason appRouting.ts moved: App.tsx is a COMPOSITION (title bar, nav, content,
// toasts, dialogs) sitting on the measured 400-code-line ceiling, and a self-contained leaf
// component with no app state in it is the cheapest thing in that file to stop owning. Behaviour
// is identical — the markup below is the markup that was there.
//
// WHAT IT SAYS AND WHY. No `eqlog_*.txt` was found in the (auto-detected or Settings-overridden)
// EQ folder. Quiet and actionable: it names the two things that fix it — turn logging on in-game,
// or point the app at the install folder — and hands over a button to the place that does the
// second. Showing empty or erroring feature views instead would make a solvable setup problem
// look like a broken app.

import type { JSX } from 'react'
import { Box, Button, Typography } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'
import TravelExploreIcon from '@mui/icons-material/TravelExplore'

export default function NoLogsEmptyState({
  onOpenPreferences
}: {
  onOpenPreferences: () => void
}): JSX.Element {
  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 1.5,
        color: 'text.secondary'
      }}
    >
      <TravelExploreIcon sx={{ fontSize: 48, opacity: 0.6 }} />
      <Typography variant="h6" color="text.primary">
        No EverQuest logs found yet
      </Typography>
      <Typography variant="body2" sx={{ maxWidth: 440 }}>
        We looked for your EverQuest Legends install automatically but didn&apos;t find any
        character logs. Make sure logging is on in-game (type <code>/log on</code>), or point us at
        your install folder.
      </Typography>
      <Button variant="contained" startIcon={<SettingsIcon />} onClick={onOpenPreferences} sx={{ mt: 1 }}>
        Open preferences
      </Button>
    </Box>
  )
}
