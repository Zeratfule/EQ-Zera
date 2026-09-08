/**
 * Per-class SKILL / DISCIPLINE unlock levels, read off the eqlwiki class pages
 * (scripts/scrape-classes.ts § skillUnlocks/discUnlocks).
 *
 * MEASURED FIRST (2026-08-05, over the 16 cached class pages). The wiki DOES state
 * unlock levels, in tables, on every class page — but it states them in five different
 * column orders and under five different header spellings:
 *
 *   Level | Trained | Skill | Cap Until 50 | Cap Above 50      (the 9 caster pages)
 *   Level | Skill | Trained | Pre 50 Cap | Post 50 Cap         (BER, BST, WAR)
 *   Skill Name | Level Obtained | Trained | Max                (Misc-skill tables)
 *   Level | Discipline | Endurance Cost | …                    (BER Combat Disciplines)
 *   Poison | Level Obtained | Type | …                         (ROG poisons)
 *
 * and PAL/SHD pack the whole row onto one line with `||`. Column INDEXES are therefore
 * read from the HEADER, never assumed: a table that does not name both a level column
 * and a name column is SKIPPED and reported, never guessed at. That is what keeps the
 * Wizard page's two quest tables (Quest | Reward), the Rogue page's stance/invocation
 * tables (no level column at all) and every prose section out of the output.
 *
 * KIND IS STRUCTURE-DERIVED, NEVER GUESSED (world-model law 1):
 *   - 'disc'   — the table sits under a heading the page itself calls Disciplines
 *                (or Poisons, the Rogue page's own name for its poison disciplines).
 *   - 'skill'  — the table sits under a heading the page calls Skills.
 *   - 'innate' — the row's name is one the page FOOTNOTES as an ability rather than a
 *                skill ("* Lay on Hands is an Ability, not a Skill", "** Smite is a new
 *                Paladin ability (not a Skill) in EQL"). Nothing else is called innate,
 *                and no row is promoted on a hunch.
 *
 * STRUCK-THROUGH ROWS ARE DROPPED. The wiki marks content that is not on the Legends
 * server with `<s>…</s>`, and `plain()` would otherwise happily strip the tag and emit a
 * discipline the server does not have. Dropped rows are counted into the scan's
 * `skipped[]` so the scrape can state the loss instead of hiding it.
 */
import { parseAbilityFootnotes, plain, rowCells, tableRows, normalizeSkill } from './classWiki'

export type UnlockKind = 'skill' | 'disc' | 'innate'

/** One thing a class gains, and the level the page says it gains it at. */
export interface ClassUnlock {
  name: string
  level: number
  kind: UnlockKind
}

/** What one class page yielded, plus every place the page did not state enough. */
export interface UnlockScan {
  unlocks: ClassUnlock[]
  /** human-readable reasons — unresolvable tables, struck rows, unparseable levels. */
  skipped: string[]
}

/** Header spellings that name the LEVEL column, across all 16 pages. */
const LEVEL_HEADERS = new Set(['level', 'level obtained', 'lvl', 'level gained'])
/** Header spellings that name the THING column. */
const NAME_HEADERS = new Set([
  'skill',
  'skill name',
  'discipline',
  'discipline name',
  'poison',
  'ability'
])

/** `style="…" | Foo` → `Foo`; a wiki cell may carry attributes before its content. */
function cellBody(raw: string): string {
  const m = /^(?:[A-Za-z-]+\s*=\s*"[^"]*"\s*)+\|(?!\|)(.*)$/s.exec(raw)
  return m ? m[1] : raw
}

/** One row/header line → its cells, honouring both the one-per-line and `||`-packed layouts. */
function splitCells(line: string, sep: '||' | '!!'): string[] {
  return line.split(sep).map((c) => cellBody(c.trim()))
}

/** A table chunk's header cells, lowercased and markup-free. */
function headerCells(segment: string): string[] {
  const out: string[] = []
  for (const line of segment.split('\n')) {
    if (!line.startsWith('!')) continue
    for (const c of splitCells(line.slice(1), '!!')) {
      for (const c2 of splitCells(c, '||')) out.push(plain(c2).toLowerCase())
    }
  }
  return out
}

