// THE QUEST CATALOG'S JOINS, in one place (EQ Zera, 2026-09-06).
//
// Three pure functions the Quests tab is built from, kept in `shared/` because two sides read
// them: the renderer (the tab, its search and its "your quest items" section) and main
// (`questItemIndex.ts` keys the item→quest index with the same `questItemKey`, so an item the
// Loot page calls a quest item and an item the Quests tab calls a quest item are the same item
// by construction).
//
//   questItemKey   — the one spelling an item name is joined on: the wiki rename applied, the
//                    `+N` tier suffix dropped, lower-cased. Same rule the Loot page keys on.
//   questClasses   — the catalog's `classes` field is 60 spellings of ~16 facts ("All", "ALL",
//                    "Any", "SK", "Shadowknight", "WAR PAL RNG SHD BRD ROG", "All except BRD
//                    ROG …", "?"). This reads them into either 'all' or a set of canonical names,
//                    and treats "we don't know" as 'all': a filter must never HIDE a quest because
//                    the wiki was vague about it.
//   joinLootToQuests — the loot history × the item index: which quest items this character has
//                    looted, with counts, and which quests those touch.

import type { LootEvent, QuestData, QuestEntry } from './types'
import { itemBaseName } from './itemStats'
import { renameItemName } from './itemRenames'

export function questItemKey(name: string): string {
  return itemBaseName(renameItemName(name)).toLowerCase()
}

export type QuestItemRole = 'required' | 'reward'

export interface QuestItemRef {
  quest: QuestEntry
  role: QuestItemRole
}

/** item key → every quest that requires or rewards it. */
export function buildQuestsByItem(data: Pick<QuestData, 'quests'>): Map<string, QuestItemRef[]> {
  const byItem = new Map<string, QuestItemRef[]>()
  const add = (quest: QuestEntry, name: string, role: QuestItemRole): void => {
    const key = questItemKey(name)
    if (key === '') return
    const refs = byItem.get(key) ?? []
    if (!refs.some((r) => r.quest.page === quest.page && r.role === role)) refs.push({ quest, role })
    byItem.set(key, refs)
  }
  for (const q of data.quests) {
    for (const it of q.requiredItems ?? []) add(q, it, 'required')
    for (const r of q.rewards ?? []) add(q, r.name, 'reward')
  }
  return byItem
}

// ---------------------------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------------------------

export const CLASS_NAMES = [
  'Bard',
  'Cleric',
  'Druid',
  'Enchanter',
  'Magician',
  'Monk',
  'Necromancer',
  'Paladin',
  'Ranger',
  'Rogue',
  'Shadow Knight',
  'Shaman',
  'Warrior',
  'Wizard'
] as const
export type ClassName = (typeof CLASS_NAMES)[number]

/** Every spelling the catalog uses for a class, lower-cased, → the canonical name. */
const CLASS_ALIASES: Record<string, ClassName> = {
  bard: 'Bard',
  brd: 'Bard',
  cleric: 'Cleric',
  clr: 'Cleric',
  cle: 'Cleric',
  druid: 'Druid',
  dru: 'Druid',
  enchanter: 'Enchanter',
  enc: 'Enchanter',
  magician: 'Magician',
  mag: 'Magician',
  monk: 'Monk',
  mnk: 'Monk',
  necromancer: 'Necromancer',
  nec: 'Necromancer',
  paladin: 'Paladin',
  pal: 'Paladin',
  ranger: 'Ranger',
  rng: 'Ranger',
  rogue: 'Rogue',
  rog: 'Rogue',
  'shadow knight': 'Shadow Knight',
  shadowknight: 'Shadow Knight',
  shd: 'Shadow Knight',
  sk: 'Shadow Knight',
  shaman: 'Shaman',
  shm: 'Shaman',
  warrior: 'Warrior',
  war: 'Warrior',
  wizard: 'Wizard',
  wiz: 'Wizard'
}

/** The wiki's group words, → the classes they mean here. */
const CLASS_GROUPS: Record<string, readonly ClassName[]> = {
  melee: ['Warrior', 'Rogue', 'Monk', 'Paladin', 'Shadow Knight', 'Ranger', 'Bard'],
  casters: ['Wizard', 'Magician', 'Necromancer', 'Enchanter'],
  'int casters': ['Wizard', 'Magician', 'Necromancer', 'Enchanter'],
  priests: ['Cleric', 'Druid', 'Shaman']
}

/** Words that mean "no restriction" — and the ones that mean "the wiki didn't say". */
const OPEN_WORDS = new Set(['all', 'any', 'all classes', 'classes', 'karana'])
const UNKNOWN_WORDS = new Set(['', '?', '??', '-', 'unknown', 'others?', 'faction dependent', 'race dependent'])

