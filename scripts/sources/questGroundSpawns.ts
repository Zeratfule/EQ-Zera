/**
 * PURE ground-spawn tables for the quest scraper: the items a walkthrough says to PICK UP OFF THE
 * GROUND, with the coordinates its table states (`QuestEntry.groundSpawns`, schema in
 * src/shared/questTypes.ts). No network; unit-tested in tests/questGroundSpawns.test.mts against
 * the committed wikitext cache.
 *
 * WHY A TABLE PARSER. The step extractor drops every table line (a table is not a step), and the
 * walkthroughs that list ground spawns list them in tables: "The Tragic Tale of House Everling"
 * (cache page-72870) gives its four harpsichord pieces as `Item || Ground-spawn location || Area`,
 * "Tarton's Wheel" (page-15322) its ten rods as `Rod | Zone | Location | Description`. Those
 * coordinates were lost.
 *
 * WHAT A GROUND-SPAWN TABLE IS, MEASURED over the 940 committed pages (2026-11-25): 37 pages carry
 * a table other than the questTopTable, 8 of them with a coordinate-shaped cell, and only these
 * two are ground spawns. The others are NOT, and each rule below exists because of one of them:
 *
 *   - an ITEM column — the header says Item / Rod / Object / Piece / Component. "Sister || Recorded
 *     location" (The Betrayer: NPCs) and "Route || Starting NPC || …" (Going Postal) have none.
 *   - a COORDINATE column — the header says Loc / Location / Coordinates, and the cell states a
 *     point: a `{{Loc}}`, a bracketed `(a, b)`, or the bare `a, b` that is the whole cell.
 *   - no DROPPER column — "Item || Who || Where" (the four Plane of Sky tests) names the mob that
 *     drops each item; its "Islands 1.5, 4, 8" is not a coordinate anyway, and the rule above
 *     already refuses it.
 *   - GROUND-SPAWN EVIDENCE — a header saying "ground" / "spawn", or the section's own words before
 *     the table saying ground spawn / ground item / picked up. A table of items with coordinates
 *     that never says they are on the ground could be anything (a vendor list, a camp list), so it
 *     is left alone: a missed spawn shows nothing, a misread one sends a player to the wrong spot.
 *
 * AND ONE OBJECT. In a ground-spawn table's own section, a line that says to COMBINE the pieces
 * "in the <object> at (a, b)" locates the object the pieces go into (page-72870: "Combine the four
 * components in the ruined harpsichord at (368, 65)"). Kept as `kind: 'object'`. Nothing else in
 * prose is read here: the step list already carries prose coordinates.
 *
 * FACTS, NOT VERDICTS (the questTypes.ts rule). A row keeps the zone ITS table states, verbatim, and
 * the words around it; which map it is on is decided at read time by the same resolver the steps
 * use (src/shared/questGroundSpawns.ts).
 */
import type { QuestGroundSpawn, QuestStepLink } from '../../src/shared/questTypes'
import { HEADING_RE, stripMarkup } from './questPage'
import { parseLocTemplate, renderLocTemplates, stepLinksOf, stepLocsOf } from './questStepRefs'

/** One table cell: its raw wikitext, and whether it was a `!` header cell. */
interface Cell {
  raw: string
  head: boolean
}

interface Table {
  /** the header row's cells, plain and lowercased */
  header: string[]
  rows: Cell[][]
  /** the section's heading and prose BEFORE this table, plain */
  context: string
  /** char offset of the table's closing `|}` line */
  end: number
}

