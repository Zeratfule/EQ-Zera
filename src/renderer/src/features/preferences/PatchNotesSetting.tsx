// PatchNotesSetting — Preferences -> Patch notes: the one switch that lets a user turn off the
// launch request to www.everquestlegends.com. ON by default.
//
// Its own file and its own section descriptor, the ThanksSetting arrangement: PreferencesView.tsx
// is at the 400-code-line ceiling. The state is main's (src/main/storePatchNotes.ts), read through
// the same view the Patch Notes tab draws, and the switch renders main's answer.

import type { JSX } from 'react'
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import NewReleasesOutlinedIcon from '@mui/icons-material/NewReleasesOutlined'
import type { PrefSection } from './PreferencesView'
import { usePatchNotes } from '../patchnotes/usePatchNotes'

const ON = 'Each launch, the app downloads the patch notes list from www.everquestlegends.com, plus any notes it has not saved yet. Nothing about you or your game is sent.'
const OFF = 'Off. The app never contacts everquestlegends.com by itself. Check now on the Patch Notes tab still works.'

export function PatchNotesSetting(): JSX.Element {
  const view = usePatchNotes()
  const enabled = view?.enabled ?? true
  return (
    <Stack spacing={0.5} data-testid="pref-patch-notes">
      <FormControlLabel
        control={
          <Switch
            size="small"
            data-testid="pref-patch-notes-launch"
            checked={enabled}
            disabled={view === null}
            onChange={(e) => void window.eq.setPatchNotesEnabled(e.target.checked)}
          />
        }
        label={<Typography variant="body2">Check for EverQuest Legends patch notes on launch</Typography>}
      />
      <Typography variant="caption" color="text.secondary">
        {enabled ? ON : OFF}
      </Typography>
    </Stack>
  )
}

export function patchNotesSection(): PrefSection {
  return {
    id: 'patchnotes',
    label: 'Patch notes',
    icon: <NewReleasesOutlinedIcon fontSize="small" />,
    items: [
      {
        id: 'patch-notes-launch',
        label: 'EverQuest Legends patch notes',
        keywords: 'patch notes hotfix developer devs everquestlegends news update launch check download network internet offline',
        content: <PatchNotesSetting />
      }
    ]
  }
}
