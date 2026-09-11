// OverlayMoveRow — MOVE THIS OVERLAY / RESET POSITION / PREVIEW, for all three strips (2026-09-10).
//
// THE REPORT: "We need a way to move the celebration overlays" (owner). There already was one —
// this row replaces a "Move it" SWITCH that did exactly the same thing — and the whole ticket is
// about why nobody could find it:
//
//   * A SWITCH DESCRIBES A STATE; MOVING IS AN ACTION. "Move it: off" reads as a preference
//     somebody else already decided, and the thing it would unlock is an INVISIBLE window, so there
//     was no second clue anywhere on screen. A button labelled with a verb is the fix, and it is
//     the whole of the fix: the mechanism underneath is unchanged.
//   * THERE WAS NO WAY BACK. A strip dragged onto a monitor that is now unplugged had no shipped
//     position to return to. Reset position is that, and MAIN decides what "where it shipped" means
//     (src/main/overlayMove.ts) — this row never computes a rectangle.
//   * AND NO WAY TO SEE WHERE A CARD WOULD LAND. You positioned an empty rectangle and waited for a
//     raid target to die to find out. Preview draws the real thing for a few seconds.
//
// ONE COMPONENT FOR THREE CARDS because it is one row: the three strips differ in what they SHOW
// and in nothing about how they are placed, and three copies of this would be three answers the
// first time one of them changed. The three Setting files pass their kind, their testid prefix and
// the noun their caption speaks about.
//
// STATE, NEVER PROCESS (the repo's UI law): the caption says what is true of the window now, not
// how the lock is implemented. Nothing here mentions IPC, `setIgnoreMouseEvents` or a window
// handle — but it does say CLICK-THROUGH in the player's own words, because that is the observable
// fact a locked strip has and the reason moving one needs a button at all.

import { type JSX, useState } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import OpenWithIcon from '@mui/icons-material/OpenWith'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import VisibilityIcon from '@mui/icons-material/Visibility'
import type { OverlayKind } from '@shared/types'

/**
 * WHAT THE ROW SAYS, IN ONE SENTENCE, whichever strip it is under.
 *
 * The two halves are the two states, and both are facts about the window rather than about the
 * setting: locked it is not there at all as far as the game is concerned, unlocked it is a dashed
 * rectangle you can pick up. Said ONCE, under the row, because it explains the whole row and not
 * one button of it.
 */
const CAPTION =
  'Locked, the overlay is invisible and clicks pass through to the game. Unlocked, it shows a dashed frame you can drag.'

/** What the row says while the frame is up. It is an instruction, because at that moment the user
 *  is being asked to do something in ANOTHER window. */
const UNLOCKED_LABEL = 'Unlocked: drag the dashed frame on screen, then click Done'

/** How long the "Position reset" note stands. Long enough to be read by somebody who was looking
 *  at the button they pressed, short enough that it is gone before it becomes furniture. */
const NOTE_MS = 4_000

export function OverlayMoveRow({
  kind,
  testId,
  open,
  locked,
  onLockedChange
}: {
  kind: OverlayKind
  /** The card's own testid prefix — `toast`, `banner`, `con-card`. The three were already spelled
   *  this way by the switches this row replaces, so every existing selector still reads. */
  testId: string
  /** Is the strip switched on? Only PREVIEW needs this: a window that does not exist cannot show a
   *  sample, while Move deliberately works anyway — it opens the window for as long as the frame is
   *  up (main/overlayMove.ts) so a strip you have never turned on can still be placed. */
  open: boolean
  locked: boolean
  onLockedChange: (locked: boolean) => void
}): JSX.Element {
  const [note, setNote] = useState('')

  const move = (moving: boolean): void => {
    onLockedChange(!moving)
    window.eq.setOverlayMoving(kind, moving)
  }

  const reset = (): void => {
    void window.eq.resetOverlayBounds(kind).then(() => {
      setNote('Position reset')
      setTimeout(() => setNote(''), NOTE_MS)
    })
  }

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {locked ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenWithIcon fontSize="small" />}
            data-testid={`pref-${testId}-move`}
            onClick={() => move(true)}
          >
            Move this overlay
          </Button>
        ) : (
          <>
            {/* The instruction comes FIRST while the frame is up: the button beside it is what you
                press when you have finished, and the sentence is what tells you there is something
                to finish. */}
            <Typography variant="body2">{UNLOCKED_LABEL}</Typography>
            <Button
              size="small"
              variant="contained"
              data-testid={`pref-${testId}-move-done`}
              onClick={() => move(false)}
            >
              Done
            </Button>
          </>
        )}
        <Button
          size="small"
          variant="outlined"
          startIcon={<RestartAltIcon fontSize="small" />}
          data-testid={`pref-${testId}-reset`}
          onClick={reset}
        >
          Reset position
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!open}
          startIcon={<VisibilityIcon fontSize="small" />}
          data-testid={`pref-${testId}-preview`}
          onClick={() => window.eq.previewOverlay(kind)}
        >
          Preview
        </Button>
        {note && (
          <Typography variant="caption" color="success.main" data-testid={`pref-${testId}-reset-note`}>
            {note}
          </Typography>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {CAPTION}
      </Typography>
    </Stack>
  )
}
