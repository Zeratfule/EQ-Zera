// The quest catalog as the renderer reads it, and the one search over it (EQ Zera, 2026-09-06).
// Same posture as mobs/mobSearch.ts: the scraped JSON is bundled, indexed once on first use, and
// searched with the shared fuzzy scorer — no round trip to main for a catalog that never changes
// while the app runs.

import type { QuestData, QuestEntry } from '@shared/types'
import { scoreQuery, tokenize } from '../../../../shared/fuzzy'
import { buildQuestsByItem, questOpenTo, type QuestItemRef } from '../../../../shared/questIndex'
import questsJson from '../../data/eqlegends/quests.json'

const catalog = questsJson as unknown as QuestData
export const QUEST_CATALOG: QuestEntry[] = catalog.quests ?? []
export const QUEST_SCRAPED_AT: string = catalog.scrapedAt ?? ''

/** page → entry, for the item section's links. */
export const QUEST_BY_PAGE: ReadonlyMap<string, QuestEntry> = new Map(QUEST_CATALOG.map((q) => [q.page, q]))

/** item key → the quests that need or give it. Built once. */
let BY_ITEM: Map<string, QuestItemRef[]> | null = null
export function questsByItem(): Map<string, QuestItemRef[]> {
  BY_ITEM ??= buildQuestsByItem(catalog)
  return BY_ITEM
}

export interface BrowseFilter {
  /** the character's resolved class loadout; empty means "don't filter by class" */
  classes: readonly string[]
  /** a start zone, or '' for any */
  zone: string
  /** quest pages this character holds an item for — they sort first */
  heldPages: ReadonlySet<string>
}

/**
 * The catalog A-Z by name, decided once. The ORDER is sorted as a list of page ids (strings), and
 * the entries are then walked in that order: ruling 4 (eslint.domainMunging.mjs) keeps `.sort`
 * off arrays of domain rows, and a bundled catalog nobody serves is still a domain row.
 */
const QUEST_AZ: QuestEntry[] = (() => {
  const nameOf = (page: string): string => QUEST_BY_PAGE.get(page)?.name ?? page
  const pages = QUEST_CATALOG.map((q) => q.page)
  pages.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  const out: QuestEntry[] = []
  for (const p of pages) {
    const q = QUEST_BY_PAGE.get(p)
    if (q) out.push(q)
  }
  return out
})()

/**
 * The browse list: the catalog narrowed by class and zone, quests with a held item first, then
 * A-Z. Loops rather than `.filter`/`.sort`, the way mobSearch walks its catalog.
 */
export function browseQuests({ classes, zone, heldPages }: BrowseFilter): QuestEntry[] {
  const held: QuestEntry[] = []
  const rest: QuestEntry[] = []
  for (const q of QUEST_AZ) {
    if (zone !== '' && q.startZone !== zone) continue
    if (!questOpenTo(q, classes)) continue
    ;(heldPages.has(q.page) ? held : rest).push(q)
  }
  return [...held, ...rest]
}

/** Start zones, most quests first — the zone filter's menu. */
export const QUEST_ZONES: { zone: string; count: number }[] = (() => {
  const counts = new Map<string, number>()
  for (const q of QUEST_CATALOG) if (q.startZone) counts.set(q.startZone, (counts.get(q.startZone) ?? 0) + 1)
  return [...counts.entries()]
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone))
})()

export interface QuestHit {
  entry: QuestEntry
  score: number
}

const DEFAULT_LIMIT = 80

let HAYSTACKS: string[][] | null = null
function haystacks(): string[][] {
  if (HAYSTACKS) return HAYSTACKS
  HAYSTACKS = QUEST_CATALOG.map((q) => {
    // Name first, then the things a player actually types: the NPC, the zone, an item they hold.
    const parts = [q.name, q.giver ?? '', q.startZone ?? '', ...(q.requiredItems ?? []), ...(q.rewards ?? []).map((r) => r.name)]
    return tokenize(parts.join(' '))
  })
  return HAYSTACKS
}

export function searchQuests(text: string, limit: number = DEFAULT_LIMIT): QuestHit[] {
  const query = tokenize(text ?? '')
  if (query.length === 0) return []
  const hay = haystacks()
  const hits: QuestHit[] = []
  for (let i = 0; i < QUEST_CATALOG.length; i++) {
    const score = scoreQuery(query, hay[i])
    if (score == null) continue
    hits.push({ entry: QUEST_CATALOG[i], score })
  }
  hits.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
  return limit > 0 ? hits.slice(0, limit) : hits
}
