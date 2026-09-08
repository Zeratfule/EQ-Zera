// PrefSectionBlock — one Preferences section as it is drawn, plus the ARRIVAL PULSE.
//
// Its own file for the reason PerfSetting's descriptor is: PreferencesView.tsx sits at the
// repo's 400-code-line factoring ceiling, and the answer to that is a split, not a threshold.
// This is a coherent piece to split off — everything about how a section LOOKS when you land on
// it, with PreferencesView keeping what the sections ARE and which one is showing.
//
// WHY THE PULSE EXISTS. A deep link ("Set up in Preferences" on an alert row, the telemetry
// notice's details link) opens this view already switched to the right section — correctly, and
// completely silently. The user clicked a sentence about voices in one tab and got a settings
// page in another, with nothing connecting the two ends; the section they were sent to looks
// exactly like the section they would have reached by hand. The pulse is that connection: the
// landed cards breathe an accent outline twice and settle. Long enough to be seen, short enough
// that it never becomes decoration, and one-shot state rather than a style (PreferencesView
// clears it on a timer).
//
// REDUCED MOTION KEEPS THE INFORMATION, NOT THE MOVEMENT. Under `prefers-reduced-motion: reduce`
// the animation is replaced by a plain static outline held for the same interval, so "which of
// these is the thing I clicked" still has an answer.

import { type JSX, useEffect, useState } from 'react'
import { Box, Paper, Stack, Typography } from '@mui/material'
import type { PrefSection } from './PreferencesView'

/** The landing highlight. See the header for why it is two pulses and why reduced motion differs. */
const PULSE_SX = {
  '@keyframes eqcPrefsLand': {
    '0%': { boxShadow: '0 0 0 0 rgba(144,202,249,0)', borderColor: 'divider' },
    '25%': { boxShadow: '0 0 0 3px rgba(144,202,249,0.45)', borderColor: 'primary.main' },
    '100%': { boxShadow: '0 0 0 0 rgba(144,202,249,0)', borderColor: 'divider' }
  },
  animation: 'eqcPrefsLand 900ms ease-out 2',
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none',
    borderColor: 'primary.main',
    boxShadow: '0 0 0 2px rgba(144,202,249,0.35)'
  }
} as const

/** How long the arrival highlight stays up. Two 900 ms pulses, then it is gone. */
const LAND_HIGHLIGHT_MS = 1800

/**
 * True for the first `LAND_HIGHLIGHT_MS` after arriving via section routing, then null forever.
 *
 * Keyed off `section` rather than off mount so it is honest in both directions: App re-keys the
 * view per deep link (so clicking the same link twice pulses twice), and a plain visit to
 * Preferences — `section` null — never pulses at all, because nothing sent the user anywhere in
 * particular and a highlight would be pointing at nothing.
 */
export function useLandedSection(section: string | null): string | null {
  const [landed, setLanded] = useState(section)
  useEffect(() => {
    if (section === null) return undefined
    setLanded(section)
    const timer = setTimeout(() => setLanded(null), LAND_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [section])
  return landed
}

/**
 * FILLING THE PANE (JOS-76) — the sx a section opts into with `PrefSection.fill`.
 *
 * One section in the app is a READING surface rather than a stack of controls (What's new), and a
 * short scroll box floating in a tall empty pane is the wrong answer for it. So it claims the
 * remaining height: this block becomes a flex column that grows, its card grows inside it, and
 * the card's own content is then free to put a scroll box at the bottom of the chain.
 *
 * `minHeight: 0` appears at EVERY rung, and it is not decoration. A flex child's default
 * `min-height: auto` refuses to shrink below its content, so one rung without it and the whole
 * column grows past the pane — the list stops scrolling and the PAGE starts, which is exactly the
 * failure AGENTS.md records for the combat log. The Paper additionally needs
 * `display:flex; flexDirection:column`, because a growing card whose content does not also grow
 * is just a taller box with the same short content in the top of it.
 *
 * OPT-IN, NEVER THE DEFAULT: every other section must size to its content, and a Preferences pane
 * where the Voice card stretched to the window bottom would be worse everywhere in order to make
 * one card right.
 */
// The three rungs ABOVE this component, which PreferencesView spreads onto its own boxes. They
// live here rather than there because this file is the one that knows what "fill" means, and
// because the chain only works if every rung agrees — keeping them apart is how one of them
// silently loses its `minHeight: 0`.
/** The view root: a definite height for the chain to distribute (see PreferencesView's note). */
export const FILL_ROOT_SX = { height: '100%', minHeight: 0 } as const
/** The [rail | content] row: stretch, so the content column is as tall as the row. */
export const FILL_ROW_SX = { alignItems: 'stretch', flexGrow: 1, minHeight: 0 } as const
/** The content column, which must be allowed to shrink below its content. */
export const FILL_COLUMN_SX = { minHeight: 0 } as const

/**
 * Is this the PANE-FILLING layout? Deliberately narrow: exactly one section on screen, and that
 * section asked for it.
 *
 * In SEARCH mode the content column holds matches from every section, so there is no single card
 * that "the remaining height" could belong to and the ordinary size-to-content layout stands —
 * which is why this reads the SHOWN sections rather than the active id. It lives here, with the
 * sx it selects, so the decision and the styling can never drift apart.
 */
export function paneFills(searching: boolean, shown: PrefSection[]): boolean {
  return !searching && shown.length === 1 && shown[0]?.fill === true
}

const FILL_BLOCK_SX = { flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } as const
const FILL_CARD_SX = {
  flexGrow: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  '& > :last-child': { flexGrow: 1, minHeight: 0 }
} as const

/** One section header plus its settings cards. `landed` runs the arrival pulse above; `fill`
 *  makes the block claim the pane's remaining height (see FILL_BLOCK_SX). */
export default function PrefSectionBlock({
  section,
  landed = false
}: {
  section: PrefSection
  landed?: boolean
}): JSX.Element {
  const fill = section.fill === true
  return (
    <Box
      data-testid={`prefs-section-${section.id}`}
      data-landed={landed ? 'true' : undefined}
      sx={fill ? FILL_BLOCK_SX : undefined}
    >
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: 'block', letterSpacing: 1, mb: 0.5 }}
      >
        {section.label}
      </Typography>
      <Stack spacing={1.5} sx={fill ? { flexGrow: 1, minHeight: 0 } : undefined}>
        {section.items.map((i) => (
          <Paper
            key={i.id}
            variant="outlined"
            sx={{ p: 1.5, ...(landed ? PULSE_SX : {}), ...(fill ? FILL_CARD_SX : {}) }}
          >
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {i.label}
            </Typography>
            {i.content}
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}
