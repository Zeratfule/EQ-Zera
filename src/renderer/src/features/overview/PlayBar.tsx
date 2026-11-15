// PlayBar - "Play EverQuest Legends", at the top of the Overview.
//
// With Luclin models switched on (Preferences -> Game) Play re-applies the chosen races if the
// launcher put them back and starts `eqgame.exe patchme`; with them off it starts the normal
// launcher. Either way main does the work (src/main/luclin/service.ts); this bar draws the answer.

import type { JSX } from 'react'
import { Button, Chip, Paper, Stack, Typography } from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { useLuclin } from '../preferences/useLuclin'
import { LuclinRiskDialog } from '../preferences/LuclinRiskDialog'

export function PlayBar(): JSX.Element {
  const state = useLuclin()
  const { prefs, status, busy, message } = state
  const running = status?.eqRunning ?? false
  return (
    <Paper variant="outlined" data-testid="overview-play-bar" sx={{ px: 1.5, py: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
        <Button
          variant="contained"
          startIcon={<PlayArrowIcon />}
          data-testid="overview-play"
          disabled={busy || running}
          onClick={state.play}
        >
          {running ? 'EverQuest is running' : 'Play EverQuest Legends'}
        </Button>
        {prefs.enabled && (
          <Chip size="small" label="Luclin models" data-testid="overview-play-luclin" />
        )}
        <Button size="small" data-testid="overview-patch" disabled={busy} onClick={state.openLauncher}>
          Patch with the launcher
        </Button>
        {prefs.enabled && (
          <Typography variant="caption" color="text.secondary">
            EQ Zera re-applies the models on your next Play.
          </Typography>
        )}
      </Stack>
      {message && (
        <Typography
          variant="caption"
          component="div"
          color={message.bad ? 'error' : 'text.secondary'}
          data-testid="overview-play-message"
          sx={{ mt: 0.5 }}
        >
          {message.text}
        </Typography>
      )}
      <LuclinRiskDialog state={state} />
    </Paper>
  )
}
