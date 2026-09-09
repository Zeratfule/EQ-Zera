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

import type {
  CharacterProfileShare,
  ShareCell,
  ShareEffect,
  ShareStatLine
} from '../../src/shared/characterShare'
import { characterBlock, characterShareText } from '../../src/shared/characterShare'

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

/**
 * The name without its rank, and the rank as its own badge.
 *
 * A v2 cell says `base` outright (only when it differs from `item`). A v1 cell only has the
 * verbatim name, so the ` +N` the tier came from is stripped by hand — and ONLY when the name
 * really ends in that exact suffix, so a name the sanitizer clamped mid-way is shown whole rather
 * than guessed at.
 */
export function splitRank(cell: ShareCell): { name: string; rank: number | undefined } {
  if (cell.base !== undefined) return { name: cell.base, rank: cell.tier }
  if (cell.tier !== undefined) {
    const suffix = ` +${String(cell.tier)}`
    if (cell.item.endsWith(suffix) && cell.item.length > suffix.length) {
      return { name: cell.item.slice(0, -suffix.length), rank: cell.tier }
    }
  }
  return { name: cell.item, rank: cell.tier }
}

/**
 * Whether there is anything to open under the name.
 *
 * NOT `typeof cell.known`: the sanitizer stamps `known: true` onto every cell it rebuilds, a v1
 * body included, so that flag alone cannot tell "v1, nothing was ever sent" from "v2, an item
 * with facts". What can is the facts themselves — a number, a stat line, a flag, an effect, a
 * weapon — or the one negative fact worth opening for, `known: false`. A v1 cell has none of
 * those and stays a plain row, exactly as it rendered before v2 existed.
 */
function hasFacts(cell: ShareCell): boolean {
  if (!cell.known) return true
  return (
    cell.ac !== undefined ||
    cell.hp !== undefined ||
    cell.mana !== undefined ||
    cell.endurance !== undefined ||
    Boolean(cell.stats?.length) ||
    Boolean(cell.effects?.length) ||
    Boolean(cell.flags?.length) ||
    cell.weapon !== undefined
  )
}

const EFFECT_LABEL: Record<ShareEffect['kind'], string> = {
  combat: 'Combat',
  focus: 'Focus',
  click: 'Click',
  worn: 'Worn',
  proc: 'Proc',
  effect: 'Effect'
}

function statChips(lines: readonly ShareStatLine[]): string {
  return chips(lines.map((line) => ({ label: line.label, text: line.value })))
}

/** The four core numbers and the weapon line, as one chip row. */
function coreChips(cell: ShareCell): string {
  const core: { label: string; text: string }[] = []
  if (cell.ac !== undefined) core.push({ label: 'AC', text: String(cell.ac) })
  if (cell.hp !== undefined) core.push({ label: 'HP', text: String(cell.hp) })
  if (cell.mana !== undefined) core.push({ label: 'Mana', text: String(cell.mana) })
  if (cell.endurance !== undefined) core.push({ label: 'Endurance', text: String(cell.endurance) })
  const w = cell.weapon
  if (w?.dmg !== undefined) core.push({ label: 'Damage', text: String(w.dmg) })
  if (w?.delay !== undefined) core.push({ label: 'Delay', text: String(w.delay) })
  if (w?.skill !== undefined) core.push({ label: 'Skill', text: w.skill })
  return core.length ? `<ul class="chips core">${chips(core)}</ul>` : ''
}

/** `Focus  Improved Damage II — detail` per effect. */
function effectRows(effects: readonly ShareEffect[]): string {
  const rows = effects
    .map((e) => {
      const detail = e.detail !== undefined ? `<span class="muted-inline"> — ${esc(e.detail)}</span>` : ''
      return `<li><span class="k">${esc(EFFECT_LABEL[e.kind] ?? 'Effect')}</span>${esc(e.name)}${detail}</li>`
    })
    .join('')
  return rows ? `<ul class="effects">${rows}</ul>` : ''
}

/**
 * What opens under an item: its flags, the four core numbers, every other stat line, its
 * effects and its weapon line — or the honest "not in the database" when the DB had no record.
 * Every string here is a stranger's; every one goes through `esc()`.
 */
