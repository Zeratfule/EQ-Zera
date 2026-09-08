// THE COMBAT AREA'S ONE SEGMENTED-CONTROL CHROME — the pill track every Dashboard/Timeline,
// Fight/Overall, Outgoing/Incoming and (JOS-361) Damage breakdown/Mitigation switch wears.
//
// It lived inside CombatHeader.tsx while the header was the only surface with switches on it. The
// in-card tabs JOS-361 added are a SECOND place that has to look like the first — and the ticket's
// own wording is "follow the app's existing in-card tab idiom … do not invent a new control" — so
// the chrome moved to a file both can import rather than being exported out of a component module
// or, worse, re-picked at the new call site. The three weights and the argument for each are
// below, unchanged from where they were written.
//
// No JSX and no component here on purpose: this is a style object, so it stays a `.ts` module the
// way `combatPrefs.ts` sits beside `useCombatPrefs.ts`.

import type { SxProps, Theme } from '@mui/material'
import { PALETTE, withAlpha } from '../../../../shared/palette'

/**
 * Chrome for the combat area's segmented controls. All of them used to be identical `small`
 * ToggleButtonGroups sitting in a row, which is what made the header read as a toolbar dump:
 * three outlined boxes of equal weight, none of them obviously the important one. They are
 * now one SHAPE (a low borderless pill track) at three different WEIGHTS, so the eye ranks
 * them instead of scanning them:
 *   - `primary` — the view switch (Dashboard/Timeline). It is the NAVIGATION of this tab, so
 *                 it is the only control wearing the accent: an accent-tinted track behind the
 *                 selection and accent text on it.
 *   - `quiet`   — a control that lives INSIDE another unit rather than beside it: the scope
 *                 (Fight/Overall) inside the subject affordance, and the meter card's own
 *                 Damage breakdown/Mitigation tabs inside that card (JOS-361). A plain light
 *                 wash, so it reads as part of the thing it sits in.
 *   - `text`    — the direction filter (Outgoing/Incoming): no track at all, just text that
 *                 brightens when active. It filters what one panel lists; it is not a mode.
 *
 * UNSELECTED IS NOT DISABLED. The direction pair used to render its inactive half in
 * `text.disabled`, which is the same colour the app uses for things you cannot click — so the
 * one word you are meant to click ("Incoming") read as dead text. Every unselected option here
 * is `text.secondary` and lifts on hover; `text.disabled` is now reserved for the genuinely
 * disabled case (Timeline with no event ring), which is what it should have meant all along.
 */
export function segmented(weight: 'primary' | 'quiet' | 'text'): SxProps<Theme> {
  const selected =
    weight === 'primary'
      ? { bgcolor: withAlpha(PALETTE.accent, 0.20), color: 'primary.main' }
      : weight === 'quiet'
        ? { bgcolor: 'rgba(255,255,255,0.10)', color: 'text.primary' }
        : // no track behind the pair, so the ACTIVE one carries a faint wash of its own —
          // colour + weight alone are too weak a signal at 11px.
          { bgcolor: 'rgba(255,255,255,0.09)', color: 'text.primary' }
  return {
    flexShrink: 0,
    ...(weight === 'text' ? null : { bgcolor: 'rgba(255,255,255,0.04)', borderRadius: 1, p: '2px' }),
    '& .MuiToggleButtonGroup-grouped': {
      border: 0,
      borderRadius: '5px !important',
      px: weight === 'text' ? 0.5 : 1,
      py: '1px',
      minHeight: 0,
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1.7,
      letterSpacing: 0,
      textTransform: 'none',
      color: 'text.secondary',
      '&:hover': { bgcolor: 'rgba(255,255,255,0.06)', color: 'text.primary' },
      '&.Mui-selected': { ...selected, fontWeight: 700 },
      '&.Mui-selected:hover': selected,
      // The ONE thing in this bar that is allowed to look dead, and only when it truly is.
      '&.Mui-disabled': { color: 'text.disabled', '&:hover': { bgcolor: 'transparent' } }
    }
  }
}
