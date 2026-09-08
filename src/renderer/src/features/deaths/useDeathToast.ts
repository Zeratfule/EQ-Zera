// useDeathToast — THE DEATH RECAP DETECTOR (ROADMAP item 7).
//
// A hook with no return value, mounted once app-wide beside the seven watches that came before it:
// when a LIVE `playerDeath` reaches the `deaths` module, the celebration overlay gets a card
// naming who killed you and what the last fifteen seconds held. The WORDS are all in
// `./deathCard.ts`, which is pure and node-tested and is also what the Overview card
// reads, so the card that pops and the card that stays cannot word one death two ways.
//
// ── THE CELEBRATIONS LAW ──────────────────────────────────────────────────────────────────────
//
// Exactly once per LIVE transition, and hydration seeds a SILENT baseline. A fold has no way to
// tell a death it is replaying from one that just happened, and it may not read a wall clock to
// find out (deathTypes.ts's own header), so a hydrate publishes a recap for EVERY past death — a
// long log holds dozens. The first non-null snapshot therefore records a baseline and celebrates
// nothing, and a character switch clears it for the reason it does in useQuestItemToast: main
// rebuilt the world, and the next snapshot is that world's history rather than news.
//
// ── WHY THE BASELINE IS A LENGTH ──────────────────────────────────────────────────────────────
//
// `recaps` is append-only and capped drop-oldest at 50, so the count of rows already seen is an
// exact cursor and a timestamp is not (two deaths can share a second — a death and the DoT tick
// that was still landing). A snapshot SHORTER than the baseline is a rebuild rather than a
// retraction — the `epoch` reset clears the ring — and it re-seeds silently, exactly as the loot
// watches do.
//
// A DEATH IS NOT A CELEBRATION, and it still belongs in the celebration lane: that window is the
// app's one always-visible surface, and "you died to a fire giant warrior, here is what hit you"
// is the single most time-critical thing this app can say to somebody who is about to run back
// for their corpse. It carries no `focus` and no item — there is no destination the click could
// honestly name (the recap's own surface is the Overview card the player is not looking at), and
// a death hands you nothing.

import { useEffect, useRef } from 'react'
import type { DeathSnap } from '@shared/types'
import { useModule } from '../../lib/useModule'
import { deathToastId, deathToastText } from './deathCard'

/** Watch the deaths module and toast every LIVE death. Mount once, app-wide. */
export function useDeathToast(): void {
  const snap = useModule<DeathSnap>('deaths')
  // null = "no baseline yet"; the first snapshot sets it and celebrates nothing.
  const baselineRef = useRef<number | null>(null)

  useEffect(() => {
    const off = window.eq.onCharacter(() => {
      baselineRef.current = null
    })
    return off
  }, [])

  useEffect(() => {
    if (!snap) return
    const baseline = baselineRef.current
    const recaps = snap.recaps
    baselineRef.current = recaps.length
    // First sight, or a rebuild that left fewer rows than we had counted: seed, say nothing.
    if (baseline === null || recaps.length < baseline) return
    // An INDEX WALK, never a `.slice()` into a shared row type — and the same walk covers the
    // ordinary one-new-row case and the burst a paused tail can deliver.
    for (let i = baseline; i < recaps.length; i++) {
      const recap = recaps[i]
      const { title, subtitle } = deathToastText(recap)
      window.eq.showToast({ id: deathToastId(recap), kind: 'death', title, subtitle })
    }
  }, [snap])
}
