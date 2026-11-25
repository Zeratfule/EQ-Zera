/**
 * PURE per-page checks for the quest data HEALTH GATE (scripts/questHealth.mts): does a cached
 * quest page say something the parser (./questPage.ts) did not read?
 *
 * WHY. On 2026-11-23 the parser silently lost the walkthroughs of 21 quests — the Nektropos-patch
 * pages use level-1 `= Walkthrough =` headings, `= Summary =` checklists and a "Starts In" label,
 * and none of the three was read — and the refresh shipped the thinner file without a word. These
 * checks look at the WIKITEXT with their own, deliberately looser eyes, and ask the parser whether
 * it agreed. Where the parser's own regex is the thing being checked, the check never uses it to
 * look (a parser that stops seeing `= X =` must not blind the check that looks for `= X =`).
 *
 * THE FOUR RULES (a finding names its rule; the allowlist is keyed by page + rule):
 *   - `unparsed-heading`  a line that is plainly a heading (`= Text =`, any depth, anything after)
 *                          that the parser's heading regex refuses. `== Checklist =={{CheckboxList}}`
 *                          on Harvester Quest is the live example.
 *   - `unread-step-heading` a heading whose words say steps (Checklist, Quick List, Summary,
 *                          Walkthrough, Steps) that is neither one of the parser's step headings nor
 *                          inside one, with content under it.
 *   - `unread-list`        the parser found NO steps, yet the page has a bullet list outside its
 *                          reward/notes/related sections.
 *   - `unknown-label`      a questTopTable label the parser neither reads nor deliberately skips.
 */
import { HEADING_RE, STEP_HEADINGS, TOP_TABLE_LABELS, topTableLabels } from './questPage'

export type PageRule = 'unparsed-heading' | 'unread-step-heading' | 'unread-list' | 'unknown-label'

export interface PageFinding {
  page: string
  rule: PageRule
  /** what was seen: the heading, the label, the line */
  detail: string
}

/**
 * Labels the parser deliberately does NOT read, each because the catalog has no field for it (yet).
 * Measured over the 940 cached pages, 2026-11-25. A label that is not here and is not read is a
 * finding — that is how "Starts In" would have been caught.
 */
export const SKIPPED_LABELS: readonly RegExp[] = [
  /faction/, // "Required Faction" (60), "Minimum Faction", "Faction", "Faction Needed", "Primary Faction", "Factions Raised"
  /^deity$/,
  /^races$/,
  /^repeatable$/,
  /^related quests$/
]

/**
 * What the PARSER reads, as the checks see it: its heading regex, its step headings, the label words
 * its top-table reader takes. The real parser's by default; a test hands in an older parser's view
 * to prove the gate would have caught it (tests/questHealth.test.mts replays 2026-11-23's).
 */
export interface ParserView {
  heading: RegExp
  stepHeadings: readonly RegExp[]
  labels: readonly string[]
}

export const PARSER: ParserView = {
  heading: HEADING_RE,
  stepHeadings: STEP_HEADINGS,
  labels: Object.values(TOP_TABLE_LABELS).flat()
}

/** A heading to a loose eye: `=` run, text, `=` run — whatever follows on the line. */
const LOOSE_HEADING = /^\s*(=+)\s*([^=\s][^=]*?)\s*=+/
/** Words that say "the steps are here". Independent of the parser's own STEP_HEADINGS on purpose. */
const STEP_WORDS = /\b(?:checklists?|quick ?list|summary|walkthroughs?|steps?)\b/i
/** Sections that never hold steps, for the "no steps but a list" check. */
const NOT_STEP_SECTION = /\brewards?\b|^notes?$|^related\b|^see also$|^external links?$|^references$|^trivia$|^faction/i
const LIST_LINE = /^\s*[*#]+\s*\S/

function withoutNoise(wikitext: string): string {
  return wikitext
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\|[^\n]*questTopTable[^\n]*\n[\s\S]*?\n\|\}/i, '\n')
}