/** Where the level and the name live in this table, or null when it does not say. */
function columns(segment: string): { level: number; name: number } | null {
  const heads = headerCells(segment)
  const level = heads.findIndex((h) => LEVEL_HEADERS.has(h))
  const name = heads.findIndex((h) => NAME_HEADERS.has(h))
  return level < 0 || name < 0 ? null : { level, name }
}

/**
 * A page's headings with their `=` depth, so a table can be classified by the heading
 * chain that ENCLOSES it (innermost first) rather than by the one nearest above it.
 */
interface Heading {
  depth: number
  name: string
  from: number
  to: number
}

function pageHeadings(wt: string): Heading[] {
  const heads = [...wt.matchAll(/^(=+)\s*(.+?)\s*=+\s*$/gm)]
  return heads.map((h, i) => ({
    depth: h[1].length,
    name: h[2],
    from: h.index + h[0].length,
    to: i + 1 < heads.length ? heads[i + 1].index : wt.length
  }))
}

/** The enclosing heading names of section `i`, innermost first. */
function chain(heads: Heading[], i: number): string[] {
  const names = [heads[i].name]
  let depth = heads[i].depth
  for (let j = i - 1; j >= 0; j--) {
    if (heads[j].depth < depth) {
      names.push(heads[j].name)
      depth = heads[j].depth
    }
  }
  return names
}

/** 'disc' / 'skill' from what the page CALLS the section; null when it calls it neither. */
function sectionKind(names: string[]): 'skill' | 'disc' | null {
  for (const n of names) {
    if (/disciplin|poison/i.test(n)) return 'disc'
    if (/skill/i.test(n)) return 'skill'
  }
  return null
}

/**
 * Names the page footnotes as abilities-not-skills — the ONLY source of kind 'innate'.
 * Reads the SAME sentence classes.json's `abilities` section reads, through the same
 * function, so the two can never disagree about what the page called an ability.
 */
function footnotedAbilities(wt: string): Set<string> {
  return new Set(parseAbilityFootnotes(wt).map((n) => n.toLowerCase()))
}

/** `37`, `37?` → 37; anything else (a `?`, a range, a blank) → null. */
function levelOf(cell: string): number | null {
  const m = /^(\d{1,2})\??$/.exec(plain(cell).trim())
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 65 ? n : null
}

interface RowContext {
  cols: { level: number; name: number }
  kind: 'skill' | 'disc'
  innate: Set<string>
  where: string
  skipped: string[]
}

/**
 * One table row → the unlocks it states (usually one). `A / B` in a SKILL cell is TWO
 * skills — the Monk page's "Dragon Punch / Tail Rake" — which is exactly how the existing
 * `skills` table reads the same cell; a discipline name is never split (its `/` is prose).
 */
function parseRow(ctx: RowContext, chunk: string): ClassUnlock[] {
  const cells = rowCells(chunk).flatMap((c) => splitCells(c, '||'))
  if (cells.length <= Math.max(ctx.cols.level, ctx.cols.name)) return []
  const rawName = cells[ctx.cols.name]
  const rawLevel = cells[ctx.cols.level]
  if (/<s>/i.test(rawName) || /<s>/i.test(rawLevel)) {
    ctx.skipped.push(`${ctx.where}: '${plain(rawName)}' is struck through (not on Legends) — dropped`)
    return []
  }
  const level = levelOf(rawLevel)
  const bare = plain(rawName).replace(/\s*\*+$/, '').trim()
  if (bare.length === 0 || bare.length > 40) return []
  if (level === null) {
    ctx.skipped.push(`${ctx.where}: '${bare}' states no numeric level ('${plain(rawLevel)}') — dropped`)
    return []
  }
  const kind: UnlockKind = ctx.innate.has(bare.toLowerCase()) ? 'innate' : ctx.kind
  if (kind === 'disc') return [{ name: bare, level, kind }]
  return bare
    .split(' / ')
    .map((part) => normalizeSkill(part))
    .filter((name) => name.length > 0)
    .map((name) => ({ name, level, kind }))
}

