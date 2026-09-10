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
import type { CardHotspot } from './env'
import { STYLE } from './pageStyle'

/** Everything the renderer is handed. One object because seven loose arguments is six too many. */
export interface PageInput {
  id: string
  profile: CharacterProfileShare
  /** the compiled-in public origin — every URL on the page is built from it */
  origin: string
  /** the `EQC1-…` string, built by the server from the stored envelope */
  shareString: string
  hasCard: boolean
  /** where each gear cell sits on the card, for the hotspots; empty = a plain image */
  cardMap: readonly CardHotspot[]
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

/**
 * What the four numbers mean, in the reader's words. The mechanism is src/shared/build/profiles.ts
 * (weights in HP-equivalents, class-aware; a meter is current over the best reachable set) and the
 * solo blend there; this paragraph must keep saying what that file does.
 */
const SCORES_EXPLAINED =
  `<details class="how"><summary>How these are scored</summary>` +
  `<p><b>Tank</b>, <b>DPS</b> and <b>Healer</b> read the worn gear through a weight table for the character’s classes: ` +
  `every stat is worth some number of hit points to that role (AC and HP to a tank, damage-per-delay and strength to melee DPS, ` +
  `wisdom or intelligence and mana to casters and priests), the items are added up, and the total is shown against the best set ` +
  `the same rules could build from the item database for these classes. So 100% means the best gear reachable, not a game value.</p>` +
  `<p><b>Solo</b> blends the class kit (healing, sustain, escape, control, pets) with the gear meters.</p>` +
  `<p>The app’s Build tab reads the same scores slot by slot and lists the upgrades that would move each one, ` +
  `so a build can be tuned for tanking, DPS or healing.</p></details>`

/** The four readings, or the honest absence (world-model law 1: omitted, never zeroed). */
function scoresBlock(profile: CharacterProfileShare): string {
  const scores = profile.scores
  if (!scores) {
    return `<section class="panel"><h2>Scores</h2><p class="muted">Not computed yet.</p>${SCORES_EXPLAINED}</section>`
  }
  const rows = SCORE_ROWS.map(([key, label]) => {
    const pct = String(Math.max(0, Math.min(100, Math.round(scores[key]))))
    return (
      `<li><span class="k">${esc(label)}</span>` +
      `<span class="track"><span class="fill fill-${esc(key)}"></span></span>` +
      `<span class="v">${pct}%</span></li>`
    )
  }).join('')
  return `<section class="panel"><h2>Scores</h2><ul class="bars">${rows}</ul>${SCORES_EXPLAINED}</section>`
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
  if (cell.weapon) core.push(...weaponChips(cell.weapon))
  return core.length ? `<ul class="chips core">${chips(core)}</ul>` : ''
}

/**
 * Damage, delay, the damage/delay ratio and the skill. The ratio is the same arithmetic as the
 * app's damageRatio (itemStats.ts), derived here rather than sent: it is nothing the envelope
 * does not already say. Three places, the way the game community quotes it.
 */
function weaponChips(w: NonNullable<ShareCell['weapon']>): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = []
  if (w.dmg !== undefined) out.push({ label: 'Damage', text: String(w.dmg) })
  if (w.delay !== undefined) out.push({ label: 'Delay', text: String(w.delay) })
  if (w.dmg && w.delay) out.push({ label: 'Ratio', text: (w.dmg / w.delay).toFixed(3) })
  if (w.skill !== undefined) out.push({ label: 'Skill', text: w.skill })
  return out
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
  return (
    `<li id="slot-${esc(cell.slot)}" data-slot="${esc(cell.slot)}">` +
    `<span class="slot">${esc(cell.label)}</span>${body}${bits.join('')}</li>`
  )
}

function slotsBlock(profile: CharacterProfileShare): string {
  if (!profile.cells.length) return ''
  const rows = profile.cells.map((cell) => cellRow(cell)).join('')
  const hint = profile.cells.some(hasFacts)
    ? `<p class="muted">Hover or tap an item to see its stats.</p>`
    : ''
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

/**
 * The card image, and over it one hotspot per gear cell the app measured (`cardMap`).
 *
 * A hotspot is a focusable box at the cell's fractional position (the numbers become nonce'd
 * CSS rules, see `hotspotCss`; a `style=` attribute would be blocked). Hover or focus shows a
 * tip with the item's name, rank and the same facts block the gear list opens; the script adds
 * the pin-on-click and lights the matching list row. Cells on the right half flip their tip
 * leftward so it stays over the card. No map, no overlay: the image alone, full column width -
 * it is a full-resolution JPEG since 1.22.1, so it can afford the width.
 */
/**
 * The card URL, versioned by the record's last write. The bytes under `/c/:id.png` CHANGE when a
 * character is re-shared, but the path does not, and the card is served with an hour of cache -
 * so without this a re-share showed the previous picture until the cache aged out (Jack, 2026-09-10:
 * "still super small" while the served file was already right). The query string is ignored by
 * the route, which matches the pathname only.
 */
function cardUrl(input: PageInput): string {
  return `/c/${esc(input.id)}.png?v=${String(input.updatedAt)}`
}

function cardBlock(input: PageInput, title: string): string {
  const img = `<img class="card" src="${cardUrl(input)}" alt="${esc(title)}">`
  if (!input.cardMap.length) return `<div class="cardwrap">${img}</div>`
  const bySlot = new Map(input.profile.cells.map((cell) => [cell.slot, cell]))
  const hots = input.cardMap
    .map((spot, i) => {
      const cell = bySlot.get(spot.slot)
      if (!cell) return ''
      const { name, rank } = splitRank(cell)
      const badge = rank !== undefined ? `<span class="rank">+${String(rank)}</span>` : ''
      const flip = spot.x + spot.w / 2 > 0.5 ? ' flip' : ''
      const tip =
        `<div class="tip"><p class="tipname"><span class="item">${esc(name)}</span>${badge}</p>` +
        (hasFacts(cell) ? factsBlock(cell) : '') +
        `</div>`
      return (
        `<div class="hot hot-${String(i)}${flip}" tabindex="0" data-slot="${esc(cell.slot)}" ` +
        `role="button" aria-label="${esc(name)}">${tip}</div>`
      )
    })
    .join('')
  return `<div class="cardwrap">${img}<div class="hots">${hots}</div></div>`
}

/** The hotspot geometry as nonce'd rules: percentages of the card, from sanitized 0..1 numbers. */
function hotspotCss(input: PageInput): string {
  if (!input.hasCard) return ''
  const pct = (n: number): string => String(Math.round(n * 10_000) / 100)
  return input.cardMap
    .map((spot, i) => `.hot-${String(i)}{left:${pct(spot.x)}%;top:${pct(spot.y)}%;width:${pct(spot.w)}%;height:${pct(spot.h)}%}`)
    .join('')
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
    hoverScript() +
    hotspotScript() +
    `</script>`
  )
}

