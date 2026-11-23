// Rewrites the "Recent releases" block of website/home-body.html from src/shared/releaseNotes.ts,
// keeping the three newest releases (website/README.md, "Per release"). Run with
// `npx tsx scripts/site-releases.mts`, then `node build.mjs` in website/.

import fs from 'node:fs'
import { RELEASE_NOTES } from '../src/shared/releaseNotes'

const LABEL: Record<string, string> = { new: 'New', changed: 'Changed', fixed: 'Fixed' }
const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const blocks = RELEASE_NOTES.slice(0, 3).map((r) => {
  const items = r.entries
    .map((e) => {
      // A release before 0.7.0 carries no kind; it shows untagged.
      const tag = e.kind === undefined ? '' : `<span class="eqz-tag eqz-tag-${e.kind}">${LABEL[e.kind]}</span>`
      return `          <li>${tag}${esc(e.text)}</li>`
    })
    .join('\n')
  return `      <div class="eqz-release">\n        <div class="v">${r.version}<small>${r.date}</small></div>\n        <ul>\n${items}\n        </ul>\n      </div>`
})

const path = 'website/home-body.html'
let html = fs.readFileSync(path, 'utf8')
const crlf = html.includes('\r\n')
html = html.replace(/\r\n/g, '\n')
const re = /( {4}<div class="eqz-releases">\n)[\s\S]*?(\n {4}<\/div>\n {4}<p class="eqz-more">)/
if (!re.test(html)) throw new Error('releases block not found')
html = html.replace(re, (_m, open: string, close: string) => open + blocks.join('\n') + close)
fs.writeFileSync(path, crlf ? html.replace(/\n/g, '\r\n') : html)
console.log(`releases: ${RELEASE_NOTES.slice(0, 3).map((r) => r.version).join(', ')}`)
