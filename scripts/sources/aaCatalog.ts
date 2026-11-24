/**
 * eqlwiki `Alternate_Advancement` wikitext → AA catalog entries (scripts/gen-aa-catalog.mts).
 *
 * Pure functions over already-fetched wikitext: no network, no disk (the classWiki.ts split — the
 * `gen-*` entry point owns politeness, caching and output).
 *
 * THE PAGE'S SHAPES, MEASURED on the 2026-11-23 revision:
 *   - four sections: `== General AAs ==`, `== Archetype AAs ==`, `=== <Class> Class AAs ===` (one
 *     per class, under `== Class AAs ==`) and `== Special AAs ==`;
 *   - rows are `| Name || Ranks || Cost || Description` on one line, EXCEPT a few written one cell
 *     per line (Full Potential, Point Blank Fire, Widened Perception) and one whose description runs
 *     onto a second line after a `<br>` (Innate Camouflage) — the tokenizer reads all three;
 *   - costs are `3/6/9` per rank, `?` for an unknown rank, `1 for all ranks`, or a lone `0` on a
 *     multi-rank AA (the Unbound line: granted free at levels 12/30/50);
 *   - requirements live in the description: `Requirements: Level 50, Divine Aura at Level 1.`,
 *     `Level 12/30/50` (per rank), `Requires Critical Affliction rank 1/2/3`;
 *   - the Special table's columns are rank VALUES, not costs (Special AAs are granted by
 *     reincarnation or by achievements, never bought), plus an activated-ability column on the
 *     class rows;
 *   - the race reincarnation rows are titled `Class Reincarnation: Barbarian` on the wiki and
 *     `Race Reincarnation: Barbarian` in the client (dbstr_us.txt ids 26100-26148) — the client's
 *     spelling wins and the wiki's is kept as `wikiName`.
 * Anything the parser cannot read is kept, with the reason in `issues`, never dropped.
 */
import type { AaCatalogEntry, AaGrant, AaPrereq, AaRequirements, AaSection } from '../../src/shared/aaCatalog'
import type { ClassAbbr } from '../../src/shared/classCombo'

const CLASS_ABBR: Record<string, ClassAbbr> = {
  bard: 'BRD',
  beastlord: 'BST',
  berserker: 'BER',
  cleric: 'CLR',
  druid: 'DRU',
  enchanter: 'ENC',
  magician: 'MAG',
  monk: 'MNK',
  necromancer: 'NEC',
  paladin: 'PAL',
  ranger: 'RNG',
  rogue: 'ROG',
  'shadow knight': 'SHD',
  shaman: 'SHM',
  warrior: 'WAR',
  wizard: 'WIZ'
}

/**
 * Wiki spellings the client does not use, each MEASURED against dbstr_us.txt (2026-11-23): the
 * client's name is what the log prints, so it is the name kept. Never fuzzy — a new mismatch shows
 * up in tests/aaCatalogClient.test.mts and is added here by hand, with its evidence.
 */
const WIKI_RENAMES: Record<string, string> = {
  // dbstr 54^1^Unbound Strikethrough (beside the rest of the Unbound line, 50-60).
  'Unbounded Strikethrough': 'Unbound Strikethrough',
  // dbstr 13^1^Warriors Endurance (no apostrophe).
  "Warrior's Endurance": 'Warriors Endurance'
}

export interface AaSectionBlock {
  section: AaSection
  cls?: ClassAbbr
  body: string
}

/** Wiki markup down to display text. `<br>` becomes a space; struck text keeps its words. */
export function cleanText(s: string): string {
  return s
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The page cut into its AA sections, in page order. */
export function aaSections(wt: string): AaSectionBlock[] {
  const heads = [...wt.matchAll(/^(==+)\s*(.+?)\s*\1\s*$/gm)]
  const out: AaSectionBlock[] = []
  heads.forEach((h, i) => {
    const body = wt.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : wt.length)
    const title = h[2].toLowerCase()
    const cls = /^(.+) class aas$/.exec(title)
    if (cls && h[1] === '===') {
      const abbr = CLASS_ABBR[cls[1]] as ClassAbbr | undefined
      if (abbr) out.push({ section: 'class', cls: abbr, body })
    } else if (title === 'general aas') out.push({ section: 'general', body })
    else if (title === 'archetype aas') out.push({ section: 'archetype', body })
    else if (title === 'special aas') out.push({ section: 'special', body })
  })
  return out
}

/**
 * The data rows of a section's table as raw cells. A line starting `|` opens cells (`||` splits
 * several on one line); any other non-header line continues the cell above it.
 */
