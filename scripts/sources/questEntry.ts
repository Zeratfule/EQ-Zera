/**
 * PURE parsed-page -> catalog-entry projection for the quest scraper (`scripts/scrape-quests.ts`).
 *
 * Moved out of the scraper so the quest data HEALTH GATE (scripts/questHealth.mts) can rebuild the
 * whole catalog from the committed wikitext cache with zero network: the scraper and the gate then
 * run the SAME projection, so "would a refresh right now ship thinner data?" is answered by the code
 * a refresh actually runs.
 */
import type { QuestEntry, QuestGroundSpawn } from '../../src/shared/questTypes'
import { groundSpawnsOf } from './questGroundSpawns'
import { isEmptyParse, parseQuestPage, type ParsedQuestPage } from './questPage'

/**
 * Why this page is NOT a quest, or null when it is one.
 *
 * Category:Quests also holds INDEX pages ("Popular Quests by Level", "Class Race Quest
 * List") — no quest header at all, just hundreds of item links. Indexing those would tie
 * every listed item to a page that is not a quest.
 */
export function nonQuestReason(parsed: ParsedQuestPage): string | null {
  const indexPage =
    !parsed.hasTopTable && !parsed.giver && !parsed.startZone && parsed.requiredItems.length > 40
  if (parsed.disambiguation && isEmptyParse(parsed)) return 'disambiguation hub'
  if (indexPage) return `index/list page (${String(parsed.requiredItems.length)} item links, no quest header)`
  if (isEmptyParse(parsed)) return 'no quest fields parsed'
  return null
}

/** Project a parsed page into a catalog entry — ONLY the fields the page actually stated. */
export function toQuestEntry(parsed: ParsedQuestPage, groundSpawns: readonly QuestGroundSpawn[] = []): QuestEntry {
  const entry: QuestEntry = { name: parsed.page, page: parsed.page }
  if (parsed.startZone) entry.startZone = parsed.startZone
  if (parsed.giver) entry.giver = parsed.giver
  if (parsed.minLevel != null) entry.minLevel = parsed.minLevel
  if (parsed.classes.length) entry.classes = parsed.classes
  if (parsed.relatedZones.length) entry.relatedZones = parsed.relatedZones
  if (parsed.relatedNpcs.length) entry.relatedNpcs = parsed.relatedNpcs
  if (parsed.rewards.length) entry.rewards = parsed.rewards.map((name) => ({ name }))
  if (parsed.requiredItems.length) entry.requiredItems = parsed.requiredItems
  if (parsed.expReward) entry.expReward = true
  if (parsed.steps.length) entry.steps = parsed.steps
  withPlaces(entry, parsed, groundSpawns)
  return entry
}

/**
 * The per-step links and coordinates (index-aligned with `steps`, so whole or not at all), then the
 * ground spawns the page's tables locate.
 */
function withPlaces(entry: QuestEntry, parsed: ParsedQuestPage, groundSpawns: readonly QuestGroundSpawn[]): void {
  if (parsed.stepLinks.some((l) => l.length > 0)) entry.stepLinks = parsed.stepLinks
  if (parsed.stepLocs.some((l) => l.length > 0)) entry.stepLocs = parsed.stepLocs
  if (groundSpawns.length > 0) entry.groundSpawns = [...groundSpawns]
  if (parsed.giverLocs.length > 0) entry.giverLocs = parsed.giverLocs
}

/** One cached quest page: its title and its wikitext (null when the fetch had none). */
export interface QuestSourcePage {
  title: string
  wikitext: string | null
}

export interface BuiltCatalog {
  /** sorted by page title, exactly as the scraper writes them */
  quests: QuestEntry[]
  skipped: { page: string; reason: string }[]
}

/** Every page through the parser and the projection, sorted — the catalog a scrape writes. */
export function buildQuestCatalog(pages: readonly QuestSourcePage[], isItem: (title: string) => boolean): BuiltCatalog {
  const quests: QuestEntry[] = []
  const skipped: { page: string; reason: string }[] = []
  for (const p of pages) {
    if (p.wikitext == null) {
      skipped.push({ page: p.title, reason: 'no wikitext' })
      continue
    }
    const parsed = parseQuestPage(p.title, p.wikitext, isItem)
    const reason = nonQuestReason(parsed)
    if (reason) skipped.push({ page: p.title, reason })
    else quests.push(toQuestEntry(parsed, groundSpawnsOf(p.wikitext, isItem)))
  }
  quests.sort((a, b) => a.page.localeCompare(b.page))
  return { quests, skipped }
}
