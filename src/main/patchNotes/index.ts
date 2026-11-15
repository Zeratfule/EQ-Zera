// patchNotes/index.ts — EverQuest Legends patch notes in main: the cache file, the launch check,
// and the view every window is told about.
//
// LAUNCH: `initPatchNotes()` runs once the main window exists and waits a few seconds more, so
// the first paint never shares the process with a download. It then checks only when the
// Preferences switch is on (default ON) and the backoff allows (shared/patchNotes.ts). The tab
// draws from the disk cache the whole time, so it opens instantly and works offline.
//
// ONE CHECK AT A TIME: a "Check now" pressed during the launch check joins it rather than
// starting a second one. Cache writes are chained so two never race for the same temp file.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { E2E } from '../e2e'
import { logError } from '../errorLog'
import { allowedExternalUrl } from '../security'
import { sendToMain } from '../windows'
import { writeFileDurableAsync } from '../telemetry/durableWrite'
import { getPatchNotesPrefs } from '../storePatchNotes'
import { IPC } from '../../shared/ipc'
import {
  EMPTY_PATCH_NOTES_CACHE,
  buildView,
  markRead,
  normalizeCache,
  noticeFor,
  shouldAutoCheck,
  type PatchNoteNotice,
  type PatchNotesCache,
  type PatchNotesView
} from '../../shared/patchNotes'
import { PAGE_NAME_RE, type PatchNoteArticle } from '../../shared/patchNotesParse'
import { E2E_ORIGIN_ENV, fetchPageText, patchNotesOriginFor } from './net'
import { runCheck } from './run'

const ORIGIN = patchNotesOriginFor(E2E, process.env[E2E_ORIGIN_ENV])
/** After the window is up, before the first request. */
const LAUNCH_DELAY_MS = E2E ? 500 : 4_000
const CACHE_FILE = 'patch-notes.json'

let cache: PatchNotesCache | null = null
let loading: Promise<PatchNotesCache> | null = null
let checking: Promise<void> | null = null
let lastError: string | null = null
let notice: PatchNoteNotice | null = null
let writes: Promise<void> = Promise.resolve()

function cachePath(): string {
  return join(app.getPath('userData'), CACHE_FILE)
}

async function readCacheFile(): Promise<PatchNotesCache> {
  try {
    return normalizeCache(JSON.parse(await readFile(cachePath(), 'utf8')))
  } catch {
    return EMPTY_PATCH_NOTES_CACHE
  }
}

/** The cache, read from disk on first use. */
function loadCache(): Promise<PatchNotesCache> {
  if (cache) return Promise.resolve(cache)
  loading ??= readCacheFile().then((c) => {
    cache ??= c
    return cache
  })
  return loading
}

function saveCache(next: PatchNotesCache): Promise<void> {
  cache = next
  const data = JSON.stringify(next)
  writes = writes
    .then(() => writeFileDurableAsync(app.getPath('userData'), cachePath(), data))
    .catch((err: unknown) => logError('main:patchNotes', { message: 'failed writing the patch notes cache', err }))
  return writes
}

export function patchNotesView(): PatchNotesView {
  return buildView(cache ?? EMPTY_PATCH_NOTES_CACHE, {
    enabled: getPatchNotesPrefs().enabled,
    available: ORIGIN !== '',
    checking: checking !== null,
    error: lastError,
    notice
  })
}

function push(): void {
  sendToMain(IPC.onPatchNotes, patchNotesView())
}

async function doCheck(): Promise<void> {
  const start = await loadCache()
  const result = await runCheck(start, {
    origin: ORIGIN,
    fetchText: (url) => fetchPageText(url, ORIGIN),
    now: () => Date.now(),
    keepHref: (href) => allowedExternalUrl(href) !== null,
    progress: async (c) => {
      await saveCache(c)
      push()
    }
  })
  await saveCache(result.cache)
  lastError = result.error
  notice = noticeFor(result.arrived) ?? notice
}

/** Run a check, or join the one already running. Resolves once it is over. */
export async function checkPatchNotes(): Promise<PatchNotesView> {
  if (ORIGIN === '') return patchNotesView()
  checking ??= doCheck()
    .catch((err: unknown) => logError('main:patchNotes', err))
    .finally(() => {
      checking = null
      push()
    })
  push()
  await checking
  return patchNotesView()
}

async function launchCheck(): Promise<void> {
  if (!getPatchNotesPrefs().enabled) return
  const c = await loadCache()
  if (!shouldAutoCheck(c, Date.now())) return
  await checkPatchNotes()
}

/** Called once the main window exists. Never blocks; with no origin it does nothing at all. */
export function initPatchNotes(): void {
  void loadCache().then(push)
  if (ORIGIN === '') return
  setTimeout(() => {
    void launchCheck().catch((err: unknown) => logError('main:patchNotes', err))
  }, LAUNCH_DELAY_MS).unref()
}

export async function patchNoteArticle(pageName: unknown): Promise<PatchNoteArticle | null> {
  if (typeof pageName !== 'string' || !PAGE_NAME_RE.test(pageName)) return null
  return (await loadCache()).articles[pageName] ?? null
}

export async function markPatchNoteRead(pageName: unknown): Promise<PatchNotesView> {
  const name = typeof pageName === 'string' && PAGE_NAME_RE.test(pageName) ? pageName : null
  if (pageName !== null && name === null) return patchNotesView()
  const c = await loadCache()
  const next = markRead(c, name)
  if (next !== c) await saveCache(next)
  push()
  return patchNotesView()
}

export function dismissPatchNotesNotice(): PatchNotesView {
  notice = null
  push()
  return patchNotesView()
}

/** For the view getter: make sure the disk cache has been read first. */
export async function loadedPatchNotesView(): Promise<PatchNotesView> {
  await loadCache()
  return patchNotesView()
}
