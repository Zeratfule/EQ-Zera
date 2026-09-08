// page.ts — the shared profile as a PAGE, rendered server-side from the sanitized body.
//
// ---------------------------------------------------------------------------
// EVERY VALUE ON THIS PAGE CAME FROM A STRANGER
// ---------------------------------------------------------------------------
// The body was written by whoever POSTed it. `sanitizeCharacterShare` has already clamped every
// string and capped every list, but a clamped string is still ARBITRARY TEXT — an item called
// `<img onerror=…>` is 120 legal characters. So this file has ONE rule and it has no exceptions:
// nothing from the body reaches the output except through `esc()`. There is no "this one is a
// number so it is fine" shortcut here; the numbers go through `String()` and the strings go
// through `esc()`, and `tests/shareServer.test.mts` asserts the raw `<` of a hostile item name
// never appears in the HTML.
//
// The second half of that rule is the CSP the handler sends: `default-src 'none'` with a per-
// response nonce on the one `<style>` and the one `<script>`. Inline style ATTRIBUTES are not
// nonce-able, which is why the score bars' widths are emitted as generated CSS rules inside the
// nonce'd stylesheet rather than as `style="width:74%"`.
//
// ---------------------------------------------------------------------------
// THE PALETTE IS THE WEBSITE'S
// ---------------------------------------------------------------------------
// Colours and type mirror `website/additional.css` (ground #0c0a1f, panel #1a1638, line #2d2757,
// ink #efeaff, cyan #5ee6ff, pink #ff5fb8; Chakra Petch / Source Sans 3 / JetBrains Mono). The
// faces are named with SYSTEM FALLBACKS and no `@font-face`: `default-src 'none'` has no
// `font-src`, so a webfont would be blocked, and widening the CSP to load one from a third party
// would be a strictly worse trade than Bahnschrift.

import type { CharacterProfileShare, ShareCell } from '../../src/shared/characterShare'
import { characterShareText } from '../../src/shared/characterShare'

/** Everything the renderer is handed. One object because seven loose arguments is six too many. */
export interface PageInput {
  id: string
  profile: CharacterProfileShare
  /** the compiled-in public origin — every URL on the page is built from it */
  origin: string
  /** the `EQC1-…` string, built by the server from the stored envelope */
  shareString: string
  hasCard: boolean
  /** epoch millis of the last write — what the "Shared from EQ Zera · <date>" line reads */
  updatedAt: number
  nonce: string
}

/** The one escape. `&` first, or the later replacements would double-escape their own output. */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** `<name> · Level <n> <classes>` — each part is allowed to be absent, and then it is not said. */
export function pageTitle(profile: CharacterProfileShare): string {
  const tail: string[] = []
  if (profile.level !== undefined) tail.push(`Level ${String(profile.level)}`)
  if (profile.classes.length) tail.push(profile.classes.join(' / '))
  const head = profile.name ?? 'A character'
  return tail.length ? `${head} · ${tail.join(' ')}` : head
}

/**
 * The unfurl's one sentence: the AC line and the four scores, or — when the Build tab had no
 * reading to give — the class line and the AC line.
 *
 * Built out of `characterShareText`, the same summary the app pastes into a chat window, so the
 * Discord embed and the clipboard say the same words about the same character rather than two
 * near-miss phrasings that drift apart on the next edit.
 */
export function pageDescription(profile: CharacterProfileShare): string {
  const lines = characterShareText(profile)
    .split('\n')
    .filter((line) => line.length > 0)
  const head = lines[0] ?? ''
  const acLine = lines.find((line) => line.startsWith('AC ')) ?? ''
  if (profile.scores) {
    const scoreLine = lines[1] ?? ''
    return [scoreLine, acLine].filter(Boolean).join(' · ')
  }
  return [head, acLine].filter(Boolean).join(' · ')
}

/** ISO date only. Locale-free on purpose: the server has no idea where the reader is. */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

const SCORE_ROWS: readonly [keyof NonNullable<CharacterProfileShare['scores']>, string][] = [
  ['tank', 'Tank'],
  ['dps', 'DPS'],
  ['heal', 'Healer'],
  ['solo', 'Solo']
]

/** The four readings, or the honest absence (world-model law 1: omitted, never zeroed). */
function scoresBlock(profile: CharacterProfileShare): string {
  const scores = profile.scores
  if (!scores) {
    return `<section class="panel"><h2>Scores</h2><p class="muted">Not computed yet.</p></section>`
  }
  const rows = SCORE_ROWS.map(([key, label]) => {
    const pct = String(Math.max(0, Math.min(100, Math.round(scores[key]))))
    return (
      `<li><span class="k">${esc(label)}</span>` +
      `<span class="track"><span class="fill fill-${esc(key)}"></span></span>` +
      `<span class="v">${pct}%</span></li>`
    )
  }).join('')
  return `<section class="panel"><h2>Scores</h2><ul class="bars">${rows}</ul></section>`
}

