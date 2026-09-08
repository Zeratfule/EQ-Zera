// ============================================================================
// overlaySnap — the OPT-IN magnetism an overlay drag gets, and the geometry behind it (JOS-217).
// ============================================================================
//
// THE ASK, AND WHY IT IS A PREFERENCE. Three separate reports wanted floating overlays that line
// up: a grid cluster (GD1ABN, TG3S1K), then "matching sizes, snapping seems a little finicky, my
// OCD can see the small difference" (J29XCN), then a fourth asking for the same against the main
// window. One of those same reports is a complaint that an EARLIER snap-back FOUGHT the user, and
// that is the whole design constraint: a window that refuses to go where you put it is worse than
// one that lands two pixels off. So the owner's ruling (2026-08-14) is that this ships as a
// PREFERENCE THAT IS OFF BY DEFAULT — with it off, an overlay drag is byte-identical to what it
// has always been, because the only code that runs is one boolean read.
//
// PURE ON PURPOSE, and shared on purpose. The geometry imports nothing — not Electron, not the
// store — so tests/overlaySnap.test.mts can describe a three-monitor desktop with four overlays on
// it in a few lines (the `displayFit.ts` split, applied to the question one layer up: displayFit
// asks "does this rectangle still fit on a screen", this asks "what would the user like it to line
// up with"). It is in `shared/` rather than `main/` because the PREFERENCE half is read by the
// renderer's Preferences card, and because `SNAP_DISTANCE_PX` is quoted in that card's caption —
// the sentence a user reads and the distance the window actually snaps at must be one number.
//
// WHAT IT SNAPS TO, and it is a short list on purpose:
//
//   * OTHER WINDOWS this app owns — the other open overlays, and the main Companion window. Four
//     positions per axis: the two ABUTMENTS (your right edge on their left edge, and the mirror)
//     and the two ALIGNMENTS (left edges flush, right edges flush). Abutment is how a column of
//     meters gets stacked with no seam; alignment is what answers the OCD report, because two
//     windows whose left edges agree to the pixel is exactly what "I can see the small difference"
//     is about.
//   * SCREEN EDGES — each display's WORK AREA, so a snapped overlay lands beside the taskbar
//     rather than under it. Two positions per axis.
//
// AND WHAT IT DOES NOT DO, stated so the absences read as decisions rather than omissions:
//   * NO GRID. The design comment's advanced Off/8px/16px sub-option is not in the owner's build
//     ruling; the prefs blob is a BLOB rather than a bare boolean so that adding one later is a
//     field, not a migration.
//   * NO RESIZE / SIZE MATCHING. The ruling is "while dragging". Equal-size magnetism is a
//     `will-resize` feature and it is a second ticket's worth of judgement about which dimension
//     the user is expressing.
//   * NO CENTRE LINES. A centre snap is invisible until it fires, and a magnet you cannot predict
//     is the fighting behaviour this feature was told not to reproduce.
//
// A WINDOW ONLY SNAPS TO SOMETHING IT IS NEXT TO. Every candidate is gated on the OTHER axis: a
// left-edge alignment is offered only when the two windows are NEIGHBOURS on that other axis.
// Without that gate, dragging near the top of the screen would jump to the left edge of a meter
// parked at the bottom of it, and the magnet would feel like a poltergeist.
//
// AND "NEIGHBOUR" IS NOT THE SNAP DISTANCE — THAT CONFLATION IS THE WIDTH-AXIS DEFECT (JOS-359,
// owner hands-on 2026-08-14: "its also not working width width"). The first build reused
// SNAP_DISTANCE_PX for both questions, which are not the same question:
//
//   * "how near does an EDGE have to be before it pulls?" is 8 because the user has to cross it
//     to escape — every pixel is resistance, so it is deliberately tiny (see the constant), and
//   * "are these two windows a PAIR?" costs the user nothing at all. It creates no resistance; it
//     only decides whether a candidate exists to be measured by the first question.
//
// MEASURED, and the measurement is this app's own layout: `main/overlayLayout.ts` docks the meter
// stack with GUTTER = 10 between slots. So in the column THE APP ITSELF CREATES, two overlays are
// 10px apart — two pixels outside an 8px gate — and no left-edge alignment was ever offered for
// them. The user could only line up the widths by first crushing the gutter to zero (a vertical
// abutment IS within 8), which is why the axis read as dead: vertical stacking works at any
// horizontal offset (a column overlaps on x, so the y gate always passes), while horizontal
// alignment demanded a vertical adjacency the user never wanted. `neighbourly` below is the fix,
// and it needs no new magic number — see its own comment.

