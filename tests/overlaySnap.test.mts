// ============================================================================
// overlaySnap.test.mts — the opt-in magnetism an overlay drag gets (JOS-217).
// ============================================================================
//
// The feature's whole risk is geometry: a magnet that pulls to the wrong edge, that pulls from
// across the desktop, or that pulls at all for a user who never asked for it. All three are pure
// questions, so all three are answered here — `src/shared/overlaySnap.ts` imports nothing, which
// is what lets this file describe a three-monitor desktop with several overlays on it in a few
// lines. The Electron half (src/main/overlaySnapDrag.ts) is one `will-move` listener over these
// functions and carries no arithmetic of its own.
//
// NINE CLAIMS, and the first two are owner rulings rather than behaviours:
//
//   1. IT IS HELD (JOS-359). `SNAP_RELEASE_HOLD` is on, so EVERY read of the preference is false —
//      including a store that says `enabled: true`, which is the install that switched it on while
//      it was shipping. Nothing snaps for anybody this release.
//   2. THE MACHINERY UNDER THE HOLD IS INTACT. `DEFAULT_OVERLAY_SNAP.enabled` is false, garbage
//      reads as false, and a patch that names nothing keeps what was stored — read through
//      `mergeOverlaySnap`, because the hold makes those unobservable through the normalizer. This
//      is what makes the one-line re-enable a working preference rather than a broken one.
//   3. NOTHING IN RANGE ⇒ THE SAME RECTANGLE BACK, identically. That is the no-op path the drag
//      listener tests with a plain comparison, so it has to be exact.
//   4. WINDOWS OFFER FOUR STOPS PER AXIS — two abutments and two alignments — and the NEAREST one
//      wins.
//   5. A TARGET YOU ARE NOT BESIDE PULLS NOTHING. This is the difference between an assist and a
//      poltergeist, and it is the one rule a naive implementation leaves out.
//   6. …BUT "BESIDE" IS NOT THE SNAP DISTANCE (JOS-359, the width-axis defect). The app's own
//      docked column is 10px between slots and every left-edge alignment in it was refused.
//   7. THE TWO AXES ARE ONE ALGORITHM. Transpose the whole desktop and the answer transposes —
//      asserted over thousands of generated worlds, because "x is broken" was a live report and
//      this is the shape of pin that could have answered it in one run.
//   8. A SNAPPED DRAG CAN BE PULLED FREE (JOS-359). Driven as a whole drag through `snapDrag`
//      against a model of the Windows move loop.
//   9. SCREEN EDGES ARE THE WORK AREA, per display, and only the display you are on.
//
// Sizes are never touched anywhere in here: this is a MOVE.

import { test } from 'node:test'
import assert from 'node:assert/strict'
// The ONE impure thing in this file: the release hold is a claim about three files, and two of
// them are an Electron listener and a React tree that no node test can call (claim 1).
import { readFileSync } from 'node:fs'
import {
  DEFAULT_OVERLAY_SNAP,
  DRAG_RESUME_MS,
  SNAP_DISTANCE_PX,
  SNAP_RELEASE_HOLD,
  mergeOverlaySnap,
  normalizeOverlaySnap,
  snapDrag,
  snapMovingBounds,
  type SnapDragSession,
  type SnapRect,
  type SnapTargets
} from '../src/shared/overlaySnap'

/** A 1920x1080 primary whose work area stops 40px short of the bottom (a taskbar). */
const PRIMARY: SnapRect = { x: 0, y: 0, width: 1920, height: 1040 }
/** A second monitor to the right, no taskbar. */
const SECOND: SnapRect = { x: 1920, y: 0, width: 1920, height: 1080 }

const rect = (x: number, y: number, width = 300, height = 200): SnapRect => ({ x, y, width, height })

/** Targets with no screens at all — for the claims that are only about neighbouring windows. */
const windowsOnly = (...windows: SnapRect[]): SnapTargets => ({ windows, screens: [] })
/** Targets with no windows at all — for the claims that are only about screen edges. */
const screensOnly = (...screens: SnapRect[]): SnapTargets => ({ windows: [], screens })

// ---- 1. the release hold ----------------------------------------------------------------------