export function tableRowCells(body: string): string[][] {
  const start = body.indexOf('{|')
  const end = body.indexOf('\n|}')
  if (start < 0) return []
  const table = body.slice(start, end < 0 ? body.length : end)
  const rows: string[][] = []
  for (const chunk of table.split(/\n\|-[^\n]*/).slice(1)) {
    const cells: string[] = []
    for (const line of chunk.split('\n')) {
      if (line.startsWith('|')) cells.push(...line.slice(1).split('||').map((c) => c.replace(/^\|/, '').trim()))
      else if (line.trim() !== '' && !line.startsWith('!') && cells.length > 0) cells[cells.length - 1] += `\n${line.trim()}`
    }
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

/** Per-rank costs from the Cost cell. Unknown ranks are null; every surprise is an issue. */
export function parseCosts(cell: string, ranks: number, issues: string[]): (number | null)[] {
  const text = cleanText(cell)
  const all = /^(\d+) for all ranks$/i.exec(text)
  if (all) return Array.from({ length: ranks }, () => Number(all[1]))
  const parts = text.split('/').map((p) => p.trim())
  if (parts.length === 1 && parts[0] === '0') return Array.from({ length: ranks }, () => 0)
  const costs = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : null))
  if (parts.some((p) => p !== '?' && !/^\d+$/.test(p))) issues.push(`cost not read: "${text}"`)
  if (costs.length !== ranks) issues.push(`cost lists ${String(costs.length)} ranks of ${String(ranks)}: "${text}"`)
  return Array.from({ length: ranks }, (_v, i) => costs[i] ?? null)
}

function numbers(s: string): number[] {
  return s.split('/').map(Number)
}

/** One comma-separated piece of a `Requirements:` clause. */
function readPiece(piece: string, req: AaRequirements): void {
  const level = /^level\s+(\d+(?:\/\d+)*)$/i.exec(piece)
  if (level) {
    const lv = numbers(level[1])
    if (req.levels.length === 0) req.levels = lv
    else if (lv.join('/') !== req.levels.join('/')) req.unparsed.push(piece)
    return
  }
  const pre = /^(.+?)\s+(?:at\s+)?(?:level|rank)\s+(\d+(?:\/\d+)*)$/i.exec(piece)
  if (pre) {
    addPrereq(req, { name: pre[1].trim(), ranks: numbers(pre[2]) })
    return
  }
  const spend = /^must spend (\d+) (?:ability|aa) points?/i.exec(piece)
  if (spend) {
    req.pointsSpent = Number(spend[1])
    return
  }
  req.unparsed.push(piece)
}

function addPrereq(req: AaRequirements, p: AaPrereq): void {
  if (!req.prereqs.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) req.prereqs.push(p)
}

/** Text after `Requirements:` up to the end of its sentence, and what follows it. */
function splitClause(after: string): { clause: string; rest: string } {
  const m = /^(.*?)(?:\.(?:\s|$)|$)/.exec(after)
  const clause = m ? m[1].trim() : after.trim()
  return { clause, rest: after.slice(m ? m[0].length : after.length).trim() }
}

