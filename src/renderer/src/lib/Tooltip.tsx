import { cloneElement, type JSX } from 'react'
import MuiTooltip, { type TooltipProps as MuiTooltipProps } from '@mui/material/Tooltip'

/**
 * THE app's Tooltip. Import this everywhere; never `Tooltip` from `@mui/material` directly.
 *
 * WHY A WRAPPER EXISTS AT ALL (owner rule, 2026-08-04): "anything wearing a tooltip shows the
 * HAND". A hoverable thing has to LOOK hoverable before it is hovered — the tooltip itself can't
 * teach you it is there, because you only see it once you have already stopped. The affordance
 * has to be the cursor, and it has to be on the ANCHOR, which is the one element MUI's own
 * theming cannot reach: `MuiTooltip`'s `styleOverrides` style the POPPER, and the popper does
 * not exist until the hover has already happened. Nor is there a stable attribute on the anchor
 * to hang CSS off (`aria-describedby` is added on OPEN, so a rule keyed on it would flip the
 * cursor a beat late, and later still behind an `enterDelay`).
 *
 * So the cursor rides a CLASS this component clones onto its child, and the class's one rule
 * lives in the theme (`theme.ts`, applied through CssBaseline) rather than in ~130 per-site `sx`
 * props. `className` is the right vehicle because both halves of the tree accept it: a DOM
 * element takes it natively, and every MUI component forwards it to its root. Layout is
 * untouched — no wrapper element is introduced, so nothing moves.
 *
 * The two honest EXCEPTIONS are handled without a prop at the call site:
 *   - a DISABLED control keeps `not-allowed` (the theme's `:has(.Mui-disabled)` rule, which also
 *     catches the `<span>` a disabled MUI button has to be wrapped in for its tooltip to work);
 *   - text whose real affordance is SELECTION keeps its I-beam — pass `cursor="inherit"` and the
 *     class is never applied.
 */
export interface TooltipProps extends MuiTooltipProps {
  /**
   * `'pointer'` (default) marks the child as a tooltip anchor and it shows the hand.
   * `'inherit'` opts out entirely — for anchors whose own affordance must win (selectable ids,
   * a text field the user types into).
   */
  cursor?: 'pointer' | 'inherit'
}

/** The class the theme's cursor rules key on. Exported for tests, not for hand-application. */
export const TIP_ANCHOR_CLASS = 'eq-tip-anchor'

export function Tooltip({ cursor = 'pointer', children, ...rest }: TooltipProps): JSX.Element {
  if (cursor === 'inherit') return <MuiTooltip {...rest}>{children}</MuiTooltip>
  const existing = (children.props as { className?: string }).className
  const child = cloneElement(children, {
    className: existing ? `${existing} ${TIP_ANCHOR_CLASS}` : TIP_ANCHOR_CLASS
  } as Partial<unknown> & { className: string })
  return <MuiTooltip {...rest}>{child}</MuiTooltip>
}

export default Tooltip
