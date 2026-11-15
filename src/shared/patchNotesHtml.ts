// patchNotesHtml.ts — turns a patch-note article's HTML into a small, closed tree of nodes.
//
// THE RULE: nothing from everquestlegends.com reaches the DOM as markup. Main runs this over the
// article body and keeps the TREE (strings and `{ tag, href?, children }` records whose tag is one
// of a fixed dozen), the renderer maps each tag through its own switch, and no
// `dangerouslySetInnerHTML` is ever involved. So the allowlist below is the whole surface:
//
//   * kept:      p, h2, h3, h4, ul, ol, li, strong, em, u, s, br, and a[href] (https only, and only
//                where the caller's `keepHref` says the app could actually open it)
//   * renamed:   h1 -> h2, h5/h6 -> h4, b -> strong, i -> em, strike/del -> s, and a span whose
//                style strikes its text through -> s (the devs strike reverted notes that way)
//   * unwrapped: every other element (div, span, time, section...), keeping its text
//   * dropped with everything inside: script, style, iframe, svg, form controls, media, comments
//
// No attribute survives except that one href, so `onclick`, `style` and `javascript:` have nowhere
// to live. PURE: no imports beyond types, no DOM, safe in main, the renderer and node tests.

export type PatchNoteTag = 'p' | 'h2' | 'h3' | 'h4' | 'ul' | 'ol' | 'li' | 'strong' | 'em' | 'u' | 's' | 'br' | 'a'

export interface PatchNoteElement {
  tag: PatchNoteTag
  href?: string
  children: PatchNoteNode[]
}

/** A text run, or an element. */
export type PatchNoteNode = string | PatchNoteElement

/** Decides whether a link may stay a link. A refused href leaves its text behind. */
export type KeepHref = (href: string) => boolean

const RENAME: Readonly<Record<string, PatchNoteTag>> = {
  p: 'p',
  h1: 'h2',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h4',
  h6: 'h4',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  strong: 'strong',
  b: 'strong',
  em: 'em',
  i: 'em',
  u: 'u',
  s: 's',
  strike: 's',
  del: 's',
  a: 'a'
}

/** Elements whose CONTENT is dropped too, not just the tag. */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head',
  'title', 'textarea', 'select', 'option', 'button', 'form', 'canvas', 'video', 'audio', 'picture',
  'frameset', 'frame', 'applet', 'dialog'
])

/** Elements that never have a closing tag. Only `br` survives as a node. */
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'source', 'track', 'wbr', 'embed', 'param'])

/** Elements whose content is raw text: a `<` inside them is not a tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title'])

/** Opening one of these closes an open paragraph, as an HTML parser would. */
const BLOCK = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li'])

/** Nesting deeper than this is unwrapped rather than built. Real notes reach 4. */
const MAX_DEPTH = 24
/** Hard caps so a hostile page cannot make a huge tree. */
const MAX_INPUT_CHARS = 400_000
const MAX_NODES = 20_000

const NAMED_ENTITIES: Readonly<Record<string, number>> = {
  amp: 0x26, lt: 0x3c, gt: 0x3e, quot: 0x22, apos: 0x27, nbsp: 0xa0,
  rsquo: 0x2019, lsquo: 0x2018, ldquo: 0x201c, rdquo: 0x201d, ndash: 0x2013, mdash: 0x2014,
  hellip: 0x2026, trade: 0x2122, copy: 0xa9, reg: 0xae, bull: 0x2022, middot: 0xb7, times: 0xd7,
  deg: 0xb0, frac12: 0xbd, eacute: 0xe9
}

/** C0/C1 controls (tab, newline and carriage return kept), zero-width and BiDi controls, the BOM.
 *  Built from code points so the source stays plain ASCII. */
