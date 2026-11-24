// AaRow — one AA in the catalog list: name, held / max, the next rank's cost, its requirements,
// the description on demand, and the two controls — the rank to plan to, and the rank the user
// says they hold that the log never saw.

import { type JSX, useState } from 'react'
import { Box, Chip, IconButton, Paper, Stack, Tooltip, Typography } from '@mui/material'
import type { AaCatalogEntry } from '@shared/aaCatalog'
import type { AaHeld } from '@shared/aaPlanner'
import { nextRankCost } from '../../../../shared/aaPlanner'

const GRANT_LABEL: Record<NonNullable<AaCatalogEntry['granted']>, string> = {
  reincarnation: 'granted by reincarnation',
  achievement: 'granted by achievements'
}

function costText(entry: AaCatalogEntry, held: number): string {
  if (entry.granted) return GRANT_LABEL[entry.granted]
  if (held >= entry.maxRank) return 'maxed'
  const c = nextRankCost(entry, held)
  if (c === null) return 'next rank: cost unknown'
  return c === 0 ? 'next rank: free (auto-granted)' : `next rank: ${String(c)} pts`
}

function reqText(entry: AaCatalogEntry): string {
  if (entry.req.raw === null) return entry.granted ? '' : 'Requirements: none stated'
  return `Requirements: ${entry.req.raw}`
}

function Stepper({
  label,
  value,
  min,
  max,
  testId,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  testId: string
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <Stack direction="row" alignItems="center" spacing={0.25} data-testid={testId}>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
        {label}
      </Typography>
      <IconButton size="small" aria-label={`${label} down`} data-testid={`${testId}-dec`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Typography variant="body2">-</Typography>
      </IconButton>
      <Typography variant="body2" data-testid={`${testId}-value`} sx={{ minWidth: 18, textAlign: 'center' }}>
        {value}
      </Typography>
      <IconButton size="small" aria-label={`${label} up`} data-testid={`${testId}-inc`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Typography variant="body2">+</Typography>
      </IconButton>
    </Stack>
  )
}

function HeldChip({ entry, h }: { entry: AaCatalogEntry; h: AaHeld | undefined }): JSX.Element {
  const rank = h?.rank ?? 0
  const yours = h !== undefined && h.stated > h.logged
  const title = yours ? `You marked rank ${String(h.stated)}; your log shows ${String(h.logged)}` : 'Ranks seen in your log'
  return (
    <Tooltip title={title}>
      <Chip
        size="small"
        variant={rank > 0 ? 'filled' : 'outlined'}
        color={rank >= entry.maxRank ? 'success' : 'default'}
        label={`${String(rank)} / ${String(entry.maxRank)}${yours ? ' (you said)' : ''}`}
        data-testid="aa-planner-held"
      />
    </Tooltip>
  )
}

export interface AaRowProps {
  entry: AaCatalogEntry
  held: AaHeld | undefined
  target: number
  onTarget: (rank: number) => void
  onStated: (rank: number) => void
}

export default function AaRow({ entry, held, target, onTarget, onStated }: AaRowProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const rank = held?.rank ?? 0
  const plannable = entry.granted === undefined && rank < entry.maxRank
  return (
    <Paper
      variant="outlined"
      data-testid="aa-planner-row"
      data-name={entry.name}
      data-held={rank}
      data-max={entry.maxRank}
      data-granted={entry.granted ?? ''}
      sx={{ p: 0.75 }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        <Title name={entry.name} open={open} onToggle={() => setOpen((o) => !o)} />
        <HeldChip entry={entry} h={held} />
        {(entry.classes ?? []).map((c) => (
          <Chip key={c} size="small" variant="outlined" label={c} />
        ))}
        <Typography variant="caption" color="text.secondary" data-testid="aa-planner-next">
          {costText(entry, rank)}
        </Typography>
        {entry.issues && <Chip size="small" variant="outlined" color="warning" label="partly read" title={entry.issues.join(' | ')} />}
        <Box sx={{ flexGrow: 1 }} />
        <Stepper label="I hold" value={held?.stated ?? 0} min={0} max={entry.maxRank} testId="aa-planner-stated" onChange={onStated} />
        {plannable && (
          <Stepper label="Plan to" value={Math.max(target, rank)} min={rank} max={entry.maxRank} testId="aa-planner-target" onChange={onTarget} />
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" data-testid="aa-planner-req" sx={{ display: 'block' }}>
        {reqText(entry)}
      </Typography>
      {open && <Description entry={entry} />}
    </Paper>
  )
}

function Description({ entry }: { entry: AaCatalogEntry }): JSX.Element {
  return (
    <Box data-testid="aa-planner-desc" sx={{ mt: 0.5 }}>
      <Typography variant="body2">{entry.description}</Typography>
      {entry.rankValues && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Per rank: {entry.rankValues.join(' / ')}
        </Typography>
      )}
      {entry.activated && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Activated: {entry.activated}
        </Typography>
      )}
    </Box>
  )
}

function Title({ name, open, onToggle }: { name: string; open: boolean; onToggle: () => void }): JSX.Element {
  return (
    <Typography
      variant="subtitle2"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      data-testid="aa-planner-name"
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      sx={{ cursor: 'pointer', minWidth: 180 }}
    >
      {name}
    </Typography>
  )
}