/**
 * Hover tooltips for the gear rows, on devices that can hover.
 *
 * The tap and keyboard path is the native <details> and needs no script. On a mouse, hovering a
 * row opens it as a floating panel (`.float`); leaving closes it again; clicking a floating row
 * pins it open inline, and the next click is the native toggle that closes it. Touch devices are
 * excluded by the media query, so a phone never sees a panel it cannot dismiss.
 */
function hoverScript(): string {
  return (
    `(function(){if(!window.matchMedia||!matchMedia('(hover: hover) and (pointer: fine)').matches)return;` +
    `var rows=document.querySelectorAll('details.gear');` +
    `for(var i=0;i<rows.length;i++)(function(d){var s=d.querySelector('summary');if(!s)return;` +
    `s.addEventListener('mouseenter',function(){if(!d.open){d.open=true;d.classList.add('float')}});` +
    `d.addEventListener('mouseleave',function(){if(d.classList.contains('float')&&!d.classList.contains('pinned')){d.open=false;d.classList.remove('float')}});` +
    // A click on a floating row PINS it where it floats (no layout jump); a second click lets go.
    `s.addEventListener('click',function(e){if(!d.classList.contains('float'))return;e.preventDefault();` +
    `if(d.classList.contains('pinned')){d.classList.remove('pinned','float');d.open=false}else{d.classList.add('pinned')}});` +
    `})(rows[i]);` +
    `document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;var p=document.querySelectorAll('details.gear.pinned');` +
    `for(var j=0;j<p.length;j++){p[j].classList.remove('pinned','float');p[j].open=false}});})();`
  )
}

/**
 * Hotspot ↔ row coupling. Hovering a box on the card lights its row in the gear list and the
 * other way round; a click pins the tip open (one at a time), Escape and a second click let go.
 * Without the script the CSS hover and focus states still show the tip - this only adds the link.
 */
function hotspotScript(): string {
  return (
    `(function(){var hots=document.querySelectorAll('.hot');if(!hots.length)return;` +
    `function unpin(){var all=document.querySelectorAll('.hot.pin');for(var j=0;j<all.length;j++)all[j].classList.remove('pin')}` +
    `for(var i=0;i<hots.length;i++)(function(h){var r=document.getElementById('slot-'+h.getAttribute('data-slot'));` +
    `h.addEventListener('mouseenter',function(){if(r)r.classList.add('lit')});` +
    `h.addEventListener('mouseleave',function(){if(r)r.classList.remove('lit')});` +
    `h.addEventListener('click',function(){var on=!h.classList.contains('pin');unpin();if(on)h.classList.add('pin')});` +
    `h.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();h.click()}});` +
    `if(r){r.addEventListener('mouseenter',function(){h.classList.add('lit')});` +
    `r.addEventListener('mouseleave',function(){h.classList.remove('lit')})}` +
    `})(hots[i]);` +
    `document.addEventListener('keydown',function(e){if(e.key==='Escape')unpin()});` +
    // A tap or click anywhere else lets a pinned tip go - the touch path's way out.
    `document.addEventListener('click',function(e){var t=e.target;if(!(t&&t.closest&&t.closest('.hot')))unpin()});})();`
  )
}


/** The Open Graph / Twitter head — what Discord draws when the link is pasted (ruling 5). */
function metaTags(input: PageInput, title: string, description: string): string {
  const pageUrl = `${input.origin}/s/${input.id}`
  const card = `${input.origin}${cardUrl(input)}`
  const tags = [
    `<meta name="description" content="${esc(description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="EQ Zera">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(pageUrl)}">`,
    `<meta property="og:image" content="${esc(card)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(card)}">`
  ]
  return tags.join('')
}

const SITE = 'https://eqzera.com/'

/**
 * The top bar: the EQ Zera mark linking home, and the download on the right. The mark is served
 * by this origin (`/logo.png`, logo.ts) because the CSP's `img-src 'self'` admits nothing else.
 */
function brandBar(): string {
  return (
    `<nav class="brand"><a class="home" href="${SITE}"><img src="/logo.png" alt="" width="32" height="32">EQ Zera</a>` +
    `<a class="get" href="${SITE}#install">Get the app</a></nav>`
  )
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
  const card = input.hasCard ? cardBlock(input, title) : ''
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${esc(title)} · EQ Zera</title>` +
    metaTags(input, title, description) +
    `<style nonce="${esc(input.nonce)}">${STYLE}${scoreWidthCss(input.profile)}${hotspotCss(input)}</style>` +
    `</head><body><div class="wrap">` +
    brandBar() +
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