test('THE FEATURE IS HELD OUT OF THIS RELEASE, and a stored `true` is inert', () => {
  assert.equal(SNAP_RELEASE_HOLD, true, 'the owner ruling (JOS-359), as a value a test can hold')

  // The install that matters: somebody switched this ON while it was shipping, and the hold has to
  // reach them without anybody editing a store file.
  assert.deepEqual(normalizeOverlaySnap({ enabled: true }), { enabled: false })
  // …and every other reading of the store lands in the same place.
  assert.deepEqual(normalizeOverlaySnap(undefined), { enabled: false })
  assert.deepEqual(normalizeOverlaySnap(null), { enabled: false })
  assert.deepEqual(normalizeOverlaySnap('yes'), { enabled: false })
  assert.deepEqual(normalizeOverlaySnap([true]), { enabled: false })
  // The IPC setter normalizes its patch through the same function, so no patch can turn it on
  // either — a renderer that still knew how to ask would be answered `false`.
  assert.deepEqual(normalizeOverlaySnap({ enabled: true }, { enabled: true }), { enabled: false })
})

test('THE HOLD REACHES ALL THREE PLACES — the store, the drag, and the pane', () => {
  // A SOURCE PIN, because two of the three are not values this process can call: one is an
  // Electron listener and one is a React tree. The claim is the same either way — the hold is ONE
  // constant, and nothing may grow a second opinion about whether this feature is shipping.
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

  const drag = read('../src/main/overlaySnapDrag.ts')
  assert.match(
    drag,
    /if \(SNAP_RELEASE_HOLD\) return/,
    'installOverlaySnap refuses before it hooks will-move — held, not one line of this runs on a drag'
  )

  const view = read('../src/renderer/src/features/preferences/PreferencesView.tsx')
  assert.match(view, /if \(SNAP_RELEASE_HOLD\) return \[\]/, 'the card is not built into the Overlays section')
  // …and it is built by a factory the section SPREADS, so the item is absent from the pane and
  // from the search index together — a switch a user can find but not have is worse than none.
  assert.match(view, /\.\.\.snapItems\(\)/, 'the section spreads whatever the hold leaves')
})

// ---- 2. the machinery under the hold ----------------------------------------------------------

test('THE PREFERENCE SHIPS OFF, and every unreadable value reads as off', () => {
  assert.equal(DEFAULT_OVERLAY_SNAP.enabled, false, 'the owner ruling, as a value a test can hold')

  // An absent key is the overwhelmingly common case: nobody has this key until they touch the
  // switch, and "absent" has to mean the behaviour every build before this one had.
  assert.deepEqual(mergeOverlaySnap(undefined), { enabled: false })
  assert.deepEqual(mergeOverlaySnap(null), { enabled: false })
  // A hand-edited file, a downgrade, or a share import can leave anything here.
  assert.deepEqual(mergeOverlaySnap('yes'), { enabled: false })
  assert.deepEqual(mergeOverlaySnap([true]), { enabled: false })
  assert.deepEqual(mergeOverlaySnap({ enabled: 'true' }), { enabled: false })
  assert.deepEqual(mergeOverlaySnap({ enabled: 1 }), { enabled: false })
  // And the one value that turns it on is a real boolean.
  assert.deepEqual(mergeOverlaySnap({ enabled: true }), { enabled: true })
})

test('a patch keeps the fields it does not name — the merge the IPC setter relies on', () => {
  const stored = { enabled: true }
  // `setOverlaySnap` passes what is stored as the fallback; a patch mentioning nothing must not
  // silently switch the feature off under a user who was only ever writing some other field.
  assert.deepEqual(mergeOverlaySnap({}, stored), { enabled: true })
  assert.deepEqual(mergeOverlaySnap({ enabled: false }, stored), { enabled: false })
  // Junk in the patch is the same as an absent field: keep what is stored.
  assert.deepEqual(mergeOverlaySnap({ enabled: 'off' }, stored), { enabled: true })
})

// ---- 3. nothing in range ---------------------------------------------------------------------

test('with nothing near, the drag is handed back UNCHANGED — the same object', () => {
  const moving = rect(500, 500)
  const targets = windowsOnly(rect(50, 50))
  const out = snapMovingBounds(moving, targets)
  assert.equal(out, moving, 'the no-snap path allocates nothing and compares equal by identity')
})

test('no targets at all is a no-op, and so is a zero snap distance', () => {
  const moving = rect(100, 100)
  assert.equal(snapMovingBounds(moving, { windows: [], screens: [] }), moving)
  // A neighbour whose left edge is 2px away would normally pull; distance 0 refuses.
  assert.equal(snapMovingBounds(moving, windowsOnly(rect(102, 100)), 0), moving)
})

