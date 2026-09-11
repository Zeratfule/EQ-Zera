// ToastOverlay — the 'toast' overlay kind (docs/plans/celebration-toasts.md).
//
// A transparent strip at the top of the screen that USUALLY RENDERS NOTHING. Main pushes one
// finished payload per celebration (`toast:card`); this component queues, times and dismisses
// it locally. It is a sibling of OverlayMeter / EventLogOverlay in the same overlay.html bundle
// (kind from `?kind=`), so it inherits their per-kind config, their persisted bounds and their
// lock semantics — and, being MUI-free like them, it stays cheap to paint over the game.
//
// ALL THE TIMING IS IN toastQueue.ts, as a pure reducer over an explicit `dtMs`. This file owns
// exactly one interval and one rule about the mouse.
//
// THE MOUSE RULE (T2): the window is PERSISTENT while enabled and fully click-through when the
// queue is empty — an invisible strip must never eat a click meant for the game. The moment a
// card is on screen the renderer asks main to flip `setIgnoreMouseEvents(false)` so hover-pin
// and the reward click work, and it flips back the moment the last card leaves. Only while
// LOCKED: an unlocked (interactive) toast is being positioned, and must keep the pointer.
//
// INTERACTIVE MODE is how you move it. Locked, there is nothing to grab — by design, since the
// window is empty most of the time. Unlocked (Preferences → Overlays → "Move this overlay"), the
// strip shows its outline and a drag bar, so "configurable position later" is the mechanism
// every other overlay already has rather than a new one.
//
// THE ONE EXCEPTION TO "RENDERS NOTHING" IS THE INTRODUCTION (JOS-83, `useIntroduction` below):
// the first time this overlay ever comes up on an install it queues ONE card naming itself, so a
// user who has never triggered a celebration is not left staring at an anonymous rectangle.
//
// AND THE WINDOW FOLLOWS THE STACK (2026-09-08). The owner's report against 1.19.2: "the overlay
// pop ups when quest items drop and what not doesn't look like a complete bubble. The bottom of the
// bubble appears cut off." The lane was a fixed 560x360 times the text scale, and a quest-item card
// — chrome row, title, subtitle, the item card, up to three quest blocks — is taller than that, so
// the card was clipped at the window's bottom edge. A boss or a level card fits, which is why it
// took a quest drop to find it. The fix is the con card's mechanism, shared rather than reinvented:
// `useFitWindowHeight` below measures the CONTENT box and asks main for a window that tall
// (overlayFit.ts), and main clamps it (overlayLayout.ts `fittedOverlayHeight`). Only the height
// moves — persisted bounds still own the position and the width.

