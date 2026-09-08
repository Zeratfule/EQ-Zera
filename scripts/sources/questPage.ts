/**
 * PURE quest-page wikitext parser (no network) — the parsing half of
 * `scripts/scrape-quests.ts`. Kept in its own module so it can be unit-tested against
 * verbatim wikitext excerpts (tests/questPageParse.test.mts) without hitting the wiki.
 *
 * Shape of an eqlwiki quest page (probed 2026-08-02 against the live wiki):
 *
 *   {{Classic Era}}
 *   [[File:npc_beur_tenlah.png|frame|Beur Tenlah]]
 *   {| class="questTopTable"
 *   ! ''' Start Zone: '''
 *   | [[Freeport|East Freeport]]
 *   |-
 *   ! ''' Quest Giver: '''
 *   | [[Beur Tenlah]]
 *   |-  … Minimum Level / Classes / Related Zones / Related NPCs
 *   |}
 *
 *   == Reward ==
 *   <ul><li>  {{:Used Merchants Gloves}}   ← a `{{:Name}}` transclusion IS an item box
 *   </li></ul>
 *
 *   == Walkthrough ==
 *   …'''Bring him some [[Dwarven Ale]].'''…   ← turn-in items live in the prose
 *   {{YouGainExperience}}                     ← (or {{exp}}) exp reward marker
 *
 * The Walkthrough's links are a mix of items, NPCs and zones, so the caller supplies an
 * `isItem(title)` predicate (built from the wiki's item-page title set) — that filter is
 * what turns prose links into a trustworthy required-item list.
 */

/** The `{| class="questTopTable"` header block, verbatim label → value cells. */
export interface QuestTopTable {
  startZone?: string
  giver?: string
  minLevel?: number
  /** raw "Minimum Level" cell when it carries prose ("15 (lowest guard is 30)") */
  minLevelText?: string
  classes: string[]
  relatedZones: string[]
  relatedNpcs: string[]
}

export interface ParsedQuestPage extends QuestTopTable {
  /** wiki page title (also the quest's display name) */
  page: string
  /** reward item names (transclusion boxes + item links inside the Reward section) */
  rewards: string[]
  /** item names referenced by the page body (turn-ins/collectibles), minus rewards */
  requiredItems: string[]
  /** page carries a {{YouGainExperience}} / {{exp}} marker */
  expReward: boolean
  /** the quest's steps, one plain-text line each (see `extractSteps`) */
  steps: string[]
  /** true when the page is a disambiguation hub, not a quest */
  disambiguation: boolean
  /** true when the page has a questTopTable header block */
  hasTopTable: boolean
}

const TOP_TABLE_RE = /\{\|[^\n]*questTopTable[^\n]*\n([\s\S]*?)\n\|\}/i
const NAMESPACED = /^(file|image|category|template|help|user|special|talk|media|mediawiki)\s*:/i

