// The Leveling tab's four headline numbers — level, AA earned, AA spent, AA unspent.
//
// Split out of LevelingView (which sits at the measured 400-code-line ceiling) the day the tab
// gained the "New at this level" panel. Pure presentation: every number is computed in the view
// and every caption states the honesty the analytics owe — CURRENT level is the one the log last
// STATED (a ding, or your own `/who` row — JOS-192), never max(), because a loadout swap re-reports
// the level of the new (lowest) class, so the peak belongs to a class that may no longer be in the
// loadout and rides the caption instead. The card says WHICH line stated it and how long ago,
// because that is the difference between a level and a level that has since been overtaken.

import { type JSX } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import BoltIcon from '@mui/icons-material/Bolt'
import { Tooltip } from '../../lib/Tooltip'
import { PALETTE } from '../../../../shared/palette'

function HeroCard({
  icon,
  value,
  label,
  sub,
  accent,
  /** Hover sentence for the whole card. Only the level card has one to say. */
  title,
  /** Only the cards an assertion needs to READ carry one (the AA ledger's footer must equal
   *  the AA-points-spent figure, and e2e proves that across the two components). */
  testId
}: {
  icon: JSX.Element
  value: string
  label: string
  sub?: string
  accent: string
  title?: string
  testId?: string
}): JSX.Element {
  const card = (
    <Paper
      variant="outlined"
      sx={{ p: 2, flex: 1, minWidth: 160, borderLeft: `3px solid ${accent}`, display: 'flex', gap: 1.5 }}
    >
      <Box sx={{ color: accent, display: 'flex', alignItems: 'center' }}>{icon}</Box>
      <Box>
        <Typography variant="h4" sx={{ lineHeight: 1, color: accent }} data-testid={testId}>
          {value}
        </Typography>
        <Typography variant="body2">{label}</Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary">
            {sub}
          </Typography>
        )}
      </Box>
    </Paper>
  )
  return title ? <Tooltip title={title}>{card}</Tooltip> : card
}

export interface LevelingHeroesProps {
  currentLevel: number | null
  /** '/who' or 'Nh ago' beside the number; '' when the bare number is the whole fact. */
  levelCue: string
  /** which line stated that level and how long ago; '' when nothing has stated one. */
  levelTitle: string
  levelCount: number
  peak: number | null
  swaps: number
  aaEarned: number
  aaSpent: number
  aaUnspent: number | null
  boughtCount: number
}

export function LevelingHeroes({
  currentLevel,
  levelCue,
  levelTitle,
  levelCount,
  peak,
  swaps,
  aaEarned,
  aaSpent,
  aaUnspent,
  boughtCount
}: LevelingHeroesProps): JSX.Element {
  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
      <HeroCard
        icon={<MilitaryTechIcon fontSize="large" />}
        value={currentLevel != null ? String(currentLevel) : '-'}
        label="Character level"
        title={levelTitle || undefined}
        // THE CUE RIDES THE CAPTION, NOT THE LABEL (measured, JOS-192). The caption is already a
        // list of qualifiers about the level-up record and has a line to spare; the LABEL is the
        // card's one-line name, and appending to it wrapped the tallest hero card by a line at
        // every width — which pushed the whole two-column band down and drew the timeslice
        // control under the panel above it (tests/e2e/leveling.e2e.mts caught exactly that).
        sub={
          (levelCue ? `${levelCue} · ` : '') +
          (levelCount
            ? `${levelCount} level-ups logged` +
              (swaps > 0 ? ` · peak ${peak} · ${swaps} class swap${swaps === 1 ? '' : 's'}` : '')
            : 'no level-ups in log')
        }
        accent={PALETTE.accent}
        testId="leveling-hero-level"
      />
      <HeroCard
        icon={<AutoAwesomeIcon fontSize="large" />}
        value={aaEarned ? aaEarned.toLocaleString() : '-'}
        label="AA points earned"
        sub="spent + unspent"
        accent={PALETTE.cyan}
      />
      {/* `boughtCount` counts paid (ability, RANK) steps, not abilities — 91 of them across 50
          abilities on the real log. The caption read "abilities allocated" until the AA ledger
          grouped the ranks into ladders and made the two visibly different numbers. */}
      <HeroCard
        icon={<AutoAwesomeIcon fontSize="large" />}
        value={aaSpent ? aaSpent.toLocaleString() : '-'}
        label="AA points spent"
        sub={`${boughtCount} ranks allocated`}
        testId="leveling-hero-aa-spent"
        accent={PALETTE.amber}
      />
      <HeroCard
        icon={<BoltIcon fontSize="large" />}
        value={aaUnspent != null ? aaUnspent.toLocaleString() : '-'}
        label="AA unspent"
        sub="last reported balance"
        accent={PALETTE.green}
      />
    </Stack>
  )
}