import { type JSX, type Dispatch, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { DEFAULT_TOAST_CONFIG, introToastPayload, type ToastPayload } from '@shared/toast'
import type { OverlayConfig } from '@shared/types'
import { ToastCard } from './ToastCard'
import { ScaledContent } from './overlayScale'
import { useUnpinOnPointerExit } from './cardQueue'
import { toastReduce, type ToastAction, type ToastCardState } from './toastQueue'
import { TextScaleStepper } from './TextScaleStepper'
import { BgAlphaSlider } from './BgAlphaSlider'
import { DragGrip } from './DragGrip'
import { useOverlayChrome, type OverlayChrome } from './useOverlayChrome'
import { fitChanged, overlayFitRequest } from './overlayFit'
import { PALETTE, withAlpha } from '../../../shared/palette'

/** How often the queue's clocks advance. 100 ms is imperceptible against a 6 s hold and costs
 *  nothing: the reducer returns the SAME array when no card moved, so React re-renders only
 *  when something actually changed. */
const TICK_MS = 100

/** The window's own inset, on every side. Chrome pixels: the root is outside ScaledContent, and
 *  the fit adds it back on both edges (overlayFit.ts `overlayFitRequest`). */
const PAD = 6

/**
 * The smallest window this strip will ever ASK for.
 *
 * Not a floor on what it can be — main owns that (`OVERLAY_MIN_SIZE`, 90) — but a floor on what
 * this renderer is willing to claim it measured. A measurement taken in the frame between a card
 * leaving and the next one mounting is a few pixels of empty wrapper, and shrinking a live
 * notification lane to a sliver on the strength of it would be a visible collapse in front of the
 * card that is about to arrive. 120 is a card's chrome row and its title: below that there is
 * nothing a celebration could be.
 */
const FIT_MIN_PX = 120

const ACCENT = PALETTE.accent

/**
 * WHAT THE FRAME SAYS (2026-09-10, owner: "we need a way to move the celebration overlays").
 *
 * The old line was "Drag me where celebrations should appear", which describes the drag and not the
 * window: somebody who has just pressed Move this overlay in Preferences and is now looking at a
 * dashed rectangle over their game needs to be told WHAT THIS RECTANGLE IS — it is where the cards
 * come out — and how to finish. Two sentences, and the second names the button beside it.
 */
const FRAME_TEXT = 'Celebration cards appear here. Drag to move, then Done.'

/**
 * The positioning frame, shown only while the overlay is unlocked.
 *
 * It is also where the TEXT SIZE and the TRANSPARENCY live for this kind, for the same reason the
 * drag handle does: the toast has no header and no footer to hang a control off — it renders
 * nothing at all most of the time — so this frame is the only chrome it ever shows. Preferences →
 * Overlays → "Move this overlay" is therefore the whole route to all three knobs: move it, size it,
 * fade it, Done. (The `bg` slider arrived in JOS-407; until then this kind's 0.72 was not settable.)
 */
function DragFrame({
  onDone,
  textScale,
  bgAlpha,
  patch,
  noDrag
}: {
  onDone: () => void
  textScale: number
  bgAlpha: number
  patch: OverlayChrome['patch']
  noDrag: React.CSSProperties
}): JSX.Element {
  return (
    <div
      data-testid="toast-drag-frame"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 8,
        padding: '6px 10px',
        borderRadius: 8,
        border: `1px dashed ${ACCENT}`,
        background: withAlpha(PALETTE.bg, 0.65),
        color: ACCENT,
        fontSize: 11
      }}
    >
      {/* THE GRAB HANDLE (2026-09-10). The whole frame already drags — the root carries
          `chrome.dragRegion` while unlocked and every control in here carries `no-drag` — but a
          rectangle that can be picked up looks exactly like one that cannot, and this frame is the
          only thing the user was ever told to drag. See DragGrip.tsx. */}
      <DragGrip testId="toast-drag-grip" />
      {/* The PROSE is the give on a narrow strip; the three controls beside it are the whole point
          of the frame and stay whole at every width. */}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {FRAME_TEXT}
      </span>
      <BgAlphaSlider bgAlpha={bgAlpha} patch={patch} noDrag={noDrag} />
      <TextScaleStepper textScale={textScale} patch={patch} noDrag={noDrag} />
      <button
        type="button"
        onClick={onDone}
        style={{
          ...noDrag,
          flexShrink: 0,
          border: `1px solid ${ACCENT}`,
          borderRadius: 4,
          background: 'transparent',
          color: ACCENT,
          fontSize: 11,
          padding: '2px 8px',
          cursor: 'pointer'
        }}
      >
        Done
      </button>
    </div>
  )
}

/**
 * Keep main's click-through state in step with the queue.
 *
 * PASS-THROUGH IS THE SAFE ANSWER, so it is also the answer BEFORE the persisted config
 * arrives: a transparent strip across the top of the screen that captured the mouse for even a
 * few frames at startup would eat a click aimed at the game, and the user would have no idea
 * what did it. Once the config is known: unlocked (being positioned) keeps the mouse
 * unconditionally; locked captures it only while a card is actually on screen.
 */
function useMouseCapture(ready: boolean, locked: boolean, hasCards: boolean): void {
  useEffect(() => {
    const ignore = !ready ? true : locked ? !hasCards : false
    window.eqOverlay.setIgnoreMouse(ignore)
  }, [ready, locked, hasCards])
}