/** [[Page|Label]] → Label, [[Page]] → Page, then drop templates/html/quotes. */
export function stripMarkup(v: string): string {
  return v
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every `[[Target]]` / `[[Target|Label]]` TARGET in `text` (namespaced links skipped). */
export function linkTargets(text: string): string[] {
  const out: string[] = []
  const re = /\[\[\s*([^\]|#<>{}]+?)\s*(?:\|[^\]]*)?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim()
    if (!t || NAMESPACED.test(t)) continue
    out.push(t)
  }
  return out
}

/** Every `{{:Page}}` main-namespace transclusion target — on quest pages these are item boxes. */
export function transclusionTargets(text: string): string[] {
  const out: string[] = []
  const re = /\{\{:\s*([^}|\n]+?)\s*(?:\|[^}]*)?\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const t = m[1].trim()
    if (t && !NAMESPACED.test(t)) out.push(t)
  }
  return out
}

/** Case-insensitive de-dupe that keeps first-seen order and spelling. */
export function dedupe(names: Iterable<string>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const k = n.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(n.replace(/\s+/g, ' ').trim())
  }
  return out
}

/** Split a table cell into names: prefer link labels, else comma-separated plain text. */
function cellList(raw: string): string[] {
  const links = [...raw.matchAll(/\[\[\s*([^\]|#]+?)\s*(?:\|\s*([^\]]*?)\s*)?\]\]/g)].map((m) =>
    (m[2] || m[1]).trim()
  )
  const parts = links.length
    ? links
    : stripMarkup(raw)
        .split(/,|\band\b/)
        .map((s) => s.trim())
  return dedupe(parts.filter((s) => s && !/^none$/i.test(s) && !/^n\/?a$/i.test(s)))
}

function cellText(raw: string): string | undefined {
  const s = stripMarkup(raw)
  if (!s || /^none$/i.test(s) || /^n\/?a$/i.test(s)) return undefined
  return s
}

/**
 * Parse the `questTopTable` header block into its labelled fields. Rows are
 * `! ''' Label: '''` followed by `| value` lines (a value may span several lines).
 * Returns null when the page has no such table.
 */
/**
 * The table body's `! ''' Label: '''` / `| value` rows, as lowercased label → value. A label
 * that repeats within one row joins its values with ", "; `|-` (a new row) clears the label,
 * so a stray value line can never attach to the previous row's label.
 */
function topTableFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {}
  let label: string | null = null
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('|-')) {
      label = null
      continue
    }
    if (line.startsWith('!')) {
      const key = stripMarkup(line.replace(/^!+/, ''))
        .replace(/:\s*$/, '')
        .trim()
        .toLowerCase()
      label = key || null
      continue
    }
    if (line.startsWith('|') && label) {
      const val = line.replace(/^\|+/, '').trim()
      fields[label] = fields[label] ? `${fields[label]}, ${val}` : val
    }
  }
  return fields
}

export function parseTopTable(wikitext: string): QuestTopTable | null {
  const m = TOP_TABLE_RE.exec(wikitext)
  if (!m) return null
  const fields = topTableFields(m[1])

  /** First field whose label CONTAINS one of `wants`, in the order given; '' when none. */
  const pick = (...wants: string[]): string => {
    for (const want of wants) {
      for (const [k, v] of Object.entries(fields)) if (k.includes(want)) return v
    }
    return ''
  }
  const minText = cellText(pick('minimum level', 'min level', 'level'))
  const minNum = minText ? Number(/(\d+)/.exec(minText)?.[1]) : NaN

  return {
    startZone: cellText(pick('start zone')),
    giver: cellText(pick('quest giver', 'giver')),
    minLevel: Number.isFinite(minNum) ? minNum : undefined,
    minLevelText: minText && !/^\d+$/.test(minText) ? minText : undefined,
    classes: cellList(pick('classes')),
    relatedZones: cellList(pick('related zones')),
    relatedNpcs: cellList(pick('related npcs', 'related npc'))
  }
}

export interface WikiSection {
  heading: string
  text: string
}

/** Split wikitext into its lead and `== Heading ==` sections (any depth). */
export function splitSections(wikitext: string): { lead: string; sections: WikiSection[] } {
  const lines = wikitext.split('\n')
  const sections: WikiSection[] = []
  const lead: string[] = []
  let cur: WikiSection | null = null
  for (const line of lines) {
    const h = /^\s*={2,6}\s*(.+?)\s*={2,6}\s*$/.exec(line)
    if (h) {
      cur = { heading: h[1].trim(), text: '' }
      sections.push(cur)
      continue
    }
    if (cur) cur.text += line + '\n'
    else lead.push(line)
  }
  return { lead: lead.join('\n'), sections }
}

const REWARD_HEADING = /^rewards?\b/i
const EXP_MARKER = /\{\{\s*(yougainexperience|exp)\s*\}\}|you gain experience/i

// ---- steps -----------------------------------------------------------------------------------

/**
 * The headings a quest's steps live under, MOST CONDENSED FIRST. Measured over the 928 committed
 * pages (2026-09-06): 1 Quick List, 120 Checklist, 13 Short Walkthrough, 848 Walkthrough. The
 * first three are bullet lists a player can follow; a Walkthrough is prose with the NPC dialogue
 * pasted in, so it is the fallback and gets the dialogue stripped.
 */
const STEP_HEADINGS: RegExp[] = [
  /quick list$/i,
  /checklist$/i, // "Checklist", "High-level Checklist"
  /^short walkthrough$/i,
  /^walkthrough$/i,
  /walkthrough/i // "Walkthrough with Dialogue", "Long Walkthrough with Dialogue"
]
/**
 * Pages with NONE of those (40 of 928: "Obtaining the Orders" / "The War" / "Turn-In for the
 * 10th Ring" on the Coldain ring pages, route names on the Bard Mail page) get every section
 * that is not one of these — the sections that are never steps on any page.
 */
const NOT_STEPS = /rewards?$|^notes?$|^related\b|^see also$|^dialogue$|^exp gain$|^references$|^external links?$|^guides?$|^videos?$/i

/** Wiki table syntax, in a section that is supposed to be a list. */
const TABLE_LINE = /^\s*(\{\||\|\}|\|-|\||!)/
/** `:Vurgo says, '…'` (indented reply) or `Fajio says: …` — an NPC talking, not a step. */
const NPC_DIALOGUE = /^\s*:|^[A-Z][\w'`. -]{0,40}\bsays?\b\s*:?\s*['"]/
/** The faction and exp lines the wiki pastes after every turn-in. */
const SIDE_EFFECT = /^\s*\*?\s*your faction standing with\b|you gain experience/i
const MAX_STEPS = 60
const MAX_STEP_CHARS = 600

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&lt;': '<', '&gt;': '>' }

/** A wikitext line → the plain step a player reads, or null when the line is not a step. */
function stepText(rawLine: string): string | null {
  if (!rawLine.trim() || TABLE_LINE.test(rawLine) || NPC_DIALOGUE.test(rawLine) || SIDE_EFFECT.test(rawLine)) return null
  if (/^\s*\[\[\s*(category|file|image)\s*:/i.test(rawLine)) return null
  const text = stripMarkup(
    rawLine
      .replace(/^\s*[*#;:]+\s*/, '') // bullet / numbering
      .replace(/\{\{:\s*([^}|\n]+?)\s*(?:\|[^}]*)?\}\}/g, '$1') // an item box IS the item's name
  ).replace(/&[#\w]+;/g, (e) => ENTITIES[e] ?? ' ')
  const clean = text.replace(/\s+/g, ' ').trim()
  // A fragment of a multi-line template (`{{Itempage` on an item page filed under Quests) is
  // markup, not a step — stripMarkup only removes templates that close on the same line.
  if (clean.length < 3 || /\{\{|\}\}|\[\[|\]\]/.test(clean)) return null
  return clean.length > MAX_STEP_CHARS ? `${clean.slice(0, MAX_STEP_CHARS - 1).trimEnd()}…` : clean
}

/**
 * The wikitext under `heading` (any level), INCLUDING its sub-sections — a Walkthrough split
 * into `=== Quest Stage 1: ===` blocks is one walkthrough — up to the next heading at the same
 * level or shallower. Sub-headings come through as their own lines so the list keeps its shape.
 */
function sectionWithChildren(wikitext: string, heading: RegExp): string | null {
  let level = 0
  const out: string[] = []
  for (const line of wikitext.split('\n')) {
    const h = /^\s*(={2,6})\s*(.+?)\s*={2,6}\s*$/.exec(line)
    if (!h) {
      if (level > 0) out.push(line)
      continue
    }
    const depth = h[1].length
    const text = h[2].trim()
    if (level === 0) {
      if (heading.test(text)) level = depth
      continue
    }
    if (depth <= level) break
    out.push(`${text.replace(/:\s*$/, '')}:`)
  }
  return level === 0 ? null : out.join('\n')
}

/**
 * The quest's steps: the first of `STEP_HEADINGS` that yields anything, as plain-text lines.
 * Comments, `<div class='facblock'>` blocks and `<ref>`s go first, since they span lines.
 */
export function extractSteps(wikitext: string): string[] {
  const body = wikitext
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div[^>]*facblock[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  const toSteps = (section: string): string[] => {
    const steps: string[] = []
    for (const line of section.split('\n')) {
      const s = stepText(line)
      if (s !== null && s !== steps[steps.length - 1]) steps.push(s)
    }
    // A sub-heading with nothing under it says nothing.
    while (steps.length > 0 && steps[steps.length - 1].endsWith(':')) steps.pop()
    return steps.slice(0, MAX_STEPS)
  }
  let sawHeading = false
  for (const heading of STEP_HEADINGS) {
    const section = sectionWithChildren(body, heading)
    if (section === null) continue
    sawHeading = true
    const steps = toSteps(section)
    if (steps.length > 0) return steps
  }
  if (sawHeading) return []
  // No step heading at all: every section that is not a known non-step section, in page order.
  // A page with no headings (an item page filed under Category:Quests) yields nothing.
  const { sections } = splitSections(body)
  const rest = sections.filter((s) => !NOT_STEPS.test(s.heading)).map((s) => `${s.heading.replace(/:\s*$/, '')}:\n${s.text}`)
  return rest.length === 0 ? [] : toSteps(rest.join('\n'))
}

/**
 * Parse one quest page. `isItem(title)` decides whether a prose link names an item page
 * (built from the wiki's item-title set); without it every link would be kept, dragging
 * in NPCs and zones.
 */
export function parseQuestPage(
  page: string,
  wikitext: string,
  isItem: (title: string) => boolean = () => false
): ParsedQuestPage {
  const top = parseTopTable(wikitext)
  const withoutTable = wikitext.replace(TOP_TABLE_RE, '\n')
  const { lead, sections } = splitSections(withoutTable)

  const rewardText = sections
    .filter((s) => REWARD_HEADING.test(s.heading))
    .map((s) => s.text)
    .join('\n')
  const bodyText = [lead, ...sections.filter((s) => !REWARD_HEADING.test(s.heading)).map((s) => s.text)].join('\n')

  // Rewards: a `{{:Name}}` box is always an item; a plain link only counts when the
  // title is a known item page (Reward sections also link factions, zones and coin).
  const rewards = dedupe([
    ...transclusionTargets(rewardText),
    ...linkTargets(rewardText).filter(isItem)
  ])
  const rewardKeys = new Set(rewards.map((r) => r.toLowerCase()))

  // Required/turn-in items: item references anywhere OUTSIDE the Reward section. Unlike the
  // Reward section (which only ever holds item boxes), the body transcludes mob/zone boxes
  // too, so BOTH links and transclusions go through the item filter here.
  const requiredItems = dedupe([
    ...transclusionTargets(bodyText).filter(isItem),
    ...linkTargets(bodyText).filter(isItem)
  ]).filter((n) => !rewardKeys.has(n.toLowerCase()))

  return {
    page,
    startZone: top?.startZone,
    giver: top?.giver,
    minLevel: top?.minLevel,
    minLevelText: top?.minLevelText,
    classes: top?.classes ?? [],
    relatedZones: top?.relatedZones ?? [],
    relatedNpcs: top?.relatedNpcs ?? [],
    rewards,
    requiredItems,
    expReward: EXP_MARKER.test(wikitext),
    steps: extractSteps(withoutTable),
    disambiguation: /\{\{\s*disambig/i.test(wikitext),
    hasTopTable: top !== null
  }
}

/** A parse is "empty" when it yielded nothing worth committing (logged, never dropped silently). */
export function isEmptyParse(q: ParsedQuestPage): boolean {
  return (
    !q.hasTopTable &&
    q.rewards.length === 0 &&
    q.requiredItems.length === 0 &&
    !q.giver &&
    !q.startZone
  )
}
