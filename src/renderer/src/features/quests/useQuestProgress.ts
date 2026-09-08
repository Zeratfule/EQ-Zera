// quests/useQuestProgress.ts — the evidence bundle, and one `QuestProgress` per asked-for page.
//
// THREE WITNESSES, ONE SHAPE. The loot history says what you HOLD (joined to the catalog by
// `questItemKey`, the same key the Loot page and main's item index use), the `turnins` module says
// what reached an NPC, and the `hails` module says who you greeted. All three are read here, folded
// into a `QuestEvidence`, and handed to the pure `questProgress` in `shared/questProgress.ts` —
// which is where every rule about what the log may conclude actually lives. This hook owns the
// memoisation and nothing else.
//
// THE HAIL WITNESS ARRIVED LAST, AND IT WIRED ONE FIELD (roadmap 2). `questProgress.ts` has carried
// the rule since it was written — `classifyStep` reads `You say, 'Hail, X'` out of a walkthrough
// step and `hailSatisfied` ticks it when the evidence names that NPC through the SAME giver fold
// the turn-in join runs (`giverMatches`, so "The Great Oowomp" and "Great Oowomp" are one subject
// on the same terms everywhere in the app). Its header called `QuestEvidence.hails` a seam rather
// than a stub for exactly this moment: the engine now emits the event, the module publishes it, and
// what changed here is one `useModule` and one property. Nothing about the RULE moved.
//
// THE TURN-IN SNAPSHOT IS READ RAW (`useModule<TurnInSnap>('turnins')`) and coalesced to `[]`. A
// null snapshot here is only "not hydrated yet", and a checklist with nothing ticked is the honest
// drawing of that: unlike the celebration watch next door, a SURFACE has no baseline to protect —
// it is showing you the past on purpose.
//
// MEMOISED ON THE TWO SNAPSHOTS AND THE PAGE LIST. `useModule` guarantees snapshot identity is
// stable until the value actually changes, and `useQuestItems` memoises on the loot snapshot, so
// the fold below re-runs when the world moves and not once per render. The page list is joined into
// a string key for the same reason — a caller building `[quest.page]` inline hands a new array
// every render, and a memo keyed on the array identity would never hold.

import { useMemo } from 'react'
import type { TurnInSnap } from '@shared/types'
import { EMPTY_HAIL_SNAP, type HailSnap } from '@shared/hailTypes'
import { questProgress, type QuestEvidence, type QuestProgress } from '../../../../shared/questProgress'
import { useModule } from '../../lib/useModule'
import { QUEST_BY_PAGE } from './questSearch'
import { useQuestItems } from './useQuestItems'
import { ticksFor, useQuestPins } from './useQuestPins'

const NO_TURN_INS: TurnInSnap = []

/**
 * The separator the page list is joined on below. A wiki page title is full of spaces ("A Job for
 * Nanrum") and carries no newline, so this is the one cheap separator that round-trips the list.
 */
const PAGE_SEP = '\n'

/** The evidence bundle for the active character. Exported so the completion watch shares it. */
export function useQuestEvidence(): QuestEvidence {
  const { items } = useQuestItems()
  const turnIns = useModule<TurnInSnap>('turnins')
  // READ RAW and coalesced to the empty snapshot, on `turnins`' own terms: a null here is only
  // "not hydrated yet", and a checklist with nothing ticked is the honest drawing of that.
  const hails = useModule<HailSnap>('hails')
  const recent = (hails ?? EMPTY_HAIL_SNAP).recent
  return useMemo(
    () => ({ held: new Set(items.map((it) => it.key)), turnIns: turnIns ?? NO_TURN_INS, hails: recent }),
    [items, turnIns, recent]
  )
}

/**
 * `page → QuestProgress` for exactly the pages asked for. A page the catalog does not know is
 * simply absent from the map — never a fabricated row (law 1).
 */
export function useQuestProgress(pages: readonly string[]): Map<string, QuestProgress> {
  const evidence = useQuestEvidence()
  const [pins] = useQuestPins()
  const key = pages.join(PAGE_SEP)
  return useMemo(() => {
    const out = new Map<string, QuestProgress>()
    for (const page of key === '' ? [] : key.split(PAGE_SEP)) {
      const quest = QUEST_BY_PAGE.get(page)
      if (quest) out.set(page, questProgress(quest, evidence, ticksFor(pins, page)))
    }
    return out
    // `key` is the page list; `pages` itself is a fresh array on every render of most callers.
  }, [key, evidence, pins])
}
