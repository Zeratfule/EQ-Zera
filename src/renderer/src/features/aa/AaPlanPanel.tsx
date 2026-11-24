// AaPlanPanel — the plan: the chosen target ranks in buying order, each with its cost, the
// running total, when it becomes affordable at the current pace (an estimate), and any
// requirement it does not meet yet. Totals sit on top; up/down reorders; copy puts it on the
// clipboard as text.

import { type JSX, useState } from 'react'
import { Box, Button, Chip, IconButton, Paper, Stack, Typography } from '@mui/material'
import type { AaPlanRow, AaPlanTotals, AaReqCheck } from '@shared/aaPlanner'
import { rowBlocked } from '../../../../shared/aaPlanner'
import { formatEtaMs, planText } from '../../../../shared/aaPlanStore'
import { copyText } from '../../lib/clipboard'

function etaLabel(etaMs: number | null, shortfall: number): string | null {
  if (shortfall <= 0) return 'affordable now'
  return etaMs === null ? null : `est. ${formatEtaMs(etaMs)}`
}

function Total({ label, value, testId }: { label: string; value: string; testId: string }): JSX.Element {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="subtitle2" data-testid={testId}>
        {value}
      </Typography>
    </Box>
  )
}

function Totals({ totals, hasPace }: { totals: AaPlanTotals; hasPace: boolean }): JSX.Element {
  const eta = etaLabel(totals.etaMs, totals.shortfall)
  const unknown = totals.unknownRanks > 0 ? ` + ${String(totals.unknownRanks)} unknown` : ''
  return (
    <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
      <Total label="Points needed" value={`${String(totals.needed)}${unknown}`} testId="aa-planner-total-needed" />
      <Total label="Banked now" value={String(totals.banked)} testId="aa-planner-total-banked" />
      <Total label="Short" value={String(totals.shortfall)} testId="aa-planner-total-shortfall" />
      {hasPace && eta !== null && <Total label="At your last hour's pace" value={eta} testId="aa-planner-total-eta" />}
    </Stack>
  )
}

const CHECK_COLOR: Record<AaReqCheck['status'], 'error' | 'default' | 'success'> = {
  unmet: 'error',
  unknown: 'default',
  met: 'success'
}

function Checks({ checks }: { checks: AaReqCheck[] }): JSX.Element | null {
  const shown = checks.map((c, i) =>
    c.status === 'met' ? null : (
      <Chip
        key={`${c.kind}-${String(i)}`}
        size="small"
        variant="outlined"
        color={CHECK_COLOR[c.status]}
        label={c.status === 'unknown' ? `unknown: ${c.label}` : c.label}
        data-testid="aa-planner-step-check"
        data-status={c.status}
      />
    )
  )
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      {shown}
    </Stack>
  )
}

export interface StepActions {
  onMove: (index: number, delta: -1 | 1) => void
  onRemove: (name: string) => void
}

function Step({ row, last, actions, hasPace }: { row: AaPlanRow; last: boolean; actions: StepActions; hasPace: boolean }): JSX.Element {
  const i = row.step - 1
  const eta = hasPace ? etaLabel(row.etaMs, row.shortfall) : row.shortfall <= 0 ? 'affordable now' : null
  const unknown = row.unknownRanks > 0 ? ` + ${String(row.unknownRanks)} unknown` : ''
  return (
    <Paper variant="outlined" data-testid="aa-planner-step" data-name={row.name} data-blocked={rowBlocked(row)} data-cumulative={row.cumulative} sx={{ p: 0.75 }}>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="body2" sx={{ flexGrow: 1 }}>
          {row.step}. {row.name} {row.from} to {row.to}
        </Typography>
        <IconButton size="small" aria-label="Move up" data-testid="aa-planner-step-up" disabled={i === 0} onClick={() => actions.onMove(i, -1)}>
          <Typography variant="body2">↑</Typography>
        </IconButton>
        <IconButton size="small" aria-label="Move down" data-testid="aa-planner-step-down" disabled={last} onClick={() => actions.onMove(i, 1)}>
          <Typography variant="body2">↓</Typography>
        </IconButton>
        <IconButton size="small" aria-label="Remove" data-testid="aa-planner-step-remove" onClick={() => actions.onRemove(row.name)}>
          <Typography variant="body2">x</Typography>
        </IconButton>
      </Stack>
      <Typography variant="caption" color="text.secondary" data-testid="aa-planner-step-cost" sx={{ display: 'block' }}>
        {row.cost} pts{unknown} - {row.cumulative} total{eta !== null ? ` - ${eta}` : ''}
      </Typography>
      <Checks checks={row.checks} />
    </Paper>
  )
}

export default function AaPlanPanel({
  rows,
  totals,
  hasPace,
  actions
}: {
  rows: AaPlanRow[]
  totals: AaPlanTotals
  hasPace: boolean
  actions: StepActions
}): JSX.Element {
  const [copied, setCopied] = useState<boolean | null>(null)
  return (
    <Stack spacing={1} data-testid="aa-planner-plan" sx={{ height: '100%', minHeight: 0 }}>
      <Stack direction="row" alignItems="center">
        <Typography variant="subtitle1" sx={{ flexGrow: 1 }}>
          Plan
        </Typography>
        <Button
          size="small"
          data-testid="aa-planner-copy"
          disabled={rows.length === 0}
          onClick={() => {
            void copyText(planText(rows, totals)).then(setCopied)
          }}
        >
          {copied === true ? 'Copied' : copied === false ? 'Copy failed' : 'Copy as text'}
        </Button>
      </Stack>
      <Totals totals={totals} hasPace={hasPace} />
      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" data-testid="aa-planner-plan-empty">
            Raise "Plan to" on an AA to add it here.
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {rows.map((r) => (
              <Step key={r.name} row={r} last={r.step === rows.length} actions={actions} hasPace={hasPace} />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
