// combat/share/FightShareSlot — the one place the Combat tab's selected fight becomes a
// `FightShare`, and the dialog that draws it.
//
// ITS OWN FILE so `CombatView.tsx` gains a mount and not a derivation: that file is a composition
// (header, dashboard, log) and sits near the repo's factoring ceiling, and building a wire shape is
// not composition.
//
// THE START INSTANT IS NOT ON THE SEGMENT. `SegmentView` carries a duration and no beginning; the
// clock lives on the matching `SegmentSummary` (or, for a zone stay, on its `ZoneSessionSummary`),
// which is why the shape is built HERE, where both halves of the snapshot are in hand, rather than
// inside `buildFightShare`. A selection with no matching summary shares a `startedAt` of 0, which
// the embed reads as "nothing stated when this began" and timestamps at the moment of posting —
// never an invented start (world-model law 1).
//
// IT IS MEMOIZED ON A SIGNATURE, `useStableTimeline`'s idiom (CombatView.tsx): every snapshot tick
// rebuilds the segment, so a FINALIZED fight would otherwise hand the dialog a brand-new-but-
// identical object ten times a second while it sits open. The signature moves exactly when the
// content can have — id, duration, total, row count — so a finished fight derives once and a LIVE
// one keeps the card honest as damage lands.

import { useCallback, useMemo, useState, type JSX } from 'react'
import type { CombatSnapshot, SegmentView } from '@shared/combat'
import { buildFightShare, type FightShare } from '@shared/fightShare'
import FightShareDialog from './FightShareDialog'

/** When this fight's first attributed damage landed, from whichever list the selection is in. */
function startedAtOf(snap: CombatSnapshot | null, seg: SegmentView): number {
  if (seg.kind === 'zone') return snap?.zoneSessions.find((z) => z.id === seg.id)?.startTs ?? 0
  return snap?.segments.find((s) => s.id === seg.id)?.startTs ?? 0
}

/** The dialog's own state: whether it is up, the way to close it, and the opener the header is
 *  given ONLY when there is a selection to share. A tab switch unmounts this view, which is the
 *  same as closing the dialog - so it is session state and deliberately not a preference. */
export interface FightShareState {
  open: boolean
  /**
   * ASK FOR THE DIALOG, whatever the tab is holding right now. The deep link from a meter overlay
   * is why this is separate from `opener`: it arrives BEFORE the first snapshot does, so a request
   * gated on there already being a selection would be a request that silently did nothing. The
   * slot below draws nothing until a fight with rows in it exists, and then draws it.
   */
  show: () => void
  /** The HEADER's opener - undefined while the tab has nothing selected, or is still reading the
   *  log, because a button offering to share the empty state is a button about nothing. */
  opener: (() => void) | undefined
  close: () => void
}

/**
 * WHETHER THERE IS ANYTHING TO SHARE is decided from the two things that answer it - a selection,
 * and a fold that has caught up - rather than by the view composing a condition of its own. That
 * keeps CombatView a composition (the file is at its factoring ceiling) and puts the question next
 * to the dialog that answers it.
 */
export function useFightShare(seg: SegmentView | null, hydrating: boolean): FightShareState {
  const [open, setOpen] = useState(false)
  const show = useCallback(() => {
    setOpen(true)
  }, [])
  const close = useCallback(() => {
    setOpen(false)
  }, [])
  return { open, show, opener: seg && !hydrating ? show : undefined, close }
}

export function FightShareSlot({
  snap,
  seg,
  open,
  onClose,
  onOpenSharingPrefs
}: {
  snap: CombatSnapshot | null
  seg: SegmentView | null
  open: boolean
  onClose: () => void
  onOpenSharingPrefs: () => void
}): JSX.Element | null {
  const sig = seg
    ? `${seg.id}|${String(seg.durationSec)}|${String(seg.outTotal)}|${String(seg.entities.length)}`
    : ''
  const fight = useMemo<FightShare | null>(
    () => (seg ? buildFightShare(seg, startedAtOf(snap, seg)) : null),
    // The signature IS the dependency: `seg` and `snap` are fresh objects on every poll, and
    // listing them would defeat the memo entirely. See the header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig]
  )
  // A fight with no rows is not a thing to put in somebody's channel (main refuses it too), so the
  // dialog simply does not open on one - the Share button is already withheld in that state.
  if (!open || fight === null || fight.members.length === 0) return null
  return <FightShareDialog fight={fight} onClose={onClose} onOpenSharingPrefs={onOpenSharingPrefs} />
}