// ---- 4. the four stops a neighbouring window offers -------------------------------------------

test('ABUTMENT: a window dragged just short of a neighbour lands edge to edge', () => {
  // Neighbour occupies x 600..900. The dragged window's RIGHT edge is at 595 — 5px short.
  const neighbour = rect(600, 100)
  const out = snapMovingBounds(rect(295, 100), windowsOnly(neighbour))
  assert.equal(out.x, 300, 'right edge (300+300) sits exactly on the neighbour’s left edge')
  assert.equal(out.y, 100, 'and the other axis is untouched by an x-only correction')
  assert.equal(out.width, 300)
  assert.equal(out.height, 200, 'a MOVE never resizes')
})

test('ABUTMENT the other way: dragged just past a neighbour’s right edge', () => {
  const neighbour = rect(600, 100) // 600..900
  const out = snapMovingBounds(rect(904, 100), windowsOnly(neighbour))
  assert.equal(out.x, 900, 'left edge lands on the neighbour’s right edge')
})

test('ALIGNMENT: near-equal left edges go flush — the answer to "I can see the difference"', () => {
  // Stacked BELOW the neighbour (which occupies y 100..300), so the two are beside each other on
  // the y axis by the abutment rule, and 3px off on x.
  const neighbour = rect(600, 100)
  const out = snapMovingBounds(rect(603, 300), windowsOnly(neighbour))
  assert.equal(out.x, 600, 'left edges agree to the pixel')
  assert.equal(out.y, 300, 'the vertical abutment was already exact, so nothing moved there')
})

test('ALIGNMENT: right edges go flush too, even when the widths differ', () => {
  const neighbour = rect(600, 100, 300) // right edge 900
  // A narrower window under it whose right edge is at 896.
  const out = snapMovingBounds(rect(696, 300, 200), windowsOnly(neighbour))
  assert.equal(out.x, 700, 'right edge (700+200) meets the neighbour’s 900')
  assert.equal(out.width, 200, 'and the width is NOT matched to the neighbour — that is not this feature')
})

test('BOTH AXES snap independently in one move', () => {
  // Neighbour at 600..900 x 100..300. The dragged window is 4px short of abutting its left edge
  // and 3px off aligning its top edge.
  const out = snapMovingBounds(rect(296, 103), windowsOnly(rect(600, 100)))
  assert.deepEqual(out, { x: 300, y: 100, width: 300, height: 200 })
})

test('the NEAREST stop wins when two neighbours both reach', () => {
  // One neighbour would pull the left edge to 500 (6px away), another to 497 (3px away).
  const near = rect(497, 100)
  const far = rect(500, 100)
  const out = snapMovingBounds(rect(494, 100), { windows: [far, near], screens: [] })
  assert.equal(out.x, 497, 'the 3px pull beats the 6px one regardless of list order')
})

test('the pull reaches exactly SNAP_DISTANCE_PX and not one pixel further', () => {
  const neighbour = rect(600, 100)
  const at = snapMovingBounds(rect(300 - SNAP_DISTANCE_PX, 100), windowsOnly(neighbour))
  assert.equal(at.x, 300, 'a gap of exactly the snap distance still lands flush')
  const beyond = rect(300 - SNAP_DISTANCE_PX - 1, 100)
  assert.equal(snapMovingBounds(beyond, windowsOnly(neighbour)), beyond, 'one further is free')
})

// ---- 5. only a window you are BESIDE pulls ----------------------------------------------------

test('a neighbour across the desktop pulls NOTHING, however well its edges line up', () => {
  // Same left edge, 3px off — but 600px apart vertically. Without the cross-axis gate this would
  // jump, and the magnet would feel like a poltergeist.
  const moving = rect(603, 900)
  assert.equal(snapMovingBounds(moving, windowsOnly(rect(600, 100))), moving)
})

test('…and "beside" includes ABOUT to abut: the gate is not strict overlap', () => {
  // Neighbour occupies y 100..300. The dragged window's top edge is 6px below its bottom edge, so
  // the two spans do NOT overlap — which is exactly the moment a user is stacking one under the
  // other and wants the left edges to agree.
  const out = snapMovingBounds(rect(604, 306), windowsOnly(rect(600, 100)))
  assert.equal(out.x, 600, 'the x alignment is offered')
  assert.equal(out.y, 300, 'and the y abutment closes the 6px seam in the same move')
})

