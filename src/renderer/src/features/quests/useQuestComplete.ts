// useQuestComplete — THE CATALOG-QUEST COMPLETION WATCH (EQ Zera).
//
// The FIFTH always-mounted celebration watch, beside the boss-kill, Sky-turn-in, level-up and
// quest-item ones: when a LIVE turn-in puts the last required item of a catalog quest into its
// giver's hands, the quest is done and the app says so — the `questComplete` app signal (the sound
// the alerts extension already owns) and a celebration card anchored at the quest's own page.
//
// ── THE CELEBRATIONS LAW, COPIED FROM useQuestItemToast RATHER THAN RE-ARGUED ─────────────────
//
// Exactly once per LIVE transition, and hydration seeds a SILENT baseline. The startup replay fills
// the `turnins` module with every trade this character has ever completed, so the first snapshot
// this hook sees is the PAST — firing on it would announce a year of finished quests at launch. The
// first non-null snapshot therefore records a baseline and celebrates nothing. A character switch
// clears it for the reason it does in useQuestItemToast and useLevelUpToast: main rebuilt the
// world, and the next snapshot is that world's history, not news.
//
// THE BASELINE IS A LENGTH, NOT A TIMESTAMP, for the reason the loot one is: the turn-in snapshot
// is append-only, so the count of rows already seen is an exact cursor, while EQ's second-resolution
// clock makes `ts >` drop events and `ts >=` re-fire them. A snapshot SHORTER than the baseline is a
// rebuild rather than a retraction, and it re-seeds silently.
//
// AND THE TRANSITION ITSELF IS `newlyCompleted` (shared/questProgress.ts), over a map of
// page → complete. The length cursor says which EVENTS are new and therefore which quests are worth
// evaluating at all; the map says which of those quests CHANGED. Both are needed: a turn-in can
// complete a quest that a previous partial turn-in had already half-filled, and only the map can
// tell that from the same quest being re-derived unchanged on the next push.
//
// ── WHY IT DOES NOT EVALUATE 904 QUESTS PER EVENT ─────────────────────────────────────────────
//
// A GIVER INDEX, built once on first use over the committed catalog: every name a `giver` field
// states, folded through `nameKeys` (the app-wide `mobKey` fold plus law 2's leading article), →
// the quests that name it. A turn-in is then a map lookup on the NPC the log printed, and the
// expensive `questProgress` fold runs over a handful of candidates instead of the whole catalog.
// The index costs one walk of 904 entries on the first turn-in this window ever sees.
//
// ── THE SKY GATE ──────────────────────────────────────────────────────────────────────────────
//
// `useProgress` already celebrates Plane of Sky turn-ins against `posky.json`, with its own baseline
// and its own card. A catalog quest that IS one of those would celebrate twice, so a quest whose
// page or name matches a Sky quest's name is skipped here. MEASURED on the committed data: the
// overlap is zero — no catalog page or name matches a posky quest name, and (checked separately) no
// catalog `giver` matches a posky giver either — so today the gate suppresses nothing. It is a
// guard against the next wiki re-scrape, not an active filter, and it is stated rather than
// silently omitted because "we checked and it is empty" is a fact with a shelf life.

import { useEffect, useMemo, useRef } from 'react'
import type { QuestEntry, TurnInEvent, TurnInSnap } from '@shared/types'
import {
  giverCandidates,
  nameKeys,
  newlyCompleted,
  questProgress,
  type QuestEvidence
} from '../../../../shared/questProgress'
import { useModule } from '../../lib/useModule'
import { fireAppSignal } from '../alerts/player'
import { getPoskyData } from '../../data'
import { QUEST_BY_PAGE, QUEST_CATALOG } from './questSearch'
import { ticksFor, useQuestPins, type QuestPinsApi } from './useQuestPins'
import { useQuestEvidence } from './useQuestProgress'
import type { QuestPins } from '../../../../shared/questPins'

/** Folded giver name → the catalog pages that name it. Built once, for the life of the window. */
let GIVER_INDEX: Map<string, string[]> | null = null

/** Folded names of every Plane of Sky quest — the pages this watch leaves to `useProgress`. */
let SKY_PAGES: Set<string> | null = null

function skyPages(): Set<string> {
  if (SKY_PAGES) return SKY_PAGES
  const out = new Set<string>()
  for (const q of getPoskyData().quests) for (const k of nameKeys(q.name)) out.add(k)
  SKY_PAGES = out
  return out
}

/** Is this catalog quest one the Sky tab's own detector already celebrates? See the header. */
function isSkyQuest(q: QuestEntry): boolean {
  const sky = skyPages()
  for (const k of [...nameKeys(q.page), ...nameKeys(q.name)]) if (sky.has(k)) return true
  return false
}