const CONTROL_RE = new RegExp(
  `[${[
    [0x00, 0x08],
    [0x0b, 0x0c],
    [0x0e, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2066, 0x2069],
    [0xfeff, 0xfeff]
  ]
    .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`)
    .join('')}]`,
  'g'
)

/** U+FFFD, for a character reference that names no character. */
const REPLACEMENT = String.fromCharCode(0xfffd)

function codePointText(cp: number): string {
  if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return REPLACEMENT
  return String.fromCodePoint(cp)
}

/** Decode the character references real pages use. Unknown names are left as written. */
export function decodeEntities(raw: string): string {
  return raw.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) return codePointText(Number.parseInt(body.slice(2), 16))
    if (body.startsWith('#')) return codePointText(Number.parseInt(body.slice(1), 10))
    const cp = NAMED_ENTITIES[body]
    return cp === undefined ? whole : String.fromCodePoint(cp)
  })
}

/** Decoded, control-free text with HTML whitespace collapsed (a no-break space is kept). */
export function cleanText(raw: string): string {
  return decodeEntities(raw).replace(CONTROL_RE, '').replace(/[ \t\n\r\f]+/g, ' ')
}

/** Plain text of an HTML fragment: tags removed, text cleaned and trimmed. For one-line fields. */
export function plainText(html: string): string {
  return cleanText(html.replace(/<[^>]*>/g, ' ')).trim()
}

// ---- tokenizer ---------------------------------------------------------------------------------

type Token =
  | { kind: 'text'; text: string }
  | { kind: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { kind: 'close'; name: string }

const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase()
    if (!(name in out)) out[name] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return out
}

/** Where a comment / doctype / processing instruction starting at `i` ends, or -1. */
function skipMarkup(html: string, i: number): number {
  if (html.startsWith('<!--', i)) {
    const end = html.indexOf('-->', i + 4)
    return end < 0 ? html.length : end + 3
  }
  if (html.startsWith('<!', i) || html.startsWith('<?', i)) {
    const end = html.indexOf('>', i)
    return end < 0 ? html.length : end + 1
  }
  return -1
}

/** Index just past the `</name>` that ends a raw-text element's content. */
function skipRawText(html: string, from: number, name: string): number {
  const re = new RegExp(`</${name}\\s*>`, 'ig')
  re.lastIndex = from
  const m = re.exec(html)
  return m ? m.index + m[0].length : html.length
}

/** Split HTML into tokens. Raw-text elements are skipped whole (they are all dropped anyway). */
export function tokenize(html: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      out.push({ kind: 'text', text: html.slice(i) })
      break
    }
    if (lt > i) out.push({ kind: 'text', text: html.slice(i, lt) })
    i = readMarkupAt(html, lt, out)
  }
  return out
}

/** Read whatever starts with the `<` at `lt`; push its token; return the next index. */
function readMarkupAt(html: string, lt: number, out: Token[]): number {
  const skipped = skipMarkup(html, lt)
  if (skipped >= 0) return skipped
  const m = TAG_RE.exec(html.slice(lt, lt + 4096))
  if (!m) {
    out.push({ kind: 'text', text: '<' })
    return lt + 1
  }
  const name = m[2].toLowerCase()
  const next = lt + m[0].length
  if (m[1] === '/') {
    out.push({ kind: 'close', name })
    return next
  }
  const attrs = m[3]
  out.push({ kind: 'open', name, attrs: parseAttrs(attrs), selfClosing: /\/\s*$/.test(attrs) })
  if (!RAW_TEXT.has(name)) return next
  // The content is skipped whole, so its closing tag is emitted here.
  out.push({ kind: 'close', name })
  return skipRawText(html, next, name)
}

// ---- tree builder ------------------------------------------------------------------------------

/** One open source element. `node` is null for an unwrapped (transparent) one. */
interface Frame {
  src: string
  node: PatchNoteElement | null
}

interface Builder {
  root: PatchNoteNode[]
  stack: Frame[]
  /** Source name of the element being dropped, and how deep in same-named tags we are. */
  dropping: { name: string; depth: number } | null
  count: number
  keepHref: KeepHref
}

function parentChildren(b: Builder): PatchNoteNode[] {
  for (let k = b.stack.length - 1; k >= 0; k--) {
    const node = b.stack[k].node
    if (node) return node.children
  }
  return b.root
}

function realDepth(b: Builder): number {
  let n = 0
  for (const f of b.stack) if (f.node) n++
  return n
}

/** The nearest real open element's tag, or null at the root. */
function currentTag(b: Builder): PatchNoteTag | null {
  for (let k = b.stack.length - 1; k >= 0; k--) {
    const node = b.stack[k].node
    if (node) return node.tag
  }
  return null
}

/** Pop through the nearest open frame whose real tag is `tag`, unless a `stopAt` tag comes first. */
function closeOpen(b: Builder, tag: PatchNoteTag, stopAt: readonly PatchNoteTag[]): void {
  for (let k = b.stack.length - 1; k >= 0; k--) {
    const node = b.stack[k].node
    if (!node) continue
    if (node.tag === tag) {
      b.stack.length = k
      return
    }
    if (stopAt.includes(node.tag)) return
  }
}

/** What an opening tag becomes: a real tag, or null to unwrap it. */
function mappedTag(name: string, attrs: Record<string, string>): PatchNoteTag | null {
  if (name === 'span' && /line-through/i.test(attrs.style ?? '')) return 's'
  return RENAME[name] ?? null
}

function safeHref(b: Builder, attrs: Record<string, string>): string | null {
  const raw = decodeEntities(attrs.href ?? '').trim()
  if (raw.length === 0 || raw.length > 2048) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return null
    return b.keepHref(u.href) ? u.href : null
  } catch {
    return null
  }
}

function insideLink(b: Builder): boolean {
  return b.stack.some((f) => f.node?.tag === 'a')
}

type OpenToken = Extract<Token, { kind: 'open' }>

/** The element an opening tag builds, or null to unwrap it (an unknown tag, or a link we refuse). */
function elementFor(b: Builder, tok: OpenToken): PatchNoteElement | null {
  const tag = mappedTag(tok.name, tok.attrs)
  if (tag === null) return null
  if (tag !== 'a') return { tag, children: [] }
  const href = insideLink(b) ? null : safeHref(b, tok.attrs)
  return href === null ? null : { tag, href, children: [] }
}

function onOpen(b: Builder, tok: OpenToken): void {
  const closes = !VOID.has(tok.name) && !tok.selfClosing
  if (DROP_WITH_CONTENT.has(tok.name)) {
    if (closes) b.dropping = { name: tok.name, depth: 1 }
    return
  }
  if (tok.name === 'br') {
    pushNode(b, { tag: 'br', children: [] })
    return
  }
  if (!closes) return
  const el = elementFor(b, tok)
  if (el !== null && BLOCK.has(el.tag)) closeImplied(b, el.tag)
  const room = realDepth(b) < MAX_DEPTH && b.count < MAX_NODES
  const node = room ? el : null
  if (node) pushNode(b, node)
  b.stack.push({ src: tok.name, node })
}

/** A block start ends an open paragraph; a list item ends its open sibling. */
function closeImplied(b: Builder, tag: PatchNoteTag): void {
  if (currentTag(b) === 'p') closeOpen(b, 'p', [])
  if (tag === 'li') closeOpen(b, 'li', ['ul', 'ol'])
}

function pushNode(b: Builder, node: PatchNoteNode): void {
  if (b.count >= MAX_NODES) return
  b.count++
  parentChildren(b).push(node)
}

function onClose(b: Builder, name: string): void {
  for (let k = b.stack.length - 1; k >= 0; k--) {
    if (b.stack[k].src === name) {
      b.stack.length = k
      return
    }
  }
}

function onDropToken(b: Builder, tok: Token): void {
  const d = b.dropping
  if (!d) return
  if (tok.kind === 'open' && tok.name === d.name && !tok.selfClosing) d.depth++
  if (tok.kind === 'close' && tok.name === d.name) d.depth--
  if (d.depth <= 0) b.dropping = null
}

function onText(b: Builder, raw: string): void {
  const text = cleanText(raw)
  if (text.length === 0) return
  const parent = currentTag(b)
  // Whitespace between list items or blocks is layout, not content.
  if (text.trim().length === 0 && (parent === null || parent === 'ul' || parent === 'ol')) return
  const siblings = parentChildren(b)
  const last = siblings[siblings.length - 1]
  if (typeof last === 'string') siblings[siblings.length - 1] = last + text
  else pushNode(b, text)
}

/** Drop empty inline elements and whitespace at the edges of blocks; returns the cleaned list. */
function prune(nodes: PatchNoteNode[]): PatchNoteNode[] {
  const out: PatchNoteNode[] = []
  for (const n of nodes) {
    if (typeof n === 'string') {
      out.push(n)
      continue
    }
    const children = prune(n.children)
    if (children.length === 0 && n.tag !== 'br') continue
    out.push({ ...n, children })
  }
  return out
}

/**
 * Sanitize an HTML fragment into the closed node tree. `keepHref` is asked about every https link;
 * main passes the app's external-link allowlist, so a link the app could not open is just text.
 */
export function sanitizeHtml(html: string, keepHref: KeepHref): PatchNoteNode[] {
  const b: Builder = { root: [], stack: [], dropping: null, count: 0, keepHref }
  for (const tok of tokenize(html.slice(0, MAX_INPUT_CHARS))) {
    if (b.dropping) onDropToken(b, tok)
    else if (tok.kind === 'text') onText(b, tok.text)
    else if (tok.kind === 'open') onOpen(b, tok)
    else onClose(b, tok.name)
  }
  return prune(b.root)
}

// ---- validation of a stored tree ---------------------------------------------------------------

const KNOWN_TAGS = new Set<string>(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'u', 's', 'br', 'a'])

function isElementShape(v: unknown): v is { tag: unknown; href?: unknown; children: unknown } {
  return typeof v === 'object' && v !== null && 'tag' in v && 'children' in v
}

/**
 * Re-check a tree read back from disk: only known tags, https hrefs, strings, bounded depth.
 * Anything else is dropped. The disk cache is ours, but a file is a file.
 */
export function normalizeNodes(raw: unknown, depth = 0): PatchNoteNode[] {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return []
  const out: PatchNoteNode[] = []
  for (const v of raw as unknown[]) out.push(...normalizeNode(v, depth))
  return out
}

/** One stored node, as zero or more checked nodes. */
function normalizeNode(v: unknown, depth: number): PatchNoteNode[] {
  if (typeof v === 'string') return [v.replace(CONTROL_RE, '')]
  if (!isElementShape(v) || typeof v.tag !== 'string' || !KNOWN_TAGS.has(v.tag)) return []
  const children = normalizeNodes(v.children, depth + 1)
  const tag = v.tag as PatchNoteTag
  if (tag !== 'a') return [{ tag, children }]
  // A link that lost its href is still its text.
  if (typeof v.href !== 'string' || !v.href.startsWith('https://')) return children
  return [{ tag, href: v.href, children }]
}

/** All the text in a tree, for search and tests. */
export function nodesText(nodes: readonly PatchNoteNode[]): string {
  let s = ''
  for (const n of nodes) s += typeof n === 'string' ? n : n.tag === 'br' ? '\n' : nodesText(n.children)
  return s
}
