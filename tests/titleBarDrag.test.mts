// titleBarDrag — the title bar's double-click test (JOS-204).
//
// THE REPORT: rapidly checking and unchecking an overlay in the title bar's Overlay menu toggled
// the main window between maximized and windowed. The menu is a MUI portal, so its clicks bubble
// the REACT tree into the title bar's `onDoubleClick` while its DOM node sits under <body> — and
// the old guard, `e.target.closest('[data-no-drag]')`, is a DOM-tree question that walked past
// every marker in the bar and found nothing. Two clicks in a hurry = maximize.
//
// WHAT THIS FILE CAN AND CANNOT SAY. It owns the DECISION in both directions — the drag surface
// still maximizes, a portaled node never does — which is the half the e2e cannot assert without
// showing a window on the owner's desktop (`BrowserWindow.maximize()` shows a hidden window, so
// the positive case cannot be driven in a suite whose whole test mode is "no window is ever
// shown"). What it cannot say is that React really does bubble a portal's events into this
// handler; that is the seam the defect lived in, and tests/e2e/title-bar.e2e.mts drives it in a
// real window with the real MUI Menu.
//
// THE FAKE DOM, and its bargain. `isDragSurfaceDoubleClick` asks a real `Element` exactly two
// questions, both with textbook semantics: `contains` is subtree containment (a node contains
// itself) and `closest` walks self-then-ancestors for a selector. This file models those two and
// nothing else, so the fake cannot drift into modelling a DOM feature the predicate does not use;
// `closest` here asserts it was asked for the one selector the app ever passes, so a change of
// marker shows up as a test failure rather than a silently-always-null answer.

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isDragSurfaceDoubleClick } from '../src/renderer/src/components/titleBarDrag'

/** The only selector the predicate is allowed to ask for. */
const NO_DRAG = '[data-no-drag]'

interface FakeEl {
  parent: FakeEl | null
  noDrag: boolean
  contains: (other: FakeEl | null) => boolean
  closest: (selector: string) => FakeEl | null
}

/** A node in a fake DOM: a parent link, a `data-no-drag` marker, and the two methods. */
function el(parent: FakeEl | null = null, noDrag = false): FakeEl {
  const node: FakeEl = {
    parent,
    noDrag,
    // Subtree containment, self included — the DOM's own rule.
    contains(other: FakeEl | null): boolean {
      for (let n = other; n; n = n.parent) if (n === node) return true
      return false
    },
    // Self, then ancestors, first match wins — the DOM's own rule.
    closest(selector: string): FakeEl | null {
      assert.equal(selector, NO_DRAG, 'the predicate asked for a selector this fake does not model')
      for (let n: FakeEl | null = node; n; n = n.parent) if (n.noDrag) return n
      return null
    }
  }
  return node
}

const decide = (bar: FakeEl, target: FakeEl | null): boolean =>
  isDragSurfaceDoubleClick(bar as unknown as Element, target as unknown as Element | null)

test('the bar itself is a drag surface — double-clicking its padding maximizes', () => {
  const bar = el()
  assert.equal(decide(bar, bar), true)
})

test('a plain child of the bar is a drag surface — the brand text, the spacer', () => {
  const bar = el()
  const brand = el(bar)
  assert.equal(decide(bar, brand), true)
  // Nested arbitrarily deep: a <span> inside the brand <p> is still the bar.
  assert.equal(decide(bar, el(brand)), true)
})

test('a control inside the bar does NOT maximize — the window buttons, the gear, the picker', () => {
  const bar = el()
  const controls = el(bar, true)
  assert.equal(decide(bar, controls), false)
  // The click lands on the icon inside the button, which is what `closest` is for.
  assert.equal(decide(bar, el(el(controls))), false)
})

test('THE DEFECT: a portaled child never maximizes, even unmarked', () => {
  // The DOM the report describes: the menu is under <body>, beside the bar, marked with nothing —
  // React puts its events on this handler anyway. `closest` alone answers "no marker, so it is
  // drag surface"; containment answers "not in this bar", which is the truth.
  const body = el()
  const bar = el(body)
  const menuItem = el(el(el(body)))
  assert.equal(menuItem.closest(NO_DRAG), null, 'the portal carries no marker — that is the case')
  assert.equal(decide(bar, menuItem), false)
})

test('…and a portal that DOES carry the marker is refused for the same reason', () => {
  // Belt and braces: whichever question is asked first, a node outside the bar loses.
  const body = el()
  const bar = el(body)
  assert.equal(decide(bar, el(el(body), true)), false)
})

test('a null target is not a drag surface', () => {
  assert.equal(decide(el(), null), false)
})
