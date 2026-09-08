// RateBasisControls / RateBasisCaption — WHICH HOUR THE RATES ON THIS SURFACE ARE PER (JOS-288).
//
// The sibling of `SliceBar`, and deliberately a SECOND control rather than another row of buttons
// inside it: the slice answers "which stretch of play", this answers "per hour of what", and they
// are orthogonal in exactly the way `shared/timeslice.ts` says a range and a zone are. Folding the
// two into one group would offer `Session` beside `active` as if a reader had to choose between
// them.
//
// IT SAYS WHAT YOU ARE LOOKING AT AND NOTHING ABOUT HOW (UI conventions, inherited from SliceBar).
// The buttons are the two words the loot ledger already uses — `elapsed` and `active` — and the
// caption states which one the numbers below are on.
//
// AND EACH BUTTON EXPLAINS ITSELF ON HOVER (JOS-304, owner feedback 2026-08-13: the toggle is
// *hard to understand*). What this header used to refuse was a MUI TOOLTIP — an interactive popper
// over a dense control row lands on the neighbouring buttons and eats the clicks aimed at them
// (JOS-143's measured reason). A native `title` is the browser's own hover, takes no pointer
// events, and is the house pattern for this row. The words are `BASIS_BUTTON_TITLE`, which is
// `BASIS_TITLE` with one clause of effect in front of it — the caption below hovers the SAME
// definition by the SAME lookup, so the button and the line under it cannot come to disagree about
// what the hour is.
//
// IT IS NOT ON THE LOOT TAB, and that is a decision rather than an omission: the ledger's rate line
// prints BOTH readings side by side (JOS-261) precisely so neither can pass for the other, and a
// toggle there would replace a complete answer with half of one.
//
// THE TWO HALVES ARE MOUNTED SEPARATELY (JOS-301, `SliceBar`'s split for the same reason). The
// buttons belong on the scope row with the other controls; the caption belongs on the ONE line of
// description under it, sharing it with the slice's own words. They are still one file and one
// idea — the caption is the only place the DEFINITION of the hour in force is written, and it
// keeps its `title` (the definition proper) here where the words are.

import { type JSX } from 'react'
import { Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { RATE_BASES, type RateBasis } from '@shared/rateBasis'
import { BASIS_BUTTON_TITLE, BASIS_TITLE } from '../leveling/rangeStatsRows'
import { useRateBasis } from './useRateBasis'

export interface RateBasisBarProps {
  /**
   * Prefix for this surface's testids: `<prefix>` and `<prefix>-<basis>`. Per surface for
   * `SliceBarProps.testId`'s reason — tabs stay mounted, so two of these can exist at once.
   */
  testId: string
}

/** THE BUTTONS ALONE — the half that is a control, mountable beside the other two (JOS-301). */
export function RateBasisControls({ testId }: RateBasisBarProps): JSX.Element {
  const { basis, setBasis } = useRateBasis()
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      data-testid={testId}
      data-basis={basis}
      sx={{ flexWrap: 'wrap', rowGap: 1 }}
      useFlexGap
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        value={basis}
        onChange={(_e, next: RateBasis | null) => {
          // MUI reports null when the active button is clicked again. Some hour is always in force,
          // so that is a no-op rather than an empty selection (SliceBar's rule, same reason).
          if (next) setBasis(next)
        }}
      >
        {RATE_BASES.map((id) => (
          <ToggleButton
            key={id}
            value={id}
            data-testid={`${testId}-${id}`}
            // Every button carries ITS OWN denominator's sentence, selected or not, so the
            // difference between the two is learnable from whichever one the pointer lands on.
            title={BASIS_BUTTON_TITLE[id]}
            sx={{ px: 1.1, py: 0.25, fontSize: 11, lineHeight: 1.4, textTransform: 'none' }}
          >
            {id}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  )
}

/**
 * THE SENTENCE ALONE — the words under the row (JOS-301, `SliceCaption`'s shape).
 *
 * The control never shrinks; the caption does (the compact-bar contract). It is the ONE place the
 * definition of the hour in force is stated on this tab — the rate captions further down state the
 * SPAN, which is a different fact about the same denominator. A `span`, because it is a clause of a
 * line it does not own; `noWrap` is the line owner's call for the same reason.
 */
export function RateBasisCaption({ testId }: RateBasisBarProps): JSX.Element {
  const { basis } = useRateBasis()
  return (
    <Typography
      component="span"
      variant="caption"
      color="text.secondary"
      sx={{ minWidth: 0 }}
      data-testid={`${testId}-caption`}
      title={BASIS_TITLE[basis]}
    >
      rates per hour of {basis} time
    </Typography>
  )
}
