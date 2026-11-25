/**
 * check-quest-health.mts — the quest data HEALTH GATE's runner (the judging is scripts/questHealth.mts).
 *
 *   npm run check:quests        # rebuild the catalog from the committed cache, judge it against
 *                               # the quests.json on disk; exit 1 with the list on any FAIL
 *
 * OFFLINE, ZERO WIKI REQUESTS: it reads scripts/sources/cache/quests/ (committed) and runs the SAME
 * parse + projection a scrape runs (scripts/sources/questEntry.ts), so it answers "would a quest
 * refresh right now ship thinner data?" without making one. `npm run refresh:data` calls
 * `checkQuestHealth` on its quests step with the file before and after the scrape, and refuses to
 * leave a failing file in the tree.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { QuestData, QuestEntry } from '../src/shared/questTypes'
import { buildQuestCatalog, type QuestSourcePage } from './sources/questEntry'
import { auditQuestPage, type PageFinding } from './sources/questPageAudit'
import { formatHealth, judgeQuestHealth, type AllowEntry, type HealthResult } from './questHealth.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, 'scripts', 'sources', 'cache', 'quests')
const ALLOWLIST = join(ROOT, 'scripts', 'sources', 'quest-health-allowlist.json')
export const QUESTS_JSON = join(ROOT, 'src', 'renderer', 'src', 'data', 'eqlegends', 'quests.json')

/** The reviewed allowlist. A malformed entry is an error, never silently skipped. */
export function loadAllowlist(file: string = ALLOWLIST): AllowEntry[] {
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown }
  if (!Array.isArray(doc.entries)) throw new Error(`${file}: no "entries" array`)
  return doc.entries.map((e: unknown, i) => {
    const o = e as Partial<AllowEntry>
    if (typeof o.page !== 'string' || typeof o.rule !== 'string' || typeof o.reason !== 'string' || o.reason.trim() === '') {
      throw new Error(`${file}: entry ${String(i)} needs a page, a rule and a non-empty reason`)
    }
    return { page: o.page, rule: o.rule, reason: o.reason }
  })
}

/** Every cached quest page, title + wikitext (null when the cache has no file for it). */
export function cachedQuestPages(cache: string = CACHE): QuestSourcePage[] {
  const index = JSON.parse(readFileSync(join(cache, 'quest-pages.json'), 'utf8')) as { pageid: number; title: string }[]
  return index.map((p) => {
    const file = join(cache, `page-${String(p.pageid)}.wikitext`)
    return { title: p.title, wikitext: existsSync(file) ? readFileSync(file, 'utf8') : null }
  })
}

/** The wiki's item-title set, the same filter the scraper uses. */
export function cachedItemFilter(cache: string = CACHE): (title: string) => boolean {
  const titles = new Set(JSON.parse(readFileSync(join(cache, 'item-titles.json'), 'utf8')) as string[])
  return (t) => titles.has(t.toLowerCase().replace(/\s+/g, ' ').trim())
}

/** The page checks, for every cached page that is a quest in `next`. */
export function pageFindingsFor(next: readonly QuestEntry[], pages: readonly QuestSourcePage[]): PageFinding[] {
  const byPage = new Map(next.map((q) => [q.page, q]))
  return pages.flatMap((p) => {
    const q = byPage.get(p.title)
    return q === undefined || p.wikitext === null ? [] : auditQuestPage(p.title, p.wikitext, { steps: q.steps?.length ?? 0, rewards: q.rewards?.length ?? 0 })
  })
}

/** The gate over two catalogs, with the committed cache's pages and the reviewed allowlist. */
export function checkQuestHealth(prev: readonly QuestEntry[] | null, next: readonly QuestEntry[]): HealthResult {
  return judgeQuestHealth({ prev, next, pageFindings: pageFindingsFor(next, cachedQuestPages()), allow: loadAllowlist() })
}

function main(): void {
  const onDisk = existsSync(QUESTS_JSON) ? (JSON.parse(readFileSync(QUESTS_JSON, 'utf8')) as QuestData).quests : null
  const rebuilt = buildQuestCatalog(cachedQuestPages(), cachedItemFilter()).quests
  console.log(`check:quests - ${String(rebuilt.length)} quests rebuilt offline from the cache, judged against ${onDisk === null ? 'nothing (no quests.json)' : `the ${String(onDisk.length)} in quests.json`}`)
  const result = checkQuestHealth(onDisk, rebuilt)
  for (const line of formatHealth(result)) console.log(line)
  if (!result.ok) process.exit(1)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