/** The bar widths, as nonce'd CSS rules — a `style=` attribute would be blocked by the CSP. */
function scoreWidthCss(profile: CharacterProfileShare): string {
  const scores = profile.scores
  if (!scores) return ''
  return SCORE_ROWS.map(([key]) => {
    const pct = String(Math.max(0, Math.min(100, Math.round(scores[key]))))
    return `.fill-${key}{width:${pct}%}`
  }).join('')
}

/** One worn slot: the label, the item verbatim (` +N` and all), its exaltations and ornament. */
function cellRow(cell: ShareCell): string {
  const bits: string[] = []
  if (cell.exaltations.length) {
    bits.push(`<span class="ex">${cell.exaltations.map((e) => esc(e)).join(' · ')}</span>`)
  }
  if (cell.ornament !== undefined) {
    bits.push(`<span class="orn">ornamented as ${esc(cell.ornament)}</span>`)
  }
  return (
    `<li><span class="slot">${esc(cell.label)}</span>` +
    `<span class="item">${esc(cell.item)}</span>${bits.join('')}</li>`
  )
}

function slotsBlock(profile: CharacterProfileShare): string {
  if (!profile.cells.length) return ''
  const rows = profile.cells.map((cell) => cellRow(cell)).join('')
  return `<section class="panel"><h2>Worn gear</h2><ul class="slots">${rows}</ul></section>`
}

/** A `label: value` chip list, used for the stat / save / unsummed rows alike. */
function chips(items: readonly { label: string; text: string }[]): string {
  return items
    .map((row) => `<li><span class="k">${esc(row.label)}</span><span class="v">${esc(row.text)}</span></li>`)
    .join('')
}

function totalsBlock(profile: CharacterProfileShare): string {
  const t = profile.totals
  const stats = chips(t.stats.map((r) => ({ label: r.label, text: String(r.total) })))
  const saves = chips(t.saves.map((r) => ({ label: r.label, text: String(r.total) })))
  // Percent-valued stats are STATED, never added (characterShare.ts, law 6).
  const unsummed = chips(t.unsummed.map((r) => ({ label: r.label, text: r.values.join(', ') })))
  const counted = `${String(t.counted)} of ${String(profile.cells.length)} worn items counted`
  const unknown = t.unknown ? ` · ${String(t.unknown)} not in the item database` : ''
  return (
    `<section class="panel"><h2>Totals</h2>` +
    `<p class="ac">AC <strong>${String(t.ac)}</strong></p>` +
    (stats ? `<ul class="chips">${stats}</ul>` : '') +
    (saves ? `<h3>Saves</h3><ul class="chips">${saves}</ul>` : '') +
    (unsummed ? `<h3>Stated</h3><ul class="chips">${unsummed}</ul>` : '') +
    `<p class="muted">${esc(counted + unknown)}</p></section>`
  )
}

/** The copy block. The string is base64url by construction; it is escaped anyway, on principle. */
function shareStringBlock(shareString: string): string {
  return (
    `<section class="panel"><h2>Open this in EQ Zera</h2>` +
    `<p class="muted">Paste this into the Character tab's <em>View a shared profile</em> box.</p>` +
    `<textarea id="eqc" class="eqc" readonly rows="3" spellcheck="false">${esc(shareString)}</textarea>` +
    `<p class="row"><button id="copy" type="button" class="btn">Copy share string</button>` +
    `<span id="copied" class="copied" hidden>Copied</span></p></section>`
  )
}

/**
 * The one inline script: copy the string to the clipboard.
 *
 * `navigator.clipboard` is unavailable on an insecure origin and in some embedded browsers, so the
 * textarea it is reading from IS the fallback — select it and let `execCommand('copy')` try. The
 * page is fully usable with the script blocked: the string is already on screen and selectable.
 */
function copyScript(nonce: string): string {
  return (
    `<script nonce="${esc(nonce)}">` +
    `(function(){var b=document.getElementById('copy'),t=document.getElementById('eqc'),` +
    `f=document.getElementById('copied');if(!b||!t||!f)return;` +
    `function flash(){f.hidden=false;setTimeout(function(){f.hidden=true},1600)}` +
    `function fallback(){t.focus();t.select();try{document.execCommand('copy');flash()}catch(e){}}` +
    `b.addEventListener('click',function(){` +
    `if(navigator.clipboard&&navigator.clipboard.writeText){` +
    `navigator.clipboard.writeText(t.value).then(flash,fallback)}else{fallback()}});})();` +
    `</script>`
  )
}

