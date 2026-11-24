/**
 * Generate `src/renderer/src/data/eqlegends/aaCatalog.json` — every Alternate Advancement on the
 * EQ Legends wiki, with ranks, per-rank costs, requirements and (for Special AAs) per-rank values.
 *
 *   npm run gen:aa-catalog              # from the committed cache, no network
 *   npm run gen:aa-catalog -- --refresh # fetch the page again (ONE request), then build
 *
 * SOURCE: ONE page, eqlwiki.com `Alternate_Advancement`, fetched through the MediaWiki API's
 * `prop=revisions` so the revision id comes with the text. The raw wikitext and its revision are
 * COMMITTED under scripts/sources/cache/aa, so a re-run without `--refresh` is network-free and a
 * byte-identical no-op (no timestamp in the output). A refresh is a DATA CHANGE: diff the JSON.
 *
 * SCRAPER ETIQUETTE (AGENTS.md, LAW): one request; `maxlag=5` with its own retry arm (the deferral
 * is HTTP 200 + an error body + Retry-After); 429/5xx back off exponentially, honouring
 * Retry-After; at least 1 s between attempts.
 *
 * The parser is scripts/sources/aaCatalog.ts; the shape is src/shared/aaCatalog.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { AaCatalogData } from '../src/shared/aaCatalog'
import { parseAaCatalog } from './sources/aaCatalog'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TITLE = 'Alternate_Advancement'
const CACHE_DIR = join(HERE, 'sources/cache/aa')
const CACHE_TEXT = join(CACHE_DIR, `${TITLE}.wikitext`)
const CACHE_INDEX = join(CACHE_DIR, 'index.json')
const OUT = join(ROOT, 'src/renderer/src/data/eqlegends/aaCatalog.json')

const API = 'https://eqlwiki.com/api.php'
const UA = 'everquest-companion/0.1 (personal AA catalog scraper)'
const MIN_DELAY_MS = 1000
const MAX_ATTEMPTS = 5

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface RevisionsReply {
  error?: { code?: string }
  query?: { pages?: { revisions?: { revid?: number; slots?: { main?: { content?: string } } }[] }[] }
}

function waitFor(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get('retry-after') ?? '')
  return Math.max(MIN_DELAY_MS, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : MIN_DELAY_MS * 2 ** attempt)
}

interface Page {
  revid: number
  wikitext: string
}

function pageOf(body: RevisionsReply): Page | null {
  const rev = body.query?.pages?.[0]?.revisions?.[0]
  const wikitext = rev?.slots?.main?.content
  return rev?.revid === undefined || wikitext === undefined ? null : { revid: rev.revid, wikitext }
}

/** One request: the page, null when the wiki answered without one, or how long to wait. */
async function attempt(url: string, n: number): Promise<Page | null | { retryMs: number }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (res.status === 429 || res.status >= 500) return { retryMs: waitFor(res, n) }
  const body = (await res.json()) as RevisionsReply
  if (body.error?.code === 'maxlag') return { retryMs: waitFor(res, n) }
  return res.ok ? pageOf(body) : null
}

/** The page's current wikitext and revision, or null after the retries ran out. */
async function fetchPage(): Promise<Page | null> {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'revisions',
    rvprop: 'ids|content',
    rvslots: 'main',
    titles: TITLE,
    format: 'json',
    formatversion: '2',
    maxlag: '5'
  })
  for (let n = 0; n < MAX_ATTEMPTS; n++) {
    const got = await attempt(`${API}?${params.toString()}`, n)
    if (got === null || !('retryMs' in got)) return got
    console.warn(`  backing off ${String(got.retryMs)}ms (attempt ${String(n + 1)}/${String(MAX_ATTEMPTS)})`)
    await sleep(got.retryMs)
  }
  return null
}

async function source(refresh: boolean): Promise<{ revid: number | null; wikitext: string }> {
  if (!refresh && existsSync(CACHE_TEXT)) {
    const index = existsSync(CACHE_INDEX) ? (JSON.parse(readFileSync(CACHE_INDEX, 'utf8')) as { revid?: number }) : {}
    return { revid: index.revid ?? null, wikitext: readFileSync(CACHE_TEXT, 'utf8') }
  }
  const page = await fetchPage()
  if (!page) throw new Error(`gen:aa-catalog: could not fetch ${TITLE}`)
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(CACHE_TEXT, page.wikitext)
  writeFileSync(CACHE_INDEX, `${JSON.stringify({ title: TITLE, revid: page.revid }, null, 1)}\n`)
  return page
}

async function main(): Promise<void> {
  const { revid, wikitext } = await source(process.argv.includes('--refresh'))
  const entries = parseAaCatalog(wikitext.replace(/\r\n/g, '\n'))
  const data: AaCatalogData = { source: `eqlwiki.com ${TITLE}`, revision: revid, entries }
  writeFileSync(OUT, `${JSON.stringify(data, null, 1)}\n`)
  const by = new Map<string, number>()
  for (const e of entries) by.set(e.section, (by.get(e.section) ?? 0) + 1)
  console.log(`gen:aa-catalog: ${String(entries.length)} AAs (rev ${String(revid)}) ${JSON.stringify(Object.fromEntries(by))}`)
  for (const e of entries) if (e.issues) console.log(`  ! ${e.name}: ${e.issues.join(' | ')}`)
}

await main()
