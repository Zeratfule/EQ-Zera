/**
 * Generate `src/renderer/src/data/eqlegends/factionSources.json` — for every faction a race unlock
 * asks you to max, which mobs raise it per kill and which quest turn-ins raise it.
 *
 *   npx tsx scripts/gen-faction-sources.mts                  # caches under scripts/sources/cache
 *   npx tsx scripts/gen-faction-sources.mts --mobs <dir>     # a mob cache somewhere else
 *
 * CACHE ONLY, NO NETWORK. The mob pages are the `scrape:mobs` cache (gitignored, so a worktree may
 * need `--mobs` pointed at a checkout that has it); the quest pages are the committed
 * `scrape:quests` cache. Re-running over unchanged caches is a byte-identical no-op: there is no
 * timestamp in the output and every list is sorted.
 *
 * WHICH FACTIONS. The tracked set is read off the committed achievements dump
 * (tests/fixtures/Primitive_freeport-Achievements.txt), the `Get maximum faction with <F>.` rows,
 * so the dataset covers exactly what the Races tab can ask about. Wiki spellings are joined to it
 * through `factionKey` (src/shared/factionSources.ts), which carries the measured aliases.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { parseAchievementsDump } from '../src/shared/outputs/achievements'
import { raceUnlockStates } from '../src/shared/outputs/raceUnlocks'
import {
  factionKey,
  type FactionLoss,
  type FactionSourceEntry,
  type FactionSourceMob,
  type FactionSourceQuest,
  type FactionSourcesData
} from '../src/shared/factionSources'
import { mobFactionHits, questFactionHits, signedDelta, type StatedHit } from './sources/factionHits'
import { parseMobPage } from './sources/mobPage'
import { parseTopTable } from './sources/questPage'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const FIXTURE = join(ROOT, 'tests/fixtures/Primitive_freeport-Achievements.txt')
const QUEST_CACHE = join(HERE, 'sources/cache/quests')
const OUT = join(ROOT, 'src/renderer/src/data/eqlegends/factionSources.json')

/** Per faction, at most this many mobs and quests are kept: the best first (see `byGain`). */
const KEEP_MOBS = 40
const KEEP_QUESTS = 25

interface Member {
  pageid: number
  title: string
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function trackedFactions(): Map<string, string> {
  const dump = parseAchievementsDump(readFileSync(FIXTURE, 'utf8'))
  const tracked = new Map<string, string>()
  for (const race of raceUnlockStates(dump)) {
    for (const o of race.objectives) if (o.faction !== undefined) tracked.set(factionKey(o.faction), o.faction)
  }
  return tracked
}

/** The tracked key a wiki spelling joins to, or null. */
function joinKey(tracked: Map<string, string>, wikiName: string): string | null {
  const key = factionKey(wikiName)
  return tracked.has(key) ? key : null
}

function losses(tracked: Map<string, string>, hits: StatedHit[]): FactionLoss[] {
  const out = new Map<string, FactionLoss>()
  for (const h of hits) {
    const key = joinKey(tracked, h.faction)
    if (key === null || h.direction > 0 || h.amount === 0) continue
    const name = tracked.get(key) ?? h.faction
    const delta = signedDelta(h)
    const prev = out.get(key)
    // The worst stated loss wins; a stated one beats an unstated one.
    if (!prev || (delta !== null && (prev.delta === null || delta < prev.delta))) out.set(key, { faction: name, delta })
  }
  return [...out.values()].sort((a, b) => a.faction.localeCompare(b.faction))
}

/** The best stated gain per tracked faction on one page; null when the page states none. */
function gains(tracked: Map<string, string>, hits: StatedHit[]): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const h of hits) {
    const key = joinKey(tracked, h.faction)
    if (key === null || h.direction < 0 || h.amount === 0) continue
    const prev = out.get(key)
    if (prev === undefined || (h.amount !== null && (prev === null || h.amount > prev))) out.set(key, h.amount)
  }
  return out
}

function firstLevel(text: string | undefined): number {
  const m = text === undefined ? null : /\d+/.exec(text)
  return m ? Number(m[0]) : Number.POSITIVE_INFINITY
}

