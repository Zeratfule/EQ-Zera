import { createTheme, alpha } from '@mui/material/styles'
import { FONTS, NEON, PALETTE, withAlpha } from '../../../shared/palette'

// THE LOOK (EQ Zera, 2026-09-06): "Midnight & arcane" colours, retro-wave / console chrome.
// Clean and readable first — body copy and every data row stay in the body face on flat navy
// cards — with the identity carried by what surrounds them: a geometric display face on headings,
// the nav rail, buttons and tabs; a mono "readout" on the big figures; a magenta→violet→cyan rule
// wherever the old theme drew a plain divider; segmented console-style progress bars; and a faint
// grid on the page ground. No scanlines, no glow on text. The colour tokens and the font stacks
// live in src/shared/palette.ts so the overlay/tray bundles (no ThemeProvider) can match.
//
// Built in TWO steps on purpose: the scrollbar overrides below are expressed in
// PALETTE TOKENS (primary.main, common.white), so the palette has to exist as a
// resolved object before the components block can read it. `base` is that
// palette; `theme` is `base` + component overrides.
const base = createTheme({
  palette: {
    mode: 'dark',
    background: { default: PALETTE.bg, paper: PALETTE.paper },
    text: { primary: PALETTE.text },
    primary: { main: PALETTE.accent },
    secondary: { main: PALETTE.cyan },
    success: { main: PALETTE.green },
    warning: { main: PALETTE.amber },
    error: { main: PALETTE.red },
    divider: withAlpha(PALETTE.accent, 0.16)
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily: FONTS.body,
    // The display face on the heading ladder. h4 is the exception: it is only ever a NUMBER in
    // this app (the Overview's dps figure, the Leveling heroes), so it is the console readout.
    h4: { fontFamily: FONTS.mono, fontWeight: 400, letterSpacing: '0.02em' },
    h5: { fontFamily: FONTS.display, fontWeight: 700, fontSize: '1.2rem', letterSpacing: '0.04em' },
    h6: { fontFamily: FONTS.display, fontWeight: 700, fontSize: '0.95rem', letterSpacing: '0.06em' },
    overline: { fontFamily: FONTS.display, fontWeight: 500, fontSize: 10, letterSpacing: '0.16em' },
    button: { fontFamily: FONTS.display, fontWeight: 500, fontSize: 11, letterSpacing: '0.1em' }
  }
})

/** The neon hairline as a background, for anything that wants a rule without an element. */
const ACCENT_EDGE = withAlpha(PALETTE.accent, 0.18)
const GLOW = `0 0 14px ${withAlpha(PALETTE.accent, 0.35)}`

/**
 * App-wide scrollbars. Applied through CssBaseline (mounted in main.tsx).
 *
 * WHY THIS IS `::-webkit-scrollbar` ONLY, with NO `scrollbar-width` /
 * `scrollbar-color` — this is the whole fix, and it looks like a regression if
 * you don't know the rule:
 *
 *   In Blink, the standard properties and the legacy pseudo-elements are
 *   MUTUALLY EXCLUSIVE. The moment an element carries a non-initial
 *   `scrollbar-width` or `scrollbar-color`, Chromium switches that scroller to
 *   the native (Fluent, on Windows) scrollbar and IGNORES every
 *   `::-webkit-scrollbar-*` rule targeting it.
 *
 * This theme used to set BOTH on `*`, so the entire webkit block below was dead
 * code and every scroller got Chromium's native thin scrollbar instead.
 * MEASURED in Electron 33.4.11 / Chromium 130 (`offsetWidth - clientWidth` on a
 * 200px `overflow:auto` box): both properties set => 11px gutter and an accent-coloured
 * thumb (the `scrollbar-color` value); webkit-only => 10px, i.e. exactly the
 * width the rule asks for. Confirmed visually too: the native thin scrollbar
 * paints its thumb edge-to-edge across the gutter, with hover arrow buttons, so
 * a right-aligned value (the Leveling feed's dates) ends up flush against it —
 * the "scrollbar overlaps content" report.
 *
 * A custom webkit scrollbar is CLASSIC: it consumes layout width, so it can
 * never paint over content. The transparent border + `background-clip:
 * content-box` then insets the visible thumb inside that reserved gutter, which
 * is what puts real air between the content edge and the bar.
 *
 * Losing the standard properties costs nothing here: this renderer only ever
 * runs in Electron/Chromium. Do not "restore" them for Firefox parity — doing so
 * silently disables everything below.
 */