/**
 * How near an edge has to be before it pulls, in DIP.
 *
 * 8, and small deliberately. This is a distance the user has to cross with the mouse to ESCAPE
 * once it has stuck, so every pixel of it is a pixel of "the window will not go where I am putting
 * it". 8 is enough that a hand-aimed drag lands flush and not enough to be felt as resistance —
 * and it is the number the Preferences caption quotes, so the two can never drift apart.
 */
export const SNAP_DISTANCE_PX = 8

/**
 * THE RELEASE HOLD — this feature sits out the 2026-08-14 release, and this constant is the whole
 * of it (JOS-359, owner ruling after hands-on testing: *"snapping doesn't allow you to drag hard
 * and unsnap. its also not working width width. lets keep working on this, but disable for this
 * release."*).
 *
 * A HOLD, NOT A REVERT. Every line of the machinery is still here, still tested, still improving
 * behind it — the two defects the owner found are FIXED in this same change (see the drag session
 * below and `neighbourly`), they are simply not shipped to anybody until he has hands-on'd them
 * again. Reverting would have thrown away the geometry and the tests to re-type them next week.
 *
 * ONE SEAM, THREE THINGS. Flip this to `false` and the feature comes back whole:
 *   1. `normalizeOverlaySnap` clamps `enabled` to false — so an install that switched it ON during
 *      testing reads as OFF, without anybody editing a store file;
 *   2. `installOverlaySnap` (main/overlaySnapDrag.ts) never hooks `will-move` at all, so not one
 *      line of this runs during a drag; and
 *   3. the Preferences card is not built (renderer/…/PreferencesView.tsx), so the pane offers no
 *      switch for a preference that would be ignored.
 *
 * WIDENED TO `boolean` ON PURPOSE, and the assertion is the only spelling that survives both lint
 * layers: left to infer, the type is the literal `true`, every guard on it becomes a compile-time
 * constant, and `no-unnecessary-condition` demands the guards be deleted — which would make the
 * one-line re-enable a three-file rewrite. (An annotation says the same thing and trips
 * `no-inferrable-types` instead.)
 */
export const SNAP_RELEASE_HOLD = true as boolean

/**
 * The stored preference. ONE FIELD TODAY, and a blob rather than a bare boolean anyway (unlike
 * `uiScale`, which is one number and stored as one): the design this implements already names a
 * second field — an optional snap-to-grid step — and a blob is how that arrives as a defaulted
 * field instead of a schema migration.
 */
export interface OverlaySnapPrefs {
  /** Magnetize overlay drags to the other windows and the screen edges. Default OFF. */
  enabled: boolean
}

/**
 * OFF. This is the ruling, not a taste: the feature must be invisible until somebody asks for it,
 * so an absent key, a hand-edited file and a fresh install all mean "drag behaves exactly as it
 * did before this shipped".
 */
export const DEFAULT_OVERLAY_SNAP: OverlaySnapPrefs = { enabled: false }

/**
 * The prefs, defaulted field by field, BEFORE the release hold is applied.
 *
 * This is the merge and nothing else — the repo's store discipline (read through the normalizer,
 * write through the SAME one), so a store file, a renderer patch and a future migration cannot end
 * up with three ideas of what this setting is.
 *
 * `fallback` is what makes ONE function serve both callers. Reading the store passes the shipped
 * default; applying a PATCH passes what is currently stored, so a patch that names no field keeps
 * every field — which is the merge semantics the other prefs blobs spell out by hand.
 *
 * Exported for ONE reason: while `SNAP_RELEASE_HOLD` stands, every answer `normalizeOverlaySnap`
 * gives is `false`, so the merge underneath it would be unobservable and its tests would be
 * asserting the hold over and over. The pins that prove the machinery still works — and that the
 * one-line re-enable gets back a working preference rather than a broken one — read this.
 */
