// The four gauges (EQ Zera, 2026-09-06): Tank, DPS, Healer — each "where your set sits against
// the best set the same filters could reach", 0..100 — and Solo, the class kit blended with the
// three. Segmented bars, the console health-bar look the theme gives every LinearProgress.

import type { JSX } from 'react'
import { Box, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { BUILD_PROFILES, PROFILE_LABEL, SOLO_AXES, SOLO_AXIS_LABEL, type BuildProfile } from '../../../../shared/build/profiles'
import { FONTS, PALETTE } from '../../../../shared/palette'
import type { BuildState } from './useBuild'

const TILE_TITLE = { display: 'block', color: 'text.secondary', mb: 0.5 } as const

function Gauge({
  label,
  value,
  note,
  color,
  selected,
  onSelect,
  testId
}: {
  label: string
  value: number
  note: string
  color: string
  selected?: boolean
  onSelect?: () => void
  testId: string
}): JSX.Element {
  return (
    <Paper
      variant="outlined"
      data-testid={testId}
      onClick={onSelect}
      sx={{
        p: 1.25,
        flex: 1,
        minWidth: 150,
        cursor: onSelect ? 'pointer' : 'default',
        borderColor: selected ? color : undefined,
        boxShadow: selected ? `0 0 12px ${color}55` : 'none'
      }}
    >
      <Typography variant="caption" className="eq-display-label" sx={TILE_TITLE}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: FONTS.mono, fontSize: 28, lineHeight: 1, color }}>{value}%</Typography>
      <LinearProgress
        variant="determinate"
        value={value}
        sx={{ mt: 0.75, '& .MuiLinearProgress-bar': { backgroundImage: 'none', backgroundColor: color } }}
      />
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }} noWrap>
        {note}
      </Typography>
    </Paper>
  )
}

const PROFILE_COLOR: Record<BuildProfile, string> = { tank: PALETTE.cyan, dps: PALETTE.red, heal: PALETTE.green }

export function BuildMeters({ build }: { build: BuildState }): JSX.Element {
  const kitLine = SOLO_AXES.map((a) => `${SOLO_AXIS_LABEL[a]} ${Math.round(build.kit[a] * 100)}`).join(' · ')
  return (
    <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" data-testid="build-meters">
      {BUILD_PROFILES.map((p) => (
        <Gauge
          key={p}
          testId={`build-meter-${p}`}
          label={PROFILE_LABEL[p]}
          value={build.meters[p]}
          color={PROFILE_COLOR[p]}
          selected={build.profile === p}
          onSelect={() => build.setProfile(p)}
          note={build.profile === p ? 'selected - upgrades below read this way' : 'click to optimize for this'}
        />
      ))}
      <Tooltip title={`Class kit: ${kitLine}. Solo is 45% kit, 55% gear (tank, DPS, and healing as far as the kit can heal).`}>
        <Box sx={{ flex: 1, minWidth: 150, display: 'flex' }}>
          <Gauge
            testId="build-meter-solo"
            label="Solo capability"
            value={build.solo.percent}
            color={PALETTE.accent}
            note={`kit ${build.solo.kitPercent} · gear ${build.solo.gearPercent}`}
          />
        </Box>
      </Tooltip>
    </Stack>
  )
}
