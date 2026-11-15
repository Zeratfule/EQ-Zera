// patchNotesParse.test.mts — the EverQuest Legends patch notes parser and HTML sanitizer.
//
// Fixtures: tests/fixtures/patch-notes/*.html, trimmed from www.everquestlegends.com on
// 2026-11-15 (the index's articles script block with 4 of its 21 rows, and each article's header
// plus its body section byte for byte). Public developer posts; no user data. The tests never
// touch the network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  balancedArray,
  extractArticlesArray,
  kindOf,
  parseArticle,
  parseIndex,
  parseIndexRow,
  sectionInner
} from '../src/shared/patchNotesParse'
import {
  decodeEntities,
  nodesText,
  normalizeNodes,
  sanitizeHtml,
  type PatchNoteNode
} from '../src/shared/patchNotesHtml'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'patch-notes')
const fixture = (name: string): string => readFileSync(join(FIX, name), 'utf8')
const ALLOW_ALL = (): boolean => true
const opts = { keepHref: ALLOW_ALL, now: 1 }

/** Every tag in a tree, depth first. */
function tags(nodes: readonly PatchNoteNode[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (typeof n === 'string') continue
    out.push(n.tag)
    out.push(...tags(n.children))
  }
  return out
}

const ALLOWED = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'em', 'u', 's', 'br', 'a'])

// ---- the index ---------------------------------------------------------------------------------

test('the index fixture parses to its four notes, newest first', () => {
  const rows = parseIndex(fixture('index.html'))
  assert.ok(rows)
  assert.deepEqual(
    rows.map((r) => r.pageName),
    ['eql-update-notes-11-10-2026', 'eql-hotfix-notes-11-4-2026', 'eql-hotfix-notes-11-3-2026', 'eql-update-notes-10-29-2026']
  )
  assert.equal(rows[0].title, 'Patch Notes - November 10, 2026')
  assert.equal(rows[0].postedAt, 1794337200 * 1000)
})

test('patch vs hotfix comes from the TITLE, not the page name', () => {
  const rows = parseIndex(fixture('index.html')) ?? []
  assert.deepEqual(rows.map((r) => r.kind), ['patch', 'hotfix', 'hotfix', 'hotfix'])
  // The site names one hotfix `eql-update-notes-10-29-2026`; its title says what it is.
  assert.equal(rows[3].pageName, 'eql-update-notes-10-29-2026')
  assert.equal(kindOf('Hotfix Patch Notes - October 23, 2026'), 'hotfix')
  assert.equal(kindOf('Beta Patch Notes - July 7, 2026'), 'patch')
})

test('the array is cut out by bracket balancing, with brackets inside strings ignored', () => {
  const html = '<script>window.EQL.News.articles = [{"title":"a ] [ b \\" ]","pageName":"x"}]; other = [1]</script>'
  const arr = extractArticlesArray(html)
  assert.deepEqual(arr, [{ title: 'a ] [ b " ]', pageName: 'x' }])
  assert.equal(balancedArray('[1,[2,3]', 0), null)
})

test('a page without the array, or with something that is not JSON there, reads as null', () => {
  assert.equal(parseIndex('<html><body>maintenance</body></html>'), null)
  // An expression, not data: it is never evaluated, so it is simply not an array.
  assert.equal(extractArticlesArray('window.EQL.News.articles = [alert(1)]'), null)
  assert.equal(extractArticlesArray('window.EQL.News.articles = {"a":1}'), null)
  assert.equal(extractArticlesArray('window.EQL.News.articlesX = [1]'), null)
})

test('an index row must carry a page name the app can put in a URL, a title and a date', () => {
  const good = { pageName: 'eql-update-notes-1-1-2027', title: 'Patch Notes', start_date_epoch: '1800000000' }
  assert.ok(parseIndexRow(good))
  for (const pageName of ['../admin', 'a/b', 'notes?x=1', '', 'UPPER', 'a b', '-lead', 'x'.repeat(200)]) {
    assert.equal(parseIndexRow({ ...good, pageName }), null, pageName)
  }
  assert.equal(parseIndexRow({ ...good, title: '' }), null)
  assert.equal(parseIndexRow({ ...good, start_date_epoch: 'soon' }), null)
  assert.equal(parseIndexRow(null), null)
  // Markup in a title is text, never markup.
  assert.equal(parseIndexRow({ ...good, title: '<b>Hot</b>fix &amp; more' })?.title, 'Hot fix & more')
})