// ---- 6. …and "beside" is NOT the snap distance: the width axis (JOS-359) ----------------------
//
// THE DEFECT, IN THE APP'S OWN NUMBERS. `main/overlayLayout.ts` docks the meter stack in a column
// with GUTTER = 10 between 380x320 slots. The first build gated every candidate on the two windows
// being within SNAP_DISTANCE_PX (8) of overlapping on the OTHER axis — so in the column this app
// itself creates, two overlays were 10px apart, two pixels outside the gate, and the x axis had
// nothing to offer at any horizontal distance. Vertical stacking kept working the whole time (a
// column OVERLAPS on x, so the y axis's gate always passed), which is what made the report read as
// "its also not working width width" rather than "snapping is broken".

/** The two lowest slots of this app's own bottom-right dock on a 1920x1040 work area, verbatim
 *  from `defaultOverlayBounds` — the layout a user is looking at when they ask for tidy edges. */
const DOCK_LOWER: SnapRect = { x: 1524, y: 704, width: 380, height: 320 }
const DOCK_UPPER: SnapRect = { x: 1524, y: 374, width: 380, height: 320 }

test('THE APP’S OWN COLUMN lines up: a 10px gutter is a pair, not a coincidence', () => {
  assert.equal(DOCK_LOWER.y - (DOCK_UPPER.y + DOCK_UPPER.height), 10, 'overlayLayout.ts GUTTER')
  // The user has nudged the lower meter 4px off the column and wants its left edge back.
  const out = snapMovingBounds({ ...DOCK_LOWER, x: DOCK_LOWER.x + 4 }, windowsOnly(DOCK_UPPER))
  assert.equal(out.x, DOCK_LOWER.x, 'the left edges agree again')
  assert.equal(out.y, DOCK_LOWER.y, 'and the gutter SURVIVES — lining up is not stacking')
})

test('a column spread out by a whole window still lines up; two windows further apart does not', () => {
  // 320 of gap between two 320-tall meters: the space between them is one window, so they are
  // still a stack a user is arranging.
  const near = { ...DOCK_LOWER, x: DOCK_LOWER.x + 5, y: DOCK_UPPER.y + DOCK_UPPER.height + 320 }
  assert.equal(snapMovingBounds(near, windowsOnly(DOCK_UPPER)).x, DOCK_LOWER.x)
  // One pixel more of gap than the smaller window is tall, and they are two separate things.
  const far = { ...near, y: near.y + 1 }
  assert.equal(snapMovingBounds(far, windowsOnly(DOCK_UPPER)), far, 'nothing pulls')
})

test('the SIDE abutment is the same rule, transposed — a row lines up by its tops', () => {
  // Two meters side by side with the same 10px gutter between them, 4px out of vertical line.
  const left: SnapRect = { x: 1000, y: 400, width: 380, height: 320 }
  const right = { ...left, x: left.x + left.width + 10, y: left.y + 4 }
  const out = snapMovingBounds(right, windowsOnly(left))
  assert.equal(out.y, left.y, 'top edges agree')
  assert.equal(out.x, right.x, 'and the horizontal gutter survives, exactly as the column’s does')
})

// ---- 7. the two axes are ONE algorithm --------------------------------------------------------

/** A deterministic LCG — a property test that changes its own inputs between runs is a flake with
 *  extra steps, and a failure nobody can reproduce is not a pin. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** The whole desktop, reflected through the diagonal: x becomes y, width becomes height. */
const flip = (r: SnapRect): SnapRect => ({ x: r.y, y: r.x, width: r.height, height: r.width })

test('TRANSPOSE THE DESKTOP AND THE ANSWER TRANSPOSES — over 4000 generated worlds', () => {
  // "It is not working on the width axis" was a live report against a build whose geometry was in
  // fact perfectly symmetric (the defect was claim 6's gate, which is symmetric too — the user's
  // LAYOUT is what is not). This pin is what makes that answerable in one run next time: any
  // x-only or y-only arithmetic — a transposition, a size read off the wrong dimension — fails it.
  const rand = lcg(0x5eed)
  const pick = (n: number): number => Math.floor(rand() * n)
  const some = (): SnapRect => ({ x: pick(1200), y: pick(1200), width: 100 + pick(400), height: 100 + pick(300) })
  for (let i = 0; i < 4000; i++) {
    const moving = some()
    const targets: SnapTargets = { windows: [some(), some()], screens: [PRIMARY] }
    const straight = snapMovingBounds(moving, targets)
    const flipped = snapMovingBounds(flip(moving), {
      windows: targets.windows.map(flip),
      screens: targets.screens.map(flip)
    })
    assert.deepEqual(
      { x: flipped.y, y: flipped.x },
      { x: straight.x, y: straight.y },
      `world ${String(i)}: the two axes disagree — ${JSON.stringify({ moving, targets })}`
    )
  }
})

