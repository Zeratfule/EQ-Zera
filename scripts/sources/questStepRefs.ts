/**
 * PURE per-step location facts for the quest scraper (quest locations wave): the `{{Loc}}`
 * template rendered into the step's text instead of dropped, and each step's links and
 * coordinates kept beside its text (`QuestEntry.stepLinks` / `stepLocs`, schema in
 * src/shared/questTypes.ts). No network; unit-tested in tests/questStepRefs.test.mts against
 * the committed wikitext cache.
 *
 * WHAT A COORDINATE IS, MEASURED over the committed pages (2026-11-25). The wiki writes /loc order
 * (north-south, east-west[, z]) in four shapes, and only these four are read:
 *
 *   1. `{{Loc|Zone|a, b[, z]|label}}` — 31 pages. The template's zone is stated, so it is kept.
 *      Its coordinate parameter is written every way the wiki likes: `(+690, -17)`, `-802,2682,-2`,
 *      `(116, -1365),(-322, 1854)` (two points), `(-216,3813` (an unclosed paren).
 *   2. A bracketed group: `(201, -97, -7)`, `[-248.40, -124.09, 31.75]`, `(loc 52, -148)`.
 *   3. A CUED run: `at 1029, -978, 32`, `location -300, +1100`, `Your Location is -4.05, -70.53`,
 *      `/waypoint -90,287,127`, `loc:-89, -322`.
 *   4. Nothing else. A bare `-850, +1150` with no bracket and no cue is left alone, because the
 *      same prose writes `#4, 1x for Shawl` and `48,000 exp`; a missed coordinate shows nothing,
 *      a misread one would draw a wrong mark (world-model law 1).
 *
 * TWO GUARDS keep prose numbers out: an unspaced comma between unsigned numbers whose second
 * group is exactly three digits is a THOUSANDS separator (`48,000`), and a run followed by a unit
 * (`%`, `pp`, `exp`, `minutes`, `levels`…) is a quantity, not a place.
 */
import type { QuestStepLink, QuestStepLoc } from '../../src/shared/questTypes'
// RELATIVE value import: the zone table is pure and the node test runner has no `@shared` alias.
import { zoneShortNameFromCatalog } from '../../src/shared/zones'

/** One coordinate group, /loc order. */
interface Point {
  ns: number
  ew: number
  z?: number
}