test('duplicate page names keep the first row', () => {
  const html = `window.EQL.News.articles = ${JSON.stringify([
    { pageName: 'a-1', title: 'First', start_date_epoch: '1800000000' },
    { pageName: 'a-1', title: 'Second', start_date_epoch: '1800000001' }
  ])}`
  assert.deepEqual(parseIndex(html)?.map((r) => r.title), ['First'])
})

// ---- an article --------------------------------------------------------------------------------

test('the November 10 article: title, date and a body of six sections', () => {
  const a = parseArticle(fixture('eql-update-notes-11-10-2026.html'), 'eql-update-notes-11-10-2026', opts)
  assert.ok(a)
  assert.equal(a.title, 'Patch Notes - November 10, 2026')
  assert.equal(a.posted, '2026-11-10 11:00:00')
  const t = tags(a.body)
  assert.equal(t.filter((x) => x === 'h2').length, 6)
  assert.equal(t.filter((x) => x === 'li').length, 22)
  assert.ok(t.includes('u'), 'the underlined first heading keeps its underline')
  const text = nodesText(a.body)
  assert.ok(text.startsWith('EverQuest Legends Patch Notes- 11/10/2026'))
  assert.ok(text.includes('Throwing a spear now throws the pointed end forward instead of up.'))
  // The section AFTER the body is not part of it.
  assert.ok(!text.includes('More news'))
})

test('the August 25 article: pasted chat markup is unwrapped and struck-through notes stay struck', () => {
  const a = parseArticle(fixture('eql-update-notes-8-25-2026.html'), 'eql-update-notes-8-25-2026', opts)
  assert.ok(a)
  const t = tags(a.body)
  assert.ok(t.every((x) => ALLOWED.has(x)), t.join(','))
  assert.equal(t.filter((x) => x === 's').length, 4)
  assert.ok(t.includes('h3'))
  const text = nodesText(a.body)
  assert.ok(text.includes('The Estate of Unrest Revamp'))
  assert.ok(text.includes('Zones & Population'), 'entities are decoded')
  assert.ok(!text.includes('messageContent'), 'no attribute text leaks into the body')
})

test('every committed article sanitizes to allowed tags only', () => {
  for (const name of ['eql-update-notes-11-10-2026', 'eql-hotfix-notes-11-4-2026', 'eql-hotfix-notes-11-3-2026', 'eql-update-notes-10-29-2026']) {
    const a = parseArticle(fixture(`${name}.html`), name, opts)
    assert.ok(a, name)
    assert.ok(a.body.length > 0, name)
    assert.ok(tags(a.body).every((x) => ALLOWED.has(x)), name)
  }
})

test('a page without the article body section is not an article', () => {
  assert.equal(parseArticle('<html><body><h1 class="news-article-title">x</h1></body></html>', 'x', opts), null)
})

test('the body section is matched against its OWN closing tag', () => {
  const html = '<section class="news-article-body"><p>a</p><section><p>b</p></section><p>c</p></section><section>d</section>'
  assert.equal(sectionInner(html, 'news-article-body'), '<p>a</p><section><p>b</p></section><p>c</p>')
})

// ---- the sanitizer -----------------------------------------------------------------------------

test('script, style and their content are gone', () => {
  const out = sanitizeHtml('<p>a</p><script>alert(1)</script><style>p{color:red}</style><p>b</p>', ALLOW_ALL)
  assert.deepEqual(out, [{ tag: 'p', children: ['a'] }, { tag: 'p', children: ['b'] }])
  // Uppercase, attributes and a `<` inside the script do not fool the raw-text skip.
  const tricky = sanitizeHtml('<SCRIPT type="x">if (a < b) { document.write("<p>x</p>") }</SCRIPT><p>ok</p>', ALLOW_ALL)
  assert.equal(nodesText(tricky), 'ok')
})

test('event handlers and every other attribute are dropped', () => {
  const out = sanitizeHtml('<p onclick="steal()" style="color:red" class="x" id="y">hi</p>', ALLOW_ALL)
  assert.deepEqual(out, [{ tag: 'p', children: ['hi'] }])
  const img = sanitizeHtml('<p>a<img src="x" onerror="steal()">b</p>', ALLOW_ALL)
  assert.deepEqual(img, [{ tag: 'p', children: ['ab'] }])
})