// ---- 8. a snapped drag can be PULLED FREE (JOS-359) -------------------------------------------
//
// THE MOVE LOOP, AS THE DEFECT PROVES IT BEHAVES. Windows keeps a drag rectangle, offsets it by
// each mouse message, and KEEPS whatever the app leaves in it. So the proposal an app sees is
// "where we left the window, plus the last few pixels of hand" — not "where the hand is". A build
// that snapped the proposal itself therefore measured the pull against the stop it had just
// applied, was 3px away from it forever, and could never let go. (The owner's report is the
// measurement: raw-proposal snapping would have released the instant the pointer passed 8px.)

/** That loop, as a test can drive it: hand `snapDrag` a stream of mouse deltas and let it place
 *  the window each time, exactly as `installOverlaySnap` does. Returns where the window ends up
 *  after every message, so a test can say when it let go. */
function dragBy(start: SnapRect, targets: SnapTargets, deltas: readonly number[]): SnapRect[] {
  let session: SnapDragSession | null = null
  let window = start
  let clock = 1000
  const seen: SnapRect[] = []
  for (const dx of deltas) {
    clock += 16
    // The OS offsets ITS drag rectangle — which is the rectangle we last left the window at.
    const proposal: SnapRect = { ...window, x: window.x + dx }
    const step = snapDrag(session, { proposal, current: window, targets, now: clock })
    session = step.session
    window = step.apply ?? proposal
    seen.push(window)
  }
  return seen
}

test('a snapped overlay LETS GO once the hand has travelled past the snap distance', () => {
  const neighbour = rect(600, 100)
  // Approach from the left: the right edge lands on 600 (x = 300) and sticks there.
  const start = rect(295, 100)
  const deltas = [5, 3, 3, 3, 3, 3, 3]
  const seen = dragBy(start, windowsOnly(neighbour), deltas)
  assert.equal(seen[0].x, 300, 'the abutment takes it')
  assert.equal(seen[1].x, 300, 'and holds while the hand is still inside the snap distance')
  // The hand is now 3+3+3 = 9px past the stop — further than SNAP_DISTANCE_PX — so it is free,
  // and it is free at the HAND'S position, not at the stop plus one message.
  const freed = seen.findIndex((r, i) => i > 0 && r.x !== 300)
  assert.notEqual(freed, -1, 'the drag escapes — this is the defect the owner found')
  assert.equal(seen[freed].x, 300 + 9, 'and lands where the hand actually is, with no lost travel')
  // THE WHOLE CLAIM, IN ONE NUMBER: at the end of the drag the window is exactly where the hand
  // took it. The snap borrowed 5px on the way in and gave every one of them back on the way out.
  const travelled = deltas.reduce((a, b) => a + b, 0)
  assert.equal(seen[seen.length - 1].x, start.x + travelled, 'thereafter it tracks the hand exactly')
})

test('…and one long pull escapes in a single message, keeping every pixel of it', () => {
  const seen = dragBy(rect(295, 100), windowsOnly(rect(600, 100)), [5, 40])
  assert.equal(seen[0].x, 300, 'snapped')
  assert.equal(seen[1].x, 340, 'a 40px yank lands 40px on from the stop, not 40px from the hand')
})

test('a drag that never comes near anything is never touched at all', () => {
  const targets = windowsOnly(rect(600, 900))
  let session: SnapDragSession | null = null
  let clock = 0
  for (let i = 0; i < 5; i++) {
    clock += 16
    const proposal = rect(100 + i * 7, 100)
    const step = snapDrag(session, { proposal, current: rect(93 + i * 7, 100), targets, now: clock })
    session = step.session
    assert.equal(step.apply, null, 'no veto, no setBounds — the drag the user has always had')
  }
})

