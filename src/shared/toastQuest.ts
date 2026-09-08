// toastQuest.ts — the QUEST BLOCK of the quest-item celebration toast (ROADMAP.md §1), cut to
// the card's shape before it ever leaves main.
//
// WHY A SECOND FORMATTER. `toastItemCard` answers "what does the thing you just looted look
// like"; this answers the question the drop actually raises — "what is it FOR". A live loot line
// names an item; the committed quest catalog knows which quests want it, what to do with it, and
// where that starts. The overlay bundle is MUI-free and FETCHES NOTHING (T5), so every one of
// those facts has to arrive pre-formatted, exactly as the item card's stat lines do.
//
// THE WINDOW IS THE WHOLE IDEA. A wiki quest's `steps` can run sixty lines; a toast has room for
// six. Printing the FIRST six would be the one useless answer for a mid-quest drop, so the card
// prints a WINDOW around the step that names the item, and states honestly how many steps sit on
// either side of it (`before`/`after`) rather than silently pretending the list ended. When no
// step names the item at all the window is simply the opening of the quest, and `litStep` is
// ABSENT — a card would rather show you the start than light the wrong line (law 1).
//
// PURE, and deliberately so: what the card prints for a real catalog quest is a test's business,
// not a screenshot's. Relative imports, because `npm test` runs this module under node with no
// bundler to resolve an alias.

import {
  TOAST_MAX_QUEST_STEPS,
  TOAST_MAX_STEP_TEXT,
  TOAST_MAX_TEXT,
  type ToastQuestCard
} from './toast'
import { questItemKey } from './questIndex'
import type { QuestEntry } from './types'

/**
 * How the looted item relates to this quest: a turn-in/collectible ('required') or something the
 * quest hands out ('reward'), or undefined when the quest names it on neither side.
 *
 * REQUIRED WINS. A few quests both consume an item and hand one back with the same name (the
 * classic "give me four, here are four blessed ones" shape), and of the two readings the one the
 * player is holding is the turn-in — they just looted it, they did not just complete the quest.
 *
 * Joined on `questItemKey`, which is the ONE spelling this app matches item names on (the rename
 * overlay applied, the `+N` tier suffix dropped, lower-cased). Anything else here would mean the
 * Quests tab and this card could disagree about whether a drop is a quest item.
 */
export function questRoleFor(q: QuestEntry, itemName: string): 'required' | 'reward' | undefined {
  const key = questItemKey(itemName)
  if (key === '') return undefined
  const required = q.requiredItems ?? []
  for (const it of required) {
    if (questItemKey(it) === key) return 'required'
  }
  const rewards = q.rewards ?? []
  for (const r of rewards) {
    if (questItemKey(r.name) === key) return 'reward'
  }
  return undefined
}

/**
 * The first step whose text names the item, or undefined when none does.
 *
 * A SHORT KEY LIGHTS NOTHING. Two characters match somewhere in almost any paragraph of English,
 * so a key under three characters is refused outright rather than lighting an arbitrary line —
 * the failure mode of a substring match is a confidently wrong highlight, which is worse than no
 * highlight at all.
 */
export function litStepIndex(steps: readonly string[], itemName: string): number | undefined {
  const key = questItemKey(itemName)
  if (key.length < 3) return undefined
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].toLowerCase().includes(key)) return i
  }
  return undefined
}

/** Where in the full list the printed window starts, and how many steps it prints. */
interface StepWindow {
  start: number
  count: number
}

/**
 * The window of at most TOAST_MAX_QUEST_STEPS steps to print: centred on the lit step where the
 * list allows it, clamped at both ends so a lit step near either edge still gets a full window.
 * With nothing lit the window is the quest's opening, which is where a reader with no anchor
 * would start anyway.
 */
function stepWindow(total: number, lit: number | undefined): StepWindow {
  const count = Math.min(TOAST_MAX_QUEST_STEPS, total)
  if (lit === undefined || count === total) return { start: 0, count }
  const half = Math.floor((count - 1) / 2)
  const start = Math.max(0, Math.min(lit - half, total - count))
  return { start, count }
}

/**
 * One printed step: the wiki's whitespace collapsed to single spaces and the line cut at the cap
 * with an ellipsis, so a walkthrough paragraph that arrived as a "step" cannot grow the card.
 */
function stepText(raw: string): string {
  const flat = raw.trim().replace(/\s+/g, ' ')
  return flat.length <= TOAST_MAX_STEP_TEXT ? flat : `${flat.slice(0, TOAST_MAX_STEP_TEXT - 1)}…`
}

/**
 * "Giver · start zone", or undefined when the catalog knows neither. Only the halves it actually
 * has are printed — an unknown giver is left out, never rendered as a placeholder (law 1).
 */
function questWhere(q: QuestEntry): string | undefined {
  const parts = [q.giver, q.startZone].map((p) => p?.trim()).filter((p): p is string => !!p)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * One quest, as the quest-item toast draws it. Pure: give it a catalog entry and the name the log
 * spelled, and it returns exactly the strings the overlay will paint.
 *
 * The role falls back to 'required' when the catalog names the item on neither side, because the
 * only way this card is built at all is that something upstream matched the item to this quest —
 * and a turn-in is what that match almost always is.
 */
export function toastQuestCard(q: QuestEntry, itemName: string): ToastQuestCard {
  const all = q.steps ?? []
  const lit = litStepIndex(all, itemName)
  const win = stepWindow(all.length, lit)
  const steps = all.slice(win.start, win.start + win.count).map(stepText)
  const card: ToastQuestCard = {
    name: q.name.slice(0, TOAST_MAX_TEXT),
    page: q.page,
    role: questRoleFor(q, itemName) ?? 'required',
    steps,
    before: win.start,
    after: all.length - (win.start + steps.length)
  }
  const where = questWhere(q)
  if (where) card.where = where
  if (lit !== undefined) card.litStep = lit - win.start
  return card
}
