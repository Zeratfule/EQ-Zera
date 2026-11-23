// itemKnowledgeView — pure, MUI-free view rules over an ItemKnowledge record.
//
// Lives in lib/ (not in a feature) because BOTH renderer entries need it: the main window's
// loot surfaces and the overlay bundle, which is MUI-free by law. Nothing here renders — it
// only answers "what is this item, for display purposes".

import type { ItemKnowledge, ItemQuestUse } from '@shared/types'
import { recipeUseLabel } from '../../../shared/itemKnowledge'

export type KnowledgeTagKind = 'lore' | 'quest' | 'tradeskill'

/** One tag chip beside a loot row's name: the word drawn, and its one-clause hover title. */
export interface KnowledgeTag {
  kind: KnowledgeTagKind
  label: string
  title: string
}

export interface KnowledgeTagOptions {
  /** the row already carries the PoSky chip, which says "quest" for it */
  isPosky: boolean
  /** Preferences: "Show Tradeskill tag on loot" */
  showTradeskill: boolean
}

/** `first`, or `first +N more` when the list is longer. */
function firstAndMore(names: string[]): string {
  return names.length > 1 ? `${names[0]} +${String(names.length - 1)} more` : (names[0] ?? '')
}

/**
 * EVERY TAG AN ITEM EARNS, in a fixed order (LORE, quest, tradeskill). Tags never overwrite one
 * another: an item a quest uses AND a recipe consumes carries both. The one exclusion is the
 * stats block's bare QUEST ITEM flag on a recipe component no quest uses (Gnome Meat): that flag
 * leads nowhere, so the item reads as tradeskill only.
 */
export function knowledgeTags(k: ItemKnowledge, opts: KnowledgeTagOptions): KnowledgeTag[] {
  const recipes = k.recipes ?? []
  const quests = k.questUses.map((u) => u.quest)
  const tags: KnowledgeTag[] = []
  if (k.lore) tags.push({ kind: 'lore', label: 'LORE', title: 'Lore item - you can hold only one' })
  const questTagged = quests.length > 0 || (k.quest && recipes.length === 0)
  if (questTagged && !opts.isPosky) {
    const title = quests.length > 0 ? `Quest: ${firstAndMore(quests)}` : 'Quest item'
    tags.push({ kind: 'quest', label: 'quest', title })
  }
  if (recipes.length > 0 && opts.showTradeskill) {
    const title = `Tradeskill: ${firstAndMore(recipes.map(recipeUseLabel))}`
    tags.push({ kind: 'tradeskill', label: 'tradeskill', title })
  }
  return tags
}

/**
 * TRADESKILL-ONLY: the item is a recipe INGREDIENT and nothing else.
 *
 * Why it needs saying at all: an item page's stats block often carries the QUEST ITEM flag on
 * things no quest anywhere uses (Gnome Meat, Spider Legs, Bone Chips-adjacent components).
 * `isNotableKnowledge` therefore admits them to the PUSH surfaces — the pickups strip and the
 * event-log feed — where they are pure noise while you grind. This predicate is the honest
 * "it's an ingredient": at least one recipe consumes it, no quest anywhere uses it, and
 * nothing else makes it interesting.
 *
 * `questUses.length === 0` subsumes "not a Plane of Sky item": a posky association IS a quest
 * use (source 'posky'), so a Sky rune can never read as tradeskill-only.
 *
 * NOT a filter for the loot LEDGER (the history table) — that records what happened and is
 * never filtered by taste. Only the push surfaces hide on this.
 */
export function isTradeskillOnly(k: ItemKnowledge): boolean {
  if (k.lore) return false
  if (k.questUses.length > 0) return false
  return (k.recipes ?? []).length > 0
}

/** One line of "where does this quest happen" — giver, then start zone, when known. */
export function questUseWhere(u: ItemQuestUse): string | undefined {
  const parts = [u.giver, u.zone].filter((s): s is string => !!s && s.length > 0)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * The OUTCOME names a quest use offers, one hop deep: turning a required item in yields the
 * quest's rewards. A reward-role use has no outcome (it IS the outcome), and an unknown
 * reward list stays empty rather than guessed.
 */
export function questUseOutcomes(u: ItemQuestUse): string[] {
  return u.role === 'required' ? (u.rewards ?? []) : []
}
