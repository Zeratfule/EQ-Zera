/**
 * useWindowedRows — THE WINDOW FOLLOWS THE CONTAINER, and the slice arithmetic never lies (JOS-260).
 *
 * THE DEFECT THIS PINS, as a 0.23.0 user hit it: the Loot ledger rendered about thirty rows and
 * then blank space for the rest of the list. `useWindowedRows` attached its scroll listener and its
 * ResizeObserver in effects keyed on the REF OBJECT — which is stable for the life of the
 * component, so the effects ran exactly once. `LootView` returns the item-detail takeover before it
 * renders the scroll container, so drilling into a row and coming back REPLACED that container's
 * DOM node: the listeners stayed on the detached one, `scrollTop` and `clientHeight` froze at
 * whatever they last read, and the rendered slice froze with them.
 *
 * TWO CLAIMS, two shapes of test:
 *
 *   THE ARITHMETIC is pure and is tested as such — `windowSlice` is exported for exactly this. The
 *   property that matters is the padding invariant: whatever the inputs, the two spacers plus the
 *   rendered rows must add up to the full content height, or the scrollbar describes a list of a
 *   different length than the one the user is reading. It is asserted over a table that includes
 *   the degenerate cases the old code got wrong (an empty list, a `scrollTop` far past the end, a
 *   zero `rowHeight`).
 *
 *   THE BINDING is a dependency array, which no pure function can show. `tests/hookHost.mjs` runs
 *   the real hook through React's own dispatcher seam (there is no jsdom in this repo — see that
 *   file's header), against a fake scroll container that records its listeners. The regression test
 *   is the last one: replace the container node, scroll the NEW one, and the window must advance.
 *   MEASURED against the pre-fix hook (deps `[scrollRef]`): that assertion fails with the window
 *   still reporting the first slice, and the old node is left holding its listener — which is the
 *   reporter's blank ledger, in two lines.
 *
 * The e2e half of the same guard drives the real app: seed thousands of rows, drill in, come back,
 * scroll to the bottom, and assert the last row is mounted (tests/e2e/loot-window.e2e.mts).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mountHook } from './hookHost.mjs'
import { useWindowedRows, windowSlice, type WindowedRows } from '../src/renderer/src/lib/useWindowedRows'

// ── the arithmetic ─────────────────────────────────────────────────────────────────────

/** THE INVARIANT: the spacers and the rendered rows account for every pixel of the content. */
function assertAccountsForEveryPixel(win: WindowedRows, rowHeight: number, what: string): void {
  const rendered = (win.end - win.start) * (rowHeight > 0 ? rowHeight : 1)
  assert.equal(win.topPad + rendered + win.bottomPad, win.totalHeight, `${what}: padding does not sum`)
  assert.ok(win.start >= 0, `${what}: negative start`)
  assert.ok(win.end >= win.start, `${what}: end before start`)
  assert.ok(win.topPad >= 0 && win.bottomPad >= 0, `${what}: negative spacer`)
}

test('the slice accounts for every pixel of the content, for every input', () => {
  const cases = [
    { name: 'an empty list', count: 0, rowHeight: 37, scrollTop: 0, viewport: 600, overscan: 8 },
    { name: 'a list shorter than the viewport', count: 3, rowHeight: 37, scrollTop: 0, viewport: 600, overscan: 8 },
    { name: 'the top of a long list', count: 11_000, rowHeight: 37, scrollTop: 0, viewport: 600, overscan: 8 },
    { name: 'the middle of a long list', count: 11_000, rowHeight: 37, scrollTop: 200_000, viewport: 600, overscan: 8 },
    { name: 'the very bottom', count: 11_000, rowHeight: 37, scrollTop: 11_000 * 37 - 600, viewport: 600, overscan: 8 },
    { name: 'scrolled far past the end', count: 40, rowHeight: 37, scrollTop: 9_000_000, viewport: 600, overscan: 8 },
    { name: 'a never-measured viewport', count: 11_000, rowHeight: 37, scrollTop: 0, viewport: 0, overscan: 8 },
    { name: 'a never-measured viewport, scrolled', count: 11_000, rowHeight: 37, scrollTop: 5_000, viewport: 0, overscan: 8 },
    { name: 'no overscan at all', count: 500, rowHeight: 20, scrollTop: 1_000, viewport: 300, overscan: 0 },
    { name: 'a zero row height', count: 500, rowHeight: 0, scrollTop: 1_000, viewport: 300, overscan: 8 },
    { name: 'a negative scrollTop (elastic overscroll)', count: 500, rowHeight: 37, scrollTop: -120, viewport: 600, overscan: 8 }
  ]
  for (const c of cases) assertAccountsForEveryPixel(windowSlice(c), c.rowHeight, c.name)
})

test('a scrolled window renders the rows under the viewport, plus overscan on each side', () => {
  // 600px of viewport over 37px rows is 17 rows visible; 8 rows of overscan above and below.
  const win = windowSlice({ count: 11_000, rowHeight: 37, scrollTop: 37 * 500, viewport: 600, overscan: 8 })
  assert.equal(win.start, 492)
  assert.ok(win.end >= 500 + 17, `the viewport's own rows are not all in the slice (end=${String(win.end)})`)
  assert.equal(win.topPad, 492 * 37)
  assertAccountsForEveryPixel(win, 37, 'a scrolled window')
})