const PIPE = '\u0001'
/** `width="60" style="…" |` — the cell's attributes, before the content. */
const CELL_ATTRS = /^\s*(?:[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'|\S+)\s*)+\|(?!\|)/
const ITEM_HEADER = /^(?:items?|objects?|rods?|pieces?|components?|parts?|ground[- ]?spawns?)$/
const LOC_HEADER = /\b(?:loc|locs|location|locations|coords?|coordinates)\b/
const ZONE_HEADER = /^zones?$/
const DROPPER_HEADER = /^(?:who|dropped by|drops? from|drops?|mobs?|npcs?|sources?|vendors?|merchants?)$/
const GROUND_HEADER = /\bground\b|\bspawn/
const GROUND_WORDS = /\bground[- ]?(?:spawn|item)s?\b|\bgroundspawns?\b|\bpicked up\b/i
const COMBINE_AT = /\bcombine\b[^.]*?\b(?:in|into|inside)\s+(?:the\s+)?([a-z][\w' -]{2,40}?)\s+at\s+\(\s*([-+]?\d{1,5}(?:\.\d+)?)\s*,\s*([-+]?\d{1,5}(?:\.\d+)?)(?:\s*,\s*([-+]?\d{1,5}(?:\.\d+)?))?\s*\)/i
const BARE_POINT = /^\s*\(?\s*([-+]?\d{1,5}(?:\.\d+)?)\s*,\s*([-+]?\d{1,5}(?:\.\d+)?)(?:\s*,\s*([-+]?\d{1,5}(?:\.\d+)?))?\s*\)?\s*$/
const MAX_ABS = 20000
const MAX_CONTEXT = 400
const MAX_NOTE = 400

const num = (s: string): number => Math.round(Number(s) * 100) / 100

/** Pipes inside `{{…}}` and `[[…]]` are not cell separators: hide them while splitting. */
function protectPipes(line: string): string {
  let depth = 0
  let out = ''
  for (let i = 0; i < line.length; i++) {
    const two = line.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      out += two
      i++
    } else if ((two === '}}' || two === ']]') && depth > 0) {
      depth--
      out += two
      i++
    } else out += line[i] === '|' && depth > 0 ? PIPE : line[i]
  }
  return out
}

const restore = (s: string): string => s.replaceAll(PIPE, '|')

/** A cell's content without its `attr="…" |` prefix. */
const content = (raw: string): string => restore(raw.replace(CELL_ATTRS, '')).trim()

/** Plain words, a `{{Loc}}` rendered as its point rather than dropped (questStepRefs.ts). */
const plain = (raw: string): string => stripMarkup(renderLocTemplates(restore(raw))).replace(/&nbsp;/g, ' ').trim()

/** The cells one `|` / `!` line opens, split on `||` / `!!`. */
function lineCells(line: string): Cell[] {
  const head = line.startsWith('!')
  const body = protectPipes(line.slice(1))
  return body.split(head ? /!!|\|\|/ : /\|\|/).map((c) => ({ raw: content(c), head }))
}

/** One `{| … |}` body into rows of cells (a `|-` starts a row; continuation lines join the last cell). */
function tableRows(lines: readonly string[]): Cell[][] {
  const rows: Cell[][] = []
  let row: Cell[] = []
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('|-')) {
      if (row.length > 0) rows.push(row)
      row = []
    } else if (t.startsWith('|+')) continue
    else if (t.startsWith('|') || t.startsWith('!')) row.push(...lineCells(t))
    else if (row.length > 0 && t !== '') row[row.length - 1].raw += ` ${t}`
  }
  if (row.length > 0) rows.push(row)
  return rows
}

/** Every non-header table on the page, with the section prose that precedes it. */
function pageTables(wikitext: string): Table[] {
  const out: Table[] = []
  let context: string[] = []
  let inTable: string[] | null = null
  /** inside the questTopTable: skipped whole — it is the page's header block, not a table of things */
  let skipping = false
  let offset = 0
  for (const line of wikitext.split('\n')) {
    const at = offset
    offset += line.length + 1
    const closes = /^\s*\|\}/.test(line)
    if (skipping) {
      skipping = !closes
      continue
    }
    if (inTable !== null) {
      if (closes) {
        out.push(toTable(inTable, context, at))
        inTable = null
      } else inTable.push(line)
      continue
    }
    const h = HEADING_RE.exec(line)
    if (h) context = [`${h[2].trim()}:`]
    else if (/^\s*\{\|/.test(line)) {
      if (/questTopTable/i.test(line)) skipping = true
      else inTable = []
    } else if (line.trim() !== '') context.push(plain(line))
  }
  return out
}

function toTable(lines: readonly string[], context: readonly string[], end: number): Table {
  const rows = tableRows(lines)
  const headRow = rows.find((r) => r.every((c) => c.head))
  return {
    header: (headRow ?? []).map((c) => plain(c.raw).toLowerCase()),
    rows: rows.filter((r) => r !== headRow),
    context: context.join(' ').replace(/\s+/g, ' ').trim(),
    end
  }
}

/** Which column holds what. Null when the table is not a ground-spawn table. */
function columns(t: Table): Columns | null {
  const item = t.header.findIndex((h) => ITEM_HEADER.test(h))
  const loc = t.header.findIndex((h) => LOC_HEADER.test(h))
  if (item < 0 || loc < 0 || item === loc) return null
  if (t.header.some((h) => DROPPER_HEADER.test(h))) return null
  const evidence = t.header.some((h) => GROUND_HEADER.test(h)) || GROUND_WORDS.test(t.context)
  if (!evidence) return null
  return { item, loc, zone: t.header.findIndex((h) => ZONE_HEADER.test(h)) }
}

interface Point {
  ns: number
  ew: number
  z?: number
}

function okPoint(ns: number, ew: number, z: number | undefined): Point | null {
  if (![ns, ew, z ?? 0].every((n) => Number.isFinite(n) && Math.abs(n) <= MAX_ABS)) return null
  return z === undefined ? { ns, ew } : { ns, ew, z }
}

/** The points a coordinate cell states, and the zone its `{{Loc}}` names. */
function cellPoints(raw: string): { points: Point[]; zone?: string } {
  const tpl = /\{\{\s*loc\s*\|([^{}]*)\}\}/i.exec(raw)
  const parsed = tpl ? parseLocTemplate(tpl[1]) : null
  if (parsed) return { points: parsed.points, zone: parsed.zone }
  const text = plain(raw)
  const prose = stepLocsOf(text, text).map((l) => okPoint(l.ns, l.ew, l.z))
  if (prose.length > 0) return { points: prose.filter((p): p is Point => p !== null) }
  const m = BARE_POINT.exec(text)
  const p = m ? okPoint(num(m[1]), num(m[2]), m[3] === undefined ? undefined : num(m[3])) : null
  return { points: p ? [p] : [] }
}

/** The item a cell names: its first link's target, else its words. */
function itemName(raw: string): string {
  const link = /\[\[\s*([^\]|#]+?)\s*(?:\|[^\]]*)?\]\]/.exec(raw)
  const name = link && !/^[a-z ]+:/i.test(link[1]) ? link[1] : plain(raw)
  return name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** The row's other cells as one plain note; a bare Yes/No reads with its header. */
function rowNote(row: readonly Cell[], header: readonly string[], skip: ReadonlySet<number>): string {
  const parts: string[] = []
  row.forEach((c, i) => {
    if (skip.has(i)) return
    const v = plain(c.raw)
    if (v === '') return
    parts.push(/^(?:yes|no)$/i.test(v) && header[i] ? `${header[i].replace(/^./, (x) => x.toUpperCase())}: ${v}` : v)
  })
  return cap(parts.join('; '), MAX_NOTE)
}

interface Columns {
  item: number
  loc: number
  /** -1 when the table has no Zone column */
  zone: number
}

/** One row's spawns: one per point its coordinate cell states (none when it states none). */
function rowSpawns(row: readonly Cell[], t: Table, cols: Columns, isItem: (title: string) => boolean): QuestGroundSpawn[] {
  const itemCell = row[cols.item] as Cell | undefined
  const locCell = row[cols.loc] as Cell | undefined
  if (!itemCell || !locCell) return []
  const item = itemName(itemCell.raw)
  const { points, zone: tplZone } = cellPoints(locCell.raw)
  if (item === '' || points.length === 0) return []
  const zoneCell = cols.zone >= 0 ? plain(row[cols.zone]?.raw ?? '') : ''
  const zone = tplZone ?? (zoneCell === '' ? undefined : zoneCell)
  const note = rowNote(row, t.header, new Set([cols.item, cols.loc, cols.zone]))
  const links: QuestStepLink[] = row.flatMap((c, i) => (i === cols.item ? [] : stepLinksOf(c.raw, isItem)))
  return points.map((p) => {
    const s: QuestGroundSpawn = { item, ...p }
    if (zone !== undefined) s.zone = zone
    if (note !== '') s.note = note
    if (links.length > 0) s.links = links
    if (t.context !== '') s.context = cap(t.context, MAX_CONTEXT)
    return s
  })
}

function spawnsOf(t: Table, cols: Columns, isItem: (title: string) => boolean): QuestGroundSpawn[] {
  return t.rows.flatMap((row) => rowSpawns(row, t, cols, isItem))
}

/** The object a "combine … in the X at (a, b)" line in the section after the table locates. */
function combineObjects(wikitext: string, tableAt: number, context: string): QuestGroundSpawn[] {
  const out: QuestGroundSpawn[] = []
  const after = wikitext.slice(tableAt).split('\n')
  for (const line of after.slice(1)) {
    if (HEADING_RE.test(line)) break
    const text = plain(line)
    const m = COMBINE_AT.exec(text)
    if (!m) continue
    const p = okPoint(num(m[2]), num(m[3]), m[4] === undefined ? undefined : num(m[4]))
    if (!p) continue
    const s: QuestGroundSpawn = { item: m[1].trim(), ...p, kind: 'object', note: cap(text, MAX_NOTE) }
    if (context !== '') s.context = cap(context, MAX_CONTEXT)
    out.push(s)
  }
  return out
}

/** Every ground spawn the page's tables locate, page order, then the objects their sections locate. */
export function groundSpawnsOf(wikitext: string, isItem: (title: string) => boolean = () => false): QuestGroundSpawn[] {
  const body = wikitext.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
  const out: QuestGroundSpawn[] = []
  for (const t of pageTables(body)) {
    const cols = columns(t)
    if (!cols) continue
    out.push(...spawnsOf(t, cols, isItem), ...combineObjects(body, t.end, t.context))
  }
  return out
}
