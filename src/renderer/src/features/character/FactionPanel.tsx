// character/FactionPanel — WHO YOU HAVE MADE ANGRY, and how angry, as far as this log watched.
//
// EverQuest tells you that a standing moved and never tells you where it moved TO. So this panel
// reports the one thing the log actually states: the SUM OF THE MOVES THIS FOLD WATCHED, per
// faction, with the count of lines behind it. The column is headed "Change" and never
// "standing", and the panel says that once in its own subtitle rather than footnoting every row
// (the tooltip-diet rule). Everything it prints is decided by `factionRows.ts`, which is pure and
// node-tested.
//
// THE SATURATION LINES ARE CHIPS, NOT NUMBERS. `could not possibly get any worse.` says the
// standing DID NOT MOVE, because it is already at the rail — counted, never summed, and never
// drawn as a zero (factionTypes.ts's law). `at min` / `at max` with their counts is what a rail
// looks like on a screen.
//
// A ROW EXPANDS TO ITS OWN RECENT LINES and links nowhere. The committed quest catalog carries no
// faction field, so a "quests that move this faction" affordance would be this panel inventing a
// join the data cannot support (law 1). What it CAN show is what the log said, when — so that is
// what a click opens.
//
// FIXED HEIGHT IS A CONTRACT (AGENTS.md): the list grows with play, so it lives in an explicit-height
// scroll box of its own and the panel is the same size on a fresh character and a five-year one.

import { type JSX, useDeferredValue, useMemo, useState } from 'react'
import { Box, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import type { FactionSnap } from '@shared/types'
import { useModule } from '../../lib/useModule'
import { formatDate } from '../../lib/formatDate'
import { normalizeQuery } from '../../lib/search'
import { factionRecent, factionRows, type FactionPanelRow } from './factionRows'

/** The list's scroll box. Explicit, and the panel's whole size contract. */
const LIST_HEIGHT = 240

/** The rails a faction can be against, as chips. Absent counts draw nothing at all. */
function RailChips({ row }: { row: FactionPanelRow }): JSX.Element | null {
  if (row.maxed === 0 && row.bottomed === 0) return null
  return (
    <>
      {row.maxed > 0 && (
        <Chip size="small" variant="outlined" color="success" label={`at max ${String(row.maxed)}`} sx={{ height: 18 }} />
      )}
      {row.bottomed > 0 && (
        <Chip size="small" variant="outlined" color="warning" label={`at min ${String(row.bottomed)}`} sx={{ height: 18 }} />
      )}
    </>
  )
}

/** The lines behind one faction, newest first. Opened by clicking the row. */
function RecentLines({ snap, row }: { snap: FactionSnap | null; row: FactionPanelRow }): JSX.Element {
  const lines = factionRecent(snap, row.key)
  return (
    <Box data-testid="character-faction-recent" sx={{ pl: 1.5, pb: 0.5 }}>
      {lines.length === 0 ? (
        <Typography variant="caption" color="text.disabled">
          The recent strip no longer holds a line for this faction.
        </Typography>
      ) : (
        lines.map((l) => (
          <Stack key={l.key} direction="row" spacing={1} sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
              {formatDate(l.ts, { month: 'numeric', day: 'numeric' })}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {l.text}
            </Typography>
          </Stack>
        ))
      )}
    </Box>
  )
}

/** One faction. The whole row is the expand affordance; a faction row has nowhere else to go. */
function FactionRow({
  row,
  open,
  onToggle
}: {
  row: FactionPanelRow
  open: boolean
  onToggle: (key: string) => void
}): JSX.Element {
  const toggle = (): void => {
    onToggle(row.key)
  }
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      role="button"
      tabIndex={0}
      data-testid="character-faction-row"
      data-faction={row.name}
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') toggle()
      }}
      sx={{ minWidth: 0, py: 0.3, px: 0.5, borderRadius: 0.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
    >
      <Typography variant="caption" noWrap sx={{ minWidth: 0, flexGrow: 1 }} title={row.name}>
        {row.name}
      </Typography>
      <RailChips row={row} />
      <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
        {formatDate(row.lastTs, { month: 'numeric', day: 'numeric' })}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }} title={`${String(row.hits)} stated lines`}>
        {row.hits}×
      </Typography>
      <Typography
        variant="caption"
        data-testid="character-faction-delta"
        sx={{ flexShrink: 0, minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      >
        {row.deltaText}
      </Typography>
    </Stack>
  )
}

export default function FactionPanel(): JSX.Element {
  const snap = useModule<FactionSnap>('faction')
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const [open, setOpen] = useState<string | null>(null)
  const rows = useMemo(() => factionRows(snap, normalizeQuery(deferred)), [snap, deferred])
  const toggle = (key: string): void => {
    setOpen((prev) => (prev === key ? null : key))
  }

  return (
    <Paper variant="outlined" data-testid="character-factions" sx={{ p: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ flexShrink: 0 }}>
          Faction
        </Typography>
        <TextField
          size="small"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
          }}
          placeholder="Search factions"
          slotProps={{ htmlInput: { 'data-testid': 'character-factions-search' } }}
          sx={{ width: 180 }}
        />
        <Typography variant="caption" color="text.secondary" data-testid="character-factions-count" sx={{ ml: 'auto' }}>
          {rows.length}
        </Typography>
      </Stack>
      {/* Said ONCE, here, instead of on every row: the number is the moves this log watched, and
          no line EverQuest prints states an absolute standing. */}
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 0.5 }}>
        Change across this log - the game never states a standing.
      </Typography>
      <Box sx={{ height: LIST_HEIGHT, overflow: 'auto', minWidth: 0 }}>
        {rows.length === 0 ? (
          <Typography variant="caption" color="text.disabled" data-testid="character-factions-empty">
            No faction hits in this log yet.
          </Typography>
        ) : (
          rows.map((row) => (
            <Box key={row.key} sx={{ minWidth: 0 }}>
              <FactionRow row={row} open={open === row.key} onToggle={toggle} />
              {open === row.key && <RecentLines snap={snap} row={row} />}
            </Box>
          ))
        )}
      </Box>
    </Paper>
  )
}
