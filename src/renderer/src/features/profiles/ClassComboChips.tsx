// ClassComboChips — the chip vocabulary of the class-combo surface, in ONE place so the Overview
// card, the interval list and the editor cannot drift into three dialects.
//
// CHIPS CONVEY STATE (AGENTS.md, UI conventions). There are exactly four things a chip says here:
//   * a SLOT — the class (`PAL`), the candidate set we narrowed to (`CLR|PAL`), or an em-dash
//     when nothing narrowed it at all. An ambiguous slot is warning-coloured and an unknown one
//     is dimmed, so "we know two of three" is legible at a glance without reading a word.
//   * PROVENANCE — `inferred` unless the log or the user stated it outright. Never omitted for
//     an inferred combo (world-model law 1).
//   * CONFIDENCE — the MIN over slots, never the mean: a combo you 2/3 know is 2/3 known.
//   * LOCKED — you set this range, so re-inference leaves it alone.
//
// No methodology captions, no "how we inferred this" panel; the tooltips state facts about the
// data, not the algorithm that produced it.

import type { JSX } from 'react'
import { Chip, Stack } from '@mui/material'
import {
  intervalConfidence,
  type ComboInterval,
  type ComboProvenance,
  type ComboSlot
} from '@shared/classCombo'
import { loadoutUncertain } from '@shared/comboIndex'
import {
  confidenceText,
  intervalProvenance,
  overruledText,
  provenanceLabel,
  slotKind,
  slotLabel,
  uncertainText
} from './ClassComboLabels'
import { Tooltip } from '../../lib/Tooltip'

const CHIP_SX = { height: 20 } as const

/** Tooltip for one slot, stated as a fact about what the log did or did not name. */
function slotTitle(slot: ComboSlot): string {
  const kind = slotKind(slot)
  if (kind === 'resolved') return `${slot.candidates[0]} - ${provenanceLabel(slot.provenance)}.`
  if (kind === 'unknown') return 'Nothing in this range named a class for this slot.'
  return `One of ${slot.candidates.join(', ')} - the log never named which.`
}

/** One slot. Colour carries the kind; the label carries the content. */
export function SlotChip({ slot }: { slot: ComboSlot }): JSX.Element {
  const kind = slotKind(slot)
  return (
    <Tooltip title={slotTitle(slot)}>
      <Chip
        size="small"
        variant="outlined"
        color={kind === 'ambiguous' ? 'warning' : 'default'}
        label={slotLabel(slot)}
        sx={{
          ...CHIP_SX,
          fontWeight: kind === 'resolved' ? 700 : 400,
          opacity: kind === 'unknown' ? 0.55 : 1
        }}
      />
    </Tooltip>
  )
}

/** The loadout as chips, slot order preserved. Zero slots renders nothing, not an empty box. */
export function SlotChips({ slots }: { slots: readonly ComboSlot[] }): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
      {slots.map((slot, i) => (
        <SlotChip key={`${i}:${slot.candidates.join('|')}`} slot={slot} />
      ))}
    </Stack>
  )
}

/**
 * `inferred` / `stated by /who` / `you set this` — the state, never the process.
 *
 * THE INFERRED CASE NAMES THE WAY OUT (JOS-192, trigger report 01KZP6SDZJK6BPEWA4Z0MF5ANG). A
 * loadout swap prints nothing, so an inferred trio can be a loadout the player has already left,
 * and the whole of that report was that the surface showing it offered nothing to do about it.
 * The two moves are one clause on the chip that already exists — no surface grows by a pixel for
 * it (the Leveling tab's own layout budget at the app's minimum width is exactly zero: a single
 * caption line there drew the timeslice control under a panel, and tests/e2e/leveling.e2e.mts
 * says so) and every surface drawing a current loadout gets it at once.
 */
const PROVENANCE_TITLE: Record<ComboProvenance, string> = {
  inferred:
    'Read from the classes that show up in the log. Not the ones you are playing? A /who on yourself restates them, or correct the range on the Profile tab.',
  who: 'Your own /who row named this loadout outright.',
  user: 'You set this range yourself.'
}

export function ProvenanceChip({ interval }: { interval: ComboInterval }): JSX.Element {
  const p = intervalProvenance(interval)
  return (
    <Tooltip title={PROVENANCE_TITLE[p]}>
      <Chip
        size="small"
        variant="outlined"
        color={p === 'inferred' ? 'default' : 'success'}
        label={provenanceLabel(p)}
        sx={CHIP_SX}
      />
    </Tooltip>
  )
}

/** Confidence, the MIN over slots. Absent slots ⇒ 0, which prints as 0% rather than hiding. */
export function ConfidenceChip({ interval }: { interval: ComboInterval }): JSX.Element {
  return (
    <Tooltip title="The least confident slot decides.">
      <Chip
        size="small"
        variant="outlined"
        label={confidenceText(intervalConfidence(interval))}
        sx={{ ...CHIP_SX, opacity: 0.75 }}
      />
    </Tooltip>
  )
}

/** Shown only on a corrected interval: inference will not touch these slots. */
export function LockedChip(): JSX.Element {
  return (
    <Tooltip title="You set this range.">
      <Chip size="small" variant="outlined" color="info" label="locked" sx={CHIP_SX} />
    </Tooltip>
  )
}

/**
 * Shown only where the confidence gate is holding the row (JOS-239, `loadoutUncertain`).
 *
 * The roster refuses to name a loadout for these spans at all — a kill card is a claim about one
 * moment and there is no honest trio to put over it. The history list is a different question ("what
 * do we believe about each stretch, and where do I go to fix it"), so here the classes stay on
 * screen beside the Edit button and the chip says not to trust them. Same gate, two truthful
 * renderings of it.
 */
export function UncertainChip({ interval }: { interval: ComboInterval }): JSX.Element | null {
  const text = uncertainText(interval)
  if (!text || !loadoutUncertain(interval)) return null
  return (
    <Tooltip title={text}>
      <Chip size="small" variant="outlined" color="warning" label="mixed loadouts" sx={CHIP_SX} />
    </Tooltip>
  )
}

/**
 * Shown only where a manual setting LOST — a `/who` row inside the span named something else
 * (§ 4.4). It is the one way an explicit override stops being in effect, so it is a chip on the
 * row rather than a silent substitution (JOS-87).
 */
export function OverruledChip({ interval }: { interval: ComboInterval }): JSX.Element | null {
  const text = overruledText(interval)
  if (!text) return null
  return (
    <Tooltip title={text}>
      <Chip size="small" variant="outlined" color="warning" label="/who overrode you" sx={CHIP_SX} />
    </Tooltip>
  )
}