export function mergeOverlaySnap(
  value: unknown,
  fallback: OverlaySnapPrefs = DEFAULT_OVERLAY_SNAP
): OverlaySnapPrefs {
  const v = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return { enabled: typeof v.enabled === 'boolean' ? v.enabled : fallback.enabled }
}

/**
 * The prefs as anything outside this file may read them: the merge above, then the release hold.
 *
 * THE HOLD IS APPLIED ON READ, never by rewriting the store. A user who switched this on while it
 * was shipping gets no-snapping this release without losing the setting, and gets their own answer
 * back the moment the hold lifts — the store is the user's, and a feature flag is not a reason to
 * edit it behind them.
 */
export function normalizeOverlaySnap(
  value: unknown,
  fallback: OverlaySnapPrefs = DEFAULT_OVERLAY_SNAP
): OverlaySnapPrefs {
  const merged = mergeOverlaySnap(value, fallback)
  return SNAP_RELEASE_HOLD ? { ...merged, enabled: false } : merged
}

// ------------------------------------------------------------------ the geometry

/** A screen-coordinate rectangle — what `BrowserWindow.getBounds()` and `Display.workArea` share. */
export interface SnapRect {
  x: number
  y: number
  width: number
  height: number
}

/** Everything a dragged overlay may line up with. Two lists because they offer different
 *  positions: a window can be abutted OR aligned, a screen edge can only be sat against. */
export interface SnapTargets {
  /** The other windows this app owns and can see — other open overlays, and the main window. */
  windows: readonly SnapRect[]
  /** Each display's WORK AREA (not its full bounds — a snapped window sits beside the taskbar). */
  screens: readonly SnapRect[]
}

/** Which dimension a pass is working in. The whole algorithm is one axis run twice. */
type Axis = 'x' | 'y'

/** A rectangle's extent on one axis: the near edge (left/top) and the far edge (right/bottom). */
interface Span {
  near: number
  far: number
}

function span(r: SnapRect, axis: Axis): Span {
  if (axis === 'x') return { near: r.x, far: r.x + r.width }
  return { near: r.y, far: r.y + r.height }
}

const crossAxis = (axis: Axis): Axis => (axis === 'x' ? 'y' : 'x')

/** Do two spans overlap, or come within `gap` of touching? */
function within(a: Span, b: Span, gap: number): boolean {
  return a.near <= b.far + gap && b.near <= a.far + gap
}

/**
 * Are these two spans NEIGHBOURS — near enough that a user would call the windows a pair?
 *
 * This is the "is it next to me" gate, and it is asked on the axis the pass is NOT deciding (see
 * the file header for why the gate exists at all, and for the width-axis defect that came of
 * asking it with the snap distance).
 *
 * THE REACH IS THE WINDOWS THEMSELVES, so there is no third number to tune and no scale to get
 * wrong: two windows are neighbours when their spans overlap, or when the gap between them is no
 * wider than the SMALLER of the two. Read out loud, that is "you could fit the shorter of these
 * two windows in the space between them" — one meter's worth of gap is a stack, three is a
 * coincidence. It answers both cases the design cares about:
 *
 *   * the app's own docked column (GUTTER = 10 between 320-tall slots) is a pair, and so is a
 *     column a user has spread out by an inch or two, which is what "line up the left edges" is
 *     asked about; and
 *   * the header's poltergeist — a meter at the top of a 1080 screen and one parked at the bottom
 *     — is ~440px apart with 320px of window, so it still pulls NOTHING.
 *
 * It also transposes exactly (min of two extents, gap on one axis), which is what keeps the two
 * axes the same algorithm run twice rather than two behaviours that drift apart.
 */
function neighbourly(a: Span, b: Span): boolean {
  if (within(a, b, 0)) return true
  // Disjoint, so exactly one of these differences is the (positive) gap between them.
  const gap = Math.max(b.near - a.far, a.near - b.far)
  return gap <= Math.min(a.far - a.near, b.far - b.near)
}

/**
 * The four near-edge positions that line `size` up with another WINDOW's span:
 * abut after it, abut before it, align near edges, align far edges.
 */
function windowStops(t: Span, size: number): number[] {
  return [t.far, t.near - size, t.near, t.far - size]
}