/**
 * THE INTRODUCTION (JOS-83): the one card this overlay ever shows about ITSELF.
 *
 * A brand-new user reported the celebration strip as a rectangle they took for a malfunction —
 * the window is on by default and, until something is celebrated, it draws literally nothing to
 * say what it is. Painting a permanent label would trade that rare confusion for a constant one
 * (an empty, invisible, click-through strip is exactly why the kind can default on), so the
 * overlay introduces itself ONCE, through the queue it already has: a labelled card with the same
 * close button as every other, plus a button that switches the overlay off for good.
 *
 * ONCE PER INSTALL, and the flag is written the moment the card is queued rather than when it
 * leaves: a second window (or a reload) mid-introduction must not stack a second copy, and the
 * store is the only place two renderers can agree. A store with no `introduced` key reads false,
 * so installs that predate this see it too — they are precisely the ones that have been living
 * with the unlabelled strip.
 */
function useIntroduction(
  config: OverlayConfig | null,
  patch: (p: Partial<OverlayConfig>) => void,
  dispatch: Dispatch<ToastAction>
): void {
  const doneRef = useRef(false)
  useEffect(() => {
    // Nothing is decided until the persisted answer is in hand — the same rule `ready` exists for.
    if (doneRef.current || !config) return
    doneRef.current = true
    if (config.toast?.introduced === true) return
    dispatch({ type: 'show', payload: introToastPayload() })
    patch({ toast: { ...DEFAULT_TOAST_CONFIG, ...config.toast, introduced: true } })
  }, [config, patch, dispatch])
}

/**
 * THE WINDOW FOLLOWS THE STACK — measure what was drawn, tell main, once per change.
 *
 * THIS IS THE CON CARD'S HOOK (JOS-386, ConCardOverlay `useFitWindowHeight`), applied to the second
 * fit kind, and every argument in its header holds here word for word:
 *
 *   WHAT IS MEASURED is the wrapper holding the drag frame and the scaled cards, plus the root's
 *   own padding. Never the root itself — the root is `height: 100%` of the window whose height this
 *   decides, so measuring it would only ever answer "whatever I already am".
 *
 *   IT MEASURES ON EVERY RENDER, in a LAYOUT effect, and the ResizeObserver is the second net. An
 *   overlay window under `EQ_E2E=1` is never shown and therefore never composited, and Chromium can
 *   stop delivering ResizeObserver callbacks and `requestAnimationFrame` in such a window entirely.
 *   A layout effect runs on React's schedule and `getBoundingClientRect` forces layout, so the fit
 *   works in a window that never paints. Everything a toast draws changes through React anyway (a
 *   card arriving, a card leaving, the text scale); the observer is there for the rest — an item
 *   icon that resolved late, a quest step that rewrapped.
 *
 *   IT IS DEBOUNCED TO A MACROTASK, not to a frame, for the same reason: a frame callback would be
 *   a debounce that in a hidden window never fires. The debounce is also what collapses "three
 *   cards arrived at once" into one resize.
 *
 * WHAT IS THIS KIND'S OWN is `quiet`, and it is a stack rather than a single card: an EMPTY lane
 * says nothing at all (the window renders nothing, so its height is nobody's business, and a
 * shrink-then-grow around every celebration would be thrash the user can see), and neither does a
 * stack with a card fading out — collapsing the window under an exiting card would replace the fade
 * with a snap, and whatever is left re-measures a beat later anyway.
 */
function useFitWindowHeight(el: HTMLElement | null, quiet: boolean): void {
  /** The last height sent, so a stack that did not move sends nothing. */
  const sent = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const quietRef = useRef(quiet)
  quietRef.current = quiet

  const measure = (): void => {
    if (el === null || quietRef.current) return
    if (timer.current !== null) return
    timer.current = setTimeout(() => {
      timer.current = null
      if (el === null || quietRef.current) return
      const want = Math.max(FIT_MIN_PX, overlayFitRequest(el.getBoundingClientRect().height, PAD))
      if (!fitChanged(sent.current, want)) return
      sent.current = want
      window.eqOverlay.fitHeight(want)
    }, 0)
  }

  // Every render: a card arrived or left, the drag frame appeared, or the text scale moved.
  useLayoutEffect(measure)

  // …and anything React did not cause. Torn down with the element it watches.
  useEffect(() => {
    if (el === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `measure` reads its inputs by ref
  }, [el])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    []
  )
}

