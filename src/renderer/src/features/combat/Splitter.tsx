// ONE DRAG HANDLE between two panels - the Combat tab's resizable layout (combatLayout.ts).
//
// In-house rather than a dependency: the whole job is a pointer drag, five keys and a
// double-click, and the layout it drives is plain CSS grid/flex the Combat tab already owned.
//
// THE HANDLE KNOWS NOTHING ABOUT WHAT IT RESIZES. It is handed a value in its caller's units (a
// fraction, or the log's px), the bounds that value may take at the current size, and how many of
// those units one CSS px of pointer travel is worth. Dragging PREVIEWS (local state in the caller,
// so nothing is written to storage sixty times a second) and releasing COMMITS once. A key press
// commits immediately: it is one discrete step, exactly like a release.
//
// ACCESSIBLE AS THE ARIA SEPARATOR PATTERN: `role="separator"`, focusable, `aria-valuenow` with
// its min/max, arrow keys step 16 px (Shift: 64 px), Home/End jump to the bounds, and
// Enter or a double-click puts that one split back to its default.

import { useEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { HANDLE_PX } from './combatLayout'

const STEP_PX = 16
const BIG_STEP_PX = 64

export interface SplitterProps {
  /** 'x': the handle sits between side-by-side panels and drags left/right. 'y': up/down. */
  axis: 'x' | 'y'
  value: number
  bounds: { lo: number; hi: number }
  /** caller units per CSS px of travel toward +x/+y. Negative when moving the handle down SHRINKS
   *  the value (the log: its handle is on its top edge). */
  perPx: number
  onPreview: (v: number) => void
  onCommit: (v: number) => void
  onReset: () => void
  label: string
  testId: string
  /** how the value reads to a screen reader: a fraction as a percent, the log in px. */
  unit: 'percent' | 'px'
  /** hidden below md, where the dashboard is one scrolling column with nothing to split. */
  wideOnly?: boolean
}

function clamp(v: number, b: { lo: number; hi: number }): number {
  return Math.min(b.hi, Math.max(b.lo, v))
}

/** The key's direction in screen space: -1 toward the start (left/up), +1 toward the end. */
function keyDirection(key: string, axis: 'x' | 'y'): number {
  if (axis === 'x') return key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
  return key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0
}

function ariaNumber(v: number, unit: 'percent' | 'px'): number {
  return Math.round(unit === 'percent' ? v * 100 : v)
}

interface Drag {
  pointerId: number
  start: number
  from: number
  last: number | null
}

function keyHandler(p: SplitterProps): (ev: React.KeyboardEvent) => void {
  return (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault()
      p.onReset()
      return
    }
    if (ev.key === 'Home' || ev.key === 'End') {
      ev.preventDefault()
      p.onCommit(ev.key === 'Home' ? p.bounds.lo : p.bounds.hi)
      return
    }
    const dir = keyDirection(ev.key, p.axis)
    if (dir === 0) return
    ev.preventDefault()
    const px = (ev.shiftKey ? BIG_STEP_PX : STEP_PX) * dir
    p.onCommit(clamp(p.value + px * p.perPx, p.bounds))
  }
}

export function Splitter(p: SplitterProps): React.JSX.Element {
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)
  const onKeyDown = keyHandler(p)
  const pos = (ev: React.PointerEvent): number => (p.axis === 'x' ? ev.clientX : ev.clientY)

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>): void => {
    if (ev.button !== 0) return
    // No text selection while dragging; focus is taken by hand because preventDefault stops the
    // browser giving it, and the focused handle is what shows the user which split they hold.
    ev.preventDefault()
    ev.currentTarget.focus()
    ev.currentTarget.setPointerCapture(ev.pointerId)
    drag.current = { pointerId: ev.pointerId, start: pos(ev), from: p.value, last: null }
    setDragging(true)
  }
  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (d?.pointerId !== ev.pointerId) return
    d.last = clamp(d.from + (pos(ev) - d.start) * p.perPx, p.bounds)
    p.onPreview(d.last)
  }
  const end = (ev: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (d?.pointerId !== ev.pointerId) return
    drag.current = null
    setDragging(false)
    // A click that never moved commits nothing - which is what keeps a double-click's two
    // presses from writing the old value back over the reset.
    if (d.last !== null) p.onCommit(d.last)
  }

  const vertical = p.axis === 'x'
  return (
    <Box
      role="separator"
      tabIndex={0}
      aria-label={p.label}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={ariaNumber(p.value, p.unit)}
      aria-valuemin={ariaNumber(p.bounds.lo, p.unit)}
      aria-valuemax={ariaNumber(p.bounds.hi, p.unit)}
      aria-valuetext={p.unit === 'percent' ? `${String(ariaNumber(p.value, p.unit))}%` : `${String(ariaNumber(p.value, p.unit))} px`}
      data-testid={p.testId}
      data-dragging={dragging ? '1' : '0'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={p.onReset}
      onKeyDown={onKeyDown}
      sx={handleSx(vertical, p.wideOnly === true)}
    />
  )
}

/** The gap IS the handle: transparent but for a short grip, a full-length line on hover, focus and
 *  drag. */
function handleSx(vertical: boolean, wideOnly: boolean): object {
  const line = vertical
    ? { top: 0, bottom: 0, left: '50%', width: 2, transform: 'translateX(-50%)' }
    : { left: 0, right: 0, top: '50%', height: 2, transform: 'translateY(-50%)' }
  const grip = vertical
    ? { top: 'calc(50% - 12px)', height: 24, left: '50%', width: 2, transform: 'translateX(-50%)' }
    : { left: 'calc(50% - 12px)', width: 24, top: '50%', height: 2, transform: 'translateY(-50%)' }
  return {
    position: 'relative',
    display: wideOnly ? { xs: 'none', md: 'block' } : 'block',
    flexShrink: 0,
    [vertical ? 'width' : 'height']: HANDLE_PX,
    minWidth: 0,
    minHeight: 0,
    cursor: vertical ? 'col-resize' : 'row-resize',
    touchAction: 'none',
    outline: 'none',
    '&::before': { content: '""', position: 'absolute', borderRadius: 1, bgcolor: 'divider', ...grip },
    '&::after': { content: '""', position: 'absolute', borderRadius: 1, bgcolor: 'transparent', ...line },
    '&:hover::after': { bgcolor: 'divider' },
    '&:focus-visible::after, &[data-dragging="1"]::after': { bgcolor: 'primary.main' }
  }
}

/**
 * A box's content size, live. ResizeObserver on the element the split lives IN, so the bounds a
 * handle offers (and the fraction actually drawn) follow the window. Identity-guarded: a re-fire
 * with the same box re-renders nothing.
 */
export function useBoxSize(ref: React.RefObject<HTMLElement>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (!cr) return
      const w = Math.round(cr.width)
      const h = Math.round(cr.height)
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}
