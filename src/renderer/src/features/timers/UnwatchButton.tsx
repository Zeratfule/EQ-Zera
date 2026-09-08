// THE UNWATCH CONTROL, drawn once for both MUI surfaces in the Timers tab (JOS-194, round 4).
//
// The owner's ruling is that unwatching lives ON THE MOB wherever you meet it, and the failure mode
// a ruling like that invites is three controls that look and read differently depending on which
// panel you happen to be in. So the clock row and the Recently-killed entry render THIS — same
// word, same tooltip, same size — and the Recently-killed entry places it exactly where its Watch
// button sits, which is what makes the pair read as one toggle rather than two unrelated buttons.
//
// The floating window cannot import it (that bundle is MUI-free and draws plain divs), but it takes
// the same LABEL out of `shared/respawn.ts`, so the wording is one definition on all three.
//
// WHY A WORD AND NOT AN ICON. A trash can says "delete", and this deletes nothing the log cannot
// restate — it stops a clock and keeps every kill behind it. That promise is what makes the control
// safe with no confirmation step, and it is a property of the WRITE (`respawnWithoutWatch` touches
// one entry of the watch list and nothing else), not of anything the button says.
//
// AND IT SAYS NOTHING (owner ruling, round 7 addendum). It carried a tooltip stating the two
// consequences until the owner deleted it: the control speaks for itself. So there is no Tooltip
// wrapper here at all — not an empty one, not a shortened string — and the two facts live in
// shared/respawn.ts's header where they are argued rather than recited.

import { Button } from '@mui/material'
import type { JSX } from 'react'
import { RESPAWN_UNWATCH_LABEL } from '@shared/respawn'

/**
 * THE SHAPE OF BOTH HALVES OF THE TOGGLE — worn by Unwatch here and by the Recently-killed entry's
 * Watch button, which is the one place the two states swap in and out of the same slot.
 *
 * Exported for exactly that reason: MUI upper-cases button text by default, so leaving Watch on the
 * default gave a candidate list that read "WATCH" one second and "Unwatch" the next. Two spellings
 * of one control read as two controls, which is the thing this round exists to stop.
 */
export const RESPAWN_TOGGLE_SX = {
  py: 0,
  minWidth: 0,
  fontSize: 11,
  textTransform: 'none',
  flexShrink: 0
} as const

export function UnwatchButton({
  mobKey,
  display,
  testId,
  onUnwatch
}: {
  mobKey: string
  /**
   * The name as the log printed it. Kept on the props after the tooltip that used it was deleted,
   * because it is the ACCESSIBLE name of the control — a screen reader on a list of clocks would
   * otherwise hear "Unwatch" a dozen times with nothing to tell them apart.
   */
  display: string
  /** Which surface this one is, so an e2e can click the row's and the candidate's separately. */
  testId: string
  onUnwatch: (key: string) => void
}): JSX.Element {
  return (
    <Button
      size="small"
      variant="outlined"
      color="inherit"
      data-testid={testId}
      aria-label={`${RESPAWN_UNWATCH_LABEL} ${display}`}
      sx={RESPAWN_TOGGLE_SX}
      onClick={(e) => {
        // The row itself carries a hover card and, in the candidate list, a click target of its own;
        // a click on this button is about this button (the confirm button's rule).
        e.stopPropagation()
        onUnwatch(mobKey)
      }}
    >
      {RESPAWN_UNWATCH_LABEL}
    </Button>
  )
}
