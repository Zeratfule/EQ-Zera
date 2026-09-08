// THE PET NUDGE, AS THE PLAYER SEES IT (JOS-258).
//
// One sentence, laid over the meter's own content background, for a little while after a pet
// summon that nothing has bound. It is the owner's ruling rendered literally:
//
//   NOT OVERLY WORDY        one line of copy and no second sentence. There is no tooltip, no
//                           "why am I seeing this", no link to preferences. The UI convention this
//                           repo already runs on (the tooltip and caveat diet) says the label earns
//                           its keep or it goes, and this label's whole job is to name the two
//                           keystrokes that fix the thing.
//   IN OVERLAY, ON THE
//   CONTENT BACKGROUND      absolutely positioned inside the bars pane rather than stacked above
//                           it, so it never reflows a row, never resizes the window, and cannot
//                           become a banner the meter is permanently shorter for. It sits over the
//                           top of the pane because that is where a freshly-summoned pet's row is
//                           NOT (an unbound pet has no row at all - that is the whole defect).
//   TIMES OUT               there is no dismiss button and no local state. The engine's snapshot
//                           carries the nudge or it does not; this renders exactly that, poll by
//                           poll (useOverlayCombat re-asks every second). A component that
//                           remembered anything could disagree with the engine about whether the
//                           window is still open, and that disagreement is what "staleness" means.
//
// CLICK-THROUGH LIKE THE REST OF THE PANE (`pointerEvents: 'none'`, the ScopeFloor rule): a pinned
// meter offers no hit target below its header, and a coaching hint is precisely the thing that must
// not become the exception - it would eat a click aimed at the game underneath it.
//
// MUI-FREE, like every file in this bundle.

import type { JSX } from 'react'
import type { PetSummonNudge } from '@shared/combat'
import { PALETTE, withAlpha } from '../../../shared/palette'

/**
 * THE COPY, and it is the owner's own sentence (ruling 2026-08-12).
 *
 * A NORMAL DASH WITH SPACES, never an em dash - the repo-wide copy rule, guarded by
 * tests/copyNoEmDash.test.mts. `/pet who leader` is typed verbatim in the game, so it is quoted as
 * the player must type it and nothing is abbreviated away from it.
 */
export const PET_NUDGE_TEXT = 'Pet summoned - order it once or type /pet who leader so the meter can see it'

/**
 * The card. Nothing to configure: it either has a nudge to draw or renders nothing at all, which is
 * the state it is in for all but forty-five seconds of a session.
 */
export function PetNudgeCard({ nudge }: { nudge: PetSummonNudge | undefined }): JSX.Element | null {
  if (!nudge) return null
  return (
    <div
      data-testid="overlay-pet-nudge"
      style={{
        position: 'absolute',
        left: 4,
        right: 4,
        top: 3,
        // ABOVE the bars, and above the scope watermark, because it is the only thing on the panel
        // with a deadline. Everything else there can be read on the next poll.
        zIndex: 2,
        pointerEvents: 'none',
        userSelect: 'none',
        padding: '3px 6px',
        borderRadius: 4,
        // The meter's own dark panel colour at near-full opacity, so the sentence is legible over
        // whatever bar it happens to land on, plus the app's accent as a single edge - the accent
        // this window already uses for "this is the app talking", never a new colour.
        background: 'rgba(20,24,30,0.92)',
        borderLeft: `2px solid ${withAlpha(PALETTE.accent, 0.85)}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
        fontSize: 10,
        lineHeight: 1.3,
        color: 'rgba(255,255,255,0.86)'
      }}
    >
      {PET_NUDGE_TEXT}
    </div>
  )
}