export default function ToastOverlay(): JSX.Element {
  const chrome = useOverlayChrome()
  const [cards, dispatch] = useReducer(toastReduce, [] as ToastCardState[])
  useIntroduction(chrome.config, chrome.patch, dispatch)

  // A toast overlay with nothing queued renders literally nothing — that empty, transparent,
  // click-through window IS the resting state, and it is why the window can stay open forever.
  useEffect(() => {
    return window.eqOverlay.onToast((payload: ToastPayload) => dispatch({ type: 'show', payload }))
  }, [])

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'tick', dtMs: TICK_MS }), TICK_MS)
    return () => clearInterval(id)
  }, [])

  useMouseCapture(chrome.ready, chrome.locked, cards.length > 0)
  // A pointer that left without saying so must not leave a card pinned forever (JOS-381) — the
  // strip's own route into the stuck state, argued at `useUnpinOnPointerExit` (cardQueue.ts).
  useUnpinOnPointerExit(cards, dispatch)
  // THE WINDOW FOLLOWS THE STACK (2026-09-08). State rather than a ref, so the hook's observer is
  // stood up on the render the wrapper mounts rather than the one after it. The drag frame counts
  // as content: it is the whole chrome this kind ever shows, and a window fitted to an empty lane
  // would cut it in half.
  const [fitEl, setFitEl] = useState<HTMLDivElement | null>(null)
  const frameUp = chrome.ready && !chrome.locked
  useFitWindowHeight(fitEl, (cards.length === 0 && !frameUp) || cards.some((c) => c.exitingMs !== null))

  return (
    <div
      data-testid="toast-overlay"
      /* 100%, NOT 100vw/100vh — a viewport unit inside the scaled cards is resolved against the
         window and then zoomed (overlayScale). */
      style={{ width: '100%', height: '100%', padding: PAD, boxSizing: 'border-box', ...chrome.dragRegion }}
    >
      {/* THE MEASURED BOX: everything the window has to be tall enough for, and nothing that is
          sized BY the window. `fit-content`, never the root's 100% — a box that filled the window
          could only ever measure back the height it already has. */}
      <div ref={setFitEl} data-testid="toast-fit" style={{ height: 'fit-content' }}>
        {/* The drag frame is CHROME: unscaled, so "Done" and A− / A+ stay inside the strip at 2.0
            — the one route to both knobs must not be the thing the scale pushes off screen. It is
            INSIDE the measured box for the con card's reason: the frame stays in the window at
            every text scale, and a window fitted to the cards alone would clip it. */}
        {frameUp && (
          <DragFrame
            onDone={chrome.toggleLock}
            textScale={chrome.textScale}
            bgAlpha={chrome.bgAlpha}
            patch={chrome.patch}
            noDrag={chrome.noDrag}
          />
        )}
        {/* The cards ARE the content — no scroll pane, because this kind renders nothing most of
            the time and a strip that could scroll would be a window, which is what it is not.
            What a scroll pane would have been for, the window's own height now is. */}
        <ScaledContent textScale={chrome.textScale}>
          {cards.map((c) => (
            <ToastCard
              key={c.payload.id}
              payload={c.payload}
              exiting={c.exitingMs !== null}
              bgAlpha={chrome.bgAlpha}
              onHover={(over) => dispatch({ type: 'hover', id: c.payload.id, over })}
              onDismiss={() => dispatch({ type: 'dismiss', id: c.payload.id })}
            />
          ))}
        </ScaledContent>
      </div>
    </div>
  )
}
