// DragGrip — THE GLYPH THAT SAYS "PICK ME UP HERE" (2026-09-10).
//
// The three strips' positioning frames are draggable everywhere except their own controls: the
// overlay root wears `chrome.dragRegion` while unlocked (useOverlayChrome.ts) and the slider, the
// stepper and Done each wear `no-drag`. That is the mechanism, and it has always worked — but a
// rectangle that can be picked up looks exactly like one that cannot, and this frame is the ONLY
// thing the app ever tells the user to drag. So the frame prints the affordance.
//
// ONE COMPONENT, THREE FRAMES, because it is one glyph and three copies of it would be three
// glyphs the first time one of them changed. It takes a testid rather than deriving one: the three
// strips' selectors are spelled per kind everywhere else in this bundle, and a spec looking for the
// celebration strip's grip should not have to know this file exists.
//
// IT NEVER SHRINKS. The prose beside it is the give on a narrow strip (it ellipsises); the grip is
// the part of the row that has to survive, because it is what the sentence is pointing at.
//
// MUI-FREE like everything else in the overlay bundle — no theme, no component library.

import type { JSX } from 'react'
import { PALETTE } from '../../../shared/palette'

/** Two columns of dots: a grab handle in the vocabulary every list reorder control uses. */
const GLYPH = '⋮⋮'

export function DragGrip({ testId }: { testId: string }): JSX.Element {
  return (
    <span
      aria-hidden
      data-testid={testId}
      style={{
        flexShrink: 0,
        color: PALETTE.accent,
        // Letter-spacing rather than a gap: the two columns are one glyph, and a flex gap would let
        // them come apart at a text scale.
        letterSpacing: 1,
        fontSize: 13,
        lineHeight: 1,
        cursor: 'move'
      }}
    >
      {GLYPH}
    </span>
  )
}