/** Sentences in the prose that also gate ranks. */
function proseGates(text: string, req: AaRequirements, maxRank: number): void {
  for (const m of text.matchAll(/Requires ([A-Z][\w' ]+?) rank (\d+(?:\/\d+)*)/g)) {
    addPrereq(req, { name: m[1].trim(), ranks: numbers(m[2]) })
  }
  for (const m of text.matchAll(/Must spend (\d+) (?:ability|AA) points?/gi)) req.pointsSpent = Number(m[1])
  // `Rank 2 requires level 59` — that rank and every one above it need the stated level.
  for (const m of text.matchAll(/Rank (\d+) requires level (\d+)/gi)) {
    const from = Number(m[1])
    if (req.levels.length === 0 || from > maxRank) continue
    const base = Array.from({ length: maxRank }, (_v, i) => req.levels[Math.min(i, req.levels.length - 1)])
    for (let r = from; r <= maxRank; r++) base[r - 1] = Math.max(base[r - 1], Number(m[2]))
    req.levels = base
  }
}

/** The description split from its requirement clauses, the clauses parsed. */
export function parseRequirements(rawDescription: string, maxRank: number): { description: string; req: AaRequirements } {
  const text = cleanText(rawDescription)
  const parts = text.split(/Requirements:\s*/i)
  const req: AaRequirements = { levels: [], prereqs: [], pointsSpent: null, raw: null, unparsed: [] }
  const prose: string[] = [parts[0].trim()]
  const clauses: string[] = []
  for (const after of parts.slice(1)) {
    const { clause, rest } = splitClause(after)
    clauses.push(clause)
    for (const piece of clause.split(',').map((p) => p.trim())) if (piece !== '') readPiece(piece, req)
    if (rest !== '') prose.push(rest)
  }
  const description = prose.filter((p) => p !== '').join(' ')
  proseGates(description, req, maxRank)
  req.raw = clauses.length > 0 ? clauses.join('; ') : null
  return { description, req }
}

function isRemoved(nameCell: string, desc: string): boolean {
  return /<s>/i.test(nameCell) || /this aa has been removed/i.test(desc)
}

function renamed(wikiName: string): string {
  return WIKI_RENAMES[wikiName] ?? wikiName
}

function parseRanks(cell: string, issues: string[]): number {
  const text = cleanText(cell)
  if (/^\d+$/.test(text)) return Number(text)
  issues.push(`ranks not read: "${text}"`)
  return 1
}

/** A General / Archetype / Class row: Name | Ranks | Cost | Description. */
export function bought(cells: string[], block: AaSectionBlock): AaCatalogEntry | null {
  const wikiName = cleanText(cells[0] ?? '')
  if (wikiName === '') return null
  const name = renamed(wikiName)
  const issues: string[] = []
  if (cells.length !== 4) issues.push(`row has ${String(cells.length)} cells, expected 4`)
  const maxRank = parseRanks(cells[1] ?? '', issues)
  const costs = parseCosts(cells[2] ?? '', maxRank, issues)
  const rawDesc = cells.slice(3).join(' ')
  const { description, req } = parseRequirements(rawDesc, maxRank)
  if (req.unparsed.length > 0) issues.push(`requirement not read: ${req.unparsed.map((u) => `"${u}"`).join(', ')}`)
  const entry: AaCatalogEntry = { name, section: block.section, maxRank, costs, description, req }
  if (name !== wikiName) entry.wikiName = wikiName
  if (block.cls) entry.classes = [block.cls]
  if (isRemoved(cells[0] ?? '', rawDesc)) entry.removed = true
  if (issues.length > 0) entry.issues = issues
  return entry
}

function grantOf(name: string): AaGrant {
  return /^(class |race )?reincarnation:/i.test(name) ? 'reincarnation' : 'achievement'
}

/** The client's name for a Special row: race reincarnations are `Race Reincarnation:` in game. */
function clientName(wikiName: string): string {
  const m = /^Class Reincarnation: (.+)$/.exec(wikiName)
  if (!m || CLASS_ABBR[m[1].toLowerCase()] !== undefined) return wikiName
  return `Race Reincarnation: ${m[1]}`
}

/** A Special row: Name | Rank I | Rank II | Rank III | Description | [activated ability]. */
export function special(cells: string[]): AaCatalogEntry | null {
  const wikiName = cleanText(cells[0] ?? '')
  if (wikiName === '') return null
  const issues: string[] = []
  const rankValues = cells.slice(1, 4).map(cleanText)
  if (cells.length < 5) issues.push(`row has ${String(cells.length)} cells, expected 5 or 6`)
  const garbled = rankValues.filter((v) => /&|rank\s*[ivx]+/i.test(v))
  if (garbled.length > 0) issues.push(`rank values not read: ${garbled.map((g) => `"${g}"`).join(', ')}`)
  const { description, req } = parseRequirements(cells[4] ?? '', rankValues.length)
  const name = clientName(wikiName)
  const entry: AaCatalogEntry = {
    name,
    section: 'special',
    maxRank: rankValues.length,
    costs: [],
    description,
    req,
    granted: grantOf(name),
    rankValues
  }
  if (name !== wikiName) entry.wikiName = wikiName
  const activated = cleanText(cells.slice(5).join(' '))
  if (activated !== '') entry.activated = activated
  if (issues.length > 0) entry.issues = issues
  return entry
}

/** Fold a class AA listed under a second class into the first listing. */
function mergeInto(prev: AaCatalogEntry, next: AaCatalogEntry): void {
  prev.classes = [...new Set([...(prev.classes ?? []), ...(next.classes ?? [])])].sort()
  if (next.description !== prev.description || next.costs.join('/') !== prev.costs.join('/')) {
    const where = (next.classes ?? []).join(',')
    prev.issues = [...(prev.issues ?? []), `also listed under ${where}, which says: "${next.description}" (cost ${next.costs.join('/')})`]
  }
}

/** Every AA on the page, in page order; a class AA two classes list is one entry. */
export function parseAaCatalog(wt: string): AaCatalogEntry[] {
  const out: AaCatalogEntry[] = []
  const byKey = new Map<string, AaCatalogEntry>()
  for (const block of aaSections(wt)) {
    for (const cells of tableRowCells(block.body)) {
      const entry = block.section === 'special' ? special(cells) : bought(cells, block)
      if (!entry) continue
      const key = `${entry.section}|${entry.name.toLowerCase()}`
      const prev = byKey.get(key)
      if (prev && entry.section === 'class') mergeInto(prev, entry)
      else if (prev) prev.issues = [...(prev.issues ?? []), 'listed twice in its section; the first listing is kept']
      else {
        byKey.set(key, entry)
        out.push(entry)
      }
    }
  }
  return out
}
