// overview/share/useSessionShare — the one place the Overview's last session becomes a
// `SessionShare`.
//
// ITS OWN FILE so `LastSessionCard.tsx` gains a mount and not a derivation, and so the four owners
// that answer a session are asked in ONE place: the progression range query (kills, levels, zones,
// active time), the death recaps, the loot feed and the combat engine's segments. `lastSession.ts`
// has already decided WHICH session - the stretch between the two logouts the log printed - and
// this hook never second-guesses that boundary; it re-asks `rangeStats` over the same `[t0, t1)`
// the card drew, which is a pure function of the snapshot rather than a second opinion.
//
// IT IS MOUNTED ONLY WHILE THE DIALOG IS OPEN (`SessionShareSlot`), and that is deliberate: it
// carries a combat poll, and `useOverviewCombat`'s standing claim is that Overview and Combat are
// never on screen together. A second poll for the seconds a share dialog is up is a cost taken
// knowingly, and it stops the moment the dialog closes.
//
// THE LEVEL IS THE ONE READ WITH A CHOICE IN IT. The character module states the level you are NOW;
// a card about last night wants the level you were THEN. So a ding inside the range wins - the log
// stated it, inside the window - and the module's current statement is the fallback for the common
// case of a session with no ding in it at all.

import { useMemo } from 'react'
import type { ComboInterval } from '@shared/classCombo'
import type { CharacterSnap, DeathSnap, ProgressionSnap } from '@shared/types'
import { buildSessionShare, type SessionShare } from '@shared/sessionShare'
import { rangeStats } from '@shared/progressionStats'
import { useModule } from '../../../lib/useModule'
import { slotKind, slotLabel } from '../../profiles/ClassComboLabels'
import { useComboSnap } from '../../profiles/ClassComboData'
import { useOverviewCombat } from '../useOverviewCombat'
import { useRecentDrops } from '../useRecentDrops'
import type { LastSessionView } from '../lastSession'

/** How many deaths the recap ring holds inside the range. A walk, like `lastSession.ts`'s own. */
function deathsIn(deaths: DeathSnap | null, t0: number, t1: number): number {
  if (!deaths) return 0
  let n = 0
  for (const recap of deaths.recaps) {
    if (recap.ts >= t0 && recap.ts < t1) n++
  }
  return n
}

/**
 * The loadout in force when the session ENDED - the slots the log RESOLVED, and only those.
 *
 * The label is the chip vocabulary's own (`slotLabel`), so a share and the Character tab cannot
 * disagree about what a slot says. What differs is which slots travel: a slot the log never narrowed
 * prints its candidate SET on screen, where the chip's colour and its tooltip say "we know two of
 * three" - and measured against the real fixture that set is `BRD|BST|MNK|RNG|ROG`, which in
 * somebody's channel is five classes nobody plays rather than one honest hedge. So an unresolved
 * slot says NOTHING here, which is the same rule as every other absent field on this card, and the
 * Character tab remains the surface that shows what was narrowed to what.
 */
function classesAt(intervals: readonly ComboInterval[], at: number): string[] {
  const held = intervals.find((i) => i.startTs <= at && (i.endTs === null || i.endTs >= at))
  const labels: string[] = []
  for (const slot of held?.slots ?? []) {
    if (slotKind(slot) === 'resolved') labels.push(slotLabel(slot))
  }
  return labels
}

/** The level the log stated INSIDE the range, when it stated one. See the header. */
function levelIn(ups: readonly { level: number }[], fallback: number | undefined): number | undefined {
  let level: number | undefined
  for (const up of ups) level = up.level
  return level ?? fallback
}

/**
 * The last session as the thing that gets posted, or null when the log states no such session.
 *
 * MEMOIZED ON A SIGNATURE for `FightShareSlot`'s reason: the combat snapshot is a fresh object on
 * every poll, so listing it would rebuild the share - and re-run the range query over the whole
 * progression snapshot - once a second while the dialog simply sits there. The signature moves
 * exactly when the ranking can have.
 */
export function useSessionShare(view: LastSessionView | null): SessionShare | null {
  const prog = useModule<ProgressionSnap>('progression')
  const deaths = useModule<DeathSnap>('deaths')
  const who = useModule<CharacterSnap>('character')
  const combo = useComboSnap()
  const drops = useRecentDrops()
  const snap = useOverviewCombat()
  const segments = snap?.segments ?? []
  const fightSig = segments.map((s) => `${s.id}:${String(Math.round(s.dps))}`).join('|')

  return useMemo(() => {
    if (view === null || prog === null) return null
    const stats = rangeStats({ snap: prog, range: { t0: view.t0, t1: view.t1 } })
    const character = who?.character?.name
    const level = levelIn(stats.levelUps, who?.level?.level)
    return buildSessionShare({
      ...(character === undefined ? {} : { character }),
      classes: classesAt(combo.intervals, view.t1),
      ...(level === undefined ? {} : { level }),
      session: view,
      stats,
      deaths: deathsIn(deaths, view.t0, view.t1),
      drops,
      fights: segments
    })
    // `segments` is the signature's subject, not a dependency: see the header.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, prog, deaths, who, combo, drops, fightSig])
}