const NUM = String.raw`[-+]?\d{1,5}(?:\.\d+)?`
const LOC_TEMPLATE_RE = /\{\{\s*loc\s*\|([^{}]*)\}\}/gi
// The trailing guard keeps `2nd floor` from reading as an elevation of 2 (and `-70` as `-7`).
const GROUP_RE = new RegExp(String.raw`(${NUM})\s*,\s*(${NUM})(?:\s*,\s*(${NUM}))?(?![a-z\d])`, 'gi')
/** What may follow a coordinate run. A unit after it makes it a quantity. */
const NOT_A_PLACE = /^\s*(?:%|x\b|pp\b|gp\b|sp\b|cp\b|plat|gold|silver|copper|exp\b|xp\b|seconds?\b|minutes?\b|hours?\b|levels?\b|hp\b)/i
/** A bracket opening right before the run, with an optional `loc` word inside it. */
const BRACKET_BEFORE = /[([]\s*(?:loc(?:ation)?\s*[:=]?\s*)?$/i
/** The words that introduce a place. Matched against the text right before the run. */
const CUE_BEFORE = /(?:\b(?:loc|locs|location|locations|at|is|around|near|roughly)|\/loc|\/way(?:point)?)\s*[:=]?\s*$/i
const MAX_ABS = 20000

const num = (s: string): number => Math.round(Number(s) * 100) / 100

function point(m: RegExpExecArray): Point | null {
  const ns = num(m[1])
  const ew = num(m[2])
  const z = m[3] === undefined ? undefined : num(m[3])
  if (![ns, ew, z ?? 0].every((n) => Number.isFinite(n) && Math.abs(n) <= MAX_ABS)) return null
  return z === undefined ? { ns, ew } : { ns, ew, z }
}

/** `48,000`: an unspaced comma, unsigned both sides, three digits after it. A number, not a place. */
function isThousands(m: RegExpExecArray): boolean {
  return /^\d+,\d{3}(?!\d)/.test(m[0]) && m[3] === undefined
}

/** Every coordinate group in a `{{Loc}}` coordinate parameter, in order. */
function templatePoints(param: string): Point[] {
  const out: Point[] = []
  for (const m of param.matchAll(GROUP_RE)) {
    const p = point(m)
    if (p) out.push(p)
  }
  return out
}

/** `(a, b)` / `(a, b, z)` — how a coordinate reads in a step, signs only where negative. */
export function formatPoint(p: Point): string {
  return `(${[p.ns, p.ew, ...(p.z === undefined ? [] : [p.z])].map(String).join(', ')})`
}

/** The same, without its brackets. */
function bare(p: Point): string {
  return formatPoint(p).slice(1, -1)
}

/** One `{{Loc|Zone|coords|…}}`, parsed. Null when it names no zone or states no coordinate. */
export function parseLocTemplate(inner: string): { zone: string; points: Point[] } | null {
  const parts = inner.split('|').map((s) => s.trim())
  const zone = parts[0] ?? ''
  const points = templatePoints(parts[1] ?? '')
  return zone === '' || points.length === 0 ? null : { zone, points }
}

/** Plain text of a raw line, for the "does the line already say the zone" question only. */
function roughText(raw: string): string {
  return raw
    .replace(LOC_TEMPLATE_RE, ' ')
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .toLowerCase()
}

/** Every link target and label in a raw line, for the same question. */
function linkNames(raw: string): string[] {
  return [...raw.matchAll(/\[\[\s*([^\]|#]+?)\s*(?:\|\s*([^\]]*?)\s*)?\]\]/g)].flatMap((m) => [m[1], m[2] ?? ''])
}

/**
 * The raw line with each `{{Loc}}` RENDERED rather than dropped: `(a, b)`, prefixed with the
 * template's zone unless the line already says it (as text, or as a link to the same map). A
 * template that states no coordinate renders as nothing, which is what it always rendered as.
 */
export function renderLocTemplates(raw: string): string {
  if (!/\{\{\s*loc\s*\|/i.test(raw)) return raw
  const text = roughText(raw)
  const linked = linkNames(raw)
  return raw.replace(LOC_TEMPLATE_RE, (m: string, inner: string, offset: number) => {
    const parsed = parseLocTemplate(inner)
    if (!parsed) return ' '
    // `({{Loc|…}})` is already in brackets: it reads `(a, b)`, never `((a, b))`.
    const wrapped = raw[offset - 1] === '(' && raw[offset + m.length] === ')'
    const coords = parsed.points.map((p) => (wrapped ? bare(p) : formatPoint(p))).join(', ')
    const stem = zoneShortNameFromCatalog(parsed.zone)
    const said =
      text.includes(parsed.zone.toLowerCase()) || (stem !== null && linked.some((n) => zoneShortNameFromCatalog(n) === stem))
    return said ? coords : `${parsed.zone} ${coords}`
  })
}

/** The step's links, page order, item links and namespaced links left out, de-duplicated. */
export function stepLinksOf(raw: string, isItem: (title: string) => boolean): QuestStepLink[] {
  const out: QuestStepLink[] = []
  const seen = new Set<string>()
  for (const m of raw.matchAll(/\[\[\s*([^\]|#<>{}]+?)\s*(?:\|\s*([^\]]*?)\s*)?\]\]/g)) {
    const page = m[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    if (page === '' || /^[a-z ]+:/i.test(page) || isItem(page)) continue
    const label = (m[2] ?? '').replace(/'''?/g, '').replace(/\s+/g, ' ').trim()
    const key = `${page.toLowerCase()}|${label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label === '' || label === page ? { page } : { page, label })
  }
  return out
}

/** Prose coordinates in the step TEXT (shapes 2 and 3), skipping the ranges `taken` already covers. */
function proseLocs(text: string, taken: readonly [number, number][]): QuestStepLoc[] {
  const out: QuestStepLoc[] = []
  for (const m of text.matchAll(GROUP_RE)) {
    const at = m.index
    if (taken.some(([a, b]) => at >= a && at < b)) continue
    const before = text.slice(Math.max(0, at - 24), at)
    const bracketed = BRACKET_BEFORE.test(before)
    if (!bracketed && !CUE_BEFORE.test(before)) continue
    if (isThousands(m) || NOT_A_PLACE.test(text.slice(at + m[0].length))) continue
    const p = point(m)
    if (p) out.push({ ...p, at })
  }
  return out
}

/**
 * The step's coordinates, in text order: the `{{Loc}}` templates of `raw` (zone kept) located in
 * `text` where `renderLocTemplates` put them, then every prose coordinate outside those ranges.
 */
export function stepLocsOf(raw: string, text: string): QuestStepLoc[] {
  const out: QuestStepLoc[] = []
  const taken: [number, number][] = []
  let cursor = 0
  for (const m of raw.matchAll(LOC_TEMPLATE_RE)) {
    const parsed = parseLocTemplate(m[1])
    if (!parsed) continue
    for (const p of parsed.points) {
      // The bracketless form: a template already inside brackets renders without its own.
      const shown = bare(p)
      const at = text.indexOf(shown, cursor)
      if (at < 0) continue // the line was cut at MAX_STEP_CHARS past this point
      taken.push([at, at + shown.length])
      cursor = at + shown.length
      out.push({ ...p, zone: parsed.zone, at })
    }
  }
  out.push(...proseLocs(text, taken))
  return out.sort((a, b) => a.at - b.at)
}
