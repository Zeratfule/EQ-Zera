// RaceCard — one race unlock: a bar of objectives done, its state, how it was granted, and (open)
// each faction it needs with the fastest stated ways to raise it.

import type { JSX } from 'react'
import { Box, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material'
import type { RacePlan } from '../../../../shared/raceUnlockPlan'
import RaceFactionDetail, { type RaceLinks } from './RaceFactionDetail'

const STATUS_LABEL: Record<RacePlan['status'], string> = {
  unlocked: 'Unlocked',
  'in-progress': 'In progress',
  'not-started': 'Not started'
}

/** `Human (Freeport)` → `human-freeport`: the testid suffix. */
export function raceSlug(race: string): string {
  return race
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The one or two short lines under the bar: how it was granted, or what else completes it. */
function notesOf(plan: RacePlan): string[] {
  const notes: string[] = []
  if (plan.createdAs) notes.push('Your character was created as this race.')
  if (plan.grant === 'token') notes.push('Unlocked with a Race Unlock Token.')
  if (plan.via) {
    const closest = plan.via.closest === null ? '' : ` Closest: ${plan.via.closest}.`
    if (plan.status !== 'unlocked') notes.push(`Unlocks when you unlock ${plan.via.races.join(' or ')}.${closest}`)
  }
  if (plan.task) notes.push(`Complete the task ${plan.task.name}.${plan.task.complete ? ' Done.' : ''}`)
  for (const o of plan.other) notes.push(`${o.text}${o.complete ? ' Done.' : ''}`)
  if (plan.tokenBypass && plan.status !== 'unlocked') notes.push('A Race Unlock Token skips this unlock.')
  return notes
}

function progressText(plan: RacePlan): string {
  if (plan.status === 'unlocked') return 'Done'
  if (plan.factions.length > 0 && plan.factions.length === plan.total) {
    return `${String(plan.done)} of ${String(plan.total)} factions maxed`
  }
  return `${String(plan.done)} of ${String(plan.total)} done`
}

function Header({ plan, open, onToggle }: { plan: RacePlan; open: boolean; onToggle: () => void }): JSX.Element {
  const pct = plan.status === 'unlocked' ? 100 : plan.total === 0 ? 0 : (plan.done / plan.total) * 100
  return (
    <Stack
      direction="row"
      spacing={2}
      alignItems="center"
      role="button"
      tabIndex={0}
      aria-expanded={open}
      data-testid="race-card-header"
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onToggle()
      }}
      sx={{ cursor: 'pointer', borderRadius: 1, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
    >
      <Typography variant="subtitle2" sx={{ minWidth: 140 }}>
        {plan.race}
      </Typography>
      <Typography variant="body2" color="text.secondary" data-testid="race-progress-text" sx={{ minWidth: 150 }}>
        {progressText(plan)}
      </Typography>
      <Box sx={{ flexGrow: 1, minWidth: 80 }}>
        <LinearProgress
          variant="determinate"
          value={pct}
          color={plan.status === 'unlocked' ? 'success' : 'primary'}
          sx={{ height: 6, borderRadius: 3 }}
        />
      </Box>
      <Chip
        size="small"
        label={STATUS_LABEL[plan.status]}
        color={plan.status === 'unlocked' ? 'success' : 'default'}
        variant={plan.status === 'unlocked' ? 'filled' : 'outlined'}
        data-testid="race-status"
        sx={{ minWidth: 96 }}
      />
    </Stack>
  )
}

export default function RaceCard({
  plan,
  open,
  onToggle,
  links
}: {
  plan: RacePlan
  open: boolean
  onToggle: () => void
  links: RaceLinks
}): JSX.Element {
  const notes = notesOf(plan)
  return (
    <Paper
      variant="outlined"
      data-testid={`race-card-${raceSlug(plan.race)}`}
      data-race={plan.race}
      data-status={plan.status}
      data-done={plan.done}
      data-total={plan.total}
      data-remaining={plan.remaining}
      sx={{ p: 1, '&:hover': { borderColor: 'text.disabled' } }}
    >
      <Header plan={plan} open={open} onToggle={onToggle} />
      {notes.map((n) => (
        <Typography key={n} variant="caption" color="text.secondary" data-testid="race-note" sx={{ display: 'block', mt: 0.25 }}>
          {n}
        </Typography>
      ))}
      {open && plan.factions.length > 0 && (
        <Box data-testid="race-factions" sx={{ mt: 0.75 }}>
          {plan.factions.map((f) => (
            <RaceFactionDetail key={f.faction} plan={f} links={links} />
          ))}
        </Box>
      )}
    </Paper>
  )
}
