// useQuestItemToast — the QUEST-ITEM DROP DETECTOR (ROADMAP §1).
//
// A hook with no return value, mounted once app-wide beside the boss-kill, Sky-turn-in and
// level-up watches: when a LIVE loot line names an item the committed quest catalog knows, the
// celebration overlay gets a card naming the quest(s) and their steps. The DECIDING is all in
// `questItemToast.ts`, which is pure; this file owns the baseline, the refs and the send.
//
// ── THE CELEBRATIONS LAW ──────────────────────────────────────────────────────────────────────
//
// Exactly once per LIVE transition, and hydration seeds a SILENT baseline. The startup replay
// fills the `loot` module with every item this character has ever picked up — thousands of rows,
// hundreds of them quest items — so the first snapshot this hook sees is the PAST and firing on it
// would bury the screen. The first non-null snapshot therefore records a baseline and celebrates
// nothing. A character switch clears it for the reason it does in useLevelUpToast: main rebuilt
// the world, and the next snapshot is that world's history, not news.
//
// ── WHY THE BASELINE IS A LENGTH AND NOT A TIMESTAMP ──────────────────────────────────────────
//
// The loot snapshot is APPEND-ONLY — a delta is a concat, forever (useLootHistory's header) — so
// the count of rows already seen is an exact cursor. A timestamp is not: EverQuest prints several
// loot lines in the same second (a stack split, a corpse emptied in one pass), so `ts > baseline`
// would drop the second and third items of one instant and `ts >= baseline` would re-fire the
// first. A length has neither failure. A snapshot SHORTER than the baseline is a rebuild rather
// than a retraction, and it re-seeds silently.
//
// ── AND WHY THE BASELINE STILL ADVANCES WHEN THE FEATURE IS OFF ───────────────────────────────
//
// Switching the pop-up on is a statement about the FUTURE. If the baseline froze while the
// preference was false, the first snapshot after switching it on would hand the detector every
// item looted in between and fire a stack of cards about loot the player has already dealt with.
// So the cursor moves on every snapshot and only the SENDING is gated.
//
// The module is read DIRECTLY with `useModule<LootSnap>('loot')`, not through `useLootHistory`:
// that hook coalesces `null` to an empty array, and "not hydrated yet" is exactly the state this
// baseline is built on. Classes and preferences are read at FIRE time through refs (the
// `intervalsRef` idiom) so this effect depends on the SNAPSHOT alone — a `/who` or a flipped
// switch must not re-run a batch that has already been sent.

import { useEffect, useMemo, useRef } from 'react'
import type { LootSnap } from '@shared/types'
import { useModule } from '../../lib/useModule'
import { useResolvedClasses } from '../alerts/lineIntel'
import { questItemToastRequests } from './questItemToast'
import { questsByItem } from './questSearch'
import { useQuestToastPrefs } from './useQuestToastPrefs'

/** Watch the loot module and toast every LIVE quest-item drop. Mount once, app-wide. */
export function useQuestItemToast(): void {
  const snap = useModule<LootSnap>('loot')
  const classes = useResolvedClasses()
  const [prefs] = useQuestToastPrefs()
  const classesRef = useRef(classes)
  classesRef.current = classes
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  // null = "no baseline yet"; the first snapshot sets it and celebrates nothing.
  const baselineRef = useRef<number | null>(null)
  // item key → when it last popped. Lives across snapshots, cleared on a character switch.
  const recentRef = useRef<Map<string, number>>(new Map())
  // Already a module-level cached map (questSearch.questsByItem) — the memo is only so the effect
  // below can name it as a stable dependency.
  const byItem = useMemo(() => questsByItem(), [])

  useEffect(() => {
    const off = window.eq.onCharacter(() => {
      baselineRef.current = null
      recentRef.current.clear()
    })
    return off
  }, [])

  useEffect(() => {
    if (!snap) return
    const baseline = baselineRef.current
    baselineRef.current = snap.length
    // First sight, or a rebuild that left fewer rows than we had counted: seed, say nothing.
    if (baseline === null || snap.length < baseline) return
    const events = snap.slice(baseline)
    if (events.length === 0) return
    const prefsNow = prefsRef.current
    if (!prefsNow.enabled) return
    const requests = questItemToastRequests({
      events,
      byItem,
      classes: classesRef.current,
      prefs: prefsNow,
      recent: recentRef.current,
      now: Date.now()
    })
    for (const req of requests) window.eq.showToast(req)
  }, [snap, byItem])
}
