// patchNotes.ts — the EverQuest Legends patch notes: the cache, what is unread, and what to fetch.
//
// Main fetches (src/main/patchNotes.ts); this file is every DECISION about what it fetched, pure so
// node tests can drive it with a clock of their own:
//
//   * WHICH ARTICLES: the newest one every check (the devs do edit a fresh note), then any not yet
//     downloaded, newest first, at most `MAX_ARTICLES_PER_CHECK`. A posted note otherwise never
//     changes, so a downloaded one is never asked for again.
//   * WHAT IS NEW: a note in this index that the previous index did not have. The FIRST index an
//     install ever reads is a baseline, not news: nothing is announced, and every note but the
//     newest starts read, so a fresh install shows one unread note rather than twenty.
//   * WHEN TO ASK ON LAUNCH: every launch, unless the last attempts failed, in which case the wait
//     doubles from 10 minutes up to 12 hours. The manual "Check now" ignores the wait.
//
// The view the renderer draws is built here too (`buildView`), already sorted, already counted,
// so the renderer never filters or sorts it.

import { normalizeNodes } from './patchNotesHtml'
import { PAGE_NAME_RE, sortNewestFirst, type PatchNoteArticle, type PatchNoteKind, type PatchNoteSummary } from './patchNotesParse'

/** The one host the patch notes come from. */
export const PATCH_NOTES_ORIGIN = 'https://www.everquestlegends.com'
export const PATCH_NOTES_PATH = '/patch-notes'

export const MAX_ARTICLES_PER_CHECK = 5
const BACKOFF_BASE_MS = 10 * 60_000
const BACKOFF_MAX_MS = 12 * 60 * 60_000

export function indexUrl(origin: string): string {
  return `${origin}${PATCH_NOTES_PATH}`
}

/** The page for one note. `pageName` must already have passed `PAGE_NAME_RE`. */
export function articleUrl(origin: string, pageName: string): string {
  return `${origin}${PATCH_NOTES_PATH}/${pageName}`
}

/** The disk cache, whole. */
export interface PatchNotesCache {
  v: 1
  /** Newest first. Empty until the first successful check. */
  index: PatchNoteSummary[]
  articles: Record<string, PatchNoteArticle>
  /** Page names the user has opened (or that were read by the first-run baseline). */
  read: string[]
  lastOkAt: number | null
  failures: number
  lastFailureAt: number | null
}

export const EMPTY_PATCH_NOTES_CACHE: PatchNotesCache = {
  v: 1,
  index: [],
  articles: {},
  read: [],
  lastOkAt: null,
  failures: 0,
  lastFailureAt: null
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function normalizeSummary(raw: unknown): PatchNoteSummary | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.pageName !== 'string' || !PAGE_NAME_RE.test(r.pageName)) return null
  if (typeof r.title !== 'string' || typeof r.postedAt !== 'number' || !Number.isFinite(r.postedAt)) return null
  const kind: PatchNoteKind = r.kind === 'hotfix' ? 'hotfix' : 'patch'
  return { pageName: r.pageName, title: r.title.slice(0, 200), postedAt: r.postedAt, kind }
}

function normalizeArticle(pageName: string, raw: unknown): PatchNoteArticle | null {
  if (!PAGE_NAME_RE.test(pageName) || typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  return {
    pageName,
    title: typeof r.title === 'string' ? r.title.slice(0, 200) : '',
    posted: typeof r.posted === 'string' ? r.posted.slice(0, 40) : null,
    body: normalizeNodes(r.body),
    fetchedAt: finiteOrNull(r.fetchedAt) ?? 0
  }
}

function normalizeArticles(raw: unknown, keep: ReadonlySet<string>): Record<string, PatchNoteArticle> {
  const out: Record<string, PatchNoteArticle> = {}
  if (typeof raw !== 'object' || raw === null) return out
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!keep.has(name)) continue
    const a = normalizeArticle(name, value)
    if (a) out[name] = a
  }
  return out
}

/** A cache read back from disk, every field re-checked. Anything unreadable is the empty cache. */
export function normalizeCache(raw: unknown): PatchNotesCache {
  if (typeof raw !== 'object' || raw === null) return EMPTY_PATCH_NOTES_CACHE
  const r = raw as Record<string, unknown>
  const rows = Array.isArray(r.index) ? r.index.map(normalizeSummary) : []
  const index = sortNewestFirst(rows.filter((x): x is PatchNoteSummary => x !== null))
  const names = new Set(index.map((x) => x.pageName))
  const read = Array.isArray(r.read) ? r.read.filter((x): x is string => typeof x === 'string' && names.has(x)) : []
  return {
    v: 1,
    index,
    articles: normalizeArticles(r.articles, names),
    read: [...new Set(read)],
    lastOkAt: finiteOrNull(r.lastOkAt),
    failures: typeof r.failures === 'number' && r.failures > 0 ? Math.min(Math.floor(r.failures), 32) : 0,
    lastFailureAt: finiteOrNull(r.lastFailureAt)
  }
}

