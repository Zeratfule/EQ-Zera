// patchNotesParse.ts — reads the two pages everquestlegends.com serves for its patch notes.
//
// THE INDEX (`/patch-notes`) is server-rendered HTML that carries the list as one JSON array:
// `window.EQL.News.articles = [ {...}, ... ]`. It is cut out by bracket balancing (string-aware, so
// a `]` inside a title cannot end it early) and handed to JSON.parse. It is never evaluated.
//
// AN ARTICLE (`/patch-notes/<pageName>`) carries its body as the inner HTML of
// `<section class="news-article-body">`, its title in `<h1 class="news-article-title">`, and its
// date in `<time datetime>`. The body goes through `sanitizeHtml` (patchNotesHtml.ts).
//
// Every row is validated before it can become a path or a label: a `pageName` is a closed class
// because it is concatenated into a request URL. PURE, like the rest of `src/shared/**`.

import { plainText, sanitizeHtml, type KeepHref, type PatchNoteNode } from './patchNotesHtml'

export type PatchNoteKind = 'patch' | 'hotfix'

/** One row of the index. */
export interface PatchNoteSummary {
  pageName: string
  title: string
  /** When the devs posted it, epoch ms (the index's `start_date_epoch`). */
  postedAt: number
  kind: PatchNoteKind
}

/** One downloaded article. */
export interface PatchNoteArticle {
  pageName: string
  title: string
  /** The page's own `<time datetime>` text, as written (it carries no zone). */
  posted: string | null
  body: PatchNoteNode[]
  fetchedAt: number
}

/** A page name as this app is willing to put in a URL path. */
export const PAGE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,127}$/

/** More rows than this in one index is not a patch-notes page. */
const MAX_INDEX_ROWS = 200
const MAX_TITLE_CHARS = 200
const ARRAY_MARKER = 'window.EQL.News.articles'

/**
 * The text of the balanced `[...]` starting at `open`, or null when it never closes. Tracks JSON
 * strings and their escapes so brackets inside a string do not count.
 */
export function balancedArray(src: string, open: number): string | null {
  let depth = 0
  let inString = false
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '[') depth++
    else if (c === ']' && --depth === 0) return src.slice(open, i + 1)
  }
  return null
}

/** The articles array the index page embeds, parsed, or null when the page has no such array. */
export function extractArticlesArray(html: string): unknown[] | null {
  const at = html.indexOf(ARRAY_MARKER)
  if (at < 0) return null
  const eq = html.indexOf('=', at + ARRAY_MARKER.length)
  if (eq < 0 || html.slice(at + ARRAY_MARKER.length, eq).trim() !== '') return null
  const open = html.indexOf('[', eq)
  if (open < 0 || html.slice(eq + 1, open).trim() !== '') return null
  const text = balancedArray(html, open)
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Hotfix or a full patch, read from the title (the page names do not say: one hotfix is `update-notes`). */
export function kindOf(title: string): PatchNoteKind {
  return /hotfix/i.test(title) ? 'hotfix' : 'patch'
}

function epochMs(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{9,11}$/.test(raw) ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n * 1000 : null
}

/** One index row, validated, or null. */
export function parseIndexRow(raw: unknown): PatchNoteSummary | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const pageName = typeof r.pageName === 'string' ? r.pageName.trim() : ''
  if (!PAGE_NAME_RE.test(pageName)) return null
  const title = typeof r.title === 'string' ? plainText(r.title).slice(0, MAX_TITLE_CHARS) : ''
  const postedAt = epochMs(r.start_date_epoch)
  if (title.length === 0 || postedAt === null) return null
  return { pageName, title, postedAt, kind: kindOf(title) }
}

/** Newest first; ties broken by page name so the order is stable. */
export function sortNewestFirst(rows: PatchNoteSummary[]): PatchNoteSummary[] {
  return [...rows].sort((a, b) => b.postedAt - a.postedAt || a.pageName.localeCompare(b.pageName))
}

/** The index page, as validated rows newest first (duplicates dropped), or null when unreadable. */
export function parseIndex(html: string): PatchNoteSummary[] | null {
  const arr = extractArticlesArray(html)
  if (arr === null) return null
  const seen = new Set<string>()
  const rows: PatchNoteSummary[] = []
  for (const raw of arr.slice(0, MAX_INDEX_ROWS)) {
    const row = parseIndexRow(raw)
    if (!row || seen.has(row.pageName)) continue
    seen.add(row.pageName)
    rows.push(row)
  }
  return sortNewestFirst(rows)
}

/**
 * The inner HTML of the `<section>` whose class names `className`, matched against its OWN
 * closing tag (nested sections are counted), or null.
 */
export function sectionInner(html: string, className: string): string | null {
  const openRe = new RegExp(`<section\\b[^>]*class\\s*=\\s*"[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'i')
  const open = openRe.exec(html)
  if (!open) return null
  const start = open.index + open[0].length
  const tagRe = /<(\/?)section\b[^>]*>/gi
  tagRe.lastIndex = start
  let depth = 1
  for (let m = tagRe.exec(html); m; m = tagRe.exec(html)) {
    depth += m[1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(start, m.index)
  }
  return null
}

function articleTitle(html: string): string {
  const m = /<h1\b[^>]*class\s*=\s*"[^"]*\bnews-article-title\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  return m ? plainText(m[1]).slice(0, MAX_TITLE_CHARS) : ''
}

function articlePosted(html: string): string | null {
  const m = /<time\b[^>]*\bdatetime\s*=\s*"([^"]{1,40})"/i.exec(html)
  return m ? plainText(m[1]) : null
}

/** An article page, or null when it has no article body. */
export function parseArticle(
  html: string,
  pageName: string,
  opts: { keepHref: KeepHref; now: number }
): PatchNoteArticle | null {
  const inner = sectionInner(html, 'news-article-body')
  if (inner === null) return null
  return {
    pageName,
    title: articleTitle(html),
    posted: articlePosted(html),
    body: sanitizeHtml(inner, opts.keepHref),
    fetchedAt: opts.now
  }
}