const SCROLLBAR_SIZE = 12
const THUMB_INSET = 3 // 12 - 2*3 => a 6px visible thumb, 3px clear on each side

const scrollbars = {
  // Same size on both axes, so the timeline chart's horizontal bar is treated
  // identically to a vertical list scrollbar.
  '*::-webkit-scrollbar': {
    width: SCROLLBAR_SIZE,
    height: SCROLLBAR_SIZE
  },
  '*::-webkit-scrollbar-track': {
    background: 'transparent'
  },
  '*::-webkit-scrollbar-thumb': {
    backgroundColor: alpha(base.palette.common.white, 0.22),
    borderRadius: SCROLLBAR_SIZE,
    border: `${String(THUMB_INSET)}px solid transparent`,
    backgroundClip: 'content-box'
  },
  '*::-webkit-scrollbar-thumb:hover': {
    backgroundColor: alpha(base.palette.primary.main, 0.55)
  },
  '*::-webkit-scrollbar-corner': {
    background: 'transparent'
  },
  // Styling ::-webkit-scrollbar re-enables the stepper arrows on some builds;
  // this app never wants them (they eat the gutter and look nothing like the rest
  // of the UI).
  '*::-webkit-scrollbar-button': {
    display: 'none'
  },
  // Only the document scroller reserves a gutter unconditionally. Applying
  // `scrollbar-gutter: stable` via `*` was considered and REJECTED: it makes
  // every `overflow:auto` box reserve 12px even when nothing overflows, which
  // silently steals width from panels that never scroll. The classic scrollbar
  // above already reserves its own gutter the moment it appears, which is the
  // property that actually fixes the overlap.
  'html, body': {
    scrollbarGutter: 'stable'
  }
}

/**
 * TOOLTIP ANCHORS (owner rule, 2026-08-04): anything wearing a tooltip shows the HAND.
 *
 * This is the whole app-wide mechanism, and it is three rules rather than ~130 `sx` props
 * because `lib/Tooltip.tsx` clones one class onto every anchor. See that file for why the
 * cursor cannot come from `MuiTooltip.styleOverrides` (those style the popper, which does not
 * exist until after the hover) nor from an attribute selector (`aria-describedby` only appears
 * once the tooltip is already open).
 *
 * The two exceptions are STRUCTURAL, so nobody has to remember them:
 *   - a disabled control keeps `not-allowed`. MUI's disabled buttons set `pointer-events: none`,
 *     which is why they must be wrapped in a `<span>` for a tooltip to fire at all — that span
 *     is the element the cursor is read from, so `:has()` is what makes the rule work at the
 *     level it is actually applied.
 *   - selectable text keeps its I-beam by never getting the class (`cursor="inherit"`).
 */
const tooltipAnchors = {
  '.eq-tip-anchor': { cursor: 'pointer' },
  '.eq-tip-anchor.Mui-disabled, .eq-tip-anchor:has(.Mui-disabled), .eq-tip-anchor:has(:disabled)': {
    cursor: 'not-allowed'
  }
}

/**
 * THE GROUND. A 28px grid at 4% on the page background — visible as texture where a view leaves
 * navy showing, invisible behind a card. Tabular numerals everywhere, so a column of figures in
 * the body face lines up like the readout face does.
 */
const ground = {
  body: {
    backgroundColor: PALETTE.bg,
    backgroundImage:
      `linear-gradient(${withAlpha(PALETTE.accent, 0.045)} 1px, transparent 1px), ` +
      `linear-gradient(90deg, ${withAlpha(PALETTE.accent, 0.045)} 1px, transparent 1px)`,
    backgroundSize: '28px 28px',
    fontVariantNumeric: 'tabular-nums'
  },
  '::selection': { backgroundColor: withAlpha(PALETTE.magenta, 0.35) },
  // TWO UTILITY CLASSES for the card primitive (combatShared.tsx's DashCard), which sits at the
  // max-lines ceiling and cannot afford them as sx: a label in the display face, and a header
  // whose bottom edge carries the accent fading out — a rule with no element.
  '.eq-display-label': {
    fontFamily: FONTS.display,
    fontWeight: 500,
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase'
  },
  '.eq-card-rule': {
    backgroundImage: `linear-gradient(90deg, ${withAlpha(PALETTE.accent, 0.45)}, transparent 70%)`,
    backgroundSize: '100% 1px',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'bottom'
  }
}