test('a PAUSE ends the drag: the next message re-anchors instead of replaying old travel', () => {
  const neighbour = rect(600, 100)
  const targets = windowsOnly(neighbour)
  const snapped = snapDrag(null, { proposal: rect(297, 100), current: rect(292, 100), targets, now: 1000 })
  assert.equal(snapped.apply?.x, 300, 'snapped, so the session is carrying 3px of correction')

  // Same drag, moments later: the correction is still in play and the stop still holds.
  const soon = snapDrag(snapped.session, {
    proposal: rect(303, 100),
    current: rect(300, 100),
    targets,
    now: 1000 + DRAG_RESUME_MS
  })
  assert.equal(soon.apply?.x, 300, 'still stuck — the hand is 6px past the stop, inside the pull')

  // …and after a longer silence the hand is somewhere new. Re-anchoring costs at most one snap's
  // worth of correction, and never resurrects travel from a drag that finished.
  const later = snapDrag(snapped.session, {
    proposal: rect(303, 100),
    current: rect(300, 100),
    targets,
    now: 1000 + DRAG_RESUME_MS + 1
  })
  assert.equal(later.session.virtual.x, 303, 'the proposal itself is the new anchor')
})

test('somebody ELSE moving the window ends the drag too', () => {
  const targets = windowsOnly(rect(600, 100))
  const first = snapDrag(null, { proposal: rect(297, 100), current: rect(292, 100), targets, now: 500 })
  // The keep-on-screen pass (or a display change) has since put the window somewhere of its own
  // choosing, so our idea of what the OS is offsetting is fiction and must be dropped.
  const next = snapDrag(first.session, { proposal: rect(801, 400), current: rect(795, 400), targets, now: 510 })
  assert.equal(next.session.virtual.x, 801, 'anchored on what is actually happening now')
})

// ---- 9. screen edges ---------------------------------------------------------------------------

test('SCREEN EDGES are the work area — a snapped window sits BESIDE the taskbar, not under it', () => {
  // PRIMARY's work area ends at y=1040; the full screen is 1080 tall. A window dragged to 843 has
  // its bottom edge at 1043 — 3px past the work area's floor.
  const out = snapMovingBounds(rect(500, 843), screensOnly(PRIMARY))
  assert.equal(out.y, 840, 'bottom edge (840+200) rests on the work area floor, 40px above the screen')
})

test('the left and top edges pull the same way', () => {
  assert.equal(snapMovingBounds(rect(5, 500), screensOnly(PRIMARY)).x, 0)
  assert.equal(snapMovingBounds(rect(500, 6), screensOnly(PRIMARY)).y, 0)
  // …and the right edge, which is the one whose arithmetic involves the window's own width.
  assert.equal(snapMovingBounds(rect(1616, 500), screensOnly(PRIMARY)).x, 1620, 'right edge to 1920')
})

test('only the display you are ON gets to pull you', () => {
  // A window sitting entirely on the SECOND monitor, 4px past its left edge. The primary's own
  // edges are 2000px away and its rectangle does not contain this window at all, so the only stop
  // in play is the seam between the two displays.
  const onSecond = rect(1924, 500)
  assert.equal(snapMovingBounds(onSecond, screensOnly(PRIMARY, SECOND)).x, 1920, 'the seam, not x=0')

  // And a window that STRADDLES the seam is still answered by an edge it is touching. Its right
  // edge (2216) is nowhere near the primary's 1920, so the primary offers nothing reachable; the
  // second monitor's left edge is 4px away and wins. The claim is that the answer always comes
  // from a display the window is actually on — never from one it has never been near.
  assert.equal(snapMovingBounds(rect(1916, 500), screensOnly(PRIMARY, SECOND)).x, 1920)
})

test('a window on no display at all is left where it is', () => {
  const moving = rect(5000, 5000)
  assert.equal(snapMovingBounds(moving, screensOnly(PRIMARY, SECOND)), moving)
})

// ---- rounding ----------------------------------------------------------------------------------

test('a fractional work area still produces whole-pixel bounds', () => {
  // A scaled display can carry a fractional edge; a window positioned at 1919.6 is a window whose
  // next getBounds() disagrees with what we asked for.
  const scaled: SnapRect = { x: 0, y: 0, width: 1919.6, height: 1079.4 }
  const out = snapMovingBounds(rect(1616, 500), screensOnly(scaled))
  assert.equal(out.x, 1620, 'rounded, not carried through as a fraction')
  assert.equal(Number.isInteger(out.x), true)
})