/** The result of taking in a freshly fetched index. */
export interface IndexApplied {
  cache: PatchNotesCache
  /** Notes this index has that the previous one did not, newest first. Empty on a first run. */
  arrived: PatchNoteSummary[]
}

/**
 * Take in a fresh index. Articles and read marks for notes no longer listed are let go, so the
 * cache never outgrows the index. On the FIRST index (no previous one) every note but the newest
 * is marked read and nothing counts as arrived.
 */
export function applyIndex(cache: PatchNotesCache, fresh: readonly PatchNoteSummary[], now: number): IndexApplied {
  const index = sortNewestFirst([...fresh])
  const names = new Set(index.map((x) => x.pageName))
  const firstRun = cache.index.length === 0
  const before = new Set(cache.index.map((x) => x.pageName))
  const arrived = firstRun ? [] : index.filter((x) => !before.has(x.pageName))
  const read = firstRun ? index.slice(1).map((x) => x.pageName) : cache.read.filter((n) => names.has(n))
  const articles: Record<string, PatchNoteArticle> = {}
  for (const [name, a] of Object.entries(cache.articles)) if (names.has(name)) articles[name] = a
  return {
    cache: { ...cache, index, articles, read, lastOkAt: now, failures: 0, lastFailureAt: null },
    arrived
  }
}

/** Which articles to download this check: the newest always, then missing ones, newest first. */
export function planArticleFetches(cache: PatchNotesCache, max = MAX_ARTICLES_PER_CHECK): string[] {
  const out: string[] = []
  for (const [i, row] of cache.index.entries()) {
    if (out.length >= max) break
    if (i === 0 || !(row.pageName in cache.articles)) out.push(row.pageName)
  }
  return out
}

/** Store one downloaded article. A note no longer in the index is not kept. */
export function applyArticle(cache: PatchNotesCache, article: PatchNoteArticle): PatchNotesCache {
  if (!cache.index.some((x) => x.pageName === article.pageName)) return cache
  return { ...cache, articles: { ...cache.articles, [article.pageName]: article } }
}

/** Mark one note read, or every note when `pageName` is null. */
export function markRead(cache: PatchNotesCache, pageName: string | null): PatchNotesCache {
  if (pageName === null) return { ...cache, read: cache.index.map((x) => x.pageName) }
  if (cache.read.includes(pageName) || !cache.index.some((x) => x.pageName === pageName)) return cache
  return { ...cache, read: [...cache.read, pageName] }
}

export function unreadCount(cache: PatchNotesCache): number {
  const read = new Set(cache.read)
  return cache.index.reduce((n, x) => (read.has(x.pageName) ? n : n + 1), 0)
}

/** Record a failed check. */
export function noteFailure(cache: PatchNotesCache, now: number): PatchNotesCache {
  return { ...cache, failures: Math.min(cache.failures + 1, 32), lastFailureAt: now }
}

/** How long after `lastFailureAt` the next automatic check waits. 0 when nothing has failed. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0
  return Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS)
}

/** May a launch check run now? A manual check never asks. */
export function shouldAutoCheck(cache: PatchNotesCache, now: number): boolean {
  if (cache.failures === 0 || cache.lastFailureAt === null) return true
  return now - cache.lastFailureAt >= backoffMs(cache.failures)
}

// ---- the view ---------------------------------------------------------------------------------

/** One row of the list, as drawn. */
export interface PatchNoteRow extends PatchNoteSummary {
  url: string
  read: boolean
  /** Is the body on disk? A row without one still links out. */
  downloaded: boolean
}

/** The note a launch announces, once. */
export interface PatchNoteNotice {
  pageName: string
  title: string
  /** How many arrived together; the notice names the newest. */
  count: number
}

/** Everything the Patch Notes tab, the nav badge and the notice draw. */
export interface PatchNotesView {
  /** The launch check preference. */
  enabled: boolean
  /** False when this build has no origin to ask (the headless test build without a stub). */
  available: boolean
  checking: boolean
  lastOkAt: number | null
  /** A sentence for the last check that failed, or null. */
  error: string | null
  unread: number
  rows: PatchNoteRow[]
  notice: PatchNoteNotice | null
}

export interface ViewState {
  enabled: boolean
  available: boolean
  checking: boolean
  error: string | null
  notice: PatchNoteNotice | null
}

export function buildView(cache: PatchNotesCache, state: ViewState): PatchNotesView {
  const read = new Set(cache.read)
  return {
    ...state,
    lastOkAt: cache.lastOkAt,
    unread: unreadCount(cache),
    rows: cache.index.map((x) => ({
      ...x,
      url: articleUrl(PATCH_NOTES_ORIGIN, x.pageName),
      read: read.has(x.pageName),
      downloaded: x.pageName in cache.articles
    }))
  }
}

/** The notice for a batch of arrivals, or null when nothing arrived. */
export function noticeFor(arrived: readonly PatchNoteSummary[]): PatchNoteNotice | null {
  const newest = arrived[0]
  return newest === undefined ? null : { pageName: newest.pageName, title: newest.title, count: arrived.length }
}
