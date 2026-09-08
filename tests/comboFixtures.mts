// Hand-built class-combo intervals for the tests that JOIN things to them (the raid roster's
// loadout sectioning, today). NOT a *.test.mts — it is imported by the specs that need it, so the
// builder lives in one place and two files cannot drift into two ideas of what a default interval
// is. The inference tests build their intervals from real log evidence instead; this is only for
// the readers.
//
// EVERY INTERVAL NAMES ITS CLASSES. Since JOS-236 the sectioning merges intervals that state the
// SAME loadout, so an interval with its slots left empty is not "the join under test with the
// irrelevant part omitted" — it is an interval claiming the same (empty) loadout as every other
// one, which is a different scenario than the one being written.
//
// Imported RELATIVELY: node tests run through tsx with no `@shared` alias.

import type { ClassAbbr, ComboInterval, ComboProvenance, ComboSlot } from '../src/shared/classCombo'

/** One slot. Resolved unless the caller hands it several candidates. */
export function slot(candidates: ClassAbbr[], provenance: ComboProvenance = 'inferred'): ComboSlot {
  return { candidates, confidence: candidates.length === 1 ? 0.75 : 0.3, provenance, because: [] }
}

/** What a caller may say about an interval beyond its span: its classes, or raw field overrides. */
export type IntervalOver = Partial<ComboInterval> & { classes?: ClassAbbr[] }

/**
 * A combo interval with an exact boundary and everything else defaulted. `classes` is the usual
 * way to state the loadout (one resolved slot each); `slots` overrides it outright for the cases
 * that are about ambiguity or provenance.
 */
export function interval(
  id: string,
  startTs: number,
  endTs: number | null,
  over: IntervalOver = {}
): ComboInterval {
  const { classes = [], ...fields } = over
  return {
    id,
    startTs,
    endTs,
    startLo: startTs,
    startHi: startTs,
    endLo: endTs,
    endHi: endTs,
    startReason: 'evidenceShift',
    expectedSlots: 3,
    slots: classes.map((c) => slot([c])),
    levelLo: null,
    levelHi: null,
    evidenceCount: 1,
    userLocked: false,
    ...fields
  }
}

/** The two real loadouts the Lord of Ire diagnosis names (tests/bossTierRuns.test.mts). */
export const IRE_TRIO: ClassAbbr[] = ['PAL', 'MNK', 'ENC']
export const LATER_TRIO: ClassAbbr[] = ['ROG', 'PAL', 'BER']
