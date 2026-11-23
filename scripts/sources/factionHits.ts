/**
 * PURE faction-hit readers over cached wiki wikitext (no network) — the parsing half of
 * `scripts/gen-faction-sources.mts`, unit-tested in tests/factionSources.test.mts.
 *
 * TWO PAGE KINDS, TWO SHAPES, both measured over the caches 2026-11-23:
 *
 *   MOB PAGES (`scripts/sources/cache/mobs`): two template fields,
 *     | factions =                 the factions this mob belongs to; a kill LOWERS each
 *     * [[Storm Guard]] <span class='profac'>(-30)</span>
 *     | opposing_factions =        the factions that like it dead; a kill RAISES each
 *     * [[Crushbone Orcs]] <span class='oppfac'>(10)</span>
 *   The amount is in parentheses, sometimes bare (`-1`), sometimes absent or `(?)` / `(-)` / `(+)`.
 *   An explicit sign wins; an unsigned number takes the field's direction. No digit = unknown.
 *
 *   QUEST PAGES (`scripts/sources/cache/quests`): the turn-in's own chat, pasted verbatim,
 *     * Your faction standing with [[Storm Guard]] has been adjusted by 5.
 *     * Your faction standing with [[Storm Guard]] got better.          (amount unknown)
 *     * Your faction standing with [[X]] could not possibly get any worse.
 *   "got better" and "could not possibly get any better" raise by an unknown amount; their mirror
 *   images lower by one.
 */

/** One stated change. `amount` is the magnitude, null when the page names no amount. */
export interface StatedHit {
  faction: string
  direction: 1 | -1
  amount: number | null
}

/** The signed amount, or null when unstated. */
export function signedDelta(hit: StatedHit): number | null {
  return hit.amount === null ? null : hit.direction * hit.amount
}

/** The first `[[Target|Label]]` link's TARGET on a line, and the text after it; null when none. */
function firstLinkTarget(line: string): { target: string; rest: string } | null {
  const m = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(line)
  if (!m) return null
  const target = m[1].replace(/_/g, ' ').trim()
  if (target === '' || /^(file|image|category)\s*:/i.test(target)) return null
  return { target, rest: line.slice(m.index + m[0].length) }
}

/** `(-30)`, `-1`, `(+5)`, `(10)` after the link; `(?)`, `(-)` or nothing state no amount. */
function statedHit(faction: string, rest: string, fieldDirection: 1 | -1): StatedHit {
  const m = /([+-]?)\s*(\d+)/.exec(rest)
  if (!m) return { faction, direction: fieldDirection, amount: null }
  const direction = m[1] === '-' ? -1 : m[1] === '+' ? 1 : fieldDirection
  return { faction, direction, amount: Number(m[2]) }
}

/** The body of one `| field =` template parameter, up to the next parameter or the template end. */
function fieldBody(wikitext: string, field: string): string | null {
  const start = new RegExp(`^\\|\\s*${field}\\s*=`, 'm').exec(wikitext)
  if (!start) return null
  const after = wikitext.slice(start.index + start[0].length)
  const end = /^\|\s*[A-Za-z_]+\s*=|^\}\}/m.exec(after)
  return end ? after.slice(0, end.index) : after
}

function hitsInField(wikitext: string, field: string, direction: 1 | -1): StatedHit[] {
  const body = fieldBody(wikitext, field)
  if (body === null) return []
  const out: StatedHit[] = []
  for (const line of body.split('\n')) {
    const link = firstLinkTarget(line)
    if (link) out.push(statedHit(link.target, link.rest, direction))
  }
  return out
}

/** Every faction a kill of this mob moves, per the page: its own factions, then the opposing. */
export function mobFactionHits(wikitext: string): StatedHit[] {
  return [...hitsInField(wikitext, 'factions', -1), ...hitsInField(wikitext, 'opposing_factions', 1)]
}

const QUEST_LINE =
  /Your faction standing with (?:\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|([^\n[]+?)) (?:has been adjusted by (-?\d+)|got (better|worse)|could not possibly get any (better|worse))/gi

/** Every faction line a quest page quotes, in page order, one entry per line. */
export function questFactionHits(wikitext: string): StatedHit[] {
  const out: StatedHit[] = []
  for (const m of wikitext.matchAll(QUEST_LINE)) {
    const faction = (m[1] ?? m[2] ?? '').trim()
    if (faction === '') continue
    if (m[3] !== undefined) {
      const n = Number(m[3])
      out.push({ faction, direction: n < 0 ? -1 : 1, amount: Math.abs(n) })
      continue
    }
    const word = (m[4] ?? m[5] ?? '').toLowerCase()
    out.push({ faction, direction: word === 'better' ? 1 : -1, amount: null })
  }
  return out
}
