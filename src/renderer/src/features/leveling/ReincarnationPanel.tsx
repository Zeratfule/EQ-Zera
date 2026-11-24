// ReincarnationPanel — what this character has reincarnated, the AAs that bought, and the
// experience it now costs (shared/reincarnation*.ts; every number is derived there).
//
// The XP multiplier is COMMUNITY-REPORTED, not official, and wears the `reported` chip wherever it
// is printed (shared/reincarnationXp.ts holds the rule and its source). The re-level time is an
// estimate and says `est.`. A possible (inferred) reincarnation is shown, never counted: the player
// confirms it by stating a count, which is also how a reincarnation this app never saw gets in.

import { type JSX, useMemo, useState } from 'react'
import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import type { ProgressionSnap } from '@shared/types'
import type { ReincarnationEvent } from '@shared/reincarnation'
import { REINCARNATION_CLASSES, REINCARNATION_RACES, type ComponentCount } from '../../../../shared/reincarnation'
import { reincarnationSummary, resolvedCodes, type ReincarnationSummary } from '../../../../shared/reincarnationSummary'
import { XP_PENALTY_LABEL, XP_PENALTY_SOURCE_URL, penaltyText } from '../../../../shared/reincarnationXp'
import { formatDateTime } from '../../lib/formatDate'
import { useComboIntervals } from '../profiles/ClassComboData'
import { fmtDelta } from './levelChartGeometry'
import { REBIRTH_COLOR } from './RebirthMarker'
import { useReincarnationRecord } from './useReincarnation'

function XpRow({ s }: { s: ReincarnationSummary }): JSX.Element {
  const by = s.requirement.setBy
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" data-testid="leveling-reincarnation-xp">
      <Typography variant="body2">
        XP required {s.requirement.penalty > 0 ? penaltyText(s.requirement) : 'base'}
        {by ? ` - set by ${by.name} (${String(by.count)}x)` : ''}
        {s.raceUnknown && s.loadout.length > 0 ? ' - race not known' : ''}
      </Typography>
      <Chip size="small" variant="outlined" label={XP_PENALTY_LABEL} title={`Community-reported rule: ${XP_PENALTY_SOURCE_URL}`} />
      {s.forecast && (
        <Typography variant="body2" color="text.secondary" data-testid="leveling-reincarnation-forecast">
          re-level {s.forecast.fromLevel} to {s.forecast.toLevel}: ~{fmtDelta(s.forecast.ms)} est. (from last life, {s.forecast.measured} of{' '}
          {s.forecast.levels} levels)
        </Typography>
      )}
    </Stack>
  )
}

function AaChips({ s }: { s: ReincarnationSummary }): JSX.Element | null {
  if (s.aas.rows.length === 0) return null
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap data-testid="leveling-reincarnation-aas">
      {s.aas.rows.map((r) => (
        <Chip
          key={`${r.component}:${r.name}`}
          size="small"
          label={`${r.name} ${String(r.rank)}/3${r.count > 3 ? ` (${String(r.count)}x)` : ''}${r.source === 'user' ? ' - you said' : ''}`}
          sx={{ borderColor: REBIRTH_COLOR }}
          variant="outlined"
        />
      ))}
      <Chip size="small" label={`Completionist ${String(s.aas.completionist)}/3 - ${String(s.aas.classesTowardNext)}/16 classes toward next`} />
    </Stack>
  )
}

function PossibleList({ events }: { events: readonly ReincarnationEvent[] }): JSX.Element | null {
  if (events.length === 0) return null
  return (
    <Box data-testid="leveling-reincarnation-possible">
      {events.map((e) => (
        <Typography key={`${e.source}:${String(e.ts)}`} variant="caption" color="text.secondary" display="block">
          Possible reincarnation (inferred) {formatDateTime(e.ts)}
          {e.whoClasses?.length ? ` - ${e.whoClasses.join('/')}` : ''} - state the counts below if it was one
        </Typography>
      ))}
    </Box>
  )
}

const NAMES = {
  class: REINCARNATION_CLASSES.map((c) => c.name),
  race: [...REINCARNATION_RACES]
}

function CountEditor({ counts }: { counts: readonly ComponentCount[] }): JSX.Element {
  const [component, setComponent] = useState<'class' | 'race'>('class')
  const [name, setName] = useState(NAMES.class[0])
  const [count, setCount] = useState('1')
  const held = counts.find((c) => c.component === component && c.name === name)
  const n = Number(count)
  const valid = count.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 99
  const onComponent = (next: 'class' | 'race'): void => {
    setComponent(next)
    setName(NAMES[next][0])
  }
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap data-testid="leveling-reincarnation-editor">
      <TextField select size="small" value={component} onChange={(e) => onComponent(e.target.value as 'class' | 'race')}>
        <MenuItem value="class">Class</MenuItem>
        <MenuItem value="race">Race</MenuItem>
      </TextField>
      <TextField select size="small" value={name} onChange={(e) => setName(e.target.value)} sx={{ minWidth: 150 }}>
        {NAMES[component].map((n2) => (
          <MenuItem key={n2} value={n2}>
            {n2}
          </MenuItem>
        ))}
      </TextField>
      <TextField size="small" type="number" value={count} onChange={(e) => setCount(e.target.value)} sx={{ width: 80 }} />
      <Button size="small" disabled={!valid} onClick={() => void window.eq.setReincarnationCount(component, name, n)}>
        Save
      </Button>
      {held?.source === 'user' && (
        <Button size="small" onClick={() => void window.eq.setReincarnationCount(component, name, null)}>
          Use the log
        </Button>
      )}
      <Typography variant="caption" color="text.secondary">
        now {held ? `${String(held.count)} (${held.source === 'user' ? 'you said' : 'from the log'})` : '0'}
      </Typography>
    </Stack>
  )
}

/** The active loadout's resolved class codes, from the combo model's current interval. */
function useLoadoutCodes(): string[] {
  const intervals = useComboIntervals()
  return useMemo(() => resolvedCodes(intervals.length ? intervals[intervals.length - 1].slots : []), [intervals])
}

export function ReincarnationPanel(p: {
  events: readonly ReincarnationEvent[] | undefined
  prog: ProgressionSnap
  currentLevel: number | null
}): JSX.Element | null {
  const record = useReincarnationRecord()
  const classCodes = useLoadoutCodes()
  const [editing, setEditing] = useState(false)
  const s = useMemo(
    () =>
      record
        ? reincarnationSummary({ record, events: p.events ?? [], classCodes, prog: p.prog, currentLevel: p.currentLevel })
        : null,
    [record, p.events, classCodes, p.prog, p.currentLevel]
  )
  if (!s) return null
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderLeft: `3px solid ${REBIRTH_COLOR}` }} data-testid="leveling-reincarnation">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2">Reincarnation</Typography>
          {!s.any && (
            <Typography variant="caption" color="text.secondary">
              none recorded
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={() => setEditing(!editing)} data-testid="leveling-reincarnation-edit">
            {editing ? 'Done' : 'Set counts'}
          </Button>
        </Stack>
        {s.any && <XpRow s={s} />}
        <AaChips s={s} />
        <PossibleList events={s.possible} />
        {editing && <CountEditor counts={s.counts} />}
      </Stack>
    </Paper>
  )
}