export const theme = createTheme(base, {
  components: {
    MuiCssBaseline: {
      styleOverrides: { ...ground, ...scrollbars, ...tooltipAnchors }
    },
    // FLAT SURFACES. No elevation gradients (MUI dark mode paints lighter paper per elevation);
    // a card is navy paper with a hairline the accent tints, and a menu or dialog is the same
    // card lifted by a shadow and a brighter edge.
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: ACCENT_EDGE },
        elevation: {
          border: `1px solid ${withAlpha(PALETTE.accent, 0.28)}`,
          boxShadow: `0 12px 32px rgba(0,0,0,0.55), ${GLOW}`
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          textTransform: 'uppercase',
          transition: 'box-shadow 140ms ease, background-color 140ms ease, border-color 140ms ease'
        },
        containedPrimary: {
          color: PALETTE.ink,
          backgroundImage: `linear-gradient(135deg, ${PALETTE.magenta}, ${PALETTE.accent})`,
          '&:hover': { backgroundImage: `linear-gradient(135deg, ${PALETTE.magenta}, ${PALETTE.accent})`, boxShadow: GLOW }
        },
        outlined: { borderColor: withAlpha(PALETTE.accent, 0.5), '&:hover': { boxShadow: GLOW } },
        sizeSmall: { fontSize: 10, letterSpacing: '0.08em' }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 3 },
        outlined: { borderColor: withAlpha(PALETTE.accent, 0.3) }
      }
    },
    MuiTabs: {
      styleOverrides: {
        indicator: { height: 2, backgroundImage: NEON, boxShadow: `0 0 8px ${withAlpha(PALETTE.accent, 0.6)}` }
      }
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontFamily: FONTS.display,
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          minHeight: 40
        }
      }
    },
    // THE CONSOLE HEALTH BAR: a segmented fill. The segments are a mask on the bar element, so
    // every `LinearProgress` in the tree — determinate or not — reads as a row of cells.
    MuiLinearProgress: {
      styleOverrides: {
        root: { height: 8, borderRadius: 1, backgroundColor: withAlpha(PALETTE.accent, 0.12) },
        bar: {
          borderRadius: 0,
          WebkitMaskImage: 'repeating-linear-gradient(90deg, #000 0 6px, transparent 6px 8px)',
          maskImage: 'repeating-linear-gradient(90deg, #000 0 6px, transparent 6px 8px)'
        },
        barColorPrimary: { backgroundImage: `linear-gradient(90deg, ${PALETTE.accent}, ${PALETTE.cyan})` }
      }
    },
    // THE NEON HAIRLINE stands in for every horizontal divider; a vertical one stays a plain edge.
    MuiDivider: {
      styleOverrides: {
        root: {
          '&:not(.MuiDivider-vertical)': {
            border: 0,
            height: 1,
            backgroundImage: `linear-gradient(90deg, ${withAlpha(PALETTE.accent, 0.4)}, ${withAlpha(PALETTE.cyan, 0.18)} 60%, transparent)`
          }
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: withAlpha(PALETTE.accent, 0.1) },
        head: {
          fontFamily: FONTS.display,
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: base.palette.text.secondary,
          borderBottomColor: withAlpha(PALETTE.accent, 0.3)
        }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: withAlpha(PALETTE.accent, 0.25) },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: withAlpha(PALETTE.accent, 0.5) },
          '&.Mui-focused': { boxShadow: `0 0 0 3px ${withAlpha(PALETTE.accent, 0.18)}` }
        }
      }
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: PALETTE.paper,
          color: PALETTE.text,
          border: `1px solid ${withAlpha(PALETTE.accent, 0.3)}`,
          fontSize: 12,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
        },
        arrow: { color: PALETTE.paper, '&::before': { border: `1px solid ${withAlpha(PALETTE.accent, 0.3)}` } }
      }
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 4,
          // The rule along the top edge, the way the title bar wears it.
          '&::before': { content: '""', display: 'block', height: 2, backgroundImage: NEON }
        }
      }
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 2 } }
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          '&.Mui-selected': { backgroundColor: withAlpha(PALETTE.accent, 0.12) },
          '&.Mui-selected:hover': { backgroundColor: withAlpha(PALETTE.accent, 0.18) }
        }
      }
    }
  }
})
