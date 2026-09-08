// scopeFloor — WHOSE DAMAGE, said from the PANEL FLOOR instead of the title bar (JOS-121).
//
// THE MOVE. JOS-115 retired the overlay's inline scope CONTROL and kept the WORD as a read-only
// tag in the header row, beside FIGHT / HEAL · ZONE. That word then sat in the most contested
// 380 pixels this app owns: the same row carries the live dot, the kind tag, the fight selector
// (whose title is a mob name and ellipsizes), the rate, the lock and the close — and the row is
// also the window's ONLY drag handle. A word that never changes between one fight and the next
// was paying rent in the one place where a long mob name and a reachable drag strip compete.
//
// So the word left the title bar entirely and came back here: understated background text at the
// bottom of the meter panel. Same sentence, same helper (`chipLabel` — one phrasing, two
// renderers, the healRows.ts rule), no chrome around it, and the whole freed title-bar width
// went to the selector and the drag gutter (OverlayHeader).
//
// WHAT IT MUST STILL BE ABLE TO SAY, and the reason the word survived JOS-115 at all: a meter
// that is filtering rows out has to say so WHERE THE ROWS ARE MISSING, and `Group (no roster
// yet)` is the sentence explaining a Group-scoped meter that is showing everybody (roster law 1's
// fallback). That long form is the hardest case for a floor watermark — it is longest exactly
// when the meter is widest open and the panel is fullest of bars — which is why the floor is
// RESERVED rather than shared (see FLOOR_H below). The word is never the thing that got covered.
//
// IT IS NOT CHROME, AND IT DOES NOT VANISH WHEN LOCKED. The header tag did, on the JOS-115 rule
// that a pinned click-through window is chrome-free. That rule was about things you reach for;
// this is a watermark you read, it is `pointerEvents: none` so it is click-through with the panel
// rather than merely beside it, and a LOCKED meter is precisely the one that has no selector and
// no controls left to explain why a name is missing from it. So it stays in both modes, and the
// lock changes nothing about it. Since JOS-358 the word is ALL it says — see ScopeFloorText.
//
// MUI-FREE ON PURPOSE, like every file in this bundle.

import type { JSX } from 'react'
import { OverlayContent } from './overlayScale'
import type { CaptureReason } from './useOverlayChrome'

/**
 * The reserved strip at the bottom of the bars pane, in unscaled chrome pixels.
 *
 * RESERVED, not shared. The watermark is absolutely positioned in a band the scrolling pane is
 * padded out of, so a bar can never come to rest on top of it and it can never come to rest on
 * top of a bar — "never occluding bars, never competing with data" is structural here rather than
 * a promise about opacity. The price is this many pixels of bar room (under one 18px row), paid
 * once, in exchange for a sentence that is always legible.
 */
const FLOOR_H = 12

/**
 * What the floor says: the scope word, already through `chipLabel`. THE WORD, AND NOTHING ELSE —
 * the hover it used to carry (what this scope means, and where the choice lives) went with JOS-358,
 * the owner's ruling that the overlay windows keep tooltips only in the title bar. It cost nothing
 * here: the watermark is `pointerEvents: none`, so that sentence was already unreachable by a
 * pointer, and the place the choice actually lives is Preferences > Combat, which is where the
 * setting explains itself (features/preferences/MeterScopeSetting.tsx).
 */
export interface ScopeFloorText {
  label: string
}

/**
 * The watermark itself. Low-contrast, uppercase, right-aligned at the panel floor — the corner a
 * meter puts a provenance mark in, far from the bar labels on the left and below the totals on
 * the right.
 *
 * UNSCALED. It sits outside `OverlayContent`, so the A− / A+ text scale does not reach it: the
 * scale is for the reading matter (the bars), and a watermark that grew with it would be the one
 * thing on the panel demanding attention at 2.0.
 */
export function ScopeFloor({ label }: ScopeFloorText): JSX.Element {
  return (
    <div
      data-testid="overlay-scope-floor"
      style={{
        position: 'absolute',
        left: 6,
        right: 6,
        bottom: 0,
        height: FLOOR_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        // THE CLICK-THROUGH HALF, and the whole of it: the panel below a locked meter's header
        // offers no hit target, and this must not become the exception. It also keeps the word
        // from swallowing a drag or a bar click while the overlay is interactive.
        pointerEvents: 'none',
        userSelect: 'none',
        fontSize: 9,
        letterSpacing: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: 'rgba(255,255,255,0.22)'
      }}
    >
      {label}
    </div>
  )
}

/**
 * The meter's body: the scrolling bars pane with the scope watermark on its floor.
 *
 * ONE component because the damage meter and the healing meter must not drift on this — the
 * reserved band, the testid the e2e measures the click-through contract on, and the watermark's
 * position are one decision, and JOS-115 already paid for the version of this where two files
 * each held their own copy of the scope readout.
 *
 * It also forwards the SCROLL GRIP (JOS-138) for the same reason: "a pinned meter scrolls at its
 * right edge and passes clicks through everywhere else" is one contract, and the two meters may
 * not hold two opinions about where that edge is.
 */
export function MeterPane({
  textScale,
  scope,
  locked,
  capture,
  notice,
  children
}: {
  textScale: number
  scope: ScopeFloorText
  /** pinned: the mode the grip exists in (overlayScale.OverlayContent) */
  locked?: boolean
  /** the named-reason sensor from useOverlayChrome */
  capture?: (reason: CaptureReason, active: boolean) => void
  /**
   * A TIMED OVERLAY ON THE CONTENT BACKGROUND (JOS-258 — overlay/petNudgeCard.tsx).
   *
   * It comes in as a slot rather than as a prop describing the thing, so this file keeps owning
   * ONE question — where the pane's absolutely-positioned furniture is allowed to sit — without
   * learning anything about pets. The damage meter fills it; the healing meter passes nothing, and
   * that asymmetry is deliberate: an unbound pet's missing row is a DAMAGE row.
   */
  notice?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        minHeight: 0,
        // The reserved floor (see FLOOR_H): the pane stops here, so the scroller's last row and
        // the watermark can never share a pixel.
        paddingBottom: FLOOR_H
      }}
    >
      <OverlayContent textScale={textScale} testId="overlay-bars" locked={locked} capture={capture}>
        {children}
      </OverlayContent>
      <ScopeFloor {...scope} />
      {notice}
    </div>
  )
}