const STYLE = `
:root{--ground:#0c0a1f;--ground2:#13102c;--panel:#1a1638;--line:#2d2757;--ink:#efeaff;
--ink2:#b8b0d9;--ink3:#7d75a6;--cyan:#5ee6ff;--pink:#ff5fb8;--violet:#a98fe0;--sun:#c7a2ff;
--display:'Chakra Petch','Bahnschrift','Segoe UI',sans-serif;
--body:'Source Sans 3','Segoe UI',system-ui,sans-serif;
--mono:'JetBrains Mono','Cascadia Code',Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--body);font-size:17px;line-height:1.55}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:880px;margin:0 auto;padding:32px 20px 64px}
h1{font-family:var(--display);font-size:clamp(30px,5vw,44px);font-weight:700;letter-spacing:.02em;margin:0;
background:linear-gradient(180deg,#fff 0%,var(--sun) 60%,var(--pink) 100%);
-webkit-background-clip:text;background-clip:text;color:transparent}
h2{font-family:var(--display);font-size:15px;letter-spacing:.16em;text-transform:uppercase;color:var(--pink);margin:0 0 12px}
h3{font-family:var(--display);font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin:16px 0 8px}
.sub{color:var(--ink2);font-size:19px;margin:8px 0 0}
.meta{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin:14px 0 0}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:20px;margin:22px 0}
.card{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px;margin:22px 0}
.muted{color:var(--ink3);font-size:15px;margin:8px 0 0}
.ac{margin:0;font-size:22px}.ac strong{font-family:var(--mono);color:var(--cyan)}
ul{list-style:none;margin:0;padding:0}
.bars li{display:grid;grid-template-columns:70px 1fr 52px;align-items:center;gap:12px;margin:0 0 10px}
.track{height:9px;border-radius:5px;background:var(--ground2);border:1px solid var(--line);overflow:hidden}
.fill{display:block;height:100%;background:linear-gradient(90deg,var(--cyan),var(--pink))}
.bars .v{font-family:var(--mono);text-align:right;color:var(--cyan)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips li{display:flex;gap:8px;background:var(--ground2);border:1px solid var(--line);border-radius:6px;padding:5px 10px;font-size:14px}
.chips .k{color:var(--ink3)}.chips .v{font-family:var(--mono);color:var(--ink)}
.slots li{display:grid;grid-template-columns:120px 1fr;gap:10px;padding:8px 0;border-top:1px solid var(--line)}
.slots li:first-child{border-top:0}
.slot{color:var(--ink3);font-size:14px;font-family:var(--mono)}
.item{color:var(--ink)}
.ex,.orn{grid-column:2;color:var(--violet);font-size:14px}
.eqc{width:100%;font-family:var(--mono);font-size:12px;color:var(--sun);background:var(--ground2);
border:1px solid var(--line);border-radius:6px;padding:10px;resize:vertical;word-break:break-all}
.row{display:flex;align-items:center;gap:12px;margin:12px 0 0}
.btn{font-family:var(--display);font-weight:700;font-size:16px;letter-spacing:.03em;padding:12px 22px;
border:0;border-radius:6px;cursor:pointer;color:#0c0a1f;background:linear-gradient(135deg,var(--cyan),#8ab4ff 55%,var(--pink))}
.copied{color:var(--cyan);font-size:14px}
footer{color:var(--ink3);font-size:15px;margin:34px 0 0;border-top:1px solid var(--line);padding-top:20px}
`

/** The Open Graph / Twitter head — what Discord draws when the link is pasted (ruling 5). */
function metaTags(input: PageInput, title: string, description: string): string {
  const pageUrl = `${input.origin}/s/${input.id}`
  const cardUrl = `${input.origin}/c/${input.id}.png`
  const tags = [
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="EQ Zera">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(pageUrl)}">`,
    `<meta property="og:image" content="${esc(cardUrl)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(cardUrl)}">`
  ]
  return tags.join('')
}

/** The head line: who this is, and when it was shared. */
function header(input: PageInput): string {
  const profile = input.profile
  const sub: string[] = []
  if (profile.level !== undefined) sub.push(`Level ${String(profile.level)}`)
  if (profile.classes.length) sub.push(profile.classes.join(' / '))
  return (
    `<header><h1>${esc(profile.name ?? 'A character')}</h1>` +
    (sub.length ? `<p class="sub">${esc(sub.join(' · '))}</p>` : '') +
    `<p class="meta">Shared from EQ Zera · ${esc(isoDate(input.updatedAt))}</p></header>`
  )
}

/** The whole page. Server-rendered, escaped, and readable with both the script and CSS blocked. */
export function renderPage(input: PageInput): string {
  const title = pageTitle(input.profile)
  const description = pageDescription(input.profile)
  const card = input.hasCard
    ? `<img class="card" src="/c/${esc(input.id)}.png" alt="${esc(title)}" width="1200" height="630">`
    : ''
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)} · EQ Zera</title>` +
    metaTags(input, title, description) +
    `<style nonce="${esc(input.nonce)}">${STYLE}${scoreWidthCss(input.profile)}</style>` +
    `</head><body><div class="wrap">` +
    header(input) +
    card +
    scoresBlock(input.profile) +
    totalsBlock(input.profile) +
    slotsBlock(input.profile) +
    shareStringBlock(input.shareString) +
    `<footer><a href="https://eqzera.com/">EQ Zera</a> reads your EverQuest Legends log live. ` +
    `<a href="https://eqzera.com/#install">Install it</a> to build a profile of your own.</footer>` +
    `</div>` +
    copyScript(input.nonce) +
    `</body></html>`
  )
}