/** File one page under one folded name. Its own function so the walk below stays three deep. */
function fileGiver(index: Map<string, string[]>, key: string, page: string): void {
  const pages = index.get(key) ?? []
  if (!pages.includes(page)) pages.push(page)
  index.set(key, pages)
}

function giverIndex(): Map<string, string[]> {
  if (GIVER_INDEX) return GIVER_INDEX
  const index = new Map<string, string[]>()
  for (const q of QUEST_CATALOG) {
    if (isSkyQuest(q)) continue
    for (const candidate of giverCandidates(q.giver)) {
      for (const key of nameKeys(candidate)) fileGiver(index, key, q.page)
    }
  }
  GIVER_INDEX = index
  return index
}

/** Every catalog page the givers named in these turn-ins could possibly belong to. */
function candidatePages(events: readonly TurnInEvent[]): Set<string> {
  const index = giverIndex()
  const out = new Set<string>()
  for (const ev of events) {
    for (const key of nameKeys(ev.npc)) {
      for (const page of index.get(key) ?? []) out.add(page)
    }
  }
  return out
}

/** page → is it complete, for exactly these pages, against the whole evidence bundle. */
function completionMap(pages: Iterable<string>, evidence: QuestEvidence, pins: QuestPins): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const page of pages) {
    const quest = QUEST_BY_PAGE.get(page)
    if (quest) out.set(page, questProgress(quest, evidence, ticksFor(pins, page)).complete)
  }
  return out
}

/** The three surfaces one completion reaches: the sound, the card, and the tracker's own note. */
function celebrate(quest: QuestEntry, ts: number, pins: QuestPins, api: QuestPinsApi): void {
  fireAppSignal('questComplete', quest.name)
  const giver = quest.giver
  const reward = (quest.rewards ?? [])[0]?.name
  window.eq.showToast({
    id: `questDone:${quest.page}:${String(ts)}`,
    kind: 'skyQuestComplete',
    title: `Quest complete: ${quest.name}`,
    subtitle: giver ? `Turned in to ${giver}` : undefined,
    itemName: reward,
    focus: { view: 'quests', quest: quest.page }
  })
  // The tracker's note is only for a quest the player is actually tracking: `markDone` on a page
  // with no pin is a no-op by design (shared/questPins.ts), and pinning one behind the player's
  // back would be the app adding a row to a list they built.
  for (const pin of pins) {
    if (pin.page === quest.page) api.markDone(quest.page, ts)
  }
}

/** Watch the turn-in module and celebrate every LIVE catalog-quest completion. Mount once. */
export function useQuestComplete(): void {
  const snap = useModule<TurnInSnap>('turnins')
  const evidence = useQuestEvidence()
  const [pins, api] = useQuestPins()
  // Read at FIRE time through refs (the `intervalsRef` idiom) so the effect below depends on the
  // SNAPSHOT alone — a loot delta or a pin edit must not re-run a batch already sent.
  const evidenceRef = useRef(evidence)
  evidenceRef.current = evidence
  const pinsRef = useRef(pins)
  pinsRef.current = pins
  const apiRef = useRef(api)
  apiRef.current = api
  // null = "no baseline yet"; the first snapshot sets both and celebrates nothing.
  const baselineRef = useRef<number | null>(null)
  const completeRef = useRef<Map<string, boolean> | null>(null)
  // Built once; the memo only exists so the effect can name it as a stable dependency.
  const index = useMemo(() => giverIndex(), [])

  useEffect(() => {
    const off = window.eq.onCharacter(() => {
      baselineRef.current = null
      completeRef.current = null
    })
    return off
  }, [])

  useEffect(() => {
    if (!snap || index.size === 0) return
    const baseline = baselineRef.current
    baselineRef.current = snap.length
    const ev = evidenceRef.current
    const pinsNow = pinsRef.current
    // First sight, or a rebuild that left fewer rows than we had counted: seed BOTH cursors off the
    // whole snapshot and say nothing. The map has to cover every page the history could have
    // completed, or the next live turn-in would read a replayed completion as news.
    if (baseline === null || snap.length < baseline) {
      completeRef.current = completionMap(candidatePages(snap), ev, pinsNow)
      return
    }
    const events = snap.slice(baseline)
    if (events.length === 0) return
    const prev = completeRef.current
    const pages = new Set(prev === null ? [] : prev.keys())
    for (const page of candidatePages(events)) pages.add(page)
    const next = completionMap(pages, ev, pinsNow)
    completeRef.current = next
    for (const page of newlyCompleted(prev, next)) {
      const quest = QUEST_BY_PAGE.get(page)
      if (!quest) continue
      const at = questProgress(quest, ev, ticksFor(pinsNow, page)).completeAt
      celebrate(quest, at ?? events[events.length - 1].ts, pinsNow, apiRef.current)
    }
  }, [snap, index])
}
