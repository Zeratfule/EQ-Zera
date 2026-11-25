// AaCharacterBar — the two character facts the AAs tab asks the user for: the RACE (which race's
// reincarnation AA is listed; defaults to the one the log's grant line states) and the last RESPEC
// (paid purchase lines before it stop counting as held). Rules: shared/aaCharacter.ts.

import { type JSX, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import { REINCARNATION_RACES } from '../../../../shared/reincarnation'
import { formatDateTime } from '../../lib/formatDate'
import type { AaPlannerInputs } from './useAaPlanner'

const AUTO = '__auto__'

function RacePicker({ p }: { p: AaPlannerInputs }): JSX.Element {
  const autoLabel = p.detected !== null ? `${p.detected} (from your reincarnation)` : 'Not set'
  return (
    <TextField
      select
      size="small"
      label="Race"
      value={p.pickedRace ?? AUTO}
      onChange={(e) => p.setRace(e.target.value === AUTO ? null : e.target.value)}
      sx={{ minWidth: 200 }}
      slotProps={{ select: { native: true }, htmlInput: { 'data-testid': 'aa-planner-race' }, inputLabel: { shrink: true } }}
    >
      <option value={AUTO}>{autoLabel}</option>
      {REINCARNATION_RACES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </TextField>
  )
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** A local wall-clock instant as a `datetime-local` value (minutes). */
function toLocalInput(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function RespecDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (at: number) => void }): JSX.Element {
  const [when, setWhen] = useState(() => toLocalInput(Date.now()))
  const at = new Date(when).getTime()
  const valid = Number.isFinite(at) && at > 0
  return (
    <Dialog open={open} onClose={onClose} data-testid="aa-planner-respec-dialog">
      <DialogTitle>Record a respec</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          <Typography variant="body2">
            Ranks you bought before this time stop counting as held, and your own "I hold" marks on bought AAs are cleared. Granted ranks stay. You can undo this.
          </Typography>
          <TextField
            type="datetime-local"
            size="small"
            label="When you respecced"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            slotProps={{ htmlInput: { 'data-testid': 'aa-planner-respec-when' }, inputLabel: { shrink: true } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} data-testid="aa-planner-respec-cancel">
          Cancel
        </Button>
        <Button variant="contained" disabled={!valid} onClick={() => onConfirm(at)} data-testid="aa-planner-respec-confirm">
          I respecced
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function RespecControl({ p }: { p: AaPlannerInputs }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      {p.respec !== null && (
        <>
          <Typography variant="caption" color="text.secondary" data-testid="aa-planner-respec-date" data-at={p.respec.at}>
            Respecced {formatDateTime(p.respec.at)}
          </Typography>
          <Button size="small" onClick={p.onUndoRespec} data-testid="aa-planner-respec-undo">
            Undo
          </Button>
        </>
      )}
      <Button size="small" variant="outlined" onClick={() => setOpen(true)} data-testid="aa-planner-respec">
        I respecced
      </Button>
      {open && (
        <RespecDialog
          open
          onClose={() => setOpen(false)}
          onConfirm={(at) => {
            setOpen(false)
            p.onRespec(at)
          }}
        />
      )}
    </Stack>
  )
}

export default function AaCharacterBar({ p }: { p: AaPlannerInputs }): JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }} data-testid="aa-planner-facts">
      <RacePicker p={p} />
      <RespecControl p={p} />
    </Stack>
  )
}
