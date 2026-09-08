// selectionDraft.ts — THE DRAG HANDLE'S OWN CHANNEL (JOS-290).
//
// WHAT WAS MEASURED, AND WHY THIS FILE EXISTS.
//
// The owner reported that drag-selecting a period over the leveling graph is slow. The ticket's
// hypothesis was a full-snapshot `rangeStats` fold per pointermove. THAT IS NOT WHAT WAS
// HAPPENING, and both halves of it were measured before anything here was written:
//
//   1. `rangeStats` DOES NOT RUN during a drag at all. `useLevelingCharts`'s scope memo depends on
//      the COMMITTED selection (`sel`), never on the draft, so the numbers are derived once on
//      pointer-UP — which is the design, and it is kept exactly.
//   2. And it would not have mattered if it did: the progression snapshot is CAPPED
//      (EXP_CAP/KILL_CAP 40k, ZONE_CAP 4k), so over the owner's whole 1.64M-line log the columns
//      are ~7k long and `rangeStats` measures 0.95 ms/move averaged over a 120-move sweep of the
//      full 371-hour domain, 1.6 ms for the single widest range. There is no fold to make cheaper.
//
// WHAT THE COST ACTUALLY WAS: 284 ms of main-thread work PER POINTERMOVE, measured with a CPU
// profile over a real 60-move drag on the owner's real log (3.0 s per move of wall clock). The
// draft band was React STATE in `useChartSelection`, which is called from `LevelingView` — so
// every move re-rendered the WHOLE TAB: ~10k DOM nodes, 105 zone rows in the range panel, the
// drops rows, 61 AA-ledger rungs, the feed, the heroes. ~60% of the samples were MUI/emotion
// style serialization of a tree whose output was IDENTICAL to the previous frame
// (`handleInterpolation`, `getThemeValue`, `murmur2`, `processStyleVariants`, `serializeStyles`),
// ~9% the drops rows alone, ~9% react-dom reconciliation.
//
// THE FIX IS THE CHANNEL, NOT THE ARITHMETIC. A draft band is the only thing on screen that
// changes while the pointer is down — the curves, the zone strip, the legend and every readout
// are functions of the COMMITTED scope and cannot move until the drag ends. So the draft stops
// being view state and becomes a one-slot external store that only the two `SelectionBand`s
// subscribe to. A pointermove now re-renders two components of five divs each; nothing else in
// the tab is told anything happened.
//
// NO rAF THROTTLE, ON PURPOSE. The ticket lists rAF coalescing as a candidate and this file
// deliberately declines it, for two measured reasons: Chromium already delivers `pointermove` at
// most once per frame (the rest are on `getCoalescedEvents`, which nothing here reads), and
// AGENTS.md records that `requestAnimationFrame` can be throttled TO NOTHING in a never-
// composited window — which is every e2e launch, so a rAF gate would make the band untestable
// and would buy a burst that the platform has already collapsed. The cheap guard that IS here is
// value equality: two moves inside the same pixel publish once.
//
// Pure: no React, no DOM, no MUI. `tests/levelingDragDraft.test.mts` drives it directly.

/** A half-open pair of instants — structurally `ChartSelection`, declared here so this file
 *  imports nothing (useChartSelection imports IT, not the other way round). */
export interface DraftRange {
  t0: number
  t1: number
}

/**
 * The range a drag covers, given where it STARTED and where the pointer is now.
 *
 * Lifted out of `useChartSelection`'s move handler verbatim so it can be pinned: the draft band,
 * the committed selection and this function are one formula, and a fast handle that drew a
 * different rectangle from the one it commits would be the worst possible bug to ship here.
 * Ordered, never signed — dragging right-to-left is the same range as dragging left-to-right.
 */
export function draftRange(originTs: number, ts: number): DraftRange {
  return { t0: Math.min(originTs, ts), t1: Math.max(originTs, ts) }
}

/** True when two drafts describe the same instants. Null is a value here — "no band". */
export function sameDraft(a: DraftRange | null, b: DraftRange | null): boolean {
  if (a === null || b === null) return a === b
  return a.t0 === b.t0 && a.t1 === b.t1
}

/**
 * A one-slot store with `useSyncExternalStore`'s exact contract.
 *
 * `get` returns the SAME reference until `set` changes the value — that is not an optimization,
 * it is the requirement (a getSnapshot handing back a fresh object every call re-renders
 * forever). `set` with an equal value notifies NOBODY, which is what collapses a pointer moving
 * inside one pixel into zero renders.
 */
export interface DraftStore {
  subscribe: (cb: () => void) => () => void
  get: () => DraftRange | null
  set: (next: DraftRange | null) => void
}

export function createDraftStore(): DraftStore {
  let value: DraftRange | null = null
  const listeners = new Set<() => void>()
  return {
    subscribe: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    get: () => value,
    set: (next) => {
      if (sameDraft(value, next)) return
      value = next
      // Copied first: a subscriber that unsubscribes while being notified must not shorten the
      // list being walked (the useTimeslice store's own rule).
      for (const cb of [...listeners]) cb()
    }
  }
}