interface Heading {
  depth: number
  /** the heading's words, a trailing ":" dropped */
  text: string
  /** line index */
  at: number
  /** the parser's heading regex reads this line as a heading */
  seen: boolean
}

function looseHeadings(lines: readonly string[], parser: ParserView): Heading[] {
  const out: Heading[] = []
  lines.forEach((line, at) => {
    const m = LOOSE_HEADING.exec(line)
    if (m) out.push({ depth: m[1].length, text: m[2].trim().replace(/:\s*$/, ''), at, seen: parser.heading.test(line) })
  })
  return out
}

/** The lines under heading `i`, up to the next heading at any depth. */
function ownLines(lines: readonly string[], heads: readonly Heading[], i: number): string[] {
  const end = heads[i + 1]?.at ?? lines.length
  return lines.slice(heads[i].at + 1, end).filter((l) => l.trim() !== '')
}

/** A heading the parser both SEES and takes for a step section. */
const readsAsSteps = (h: Heading, parser: ParserView): boolean => h.seen && parser.stepHeadings.some((re) => re.test(h.text))

/** Is heading `i` inside (a descendant of) a heading the parser reads as a step section? */
function underStepHeading(heads: readonly Heading[], i: number, parser: ParserView): boolean {
  let depth = heads[i].depth
  for (let j = i - 1; j >= 0; j--) {
    if (heads[j].depth >= depth) continue
    if (readsAsSteps(heads[j], parser)) return true
    depth = heads[j].depth
  }
  return false
}

/**
 * `unparsed-heading` for every heading the parser cannot see; `unread-step-heading` for a step-worded
 * one it does not read — only on a page where it reads SOME step section, because a page with none
 * gets every section as its steps (questPage.ts `extractStepLines`, the fallback), this one included.
 */
function headingFindings(page: string, lines: readonly string[], heads: readonly Heading[], parser: ParserView): PageFinding[] {
  const out: PageFinding[] = []
  const hasStepSection = heads.some((h) => readsAsSteps(h, parser))
  heads.forEach((h, i) => {
    if (!h.seen) out.push({ page, rule: 'unparsed-heading', detail: lines[h.at].trim().slice(0, 120) })
    if (!hasStepSection || !STEP_WORDS.test(h.text) || readsAsSteps(h, parser) || underStepHeading(heads, i, parser)) return
    if (ownLines(lines, heads, i).length > 0) out.push({ page, rule: 'unread-step-heading', detail: h.text })
  })
  return out
}

/** No steps parsed: is there a bullet list the parser should have read? */
function listFinding(page: string, lines: readonly string[], heads: readonly Heading[]): PageFinding | null {
  const lead = lines.slice(0, heads[0]?.at ?? lines.length)
  const sections = heads.flatMap((h, i) => (NOT_STEP_SECTION.test(h.text) ? [] : [ownLines(lines, heads, i)]))
  const list = [lead, ...sections].flat().filter((l) => LIST_LINE.test(l))
  if (list.length < 2) return null
  return { page, rule: 'unread-list', detail: `${String(list.length)} list lines, first: ${list[0].trim().slice(0, 100)}` }
}

function labelFindings(page: string, wikitext: string, parser: ParserView): PageFinding[] {
  return topTableLabels(wikitext)
    .filter((label) => !parser.labels.some((w) => label.includes(w)) && !SKIPPED_LABELS.some((re) => re.test(label)))
    .map((label) => ({ page, rule: 'unknown-label' as const, detail: label }))
}

/** Every finding for one cached page. `stepCount` is what the parser extracted from it. */
export function auditQuestPage(page: string, wikitext: string, stepCount: number, parser: ParserView = PARSER): PageFinding[] {
  const lines = withoutNoise(wikitext).split('\n')
  const heads = looseHeadings(lines, parser)
  const out = [...headingFindings(page, lines, heads, parser), ...labelFindings(page, wikitext, parser)]
  if (stepCount === 0) {
    const f = listFinding(page, lines, heads)
    if (f) out.push(f)
  }
  return out
}
