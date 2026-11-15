// patchNotesCache.test.mts — what is unread, what is new, what to fetch, and when to ask again
// (src/shared/patchNotes.ts). Pure: synthetic rows, a clock passed in, no files, no network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_PATCH_NOTES_CACHE,
  MAX_ARTICLES_PER_CHECK,
  applyArticle,
  applyIndex,
  backoffMs,
  buildView,
  markRead,
  normalizeCache,
  noteFailure,
  noticeFor,
  planArticleFetches,
  shouldAutoCheck,
  unreadCount,
  type PatchNotesCache
} from '../src/shared/patchNotes'
import type { PatchNoteArticle, PatchNoteSummary } from '../src/shared/patchNotesParse'

const DAY = 86_400_000
const T0 = 1_800_000_000_000

/** `n` notes, newest first, one a day. */
function notes(n: number, newestAt = T0): PatchNoteSummary[] {
  return Array.from({ length: n }, (_, i) => ({
    pageName: `note-${String(n - i)}`,
    title: `Patch Notes ${String(n - i)}`,
    postedAt: newestAt - i * DAY,
    kind: 'patch' as const
  }))
}

function article(pageName: string): PatchNoteArticle {
  return { pageName, title: pageName, posted: null, body: [{ tag: 'p', children: [pageName] }], fetchedAt: T0 }
}

function withArticles(c: PatchNotesCache, names: string[]): PatchNotesCache {
  return names.reduce((acc, n) => applyArticle(acc, article(n)), c)
}

const state = { enabled: true, available: true, checking: false, error: null, notice: null }

test('the first index is a baseline: nothing arrives, and only the newest note is unread', () => {
  const { cache, arrived } = applyIndex(EMPTY_PATCH_NOTES_CACHE, notes(21), T0)
  assert.deepEqual(arrived, [])
  assert.equal(unreadCount(cache), 1)
  assert.equal(cache.read.includes('note-21'), false)
  assert.equal(cache.lastOkAt, T0)
})

test('a later index announces exactly the notes the previous one did not have', () => {
  const first = applyIndex(EMPTY_PATCH_NOTES_CACHE, notes(3), T0).cache
  const read = markRead(first, 'note-3')
  const next = applyIndex(read, notes(5, T0 + 2 * DAY), T0 + 2 * DAY)
  assert.deepEqual(next.arrived.map((x) => x.pageName), ['note-5', 'note-4'])
  assert.equal(unreadCount(next.cache), 2)
  assert.deepEqual(noticeFor(next.arrived), { pageName: 'note-5', title: 'Patch Notes 5', count: 2 })
  assert.equal(noticeFor([]), null)
})

test('the same index again announces nothing', () => {
  const first = applyIndex(EMPTY_PATCH_NOTES_CACHE, notes(4), T0).cache
  assert.deepEqual(applyIndex(first, notes(4), T0 + 1).arrived, [])
})

test('a note dropped from the index takes its article and read mark with it', () => {
  const first = withArticles(applyIndex(EMPTY_PATCH_NOTES_CACHE, notes(3), T0).cache, ['note-1', 'note-2', 'note-3'])
  const shorter = notes(3).slice(0, 2)
  const next = applyIndex(first, shorter, T0 + 1).cache
  assert.deepEqual(Object.keys(next.articles).sort(), ['note-2', 'note-3'])
  assert.ok(!next.read.includes('note-1'))
})

test('fetch plan: at most five, newest first, then only what is missing plus the newest', () => {
  const c = applyIndex(EMPTY_PATCH_NOTES_CACHE, notes(21), T0).cache
  const plan = planArticleFetches(c)
  assert.equal(MAX_ARTICLES_PER_CHECK, 5)
  assert.deepEqual(plan, ['note-21', 'note-20', 'note-19', 'note-18', 'note-17'])
  const after = withArticles(c, plan)
  // The newest is asked for again (the devs edit fresh notes); the rest continue down the list.
  assert.deepEqual(planArticleFetches(after), ['note-21', 'note-16', 'note-15', 'note-14', 'note-13'])
  const all = withArticles(c, notes(21).map((x) => x.pageName))
  assert.deepEqual(planArticleFetches(all), ['note-21'])
  assert.deepEqual(planArticleFetches(EMPTY_PATCH_NOTES_CACHE), [])
})

