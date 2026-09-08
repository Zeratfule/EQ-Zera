// hoverCardLayer — places a feed hover card near its anchor and clamps it inside the overlay
// window. Plain React + inline styles; the overlay bundle stays MUI-free.

import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { overlayCssZoom } from './overlayScale'
import { onOverlayPointerExit } from './pointerExit'

/** Gap the hover card keeps from its anchor AND from every window edge. */
const CARD_MARGIN = 4

/** Where the card sits and how big it may get — all four in the card's OWN (zoomed) space. */
interface Placement {
  left: number
  top: number
  maxW: number
  maxH: number
}

/**
 * Places a hover card near its anchor and CLAMPS it inside the window.
 *
 * `position: fixed`, not absolute-in-the-row: the feed is an `overflow:auto` scroll box inside an
 * `overflow:hidden` shell, so a card positioned within a row would be clipped by the scroller
 * (and, worse, could grow its scroll extent). Fixed coordinates are measured against the
 * VIEWPORT — the overlay window itself — which is also the only frame that matters here: this
 * window is small and routinely parked against a screen edge.
 *
 * Placement: above the anchor by preference (the feed reads newest-first, so a card below would
 * cover the rows you're scanning), flipped below when there's no room, then clamped on both
 * axes so it can never hang off any edge. Re-runs whenever the card's own size changes — the
 * MUI ItemWindow arrives lazily and its icon later still, so the first measurement is never the
 * last one. Hidden until placed, so it never flashes at 0,0.
 *
 * `pointerEvents: none` is load-bearing: the card has nothing to click (no links, no nested
 * hover), and a card that took the pointer while overlapping its own anchor would fire the
 * anchor's mouseleave, unmount itself, and flicker.
 *
 * IT ALSO LEAVES WITH THE POINTER, EVEN WHEN THE ROW IS NEVER TOLD (JOS-358). This card IS the
 * feature — it survived the tooltip sweep — but it is orphaned by the same missing leave a native
 * tooltip is: it mounts on the row's `mouseenter` and unmounts on the row's `mouseleave`, and an
 * always-on-top window whose cursor jumps onto the game need never see that second event. So it
 * subscribes to the ONE definition of "the pointer left this window" (overlay/pointerExit.ts)
 * rather than growing a second opinion, and `onDismiss` is the owning row's own close path — this
 * layer never unmounts itself behind the state that mounted it.
 */
export function HoverCardLayer({
  anchor,
  onDismiss,
  children
}: {
  anchor: HTMLElement
  /** the anchor row's own "no card" setter — the same one its `mouseleave` calls. */
  onDismiss: () => void
  children: React.ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<Placement | null>(null)

  useEffect(() => onOverlayPointerExit(onDismiss), [onDismiss])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const place = (): void => {
      const a = anchor.getBoundingClientRect()
      const c = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const m = CARD_MARGIN
      let top = a.top - c.height - m
      if (top < m) top = a.bottom + m
      if (top + c.height > vh - m) top = Math.max(m, vh - m - c.height)
      let left = a.left
      if (left + c.width > vw - m) left = vw - m - c.width
      if (left < m) left = m
      // Everything above is in VISUAL pixels — rects and innerWidth/Height all carry the text
      // scale of the content pane this card is rendered inside. The numbers below are written
      // back INSIDE that zoomed pane, where they get multiplied by the same scale again, so each
      // one is divided once here. It is also why the max sizes are set from these numbers rather
      // than from `calc(100vw - …)`, which the zoom would inflate past the window edge.
      //
      // This is the ONLY layer that converts: the selector popup hangs off the header, which is
      // unscaled chrome, so it measures and places in one space (overlayScale.tsx).
      const z = overlayCssZoom(el)
      const next: Placement = { left: left / z, top: top / z, maxW: (vw - 2 * m) / z, maxH: (vh - 2 * m) / z }
      setPos((p) =>
        p &&
        Math.abs(p.left - next.left) < 0.5 &&
        Math.abs(p.top - next.top) < 0.5 &&
        p.maxW === next.maxW &&
        p.maxH === next.maxH
          ? p
          : next
      )
    }
    place()
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(place)
    })
    ro.observe(el)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [anchor])

  return (
    <div
      ref={ref}
      data-testid="feed-hover-card"
      style={{
        position: 'fixed',
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 20,
        pointerEvents: 'none',
        maxWidth: pos?.maxW,
        maxHeight: pos?.maxH,
        overflow: 'hidden'
      }}
    >
      {children}
    </div>
  )
}
