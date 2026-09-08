/**
 * refresh-data.mts — ONE command that re-scrapes the three wiki datasets and tells you what
 * moved (ROADMAP §2 step 3).
 *
 *   npm run refresh:data                       # all three, warm caches where they exist
 *   npm run refresh:data -- --refresh          # ignore every disk cache, re-fetch from the wiki
 *   npm run refresh:data -- --only quests      # one source (repeatable: --only mobs --only items)
 *
 * WHAT IT DOES. Runs `scrape:items`, `scrape:mobs`, `scrape:quests` in that order, each as a
 * child process so a scraper's own progress narration reaches the terminal unchanged, and
 * around each one snapshots its output file before and after. The diff is then printed by
 * source: items added / removed / changed, mob pages changed, and — because that is the number
 * the Zone loot view actually depends on — how many mob-to-item DROP EDGES appeared and
 * disappeared. A scraper that exits non-zero stops the whole run non-zero; a half-refreshed
 * tree is not something to discover at release time.
 *
 * THE STAMP RULE (why this script writes files at all). Every scraper stamps
 * `scrapedAt: new Date().toISOString()` UNCONDITIONALLY, so a re-scrape that learned nothing
 * still rewrites the file and `git status` still goes red. That turns "did the wiki change?"
 * into a question you can only answer by reading an 8 MB diff. So: when the payload is
 * byte-identical apart from the stamp, this script RESTORES the previous bytes verbatim and
 * says so. scrape-classes.ts already does exactly this for its own output (`writeIfChanged`);
 * this generalizes it to the three scrapers that do not, without editing them. A run that
 * learned nothing therefore leaves the tree clean.
 *
 * COST (why this is a release-time chore, not something to run casually). The scrapers hold
 * AGENTS.md's scraper-etiquette law: one serialized request at a time, 1 req/s, bulk-batched
 * through the MediaWiki API. A COLD run is ~527 requests, so 10-15 minutes wall clock. It is
 * cold more often than you would think, because `scripts/sources/cache/items/` and
 * `scripts/sources/cache/mobs/` are GITIGNORED (~30 MB and ~7,900 wikitext files respectively
 * — see .gitignore's own note); `scripts/sources/cache/quests/` IS committed, so a
 * quests-only run is offline and takes under a minute. `--refresh` throws every cache away
 * and is always the expensive path.
 *
 * WHEN TO RUN IT: before each release, so the "Wiki data as of …" stamp the app shows is
 * honest and the loot tables are current. Commit whatever it changes; if it changed nothing,
 * there is nothing to commit, which is the point.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  diffByPage,
  diffKeyed,
  dropEdgeDelta,
  formatDiff,
  type DataDiff
} from './refreshDiff.mjs'
import type { ItemDbFile } from '../src/main/itemsDb'
import type { MobData, QuestData } from '../src/shared/types'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** The same runner `npm run scrape:*` uses, invoked directly so npm need not be on PATH. */
const TSX_CLI = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')

type SourceId = 'items' | 'mobs' | 'quests'

/** What one source contributes to the report: its diff, plus any source-specific lines. */
interface Report {
  diff: DataDiff
  notes: string[]
}

interface Source {
  id: SourceId
  script: string
  out: string
  /** `prev` is null the first time a file is scraped (nothing on disk yet). */
  report: (prev: unknown, next: unknown) => Report
}

/** items.json is a keyed MAP, so the diff names item keys rather than the four file fields. */
function itemsReport(prev: unknown, next: unknown): Report {
  const before = prev as ItemDbFile | null
  const after = next as ItemDbFile
  return {
    diff: diffKeyed(before?.items ?? null, after.items, { ignoreKeys: [] }),
    notes: []
  }
}

/** mobs.json is an array sorted by wiki page; drop edges are the number that matters. */
function mobsReport(prev: unknown, next: unknown): Report {
  const before = (prev as MobData | null)?.mobs ?? null
  const after = (next as MobData).mobs
  const edges = dropEdgeDelta(before, after)
  return {
    diff: diffByPage(before, after),
    notes: [`  drop edges: +${edges.added} / -${edges.removed}`]
  }
}

function questsReport(prev: unknown, next: unknown): Report {
  const before = (prev as QuestData | null)?.quests ?? null
  return { diff: diffByPage(before, (next as QuestData).quests), notes: [] }
}

/** In ROADMAP order: items first (quests reuses its item-title enumeration cache). */
const SOURCES: Source[] = [
  {
    id: 'items',
    script: join(ROOT, 'scripts', 'scrape-items.ts'),
    out: join(ROOT, 'src', 'main', 'data', 'items.json'),
    report: itemsReport
  },
  {
    id: 'mobs',
    script: join(ROOT, 'scripts', 'scrape-mobs.ts'),
    out: join(ROOT, 'src', 'renderer', 'src', 'data', 'eqlegends', 'mobs.json'),
    report: mobsReport
  },
  {
    id: 'quests',
    script: join(ROOT, 'scripts', 'scrape-quests.ts'),
    out: join(ROOT, 'src', 'renderer', 'src', 'data', 'eqlegends', 'quests.json'),
    report: questsReport
  }
]