/** The two near-edge positions that sit `size` against a SCREEN's span. */
function screenStops(s: Span, size: number): number[] {
  return [s.near, s.far - size]
}

/**
 * Every near-edge position this drag could legitimately land on for `axis`, in PRIORITY ORDER —
 * windows before screens, and within a window abutment before alignment. The order only decides
 * ties (see `stopOnAxis`); the filtering is where the judgement is.
 */
function stopsOnAxis(moving: SnapRect, targets: SnapTargets, axis: Axis): number[] {
  const m = span(moving, axis)
  const cross = span(moving, crossAxis(axis))
  const size = m.far - m.near
  const out: number[] = []
  for (const t of targets.windows) {
    // Only a window you are BESIDE gets to pull you (see the file header, and `neighbourly` for
    // why the reach here is NOT the snap distance).
    if (!neighbourly(cross, span(t, crossAxis(axis)))) continue
    out.push(...windowStops(span(t, axis), size))
  }
  for (const s of targets.screens) {
    // Only the display the window is actually ON — otherwise a second monitor's left edge would
    // reach across the desktop for a window that has never been near it.
    if (!within(cross, span(s, crossAxis(axis)), 0) || !within(m, span(s, axis), 0)) continue
    out.push(...screenStops(span(s, axis), size))
  }
  return out
}

/**
 * The position `moving` should take on `axis`, or null when nothing is near enough.
 *
 * NEAREST WINS, and a tie goes to the candidate offered FIRST. Ties are rare (they need two
 * targets the same distance away in opposite directions) and the rule exists only so the answer is
 * a function of the inputs rather than of iteration order.
 */
function stopOnAxis(moving: SnapRect, targets: SnapTargets, axis: Axis, distance: number): number | null {
  const from = span(moving, axis).near
  let best: number | null = null
  let bestGap = Infinity
  for (const value of stopsOnAxis(moving, targets, axis)) {
    const gap = Math.abs(value - from)
    if (gap > distance || gap >= bestGap) continue
    best = value
    bestGap = gap
  }
  return best
}

/**
 * Where a window being dragged to `moving` should actually go.
 *
 * SIZE IS NEVER TOUCHED — this is a MOVE, and a magnet that resized the thing you were dragging
 * would be a different feature (and a nasty surprise). The two axes are decided INDEPENDENTLY, so
 * a window can snap flush to the screen's left edge while its top edge is still wherever the mouse
 * put it; a joint decision would mean the nearer axis silently vetoing the other one.
 *
 * Returns the input rectangle UNCHANGED (the same object) whenever the answer is where the window
 * already is, so the caller's "did anything move" test is a plain comparison and the no-move path
 * allocates nothing. Note the two ways that happens: nothing was in range, OR something was and it
 * is exactly where the window is — a window already flush against its neighbour is asked about on
 * every message of a drag, and "snapped to where I am" is not a move.
 */
export function snapMovingBounds(
  moving: SnapRect,
  targets: SnapTargets,
  distance: number = SNAP_DISTANCE_PX
): SnapRect {
  if (distance <= 0) return moving
  const x = stopOnAxis(moving, targets, 'x', distance)
  const y = stopOnAxis(moving, targets, 'y', distance)
  if (x === null && y === null) return moving
  // Whole pixels: a work area on a scaled display can carry a fractional edge, and a window
  // positioned at 1919.6 is a window whose next `getBounds()` disagrees with what we asked for.
  const to = { ...moving, x: Math.round(x ?? moving.x), y: Math.round(y ?? moving.y) }
  return to.x === moving.x && to.y === moving.y ? moving : to
}

