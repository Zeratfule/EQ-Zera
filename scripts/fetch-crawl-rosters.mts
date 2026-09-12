/**
 * CRAWL-ROSTER refresher (2026-09-12) — rebuilds the rare lists in
 * `src/renderer/src/data/eqlegends/crawlRosters.json` from the eqlwiki pages the committed rows
 * already cite.
 *
 *   npx tsx scripts/fetch-crawl-rosters.mts            # fetch, diff, write
 *   npx tsx scripts/fetch-crawl-rosters.mts --dry      # fetch, diff, write NOTHING
 *
 * IT IS A MAINTENANCE SCRIPT AND NOTHING ELSE. It is wired into no build step, no npm script and no
 * runtime path: the app ships the committed JSON and adds no outbound origin of its own. Run it by
 * hand when the wiki has moved, read the diff, and commit the data change as a data change.
 *
 * WHAT IT REBUILDS AND WHAT IT REFUSES TO TOUCH. `rares` comes off the wiki. `aliases`, `notes`,
 * `confidence` and `source` are PRESERVED from the committed file, because each of them is a human
 * judgement the wiki does not state: which other names a zone answers to, what the source actually
 * said (including what it did not), how much weight the row carries, and where it came from. A
 * scraper that could overwrite `confidence` would be able to promote a named-mob list into a
 * denominator, which is the one thing `shared/crawlRoster.ts` exists to prevent.
 *
 * WHICH PAGE A ROW COMES FROM is read out of the row's own `source` field - the first
 * `eqlwiki.com/<title>` URL in it, excluding the two crawl pages. Provenance travels with the data,
 * so the refresher needs no second table of titles that could drift out of step with it.
 *
 * THE COUNTS come off `Talk:Dungeon_Crawl`, whose table is hand-maintained and has no stable shape.
 * So the parse is deliberately tolerant AND deliberately quiet: a zone row yields its first two
 * integers as `rareCount` / `killsToComplete`, every read is printed, and a value the page does not
 * state leaves the committed one alone. Read the printout; do not assume it.
 *
 * SCRAPER ETIQUETTE (AGENTS.md LAW). One serialized request at a time, 1 s between them, exponential
 * backoff honouring Retry-After on 429/5xx, `maxlag=5` so the server may refuse under load, and
 * revisions BATCHED at 50 titles through the MediaWiki API. That last part is a deliberate departure
 * from `index.php?action=raw`, which would be one request per zone: the law says pull in bulk through
 * the site's API where one exists, and one batched query fetches every zone page at once.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crawlZoneKey, type CrawlRoster, type CrawlRosterTable } from '../src/shared/crawlRoster'

const API = 'https://eqlwiki.com/api.php'
const UA = 'eq-zera/0.1 (crawl roster refresher; personal desktop toolkit)'
const DELAY_MS = 1000
const MAX_RETRIES = 5
/** MEASURED, not tunable: >50 titles per revisions batch returns HTTP 200 with zero pages. */
const BATCH = 50
const COUNTS_PAGE = 'Talk:Dungeon_Crawl'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(HERE, '../src/renderer/src/data/eqlegends/crawlRosters.json')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface RevPage {
  title: string
  missing?: boolean
  revisions?: { slots?: { main?: { content?: string } } }[]
}

/** How long a refused response says to wait: its own `Retry-After`, else the caller's backoff. */
function retryAfterMs(res: Response, fallback: number): number {
  const stated = Number(res.headers.get('retry-after'))
  return Number.isFinite(stated) && stated > 0 ? stated * 1000 : fallback
}

/** A maxlag deferral arrives as HTTP 200 with an error body - its own retry arm, per the law. */
function isMaxlag(body: { error?: { code?: string } }): boolean {
  return body.error?.code === 'maxlag'
}