test('javascript:, data:, http: and relative links leave only their text', () => {
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'jav&#x61;script:alert(1)', 'data:text/html,x', 'http://example.com', '/patch-notes/x', 'file:///c:/x.exe']) {
    const out = sanitizeHtml(`<p><a href="${href}">link</a></p>`, ALLOW_ALL)
    assert.deepEqual(out, [{ tag: 'p', children: ['link'] }], href)
  }
})

test('an https link survives only where keepHref says the app can open it', () => {
  const html = '<p><a href="https://www.everquestlegends.com/patch-notes/x" target="_blank">ours</a> <a href="https://discord.com/x">theirs</a></p>'
  const keep = (href: string): boolean => href.startsWith('https://www.everquestlegends.com/patch-notes/')
  assert.deepEqual(sanitizeHtml(html, keep), [
    { tag: 'p', children: [{ tag: 'a', href: 'https://www.everquestlegends.com/patch-notes/x', children: ['ours'] }, ' theirs'] }
  ])
})

test('iframes, svg, forms and comments are dropped with their content', () => {
  const out = sanitizeHtml(
    '<p>a</p><iframe src="https://x"><p>in</p></iframe><svg><svg><text>x</text></svg><script>1</script></svg><!-- <p>c</p> --><form><button>b</button></form><p>z</p>',
    ALLOW_ALL
  )
  assert.equal(nodesText(out), 'az')
})

test('renamed tags: b, i, h1, h6, strike, and a line-through span', () => {
  const out = sanitizeHtml('<h1>t</h1><h6>u</h6><p><b>b</b><i>i</i><strike>s</strike><span style="text-decoration: line-through;">x</span><span>y</span></p>', ALLOW_ALL)
  assert.deepEqual(tags(out), ['h2', 'h4', 'p', 'strong', 'em', 's', 's'])
  assert.equal(nodesText(out), 'tubisxy')
})

test('an open paragraph closes before a block, as a browser would', () => {
  const out = sanitizeHtml('<p>a<ul><li>one<li>two</ul>b', ALLOW_ALL)
  assert.deepEqual(out, [
    { tag: 'p', children: ['a'] },
    { tag: 'ul', children: [{ tag: 'li', children: ['one'] }, { tag: 'li', children: ['two'] }] },
    'b'
  ])
})

test('stray closing tags are ignored and unclosed ones end at the end', () => {
  assert.deepEqual(sanitizeHtml('</div></p><strong>a', ALLOW_ALL), [{ tag: 'strong', children: ['a'] }])
})

test('whitespace collapses, entities decode, control characters go', () => {
  const out = sanitizeHtml('<p>a \n\t b&nbsp;c &amp; &lt;x&gt; &#39;q&#x27; &rsquo;\u0007</p>\n<ul>\n<li>x</li>\n</ul>', ALLOW_ALL)
  assert.equal(nodesText(out), 'a b\u00a0c & <x> \'q\' \u2019x')
  assert.equal(decodeEntities('&#0; &#xD800; &bogus;'), '\ufffd \ufffd &bogus;')
})

test('nesting past the depth cap is unwrapped, not built', () => {
  const deep = '<strong>'.repeat(200) + 'x' + '</strong>'.repeat(200)
  const out = sanitizeHtml(deep, ALLOW_ALL)
  let depth = 0
  let n: PatchNoteNode | undefined = out[0]
  while (n !== undefined && typeof n !== 'string') {
    depth++
    n = n.children[0]
  }
  assert.ok(depth <= 24, String(depth))
  assert.equal(nodesText(out), 'x')
})

test('a tree read back from disk is re-checked', () => {
  const raw = [
    'text',
    { tag: 'script', children: ['alert(1)'] },
    { tag: 'p', children: ['ok', { tag: 'a', href: 'javascript:x', children: ['bad link'] }] },
    { tag: 'a', href: 'https://www.everquestlegends.com/patch-notes/x', children: ['good'] },
    { tag: 'img', src: 'x', children: [] },
    42,
    null
  ]
  assert.deepEqual(normalizeNodes(raw), [
    'text',
    { tag: 'p', children: ['ok', 'bad link'] },
    { tag: 'a', href: 'https://www.everquestlegends.com/patch-notes/x', children: ['good'] }
  ])
  assert.deepEqual(normalizeNodes('not an array'), [])
})
