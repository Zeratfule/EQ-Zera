// questItemToast — WHICH LOOT LINES DESERVE A QUEST CARD, as one pure function (ROADMAP §1).
//
// The hook beside this file (`useQuestItemToast.ts`) owns the live-only baseline and the sending;
// everything that DECIDES lives here, with no DOM, no React and no `window`, so
// `tests/questItemToast.test.mts` can pin every rule under plain node.
//
// THE RULES, IN THE ORDER THEY ARE APPLIED, AND WHY EACH ONE EXISTS:
//
//   * A DESTROY IS NOT A LOOT (JOS-401, lootDisposition.isDestroyed). `You successfully destroyed
//     38 Bone Chips.` rides the same lane as an acquisition, and celebrating it would congratulate
//     the player for throwing the quest item away.
//   * THE ITEM IS JOINED ON `questItemKey`, the one spelling the whole app keys quest items on —
//     the wiki rename applied, the `+N` tier suffix dropped, lower-cased. An item the catalog does
//     not name pops nothing: no card is better than a card about a quest we invented (law 1).
//   * MY CLASSES NARROWS, IT NEVER HIDES. `questOpenTo` already answers 'yes' for a quest whose
//     wiki page was vague about its classes, so the filter can only remove quests the catalog
//     positively says are somebody else's. With the switch off, or with no resolved loadout, every
//     quest survives.
//   * REQUIRED BEFORE REWARD. "You need this for X" is the sentence the player is standing in the
//     zone for; "X gives you one of these" is context. Otherwise the catalog's own order stands.
//   * THE REPEAT WINDOW IS KEYED ON THE ITEM, not on the quest and not on the event: a stack of
//     Bone Chips is forty loot lines in an hour and one thing worth saying. `recent` is MUTATED by
//     this call so the caller's map is the memory across calls; the window is the user's own
//     preference, because "how often" is a taste and not a constant.
//   * THREE QUESTS, MAX (TOAST_MAX_QUESTS). An item feeding nine quests is a page, not a card.
//
// THE TITLE IS THE LOG'S OWN SPELLING (world-model law 2). The join key is lower-cased and
// de-suffixed; what the card PRINTS is what the game printed, ` +2` and all.
//
// No `.filter`/`.sort`/`.reduce`/`.flatMap` anywhere below: `LootEvent`, `QuestEntry` and
// `QuestItemRef` are all declared under `src/shared/`, which makes them domain rows to
// eslint.domainMunging.mjs (ruling 4). Loops, then.

import type { LootEvent } from '@shared/types'
import { questItemKey, questOpenTo, type QuestItemRef } from '../../../../shared/questIndex'
import { isDestroyed } from '../../../../shared/lootDisposition'
import { TOAST_MAX_QUESTS, type ToastRequest } from '../../../../shared/toast'
import type { QuestToastPrefs } from './questToastPrefs'

export interface QuestItemToastInput {
  /** the NEW live loot events only, oldest first */
  events: readonly LootEvent[]
  byItem: ReadonlyMap<string, QuestItemRef[]>
  /** the character's resolved class loadout (abbreviations like 'CLR'); empty ⇒ no class filter */
  classes: readonly string[]
  prefs: QuestToastPrefs
  /** item key → the ms it last popped; MUTATED by the call */
  recent: Map<string, number>
  now: number
}

const MS_PER_MINUTE = 60_000

/**
 * The quests this card will name: class-filtered when the preference asks for it, required
 * before reward, cut at the card's cap.
 */
function keptRefs(
  refs: readonly QuestItemRef[],
  classes: readonly string[],
  prefs: QuestToastPrefs
): QuestItemRef[] {
  const narrow = prefs.myClasses && classes.length > 0
  const required: QuestItemRef[] = []
  const reward: QuestItemRef[] = []
  for (const ref of refs) {
    if (narrow && !questOpenTo(ref.quest, classes)) continue
    if (ref.role === 'required') required.push(ref)
    else reward.push(ref)
  }
  const kept = [...required, ...reward]
  // `.slice` is the window, not a query — see eslint.domainMunging.mjs on why it is not flagged.
  return kept.length > TOAST_MAX_QUESTS ? kept.slice(0, TOAST_MAX_QUESTS) : kept
}

/**
 * The supporting line. FOUR WORDINGS, because the two things a player asks of a quest item are
 * "do I keep this" (required) and "where did this come from" (reward), and one quest names itself
 * while several are a count.
 */
function subtitleFor(kept: readonly QuestItemRef[]): string {
  let anyRequired = false
  for (const ref of kept) if (ref.role === 'required') anyRequired = true
  const lead = anyRequired ? 'needed for' : 'reward from'
  const what = kept.length === 1 ? kept[0].quest.name : `${String(kept.length)} quests`
  return `Quest item · ${lead} ${what}`
}

/** One loot line's card, or null when it earns none. Mutates `recent` when it fires. */
function requestFor(e: LootEvent, input: QuestItemToastInput): ToastRequest | null {
  if (isDestroyed(e)) return null
  const key = questItemKey(e.item)
  const refs = input.byItem.get(key)
  if (!refs || refs.length === 0) return null
  const kept = keptRefs(refs, input.classes, input.prefs)
  if (kept.length === 0) return null
  const last = input.recent.get(key)
  if (last !== undefined && input.now - last < input.prefs.repeatMin * MS_PER_MINUTE) return null
  input.recent.set(key, input.now)
  const pages: string[] = []
  for (const ref of kept) pages.push(ref.quest.page)
  return {
    // The item key plus the line's own timestamp: two loots of one item are two cards, and the
    // same push seen twice refreshes one.
    id: `questItem:${key}:${String(e.ts)}`,
    kind: 'questItem',
    title: e.item,
    subtitle: subtitleFor(kept),
    itemName: e.item,
    questPages: pages,
    // The card's click target: the Quests tab, opened on the FIRST quest's page. Main re-validates
    // this focus like every other deep link.
    focus: { view: 'quests', quest: pages[0] }
  }
}

/** Every card a batch of new live loot lines earns, in the order the lines arrived. */
export function questItemToastRequests(input: QuestItemToastInput): ToastRequest[] {
  const out: ToastRequest[] = []
  for (const e of input.events) {
    const req = requestFor(e, input)
    if (req) out.push(req)
  }
  return out
}
