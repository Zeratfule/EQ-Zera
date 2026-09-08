// ZoneScopeBar — WHICH TIERS OF THIS ZONE THE NUMBERS ARE ABOUT (JOS-291).
//
// The third control of the scope sentence, and a third one rather than a row of buttons inside
// `SliceBar` for `RateBasisBar`'s reason: the slice answers "which stretch of play", the basis
// answers "per hour of what", and this answers "which visits of the camp count". Folding them into
// one group would offer `every tier` beside `Session` as if a reader had to choose between them.
//
// IT IS DRAWN ONLY WHILE THE SLICE CARRIES A ZONE. `All`, `Session`, a duration rung and a custom
// range say nothing about where, so the membership would be a setting with no subject — and a
// control that is always visible but only sometimes means anything is the thing `SliceBar`'s
// "a short history loses the buttons" rule already refuses. The choice itself SURVIVES the slice
// (it lives in `useTimeslice`'s store), so switching to `All` and back does not silently reset it.
//
// IT SAYS WHAT YOU ARE LOOKING AT AND NOTHING ABOUT HOW — SliceBar's rule, and the caption beside
// it is still where the membership in force is READ BACK on every glance.
//
// EACH BUTTON NOW EXPLAINS ITSELF, AND IT IS A NATIVE `title` (JOS-304, owner feedback 2026-08-13:
// the toggle is *hard to understand*). Two words are not enough to tell a reader what `every tier`
// admits, and the caption only names which of the two is on. The refusal this header used to carry
// was of a MUI TOOLTIP specifically — an interactive popper opening over a dense control row lands
// on the neighbouring buttons and eats the clicks aimed at them (JOS-143's measured reason, and
// SliceBar's). A native `title` is not a popper: it is the browser's own hover, it takes no
// pointer events, and it is the house pattern for exactly this row. The words are
// `ZONE_SCOPE_TITLE`, beside the label they explain, so a reworded button cannot leave its sentence
// behind.

import { type JSX } from 'react'
import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { ZONE_SCOPES, ZONE_SCOPE_LABEL, ZONE_SCOPE_TITLE, type ZoneScope } from '@shared/zoneScope'
import { useZoneScope } from './useTimeslice'

export interface ZoneScopeBarProps {
  /**
   * Prefix for this surface's testids: `<prefix>` and `<prefix>-<scope>`. Per surface for
   * `SliceBarProps.testId`'s reason — tabs stay mounted, so two of these can exist at once.
   */
  testId: string
}

export function ZoneScopeBar({ testId }: ZoneScopeBarProps): JSX.Element {
  const { zoneScope: scope, setZoneScope: onPick } = useZoneScope()
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      data-testid={testId}
      data-scope={scope}
      sx={{ flexWrap: 'wrap', rowGap: 1 }}
      useFlexGap
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        value={scope}
        onChange={(_e, next: ZoneScope | null) => {
          // MUI reports null when the active button is clicked again. Some membership is always in
          // force, so that is a no-op rather than an empty selection (SliceBar's rule, same reason).
          if (next) onPick(next)
        }}
      >
        {ZONE_SCOPES.map((id) => (
          <ToggleButton
            key={id}
            value={id}
            data-testid={`${testId}-${id}`}
            // Every button carries ITS OWN membership's sentence, selected or not, so the
            // difference between the two is learnable from whichever one the pointer lands on.
            title={ZONE_SCOPE_TITLE[id]}
            sx={{ px: 1.1, py: 0.25, fontSize: 11, lineHeight: 1.4, textTransform: 'none' }}
          >
            {ZONE_SCOPE_LABEL[id]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  )
}