test('an article for a note that is not in the index is not kept', () => {
  const c = applyIndex(EMPTY_PATCH_NOTES_CACHE, notes(2), T0).cache
  assert.equal(applyArticle(c, article('note-99')), c)
})

test('mark read: one, all, and an unknown name changes nothing', () => {
  const c = applyIndex(EMPTY_PATCH_NOTES_CACHE, notes(3, T0), T0).cache
  const later = applyIndex(c, notes(5, T0 + 2 * DAY), T0).cache
  assert.equal(unreadCount(later), 3)
  assert.equal(unreadCount(markRead(later, 'note-5')), 2)
  assert.equal(markRead(later, 'nope'), later)
  assert.equal(markRead(markRead(later, 'note-5'), 'note-5').read.length, markRead(later, 'note-5').read.length)
  assert.equal(unreadCount(markRead(later, null)), 0)
})

test('backoff doubles from ten minutes and stops at twelve hours', () => {
  assert.equal(backoffMs(0), 0)
  assert.equal(backoffMs(1), 10 * 60_000)
  assert.equal(backoffMs(3), 40 * 60_000)
  assert.equal(backoffMs(30), 12 * 60 * 60_000)
  const failed = noteFailure(noteFailure(EMPTY_PATCH_NOTES_CACHE, T0), T0)
  assert.equal(failed.failures, 2)
  assert.equal(shouldAutoCheck(failed, T0 + 19 * 60_000), false)
  assert.equal(shouldAutoCheck(failed, T0 + 20 * 60_000), true)
  assert.equal(shouldAutoCheck(EMPTY_PATCH_NOTES_CACHE, T0), true)
  // A good check clears the record.
  assert.equal(applyIndex(failed, notes(1), T0).cache.failures, 0)
})

test('a cache read back from disk is re-checked field by field', () => {
  assert.deepEqual(normalizeCache(null), EMPTY_PATCH_NOTES_CACHE)
  assert.deepEqual(normalizeCache('garbage'), EMPTY_PATCH_NOTES_CACHE)
  const raw = {
    v: 1,
    index: [
      { pageName: 'note-1', title: 'One', postedAt: T0 - DAY, kind: 'patch' },
      { pageName: '../evil', title: 'Evil', postedAt: T0, kind: 'patch' },
      { pageName: 'note-2', title: 'Two', postedAt: T0, kind: 'hotfix' }
    ],
    articles: {
      'note-1': { title: 'One', body: [{ tag: 'script', children: ['x'] }, { tag: 'p', children: ['ok'] }], fetchedAt: 5 },
      '../evil': { title: 'Evil', body: [] },
      stranger: { title: 'Not listed', body: [] }
    },
    read: ['note-1', 'note-1', 'stranger', 7],
    lastOkAt: 'yesterday',
    failures: -3,
    lastFailureAt: null
  }
  const c = normalizeCache(raw)
  assert.deepEqual(c.index.map((x) => x.pageName), ['note-2', 'note-1'])
  assert.deepEqual(Object.keys(c.articles), ['note-1'])
  assert.deepEqual(c.articles['note-1'].body, [{ tag: 'p', children: ['ok'] }])
  assert.deepEqual(c.read, ['note-1'])
  assert.equal(c.lastOkAt, null)
  assert.equal(c.failures, 0)
})

test('the view: rows newest first, read and downloaded flags, links to the real site', () => {
  const c = withArticles(applyIndex(EMPTY_PATCH_NOTES_CACHE, notes(3), T0).cache, ['note-3'])
  const v = buildView(c, state)
  assert.deepEqual(v.rows.map((r) => [r.pageName, r.read, r.downloaded]), [
    ['note-3', false, true],
    ['note-2', true, false],
    ['note-1', true, false]
  ])
  assert.equal(v.rows[0].url, 'https://www.everquestlegends.com/patch-notes/note-3')
  assert.equal(v.unread, 1)
  assert.equal(v.lastOkAt, T0)
})