// ------------------------------------------------------------------ the drag, over time
//
// EVERYTHING ABOVE IS ONE FRAME. What follows is the DRAG — and the difference between the two is
// the whole of the second defect the owner found (JOS-359: *"snapping doesn't allow you to drag
// hard and unsnap"*).
//
// WHY A SNAPPED WINDOW COULD NOT BE PULLED FREE. The Windows move loop owns a DRAG RECTANGLE. Each
// mouse message offsets that rectangle by the movement since the previous message and hands it to
// the app as `WM_MOVING` — which Electron surfaces as `will-move`'s bounds — and whatever the app
// leaves in that rectangle is what the loop then keeps and offsets NEXT time. So the moment this
// code answered a proposal with a snapped rectangle, the loop adopted the snapped rectangle as the
// drag rectangle, and every later proposal was "the stop, plus the last few pixels of mouse" —
// never "the stop, plus everything the hand has done since". With the pull measured against that,
// a hand moving 3px per message is 3px from the stop forever and the magnet never lets go. The
// owner's report IS the measurement: a build that saw the true pointer travel would have released
// the instant it passed 8px, because that is all the shipped geometry does.
//
// SO THE DRAG KEEPS ITS OWN POSITION. `snapDrag` accumulates the loop's per-message movement into
// a VIRTUAL rectangle — where the window would be if nothing had ever pulled it — and snaps THAT.
// Pointer travel past the snap distance therefore releases immediately, exactly once, and the
// window then tracks the hand again with no offset.

/** How long a gap in proposals before the next one is treated as a fresh grab rather than more of
 *  the same drag. A drag reports on every mouse message; a quarter second of silence means the
 *  hand stopped, and re-anchoring there costs at most one snap's worth of correction. */
export const DRAG_RESUME_MS = 250

/** What one drag remembers between `will-move` events. Opaque to the caller: hold it, hand it
 *  back, replace it with what comes out. */
export interface SnapDragSession {
  /** Where the drag would be with no magnetism at all — the hand's own travel. */
  virtual: SnapRect
  /** Where we last left the window. The OS builds its next proposal by offsetting THIS. */
  applied: SnapRect
  /** When the last proposal arrived (ms). */
  at: number
}

/** One `will-move`, as the pure layer needs to see it. An object rather than five parameters
 *  because the repo lints at four, and because every field here is a different KIND of fact. */
export interface SnapDragProposal {
  /** The rectangle the OS is about to apply (`will-move`'s bounds). */
  proposal: SnapRect
  /** The window's bounds right now — what the OS offset to reach `proposal`. */
  current: SnapRect
  targets: SnapTargets
  /** A clock in ms; only differences are used. */
  now: number
  distance?: number
}

export interface SnapDragResult {
  /** Hand this back on the next event. */
  session: SnapDragSession
  /** The rectangle to force the window to, or null to let the OS apply its own proposal. */
  apply: SnapRect | null
}

const samePlace = (a: SnapRect, b: SnapRect): boolean => a.x === b.x && a.y === b.y

/**
 * Is `prev` still the drag we are in the middle of?
 *
 * Two ways it is not, and both matter: the hand paused (so the accumulated position is stale), or
 * the window is no longer where we left it — which means somebody ELSE moved it (the keep-on-screen
 * pass, a display change, a restored position) and our idea of the OS's baseline is fiction.
 */
function resumed(prev: SnapDragSession | null, step: SnapDragProposal): SnapDragSession | null {
  if (prev === null || step.now - prev.at > DRAG_RESUME_MS) return null
  return samePlace(prev.applied, step.current) ? prev : null
}

/**
 * One step of a snapped drag: what to do with this proposal, and what to remember.
 *
 * PURE, and that is the point — the Electron half is a listener that fetches rectangles and calls
 * this, so the release behaviour is provable in a unit test instead of only under a real hand on a
 * real mouse (tests/overlaySnap.test.mts drives a whole drag through it).
 *
 * `apply: null` means "we have nothing to say" — the OS's own proposal is already where the window
 * belongs — so an unsnapped drag stays exactly the drag it always was, and the no-op path neither
 * vetoes the move nor writes bounds.
 */
export function snapDrag(prev: SnapDragSession | null, step: SnapDragProposal): SnapDragResult {
  const live = resumed(prev, step)
  const virtual: SnapRect = live
    ? {
        ...step.proposal,
        x: live.virtual.x + (step.proposal.x - live.applied.x),
        y: live.virtual.y + (step.proposal.y - live.applied.y)
      }
    : step.proposal
  const target = snapMovingBounds(virtual, step.targets, step.distance)
  const apply = samePlace(target, step.proposal) ? null : target
  return { session: { virtual, applied: apply ?? step.proposal, at: step.now }, apply }
}
