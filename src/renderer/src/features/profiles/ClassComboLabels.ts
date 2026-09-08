// ClassComboLabels — the PURE wording of the class-combo surface. No React, no MUI, and only
// TYPE imports from `@shared`, so tests/comboAdapter.test.mts can import it straight under tsx
// (the node runner has no `@shared/*` alias — the same constraint rangeStatsRows.ts documents).
//
// WHY A SEPARATE FILE. Every honesty rule this feature has is a wording decision: whether a slot
// prints an abbreviation or a candidate SET, whether a boundary prints an instant or a range,
// whether an interval says "inferred". Those rot silently inside JSX; here they are functions
// with return values, and the test file pins them.
//
// THE THREE RULES THIS FILE ENFORCES (docs/plans/class-combo-inference.md §8, world-model law 1):
//   1. A slot with several candidates prints the SET (`CLR|PAL`) and never picks a member. The
//      real log has spans where CLR is never exclusively evidenced — `{CLR,PAL}` is the true
//      answer there, and "PAL" would be a fabricated one.
//   2. A slot with no evidence prints an em-dash. Not a class, not a blank, not a zero.
//   3. A boundary is a RANGE. A swap prints nothing at all in the log, so the two events that
//      bracket it can be 33.9 h apart; the '~' marker and its window are the honest reading of
//      `startTs`, which is only the best estimate inside [startLo, startHi].

import type { ComboBoundaryReason, ComboInterval, ComboProvenance, ComboSlot } from '@shared/classCombo'
import { formatDateTime } from '../../lib/formatDate'
import { fmtDuration } from '../leveling/levelChartGeometry'

/** Every unknown prints as this — the app's one spelling for "the log did not say". */
export const NONE = '-'

/**
 * How many candidates make a slot UNKNOWN rather than merely ambiguous. Mirrors
 * `CLASS_ABBRS.length` in shared/classCombo.ts and is spelled literally for the same reason
 * `copyText.ts` spells SLAY_LABEL literally: a VALUE import from `@shared` would break the node
 * tests, which run without the renderer's alias. The test pins the two against each other.
 */
export const ALL_CLASSES = 16

export type SlotKind = 'resolved' | 'ambiguous' | 'unknown'

/** Resolved = exactly one candidate. Unknown = the whole roster (or nothing). Else ambiguous. */
export function slotKind(slot: ComboSlot): SlotKind {
  if (slot.candidates.length === 1) return 'resolved'
  if (slot.candidates.length === 0 || slot.candidates.length >= ALL_CLASSES) return 'unknown'
  return 'ambiguous'
}

/** `PAL` · `CLR|PAL` · `—`. Rule 1 and rule 2 in one function. */
export function slotLabel(slot: ComboSlot): string {
  const kind = slotKind(slot)
  if (kind === 'unknown') return NONE
  return slot.candidates.join('|')
}

/** The whole loadout, slot order preserved: `PAL / ROG / BER`, `PAL / CLR|PAL / —`. */
export function comboLabel(interval: ComboInterval): string {
  return interval.slots.map(slotLabel).join(' / ')
}

/** The strongest provenance in the interval — `user` beats `who` beats `inferred`. */
export function intervalProvenance(interval: ComboInterval): ComboProvenance {
  if (interval.slots.some((s) => s.provenance === 'user')) return 'user'
  if (interval.slots.some((s) => s.provenance === 'who')) return 'who'
  return 'inferred'
}

/** True when ANY slot is still inference — the chip the UI must show (law 1). */
export function hasInferredSlot(interval: ComboInterval): boolean {
  return interval.slots.some((s) => s.provenance === 'inferred')
}

/** Chip text per provenance. `who` says what the log said, not how we read it. */
export function provenanceLabel(p: ComboProvenance): string {
  if (p === 'user') return 'you set this'
  if (p === 'who') return 'stated by /who'
  return 'inferred'
}

/**
 * WHERE THE LOADOUT ON SCREEN CAME FROM, in the words the override control needs (JOS-87).
 *
 * `provenanceLabel` is chip-sized and written from the interval's point of view; this is the
 * sentence a user reads when they are deciding whether to correct it, so it names the two
 * things they can act on — autodetection, which they can override, and their own override,
 * which they can undo. A `/who` row is neither: it is the game stating the loadout, and the
 * honest thing to say is that nothing needs correcting.
 */
export function loadoutSourceText(interval: ComboInterval): string {
  const p = intervalProvenance(interval)
  if (p === 'user') return 'Set by you - autodetection will not change it.'
  if (p === 'who') return 'Named by your own /who row - the game stated this outright.'
  return 'Autodetected from the classes showing up in your log.'
}

