// TextScaleStepper — the overlay windows' TEXT SIZE control (owner feedback, 2026-08-05: "text
// size scaling for overlays. we are old folks now.").
//
// A− / A+, one TEXT_SCALE_STEP a press, clamped at both ends. ONE component for all four kinds:
// the meters and the event log put it in their footer beside the bg slider, the celebration
// toast in the drag frame that is its only chrome. A stepper rather than a slider because this
// is a reading-distance decision with maybe four useful answers, and a 0.1 detent you can hit
// blind beats a 4px-tall track over a moving game.
//
// INTERACTIVE MODE ONLY, like every other knob out here — a locked overlay is click-through and
// shows no chrome at all, so each caller already renders this behind its own `!locked`.
//
// MUI-FREE, like the rest of this bundle; the button styling is the footer's existing one.

import type { JSX } from 'react'
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN, TEXT_SCALE_STEP, clampTextScale } from '@shared/types'
import type { OverlayChrome } from './useOverlayChrome'

// NO HOVER, AN ARIA NAME INSTEAD (JOS-358). These two sit in the FOOTER, and the owner's ruling is
// that the overlay windows carry tooltips only in the title bar. `A−` / `A+` state what they do;
// the percentage the hover used to add is the one thing lost, and it is a number you read off the
// text in front of you the moment you press either one.
function StepButton({
  label,
  name,
  onClick,
  disabled
}: {
  label: string
  /** the accessible name — never a tooltip. */
  name: string
  onClick: () => void
  disabled: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={name}
      style={{
        background: 'rgba(255,255,255,0.06)',
        color: 'inherit',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 4,
        padding: '1px 5px',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        fontSize: 10,
        lineHeight: 1.4
      }}
    >
      {label}
    </button>
  )
}

export function TextScaleStepper({
  textScale,
  patch,
  noDrag
}: {
  textScale: number
  patch: OverlayChrome['patch']
  /** the caller's `no-drag` style: these buttons sit inside a drag region in every kind. */
  noDrag: React.CSSProperties
}): JSX.Element {
  // Clamp HERE as well as in the store: the disabled ends stop the common case, and a value that
  // arrived from anywhere else must not walk out of range through this control either.
  const step = (dir: 1 | -1): void => patch({ textScale: clampTextScale(textScale + dir * TEXT_SCALE_STEP) })
  // The percentage is the honest reading of what the buttons did — the scale itself is a factor
  // nobody asked for in those terms.
  const pct = `${Math.round(textScale * 100)}%`

  return (
    // NEVER SHRINKS. It sits in a one-row footer beside a slider that does: a button clipped
    // mid-glyph is the control you needed and could not press (owner, 2026-08-05).
    <span style={{ ...noDrag, display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <StepButton
        label="A−"
        name={`Smaller text (${pct})`}
        onClick={() => step(-1)}
        disabled={textScale <= TEXT_SCALE_MIN}
      />
      <StepButton
        label="A+"
        name={`Larger text (${pct})`}
        onClick={() => step(1)}
        disabled={textScale >= TEXT_SCALE_MAX}
      />
    </span>
  )
}