/** One serialized GET with exponential backoff on 429/5xx (honours Retry-After) and a maxlag arm. */
async function api<T>(params: Record<string, string>): Promise<T> {
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params }).toString()}`
  let wait = 1000
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= MAX_RETRIES
    let res: Response
    try {
      res = await fetch(url, { headers: { 'User-Agent': UA } })
    } catch (err) {
      if (last) throw err
      await sleep(wait)
      wait *= 2
      continue
    }
    if (!res.ok && (last || !(res.status === 429 || res.status >= 500))) {
      throw new Error(`${res.status} ${res.statusText}`)
    }
    if (!res.ok) {
      await sleep(retryAfterMs(res, wait))
      wait *= 2
      continue
    }
    const body = (await res.json()) as { error?: { code?: string } } & T
    if (isMaxlag(body) && !last) {
      await sleep(wait)
      wait *= 2
      continue
    }
    await sleep(DELAY_MS)
    return body
  }
}

/** The wikitext of every requested title, keyed by title. Batched at `BATCH`. */
async function wikitext(titles: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < titles.length; i += BATCH) {
    const slice = titles.slice(i, i + BATCH)
    const body = await api<{ query?: { pages?: RevPage[] } }>({
      action: 'query',
      prop: 'revisions',
      rvslots: 'main',
      rvprop: 'content',
      redirects: '1',
      titles: slice.join('|')
    })
    for (const page of body.query?.pages ?? []) {
      const text = page.revisions?.[0]?.slots?.main?.content
      if (typeof text === 'string') out.set(page.title, text)
    }
  }
  return out
}

/** The eqlwiki page title a row cites, or null when it cites none (a blog, the patch notes). */
function pageTitleOf(row: CrawlRoster): string | null {
  for (const url of row.source.split(';').map((s) => s.trim())) {
    const m = /^https?:\/\/eqlwiki\.com\/(.+)$/.exec(url)
    if (!m) continue
    const title = decodeURIComponent(m[1]).replace(/_/g, ' ')
    if (/^(Talk:)?Dungeon Crawl$/i.test(title)) continue
    return title
  }
  return null
}

/** `[[Page|Shown]]` -> `Shown`, `[[Page]]` -> `Page`, and every other markup dropped. */
function unlink(cell: string): string {
  return cell
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<ref[^>]*>.*?<\/ref>/gis, '')
    .replace(/<[^>]+>/g, ',')
    .replace(/'''?/g, '')
}

/** The named-mob names out of an infobox row, split on the separators the wiki actually uses. */
function namesFrom(cell: string): string[] {
  return unlink(cell)
    .split(/[,•\n]|\s\/\s/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s !== '' && !/^(and|none|n\/a|\?+)$/i.test(s))
}

/**
 * The zone page's rare list: the `! ''' Rare NPCs: '''` infobox row, falling back to
 * `! ''' Notable NPCs: '''`. Null when the page states neither - which leaves the committed list
 * alone rather than emptying it.
 */
function raresFrom(text: string): { names: string[]; labelled: boolean } | null {
  for (const [label, labelled] of [
    ['Rare NPCs', true],
    ['Notable NPCs', false]
  ] as const) {
    const re = new RegExp(`^!\\s*'*\\s*${label}\\s*:?\\s*'*\\s*(?:\\|\\|)?(.*)$`, 'im')
    const m = re.exec(text)
    if (!m) continue
    const names = namesFrom(m[1])
    if (names.length > 0) return { names, labelled }
  }
  return null
}

/** What the counts table states for one zone. `null` in either slot is "the page did not say". */
interface StatedCounts {
  rares: number | null
  kills: number | null
}

/** The two integers the counts table states for a zone, by folded zone name. */
function countsFrom(text: string, table: CrawlRosterTable): Map<string, StatedCounts> {
  const keys = new Map<string, string>()
  for (const [zone, row] of Object.entries(table)) {
    keys.set(crawlZoneKey(zone), zone)
    for (const alias of row.aliases ?? []) keys.set(crawlZoneKey(alias), zone)
  }
  const out = new Map<string, StatedCounts>()
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || line.startsWith('|-')) continue
    const cells = line.replace(/^\|+/, '').split('||').map((c) => unlink(c).trim())
    const zone = keys.get(crawlZoneKey(cells[0]))
    if (zone === undefined) continue
    const ints = cells
      .slice(1)
      .map((c) => /^\s*~?\s*(\d+)/.exec(c))
      .map((m) => (m ? Number(m[1]) : null))
      .filter((n): n is number => n !== null)
    out.set(zone, { rares: ints[0] ?? null, kills: ints[1] ?? null })
  }
  return out
}

/** What changed for one zone, as one line of report. */
function diffLine(zone: string, before: CrawlRoster, after: CrawlRoster): string | null {
  const added = after.rares.filter((n) => !before.rares.includes(n))
  const gone = before.rares.filter((n) => !after.rares.includes(n))
  const counts: string[] = []
  if (before.rareCount !== after.rareCount) counts.push(`rareCount ${String(before.rareCount)} -> ${String(after.rareCount)}`)
  if (before.killsToComplete !== after.killsToComplete) {
    counts.push(`killsToComplete ${String(before.killsToComplete)} -> ${String(after.killsToComplete)}`)
  }
  if (added.length === 0 && gone.length === 0 && counts.length === 0) return null
  const parts = [
    added.length > 0 ? `+${String(added.length)} (${added.join(', ')})` : '',
    gone.length > 0 ? `-${String(gone.length)} (${gone.join(', ')})` : '',
    ...counts
  ].filter((s) => s !== '')
  return `  ${zone}: ${parts.join(' · ')}`
}

/** Zone name in the table -> the eqlwiki page title its own `source` cites. A zone citing none is
 *  reported and keeps its committed list; there is nothing to scrape for it. */
function titlesFor(table: CrawlRosterTable): Map<string, string> {
  const out = new Map<string, string>()
  for (const [zone, row] of Object.entries(table)) {
    const title = pageTitleOf(row)
    if (title === null) console.log(`- ${zone}: no eqlwiki page cited, rares left as committed`)
    else out.set(zone, title)
  }
  return out
}

/** One zone's rebuilt row. Every field the wiki does not state is the committed one. */
function rebuildRow(
  zone: string,
  row: CrawlRoster,
  text: string | undefined,
  stated: StatedCounts | undefined
): CrawlRoster {
  const scraped = text === undefined ? null : raresFrom(text)
  if (scraped === null && text !== undefined) console.log(`- ${zone}: no Rare/Notable NPCs row on its page`)
  if (scraped !== null) {
    const kind = scraped.labelled ? 'Rare' : 'Notable'
    console.log(`  ${zone}: ${String(scraped.names.length)} names off the ${kind} NPCs row`)
  }
  return {
    ...row,
    rares: scraped?.names ?? row.rares,
    rareCount: stated?.rares ?? row.rareCount,
    killsToComplete: stated?.kills ?? row.killsToComplete
  }
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry')
  const committed = JSON.parse(readFileSync(OUT_PATH, 'utf8')) as CrawlRosterTable
  const titles = titlesFor(committed)

  const pages = await wikitext([...titles.values(), COUNTS_PAGE])
  const countsText = pages.get(COUNTS_PAGE)
  const counts: Map<string, StatedCounts> =
    countsText === undefined ? new Map<string, StatedCounts>() : countsFrom(countsText, committed)
  if (countsText === undefined) console.log(`- ${COUNTS_PAGE} did not answer; every count left as committed`)

  const next: CrawlRosterTable = {}
  const lines: string[] = []
  for (const [zone, row] of Object.entries(committed)) {
    const title = titles.get(zone)
    const text = title === undefined ? undefined : pages.get(title)
    if (title !== undefined && text === undefined) console.log(`- ${zone}: ${title} did not answer`)
    const after = rebuildRow(zone, row, text, counts.get(zone))
    const line = diffLine(zone, row, after)
    if (line !== null) lines.push(line)
    next[zone] = after
  }

  console.log(lines.length === 0 ? '\nNo change.' : `\n${String(lines.length)} zone(s) changed:\n${lines.join('\n')}`)
  if (dry) {
    console.log('\n--dry: nothing written.')
    return
  }
  writeFileSync(OUT_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  console.log(`\nWrote ${OUT_PATH}. READ THE DIFF: a re-scrape is a data change, not a refresh.`)
}

void main()