test('a list scrolled past its end still renders its last row rather than nothing', () => {
  // The clamp: `start` can never exceed the last index, so a stale offset (the ledger's saved
  // scroll re-applied to a list a filter has just shortened) degrades to the end of the list.
  const win = windowSlice({ count: 40, rowHeight: 37, scrollTop: 9_000_000, viewport: 600, overscan: 8 })
  assert.equal(win.end, 40)
  assert.ok(win.start <= 39)
  assert.equal(win.bottomPad, 0)
})

test('an unmeasured viewport renders a SCREENFUL, not a handful', () => {
  // The old fallback rendered `overscan` rows (8) before the ResizeObserver spoke, which is a
  // quarter-screen of content on a first paint. A screenful is the honest guess.
  const unmeasured = windowSlice({ count: 11_000, rowHeight: 37, scrollTop: 0, viewport: 0, overscan: 8 })
  assert.ok(unmeasured.end >= 21, `only ${String(unmeasured.end)} rows on an unmeasured first paint`)
})

// ── the binding ────────────────────────────────────────────────────────────────────────

/** A scroll container, as much of one as the hook actually touches. */
class FakeScroller {
  scrollTop = 0
  clientHeight = 600
  readonly listeners = new Map<string, Set<() => void>>()
  addEventListener(type: string, fn: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>()
    set.add(fn)
    this.listeners.set(type, set)
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn)
  }
  /** How many live scroll listeners this node is holding right now. */
  get bound(): number {
    return this.listeners.get('scroll')?.size ?? 0
  }
  /** Scroll it the way a user would: move the offset, then tell whoever is listening. */
  scrollTo(px: number): void {
    this.scrollTop = px
    for (const fn of this.listeners.get('scroll') ?? []) fn()
  }
  get el(): HTMLElement {
    return this as unknown as HTMLElement
  }
}

/** Every observer the hook has constructed, so a test can prove they are disconnected as well. */
const observers: FakeResizeObserver[] = []
class FakeResizeObserver {
  target: unknown = null
  live = true
  constructor(private readonly cb: () => void) {
    observers.push(this)
  }
  observe(target: unknown): void {
    this.target = target
  }
  disconnect(): void {
    this.live = false
  }
  /** A resize, delivered the way the browser would. */
  fire(): void {
    this.cb()
  }
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver

test('the window follows the CONTAINER NODE, not the ref — the JOS-260 regression', () => {
  const first = new FakeScroller()
  const ref: { current: HTMLElement | null } = { current: null }
  const host = mountHook(() => useWindowedRows({ count: 11_000, rowHeight: 37, scrollRef: ref }))

  // MOUNT. React assigns the ref during commit, so the hook sees the node on the render after the
  // one that created it — which is what the layout effect's ref re-read is for.
  const mounted = host.act(() => {
    ref.current = first.el
  })
  assert.equal(mounted.start, 0, 'a freshly mounted list does not start at the top')
  assert.equal(first.bound, 1, 'the container was never listened to')

  const scrolled = host.act(() => {
    first.scrollTo(37 * 500)
  })
  assert.equal(scrolled.start, 492, 'scrolling the container did not advance the window')

  // THE TAKEOVER. The Loot ledger's detail pane replaces the whole body: the container unmounts
  // (React nulls the ref), and coming back mounts a DIFFERENT node under the same ref.
  host.act(() => {
    ref.current = null
  })
  assert.equal(first.bound, 0, 'the old node is still holding a scroll listener — it is detached')

  const second = new FakeScroller()
  const remounted = host.act(() => {
    ref.current = second.el
  })
  assert.equal(second.bound, 1, 'the replaced container was never listened to')
  assert.equal(remounted.start, 0, 'the new container reads scrollTop 0, so the window is back at the top')

  // THE ASSERTION THE TICKET IS ABOUT: the window advances when the REPLACED node scrolls. Before
  // the fix the listener was still on the detached node and this stayed at the frozen slice.
  const after = host.act(() => {
    second.scrollTo(37 * 900)
  })
  assert.equal(after.start, 892, 'scrolling the REPLACED container did not advance the window')
  assert.ok(after.end > after.start + 17, 'the replaced container is windowing fewer rows than it shows')

  host.unmount()
  assert.equal(second.bound, 0, 'unmounting left a listener behind')
  assert.ok(observers.length >= 2, 'the ResizeObserver was not re-made for the replaced container')
  assert.ok(
    observers.every((o) => !o.live),
    'a ResizeObserver outlived the container it was watching'
  )
})

test('a resize of the container re-measures the viewport, and a taller box renders more rows', () => {
  const box = new FakeScroller()
  box.clientHeight = 200
  const ref: { current: HTMLElement | null } = { current: null }
  const host = mountHook(() => useWindowedRows({ count: 11_000, rowHeight: 37, scrollRef: ref }))
  const short = host.act(() => {
    ref.current = box.el
  })
  // 200px / 37px = 6 rows, plus 2x8 overscan.
  assert.equal(short.end, 6 + 16)

  const observer = observers[observers.length - 1]!
  assert.equal(observer.target, box.el, 'the hook is observing something other than its container')
  const tall = host.act(() => {
    box.clientHeight = 740
    // The hook holds the ResizeObserver; the fake fires the callback the browser would.
    observer.fire()
  })
  assert.ok(tall.end > short.end, `a taller box rendered no more rows (${String(short.end)} -> ${String(tall.end)})`)
  host.unmount()
})