function factsBlock(cell: ShareCell): string {
  if (!cell.known) {
    return `<div class="facts"><p class="muted">Not in the item database, so its stats are not counted.</p></div>`
  }
  const flags = cell.flags?.length
    ? `<ul class="flags">${cell.flags.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
    : ''
  const stats = cell.stats?.length ? `<ul class="chips">${statChips(cell.stats)}</ul>` : ''
  // `hasFacts` gates the caller, so at least one of these is non-empty here.
  return `<div class="facts">${flags + coreChips(cell) + stats + effectRows(cell.effects ?? [])}</div>`
}

/**
 * One worn slot: the label, the name with its rank as a badge, then what the cell knows.
 *
 * A v2 cell is a `<details>`: native, keyboard- and tap-friendly, and it works with the
 * stylesheet AND the script blocked — which is the bar every element on this page clears. A v1
 * cell has no facts to open, so it stays a plain row exactly as it was before v2 existed.
 */
function cellRow(cell: ShareCell): string {
  const { name, rank } = splitRank(cell)
  const badge = rank !== undefined ? `<span class="rank">+${String(rank)}</span>` : ''
  const title = `<span class="item">${esc(name)}</span>${badge}`
  const bits: string[] = []
  if (cell.exaltations.length) {
    bits.push(`<span class="ex">${cell.exaltations.map((e) => esc(e)).join(' · ')}</span>`)
  }
  if (cell.ornament !== undefined) {
    bits.push(`<span class="orn">ornamented as ${esc(cell.ornament)}</span>`)
  }
  const body = hasFacts(cell)
    ? `<details class="gear"><summary>${title}</summary>${factsBlock(cell)}</details>`
    : `<span class="name">${title}</span>`
  return `<li><span class="slot">${esc(cell.label)}</span>${body}${bits.join('')}</li>`
}

function slotsBlock(profile: CharacterProfileShare): string {
  if (!profile.cells.length) return ''
  const rows = profile.cells.map((cell) => cellRow(cell)).join('')
  const hint = profile.cells.some(hasFacts) ? `<p class="muted">Open an item to see its stats.</p>` : ''
  return `<section class="panel"><h2>Worn gear</h2>${hint}<ul class="slots">${rows}</ul></section>`
}

/** A `label: value` chip list, used for the stat / save / unsummed rows alike. */
function chips(items: readonly { label: string; text: string }[]): string {
  return items
    .map((row) => `<li><span class="k">${esc(row.label)}</span><span class="v">${esc(row.text)}</span></li>`)
    .join('')
}

/**
 * The character with the gear on — level, classes, and what the worn items add up to.
 *
 * Every number is a GEAR TOTAL: the app reads the log, the log carries no base stats, and law 1
 * forbids inventing them, so the panel says so in its own subtitle rather than letting "HP 145"
 * read as a hit-point pool. `characterBlock` is the app's own derivation, imported, so the page
 * and the in-app viewer can never disagree about these figures.
 */
function characterPanel(profile: CharacterProfileShare): string {
  const block = characterBlock(profile)
  const t = profile.totals
  const who: string[] = []
  if (block.level !== undefined) who.push(`Level ${String(block.level)}`)
  if (block.classes.length) who.push(block.classes.join(' / '))
  const signed = (n: number): string => (n > 0 ? `+${String(n)}` : String(n))
  const core = chips([
    { label: 'HP', text: signed(block.hp) },
    { label: 'Mana', text: signed(block.mana) },
    { label: 'Endurance', text: signed(block.endurance) }
  ])
  const stats = chips(block.stats.map((r) => ({ label: r.label, text: signed(r.total) })))
  const saves = chips(block.saves.map((r) => ({ label: r.label, text: signed(r.total) })))
  // Percent-valued stats are STATED, never added (characterShare.ts, law 6).
  const unsummed = chips(t.unsummed.map((r) => ({ label: r.label, text: r.values.join(', ') })))
  const counted = `${String(t.counted)} of ${String(profile.cells.length)} worn items counted`
  const unknown = t.unknown ? ` · ${String(t.unknown)} not in the item database` : ''
  return (
    `<section class="panel"><h2>Character</h2>` +
    (who.length ? `<p class="who">${esc(who.join(' · '))}</p>` : '') +
    `<p class="muted">What the worn gear adds. The game log carries no base stats, so these are gear totals, not the full sheet.</p>` +
    `<p class="ac">AC <strong>${String(block.ac)}</strong></p>` +
    `<ul class="chips core">${core}</ul>` +
    (stats ? `<h3>Attributes</h3><ul class="chips">${stats}</ul>` : '') +
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
.who{margin:0 0 4px;font-size:19px;color:var(--ink2)}
.chips.core .v{color:var(--cyan)}
.slots>li{display:grid;grid-template-columns:120px 1fr;gap:4px 10px;padding:8px 0;border-top:1px solid var(--line)}
.slots>li:first-child{border-top:0}
.slot{color:var(--ink3);font-size:14px;font-family:var(--mono);padding-top:2px}
.item{color:var(--ink)}
.rank{display:inline-block;margin-left:8px;padding:0 7px;border-radius:999px;font-family:var(--mono);font-size:12px;line-height:20px;
color:#0c0a1f;background:linear-gradient(135deg,var(--cyan),var(--sun));vertical-align:1px;white-space:nowrap}
.ex,.orn{grid-column:2;color:var(--violet);font-size:14px}
.gear{grid-column:2}
.gear summary{cursor:pointer;list-style:none;display:flex;align-items:center;flex-wrap:wrap;gap:0 4px}
.gear summary::-webkit-details-marker{display:none}
.gear summary::after{content:'\\25B8';color:var(--ink3);font-size:13px;margin-left:8px;transition:transform .15s}
.gear[open] summary::after{transform:rotate(90deg)}
.gear summary:hover .item{color:var(--cyan)}
.facts{margin:8px 0 4px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--ground2)}
.facts .chips{margin:0 0 8px}.facts .chips:last-child{margin-bottom:0}
.facts .chips li{background:var(--panel)}
.flags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.flags li{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--violet);
border:1px solid var(--line);border-radius:4px;padding:2px 6px}
.effects li{font-size:14px;padding:2px 0}
.effects .k{display:inline-block;min-width:56px;color:var(--ink3);font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.muted-inline{color:var(--ink3)}
.facts .muted{margin:0}
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
    characterPanel(input.profile) +
    slotsBlock(input.profile) +
    shareStringBlock(input.shareString) +
    `<footer><a href="https://eqzera.com/">EQ Zera</a> reads your EverQuest Legends log live. ` +
    `<a href="https://eqzera.com/#install">Install it</a> to build a profile of your own.</footer>` +
    `</div>` +
    copyScript(input.nonce) +
    `</body></html>`
  )
}