/** Known amounts first, largest first; unknown amounts after; then the lower level. */
function byGain<T extends { gain: number | null; page: string }>(level: (x: T) => number) {
  return (a: T, b: T): number =>
    (b.gain ?? -1) - (a.gain ?? -1) || level(a) - level(b) || a.page.localeCompare(b.page)
}

function entryFor(out: Map<string, FactionSourceEntry>, tracked: Map<string, string>, key: string): FactionSourceEntry {
  let e = out.get(key)
  if (!e) {
    e = { name: tracked.get(key) ?? key, mobs: [], quests: [] }
    out.set(key, e)
  }
  return e
}

function readMobs(dir: string, tracked: Map<string, string>, out: Map<string, FactionSourceEntry>): number {
  const members = JSON.parse(readFileSync(join(dir, 'mob-pages.json'), 'utf8')) as Member[]
  let read = 0
  for (const m of members) {
    const file = join(dir, `page-${String(m.pageid)}.wikitext`)
    if (!existsSync(file)) continue
    const wt = readFileSync(file, 'utf8')
    const mob = parseMobPage(m.title, wt)
    if (!mob) continue
    read++
    const hits = mobFactionHits(wt)
    const lowers = losses(tracked, hits)
    for (const [key, gain] of gains(tracked, hits)) {
      const row: FactionSourceMob = { page: mob.page, name: mob.name, gain, lowers }
      if (mob.level !== undefined) row.level = mob.level
      if (mob.zones) row.zones = mob.zones
      entryFor(out, tracked, key).mobs.push(row)
    }
  }
  return read
}

function readQuests(tracked: Map<string, string>, out: Map<string, FactionSourceEntry>): number {
  const members = JSON.parse(readFileSync(join(QUEST_CACHE, 'quest-pages.json'), 'utf8')) as Member[]
  let read = 0
  for (const m of members) {
    const file = join(QUEST_CACHE, `page-${String(m.pageid)}.wikitext`)
    if (!existsSync(file)) continue
    const wt = readFileSync(file, 'utf8')
    const hits = questFactionHits(wt)
    if (hits.length === 0) continue
    read++
    const top = parseTopTable(wt)
    const lowers = losses(tracked, hits)
    for (const [key, gain] of gains(tracked, hits)) {
      const row: FactionSourceQuest = { page: m.title, gain, lowers }
      if (top?.startZone) row.zone = top.startZone
      if (top?.giver) row.giver = top.giver
      if (top?.minLevel !== undefined) row.level = top.minLevel
      entryFor(out, tracked, key).quests.push(row)
    }
  }
  return read
}

function main(): void {
  const mobDir = resolve(arg('--mobs') ?? join(HERE, 'sources/cache/mobs'))
  if (!existsSync(join(mobDir, 'mob-pages.json'))) {
    throw new Error(`no mob cache at ${mobDir} - run scrape:mobs first, or pass --mobs <dir>`)
  }
  const tracked = trackedFactions()
  const out = new Map<string, FactionSourceEntry>()
  const mobPages = readMobs(mobDir, tracked, out)
  const questPages = readQuests(tracked, out)
  const factions: Record<string, FactionSourceEntry> = {}
  for (const key of [...tracked.keys()].sort()) {
    const e = entryFor(out, tracked, key)
    const found = `(of ${String(e.mobs.length)} / ${String(e.quests.length)})`
    e.mobs =e.mobs.sort(byGain<FactionSourceMob>((x) => firstLevel(x.level))).slice(0, KEEP_MOBS)
    e.quests = e.quests.sort(byGain<FactionSourceQuest>((x) => x.level ?? Number.POSITIVE_INFINITY)).slice(0, KEEP_QUESTS)
    factions[key] = e
    console.log(`${e.name.padEnd(28)} mobs ${String(e.mobs.length).padStart(3)}  quests ${String(e.quests.length).padStart(3)}  ${found}`)
  }
  const data: FactionSourcesData = {
    source: 'eqlwiki.com mob pages (factions / opposing_factions) and quest pages (faction lines)',
    factions
  }
  writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n', 'utf8')
  console.log(`read ${String(mobPages)} mob pages, ${String(questPages)} quest pages with faction lines; ${String(tracked.size)} factions -> ${OUT}`)
}

main()
