// useFocusLanding — WHERE A LEVEL-UP TOAST'S DEEP LINK ACTUALLY PUTS YOU (JOS-330).
//
// THE LINK WAS TRUE AND THE ARRIVAL WAS SILENT. Clicking "Level 24!" on the celebration overlay
// has always mounted the Leveling tab with `NewAtLevelPanel` anchored at 24 (the focusLevel /
// focusNonce contract, docs/plans/levelup-whats-new.md §2 and appRouting.ts's nonce law). Since
// JOS-300 that panel sits at the BOTTOM of the left column on a page-tall view, so what the reader
// actually saw was the top of a tab full of charts, with the thing they clicked for a screen and a
// half below the fold and nothing saying so. A link that lands you in the right ROOM is not the
// same as a link that lands you on the thing.
//
// So a landing is two moves, and this hook owns both because they share one trigger and one clock:
//
//   1. SCROLL IT INTO THE ONE SCROLLER. `[data-testid="app-content"]` is the only scroller between
//      a view and the window (JOS-289), which is exactly why the move can be a plain
//      `scrollIntoView` on the panel: with nothing else scrolling, "scroll the panel into the
//      content area" and "scroll the panel into view" are the same sentence. The ancestor is found
//      with `closest`, never `querySelector`, so this measures the box the panel is actually in.
//
//   2. LIGHT IT. A brief accent-coloured pulse on the panel's own edge, held for `LANDING_HIGHLIGHT_MS` and
//      then gone — the PrefSectionBlock arrival pulse's reasoning applied to a second surface: the
//      user clicked a sentence in one window and got a tab in another, and the highlight is the
//      only thing connecting the two ends. Under `prefers-reduced-motion: reduce` the animation is
//      replaced by a static outline held for the same interval, so the INFORMATION survives even
//      when the movement must not.
//
// THE SCROLL WAITS FOR LAYOUT, AND IT WAITS ON REACT RATHER THAN ON FRAMES. The panel's own
// content arrives after mount (`useLevelUnlocks` is an IPC pull) and the charts above it render
// from a module snapshot, so a single scroll fired at consumption time aims at a layout that is
// about to change under it. The obvious fix — a `requestAnimationFrame` settle loop — is the wrong
// one HERE: AGENTS.md records rAF being throttled to roughly nothing in a never-composited window,
// which is every e2e launch, so a frame-driven landing would be both slower and untestable. The
// cheap, honest signal is React's own: every commit that could have moved this panel re-renders it
// (LevelingView hands it a fresh props object), so the corrective scroll rides an effect with NO
// dependency array and simply runs after each commit while a landing is in flight. It re-aims only
// when the panel is not already fully inside the content box, so a settled layout costs one
// `getBoundingClientRect` per render for two seconds and nothing else.
//
// THE HIGHLIGHT DOES NOT WAIT FOR THE SCROLL, deliberately. The two are decoupled so a slow layout
// can never eat the cue — the pulse starts the instant the link is consumed and expires on its own
// clock, whatever the scroll is still chasing.
//
// AND IT RE-FIRES ON A REPEAT OF THE SAME LEVEL, which is the entire reason the nonce exists.
// Ding at 24 twice and the second card must land you exactly as the first did. That is why `seq`
// carries the NONCE rather than a boolean: `NewAtLevelPanel` keys the pulse element on it, so a
// repeat mounts a new element and the CSS animation restarts from zero instead of being ignored as
// an unchanged style. A plain tab switch (`openLeveling()` with no level, Overview's card) bumps
// the same nonce with `armed` false and must do neither thing — it cancels any landing in flight
// rather than starting one, because nothing sent the reader anywhere in particular.

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { SxProps, Theme } from '@mui/material'
import { PALETTE, withAlpha } from '../../../../shared/palette'

/** The app's ONE scroller (App.tsx). Found with `closest`, so it is the real ancestor or nothing. */
const CONTENT = '[data-testid="app-content"]'

/** How long the arrival highlight stays up: two 1000 ms pulses, then the panel is ordinary again. */
export const LANDING_HIGHLIGHT_MS = 2000

/**
 * The pulse itself, drawn by a child element rather than by the Paper.
 *
 * A child because the RESTART is the requirement: MUI/emotion would serialize an identical `sx` on
 * a repeat link to the identical class, and a CSS animation that is already running does not
 * restart when its own class is re-applied. A separate element keyed on the nonce sidesteps the
 * whole question — a new key is a new element is a new animation — and it also keeps the pulse off
 * the Paper's own `borderColor`, so the panel's resting outline is never something this has to
 * remember to put back.
 *
 * `inset: 0` + `borderRadius: inherit` traces the panel exactly; `pointerEvents: none` keeps it out
 * of every hit test on the tab (levelingLayoutSteps hit-tests the stepper INSIDE this box).
 * The colour is the theme's accent (`PALETTE.accent`, `primary.main`) — spelled via `withAlpha` because
 * the pulse fades its alpha and a palette token cannot.
 */
