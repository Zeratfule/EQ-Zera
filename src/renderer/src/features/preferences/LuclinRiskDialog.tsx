// LuclinRiskDialog - the one-time notice before the first apply or Luclin launch (owner ruling).
// In-page, never window.confirm; Accept is remembered in the store by useLuclin.

import type { JSX } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { GAME_FILE_DISCLAIMER, GAME_FILE_DISCLAIMER_TITLE } from '@shared/gameModsDisclaimer'
import type { LuclinState } from './useLuclin'

export function LuclinRiskDialog({ state }: { state: LuclinState }): JSX.Element {
  return (
    <Dialog open={state.confirming} onClose={state.cancel} data-testid="luclin-risk-dialog">
      <DialogTitle>{GAME_FILE_DISCLAIMER_TITLE}</DialogTitle>
      <DialogContent>
        <Typography variant="body2">{GAME_FILE_DISCLAIMER}</Typography>
      </DialogContent>
      <DialogActions>
        <Button data-testid="luclin-risk-cancel" onClick={state.cancel}>
          Cancel
        </Button>
        <Button variant="contained" data-testid="luclin-risk-accept" onClick={state.accept}>
          I accept
        </Button>
      </DialogActions>
    </Dialog>
  )
}