/** The canonical classes a piece of text names — by full name, by abbreviation, or by group word. */
function classesOf(text: string): ClassName[] {
  const t = text.toLowerCase()
  const named = t.split(/[\s,/()]+/).map((w) => CLASS_ALIASES[w])
  const grouped = Object.entries(CLASS_GROUPS).flatMap(([word, members]) => (t.includes(word) ? members : []))
  // Two-word names arrive split above; put "shadow knight" back.
  const twoWord: ClassName[] = t.includes('shadow knight') ? ['Shadow Knight'] : []
  const found = new Set<ClassName>([...named.filter((c): c is ClassName => c !== undefined), ...grouped, ...twoWord])
  return CLASS_NAMES.filter((c) => found.has(c))
}

/** One entry of the catalog's `classes` field, read as either "no restriction" or a set. */
function readClassEntry(entry: string): 'all' | ClassName[] {
  const t = entry.trim().toLowerCase()
  if (OPEN_WORDS.has(t) || UNKNOWN_WORDS.has(t)) return 'all'
  if (t.startsWith('all except')) {
    const excluded = new Set(classesOf(t.slice('all except'.length)))
    return CLASS_NAMES.filter((c) => !excluded.has(c))
  }
  // "All (Iksar)", "All (Good Races)", "All (Mainly for Melee)": a race/faction note on an open
  // quest — the parenthetical is not a class restriction.
  if (t.startsWith('all')) return 'all'
  const found = classesOf(t)
  return found.length === 0 ? 'all' : found
}

/**
 * The classes a quest is open to: `'all'`, or a set of canonical names.
 *
 * Anything unreadable resolves to `'all'` on purpose — the filter is a convenience, and a quest
 * hidden because its page said "?" is a quest the player never finds.
 */
export function questClasses(q: Pick<QuestEntry, 'classes'>): 'all' | ClassName[] {
  const list = q.classes ?? []
  if (list.length === 0) return 'all'
  const out = new Set<ClassName>()
  for (const entry of list) {
    const read = readClassEntry(entry)
    if (read === 'all') return 'all'
    for (const c of read) out.add(c)
  }
  return CLASS_NAMES.filter((c) => out.has(c))
}

/**
 * Whether a character can take the quest. EQ Legends gives a character a LOADOUT of classes, so
 * `mine` is the list the log resolved (`CLR`, `WAR`, … — the abbreviations are aliases here) and
 * the quest is open when ANY of them can take it. No classes known, or none this catalog names
 * (a Beastlord, say) — every quest is open: the filter narrows, it never hides.
 */
export function questOpenTo(q: Pick<QuestEntry, 'classes'>, mine: string | readonly string[] | null | undefined): boolean {
  const list = mine === null || mine === undefined ? [] : typeof mine === 'string' ? [mine] : mine
  if (list.length === 0) return true
  const open = questClasses(q)
  if (open === 'all') return true
  const known = list.map((c) => CLASS_ALIASES[c.trim().toLowerCase()]).filter((c): c is ClassName => c !== undefined)
  return known.length === 0 ? true : known.some((c) => open.includes(c))
}

// ---------------------------------------------------------------------------------------------
// Loot × quests
// ---------------------------------------------------------------------------------------------

export interface LootedQuestItem {
  key: string
  /** the name as the log spelled it, first seen */
  item: string
  count: number
  lastTs: number
  refs: QuestItemRef[]
}

/**
 * The quest items in a loot history, newest first, each with the quests it touches — and the
 * same facts keyed by quest page, for a "you hold N of this quest's items" badge.
 */
export function joinLootToQuests(
  loot: readonly LootEvent[],
  byItem: Map<string, QuestItemRef[]>
): { items: LootedQuestItem[]; byQuest: Map<string, LootedQuestItem[]> } {
  const items = new Map<string, LootedQuestItem>()
  for (const ev of loot) {
    const key = questItemKey(ev.item)
    const refs = byItem.get(key)
    if (!refs) continue
    const count = ev.count ?? 1
    const hit = items.get(key)
    if (hit) {
      hit.count += count
      if (ev.ts > hit.lastTs) hit.lastTs = ev.ts
    } else {
      items.set(key, { key, item: ev.item, count, lastTs: ev.ts, refs })
    }
  }
  const list = [...items.values()].sort((a, b) => b.lastTs - a.lastTs)
  const byQuest = new Map<string, LootedQuestItem[]>()
  for (const it of list) {
    for (const ref of it.refs) {
      const rows = byQuest.get(ref.quest.page) ?? []
      if (!rows.includes(it)) rows.push(it)
      byQuest.set(ref.quest.page, rows)
    }
  }
  return { items: list, byQuest }
}