/** Every `{| … |}` table body in a section, in source order (nested tables get their own entry). */
function tableSegments(block: string): string[] {
  return block.split(/\{\|/).slice(1)
}

/** Everything about a section that does not vary from table to table. */
interface SectionContext {
  kind: 'skill' | 'disc'
  innate: Set<string>
  where: string
  skipped: string[]
}

/**
 * One classified section → the unlocks its tables state, in source order.
 *
 * A table that does not name BOTH a level column and a name column is skipped rather than
 * read positionally; anything big enough to matter (3+ rows) says so in `skipped`.
 */
function sectionUnlocks(block: string, ctx: SectionContext): ClassUnlock[] {
  const out: ClassUnlock[] = []
  for (const segment of tableSegments(block)) {
    const cols = columns(segment)
    const rows = tableRows(segment)
    if (cols === null) {
      if (rows.length >= 3) {
        ctx.skipped.push(`${ctx.where}: a ${rows.length}-row table names no level+name columns — skipped`)
      }
      continue
    }
    for (const chunk of rows) out.push(...parseRow({ cols, ...ctx }, chunk))
  }
  return out
}

/**
 * One class page → its stated skill/discipline/innate unlocks.
 *
 * Reads ONLY tables that name both a level column and a name column, under headings the
 * page itself calls Skills or Disciplines. Everything else is left alone and reported.
 */
export function parseClassUnlocks(wt: string): UnlockScan {
  const innate = footnotedAbilities(wt)
  const heads = pageHeadings(wt)
  const unlocks: ClassUnlock[] = []
  const skipped: string[] = []
  const seen = new Set<string>()

  for (let i = 0; i < heads.length; i++) {
    const kind = sectionKind(chain(heads, i))
    if (kind === null) continue
    const block = wt.slice(heads[i].from, heads[i].to)
    // The same name can be listed twice (a page repeating a row across subsections); the
    // FIRST statement wins, which is the earliest level the page states.
    for (const unlock of sectionUnlocks(block, { kind, innate, where: heads[i].name, skipped })) {
      const key = unlock.kind + ':' + unlock.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      unlocks.push(unlock)
    }
  }
  unlocks.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
  return { unlocks, skipped }
}

/** Split one class's unlocks into the two committed sections. Empty classes are omitted. */
export function unlockSections(unlocks: Map<string, ClassUnlock[]>): {
  skillUnlocks: Map<string, ClassUnlock[]>
  discUnlocks: Map<string, ClassUnlock[]>
} {
  const skillUnlocks = new Map<string, ClassUnlock[]>()
  const discUnlocks = new Map<string, ClassUnlock[]>()
  for (const [abbr, rows] of unlocks) {
    const discs = rows.filter((u) => u.kind === 'disc')
    const rest = rows.filter((u) => u.kind !== 'disc')
    if (rest.length > 0) skillUnlocks.set(abbr, rest)
    if (discs.length > 0) discUnlocks.set(abbr, discs)
  }
  return { skillUnlocks, discUnlocks }
}

/**
 * What the central `Disciplines` page says about the CLASS pages' discipline tables.
 *
 * It says something load-bearing and easy to miss — "only Rogue poison disciplines are on
 * Legends" — and backs it up by striking through (`<s>...</s>`) every non-Rogue table on its
 * own page. The class pages do NOT strike theirs through, so MNK/BER/RNG discipline rows are
 * emitted here while the wiki's own central page denies them. That contradiction is data
 * (design § 9 R2: nothing is silently picked), so it goes into `disputed[]` per class rather
 * than being resolved by whichever page we happened to read last.
 */
export function disciplineDisputes(
  discWt: string | null,
  discUnlocks: Map<string, ClassUnlock[]>
): string[] {
  if (discWt == null) {
    return ['discUnlocks: the Disciplines page was unavailable — the class pages are uncorroborated']
  }
  const claim = /only [^.\n]*are on Legends[^.\n]*\./i.exec(discWt)?.[0]
  if (claim === undefined) return []
  const out: string[] = []
  for (const abbr of [...discUnlocks.keys()].sort()) {
    if (abbr === 'ROG') continue
    const n = discUnlocks.get(abbr)?.length ?? 0
    out.push(
      `discUnlocks '${abbr}': the class page states ${n} discipline(s) with levels, but the Disciplines ` +
        `page strikes its whole ${abbr} table through and states "${claim}" — kept, labeled disputed`
    )
  }
  return out
}