export const LANDING_PULSE_SX: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
  borderRadius: 'inherit',
  pointerEvents: 'none',
  border: '1px solid transparent',
  '@keyframes eqcLevelLand': {
    '0%': { borderColor: withAlpha(PALETTE.accent, 0), boxShadow: `0 0 0 0 ${withAlpha(PALETTE.accent, 0)}` },
    '30%': { borderColor: withAlpha(PALETTE.accent, 0.9), boxShadow: `0 0 0 3px ${withAlpha(PALETTE.accent, 0.35)}` },
    '100%': { borderColor: withAlpha(PALETTE.accent, 0), boxShadow: `0 0 0 0 ${withAlpha(PALETTE.accent, 0)}` }
  },
  animation: 'eqcLevelLand 1000ms ease-out 2',
  '@media (prefers-reduced-motion: reduce)': {
    animation: 'none',
    borderColor: withAlpha(PALETTE.accent, 0.9),
    boxShadow: `0 0 0 2px ${withAlpha(PALETTE.accent, 0.3)}`
  }
}

/**
 * Bring `el` fully inside the content scroller, or leave it alone if it already is.
 *
 * `block` is chosen by whether the panel FITS: centred when it does, which reads as "here it is"
 * rather than "here is its bottom edge", and top-aligned when it does not, because the alternative
 * for an over-tall panel is showing the reader its middle. The one-pixel slack absorbs subpixel
 * layout; the height guard skips an element that has not been laid out yet, since there is nothing
 * to aim at and the next commit will bring us back.
 */
function bringIntoContent(el: HTMLElement | null): void {
  if (!el) return
  const r = el.getBoundingClientRect()
  if (r.height < 1) return
  const box = el.closest(CONTENT)
  if (!box) {
    // No content ancestor is not a state this app produces, but a panel rendered outside the shell
    // (a test bed, a future embed) should still do the obvious thing rather than nothing.
    el.scrollIntoView({ block: 'nearest' })
    return
  }
  const b = box.getBoundingClientRect()
  if (r.top >= b.top - 1 && r.bottom <= b.bottom + 1) return
  el.scrollIntoView({ block: r.height <= b.height ? 'center' : 'start' })
}

/** What the panel needs from a landing: where to hang the ref, and which nonce (if any) is lit. */
export interface FocusLanding {
  ref: RefObject<HTMLDivElement>
  /** the nonce currently being landed, or null when nothing is. Doubles as the pulse's React key. */
  seq: number | null
}

/**
 * Run the arrival for one deep link.
 *
 * @param armed  did this link carry an anchor? `false` is a plain tab switch and lands nothing.
 * @param nonce  the routing nonce — the ONLY trigger, so the same level twice arrives twice.
 * @param apply  what the caller does with the anchor (set the level, tell the router it is spent).
 *               Read from a ref so a fresh closure each render never re-triggers the landing.
 */
export function useFocusLanding(armed: boolean, nonce: number, apply: () => void): FocusLanding {
  const ref = useRef<HTMLDivElement>(null)
  const [seq, setSeq] = useState<number | null>(null)
  const applyRef = useRef(apply)
  applyRef.current = apply

  // THE TRIGGER, and the nonce is deliberately its only dependency (the standing idiom in this
  // codebase — LootView, CombatView, QuestAccordion). `armed` is read at the instant the nonce
  // moves rather than watched: a link's anchor is a fact about that link, not a value that changes
  // under it. An unarmed bump CANCELS whatever was lit, so Overview's plain "open Leveling" card
  // cannot leave a highlight burning on a panel nobody asked for.
  useEffect(() => {
    if (!armed) {
      setSeq(null)
      return undefined
    }
    applyRef.current()
    setSeq(nonce)
    const timer = setTimeout(() => setSeq(null), LANDING_HIGHLIGHT_MS)
    return () => {
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  // THE CORRECTIVE SCROLL: no dependency array on purpose (see the header). While a landing is in
  // flight this runs after every commit and re-aims only if the panel has drifted out of the
  // content box — which is what the charts and the unlock pull do to it in the first second.
  useEffect(() => {
    if (seq === null) return
    bringIntoContent(ref.current)
  })

  return { ref, seq }
}
