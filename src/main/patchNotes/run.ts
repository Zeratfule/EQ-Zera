// patchNotes/run.ts — one check for EverQuest Legends patch notes, with every effect injected.
//
// Electron-free so tests/patchNotesRun.test.mts drives it with a fake network and a fake clock.
// The rules it carries out are in src/shared/patchNotes.ts; what this file adds is the ORDER:
//
//   1. the index, alone. A failure here stops the check and starts the backoff.
//   2. the planned articles, ONE AT A TIME, never in parallel. The first failure stops the rest
//      for this check (and counts toward the backoff); what already landed is kept.
//   3. the cache is saved and the view pushed after the index and after every article, so the tab
//      fills in as the downloads land and a quit mid-check loses nothing already fetched.

import {
  applyArticle,
  applyIndex,
  articleUrl,
  indexUrl,
  noteFailure,
  planArticleFetches,
  type PatchNotesCache
} from '../../shared/patchNotes'
import { parseArticle, parseIndex, type PatchNoteSummary } from '../../shared/patchNotesParse'
import type { KeepHref } from '../../shared/patchNotesHtml'

export interface CheckDeps {
  origin: string
  /** GET a page's text. Rejects on a network error, a timeout or a non-2xx answer. */
  fetchText: (url: string) => Promise<string>
  now: () => number
  keepHref: KeepHref
  /** Persist and publish an intermediate cache. Never throws. */
  progress: (cache: PatchNotesCache) => Promise<void>
}

export interface CheckResult {
  cache: PatchNotesCache
  /** Notes new since the previous index, newest first. */
  arrived: PatchNoteSummary[]
  /** The sentence for a check that failed part way, or null. */
  error: string | null
  /** How many requests were made, index included. */
  requests: number
}

export const UNREACHABLE = 'Could not reach everquestlegends.com. The notes below are the ones saved on this PC.'
export const UNREADABLE = 'everquestlegends.com answered, but not with patch notes this app can read.'

async function fetchArticles(start: PatchNotesCache, deps: CheckDeps): Promise<{ cache: PatchNotesCache; error: string | null; requests: number }> {
  let cache = start
  let requests = 0
  for (const pageName of planArticleFetches(cache)) {
    requests++
    let html: string
    try {
      html = await deps.fetchText(articleUrl(deps.origin, pageName))
    } catch {
      return { cache: noteFailure(cache, deps.now()), error: UNREACHABLE, requests }
    }
    const article = parseArticle(html, pageName, { keepHref: deps.keepHref, now: deps.now() })
    if (article === null) return { cache: noteFailure(cache, deps.now()), error: UNREADABLE, requests }
    cache = applyArticle(cache, article)
    await deps.progress(cache)
  }
  return { cache, error: null, requests }
}

/** One check, start to finish. Never throws: every failure is in the result. */
export async function runCheck(start: PatchNotesCache, deps: CheckDeps): Promise<CheckResult> {
  let html: string
  try {
    html = await deps.fetchText(indexUrl(deps.origin))
  } catch {
    return { cache: noteFailure(start, deps.now()), arrived: [], error: UNREACHABLE, requests: 1 }
  }
  const index = parseIndex(html)
  // An index with no notes at all is a page that changed shape; taking it in would empty the cache.
  if (index === null || index.length === 0) {
    return { cache: noteFailure(start, deps.now()), arrived: [], error: UNREADABLE, requests: 1 }
  }
  const applied = applyIndex(start, index, deps.now())
  await deps.progress(applied.cache)
  const rest = await fetchArticles(applied.cache, deps)
  return { cache: rest.cache, arrived: applied.arrived, error: rest.error, requests: 1 + rest.requests }
}