const USAGE =
  'Usage: npm run refresh:data -- [--refresh] [--only items|mobs|quests] (--only repeatable)'

interface Args {
  only: SourceId[]
  /** flags handed verbatim to every scraper. Their only flag is `--refresh`. */
  passthrough: string[]
}

const isSourceId = (v: string): v is SourceId =>
  v === 'items' || v === 'mobs' || v === 'quests'

function parseArgs(argv: readonly string[]): Args {
  const only: SourceId[] = []
  const passthrough: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--refresh') {
      passthrough.push(arg)
      continue
    }
    const inline = arg.startsWith('--only=') ? arg.slice('--only='.length) : null
    if (inline === null && arg !== '--only') {
      throw new Error(`Unrecognized argument "${arg}". ${USAGE}`)
    }
    const picked = inline ?? argv[++i]
    if (picked == null || !isSourceId(picked)) {
      throw new Error(`--only wants items, mobs or quests, not "${picked ?? ''}". ${USAGE}`)
    }
    only.push(picked)
  }
  return { only: only.length ? only : SOURCES.map((s) => s.id), passthrough }
}

/** The file's exact bytes plus its parsed form — the bytes are what a restore writes back. */
interface Snapshot {
  bytes: Buffer
  data: unknown
}

function readSnapshot(file: string): Snapshot | null {
  if (!existsSync(file)) return null
  const bytes = readFileSync(file)
  return { bytes, data: JSON.parse(bytes.toString('utf8')) as unknown }
}

function runScraper(source: Source, passthrough: readonly string[]): void {
  if (!existsSync(TSX_CLI)) throw new Error(`tsx is not installed (${TSX_CLI}). Run npm ci.`)
  const res = spawnSync(process.execPath, [TSX_CLI, source.script, ...passthrough], {
    cwd: ROOT,
    stdio: 'inherit'
  })
  if (res.error) throw res.error
  if (res.status !== 0) {
    throw new Error(`scrape:${source.id} failed (exit ${res.status ?? 'signal'}) — stopping.`)
  }
}

interface SourceResult {
  id: SourceId
  diff: DataDiff
  notes: string[]
  /** true when the payload was unchanged and the previous bytes (and stamp) were put back */
  restored: boolean
}

function refreshOne(source: Source, passthrough: readonly string[]): SourceResult {
  console.log(`\n===== ${source.id}: ${relative(ROOT, source.out)} =====`)
  const before = readSnapshot(source.out)
  runScraper(source, passthrough)
  const after = readSnapshot(source.out)
  if (after === null) throw new Error(`scrape:${source.id} left no ${source.out}.`)
  const report = source.report(before?.data ?? null, after.data)
  // The stamp rule: an unchanged payload keeps its old stamp, so `git diff` stays clean.
  const restored = report.diff.stampOnly && before !== null && !before.bytes.equals(after.bytes)
  if (restored && before) writeFileSync(source.out, before.bytes)
  return { id: source.id, diff: report.diff, notes: report.notes, restored }
}

function printBlock(result: SourceResult): void {
  console.log(`\n${formatDiff(result.id, result.diff)}`)
  for (const note of result.notes) console.log(note)
  if (result.restored) {
    console.log('  payload identical: restored the previous scrapedAt, so git stays clean')
  }
}

function printTotals(results: readonly SourceResult[]): void {
  const sum = (pick: (d: DataDiff) => number): number =>
    results.reduce((n, r) => n + pick(r.diff), 0)
  const clean = results.every((r) => r.diff.stampOnly)
  console.log(
    `\ntotals across ${results.length} source(s): ${sum((d) => d.added.length)} added, ` +
      `${sum((d) => d.removed.length)} removed, ${sum((d) => d.changed.length)} changed` +
      (clean ? ' (nothing moved, the tree is unchanged)' : '')
  )
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const wanted = SOURCES.filter((s) => args.only.includes(s.id))
  console.log(
    `refresh:data — ${wanted.map((s) => s.id).join(', ')}` +
      (args.passthrough.length ? ` (${args.passthrough.join(' ')})` : '')
  )
  const results = wanted.map((s) => refreshOne(s, args.passthrough))
  console.log('\n===== refresh:data summary =====')
  for (const result of results) printBlock(result)
  printTotals(results)
}

try {
  main()
} catch (err) {
  console.error(`\nrefresh:data FAILED — ${(err as Error).message}`)
  process.exit(1)
}