/**
 * The notice for an override the game contradicted, or null. Stated as the two facts (what you
 * set, what the log then said) with no adjudication — the model already picked `/who`, and the
 * user's job here is to decide whether their override is stale, not to be told they were wrong.
 */
export function overruledText(interval: ComboInterval): string | null {
  if (interval.userOverruled !== true) return null
  return `A /who row inside this range named ${comboLabel(
    interval
  )}, so your manual setting is not in effect here. Clear it, or set it to match.`
}

/** Why the interval OPENED. Prose, because a raw `overDetermined` is not a state a user holds. */
export function boundaryReasonLabel(reason: ComboBoundaryReason): string {
  switch (reason) {
    case 'who':
      return 'a /who row named a different loadout'
    case 'levelDrop':
      return 'the level dropped, which only a loadout swap does'
    case 'evidenceShift':
      return 'the classes showing up in the log changed'
    case 'overDetermined':
      return 'more classes than a loadout holds appeared here'
    case 'user':
      return 'you set this range'
    case 'logStart':
      return 'the log starts here'
  }
}

/** `8/2/2026, 2:13:34 AM → now` — the interval's span, user-local, one spelling. */
export function spanText(interval: ComboInterval): string {
  const end = interval.endTs === null ? 'now' : formatDateTime(interval.endTs)
  return `${formatDateTime(interval.startTs)} → ${end}`
}

/**
 * The span of SEVERAL intervals a surface has grouped together because they state the same
 * loadout (JOS-236 — the raid roster's sectioning, features/bosses/loadoutGroups.ts).
 *
 * RULE 3'S SIBLING: a merged span has HOLES in it. Earliest start → latest end is the only
 * bracket that is true of all of them, and drawn alone it would claim every hour in between, so
 * the count of ranges is part of the sentence rather than a tooltip's afterthought. One interval
 * prints exactly what `spanText` always printed; zero prints nothing rather than a fake bracket.
 */
export function spansText(intervals: readonly ComboInterval[]): string {
  if (intervals.length === 0) return ''
  if (intervals.length === 1) return spanText(intervals[0])
  const start = Math.min(...intervals.map((i) => i.startTs))
  // One open member makes the whole union open — it is still running now.
  const open = intervals.some((i) => i.endTs === null)
  const end = open ? 'now' : formatDateTime(Math.max(...intervals.map((i) => i.endTs ?? 0)))
  return `${formatDateTime(start)} → ${end} · ${String(intervals.length)} ranges`
}

/** Width of the start's uncertainty window, in ms. 0 = the log pinned the instant. */
export function startFuzzMs(interval: ComboInterval): number {
  return Math.max(0, interval.startHi - interval.startLo)
}

/**
 * The '~' annotation for a fuzzy start, or null when the boundary is exact. States the WINDOW
 * first (that is the fact) and the detector second (that is why we believe it at all).
 */
export function startFuzzText(interval: ComboInterval): string | null {
  const fuzz = startFuzzMs(interval)
  if (fuzz <= 0) return null
  const reasons = [interval.startReason, ...(interval.startAlso ?? [])]
  return `Started somewhere in a ${fmtDuration(fuzz)} window (${formatDateTime(
    interval.startLo
  )} → ${formatDateTime(interval.startHi)}): ${reasons.map(boundaryReasonLabel).join('; ')}.`
}

/** `75%` — confidence as the plan's min-over-slots number, already computed by the caller. */
export function confidenceText(confidence: number): string {
  return `${Math.round(confidence * 100)}%`
}

/**
 * Why the confidence gate (`loadoutUncertain`, shared/comboIndex.ts) is holding this interval, or
 * null when it is not — the wording for the Profile tab's per-interval row (JOS-239).
 *
 * The two conditions read differently to a user and are worth separating: "more classes than a
 * loadout holds" is about the evidence, "your level went backwards" is about a swap the log did
 * announce and nothing dated. Both end the same way — the classes on this row are the ranking's
 * opinion, and the row is the place to correct it.
 */
export function uncertainText(interval: ComboInterval): string | null {
  const reasons: string[] = []
  if (interval.startAlso?.includes('overDetermined') === true) {
    reasons.push('more classes showed up here than a loadout holds')
  }
  if (interval.levelRegressed === true) {
    reasons.push('your level went backwards inside this range, which only a swap does')
  }
  if (reasons.length === 0) return null
  return `${reasons.join(', and ')} - so a swap probably happened in here that nothing dated. Treat these classes as a guess, and correct the range if you know better.`
}

/** `levels 10–24`, `level 50`, or null when no level was observed inside the interval. */
export function levelRangeText(interval: ComboInterval): string | null {
  const { levelLo: lo, levelHi: hi } = interval
  if (lo === null || hi === null) return null
  return lo === hi ? `level ${lo}` : `levels ${lo}-${hi}`
}
