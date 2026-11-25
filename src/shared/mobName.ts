// mobName.ts — a mob page's `|name` that is the wiki TEMPLATE'S placeholder, not a name.
//
// MEASURED over the committed mobs.json (2026-11-25): two pages state `|name = NPC_Name`
// — the Namedmobpage template's own placeholder, left in by the editor (Lord Ollix Everling, Head
// Chef Vy`zen) — and it reached a quest page as a chip reading "NPC_Name · Nektropos Castle". No page
// states an empty-template `{{…}}`, a bare "?" or "Unknown" as a name today; they are refused too,
// because each is the same mistake waiting for the next refresh.
//
// NOT placeholders, on purpose: "Clockwork XXD" / "Clockwork XXXD" are clockwork model names the wiki
// gives as page titles too; five names written with underscores (`a_minnow`, `Lord_Rikantus_Everling`)
// are names, kept exactly as stated so a chip names a mob the way the Maps tab lists it. A
// `|level = ?` (71 pages) or `|known_loot = None` (21) is a placeholder VALUE, not a name; no chip
// shows a level, and "None" is no item anyone needs.
//
// PURE. Used by the bestiary index (shared/bestiaryIndex.ts) at read time, and by the mob parser
// (scripts/sources/mobPage.ts) so the next refresh stops writing the placeholder at all.

const PLACEHOLDER = /^(?:npc[_ ]?name|name|unknown|placeholder|tbd|\?+)$|\{\{|\}\}/i

/** Is this stated `|name` the template's placeholder (or nothing at all)? */
export function isPlaceholderMobName(name: string): boolean {
  const t = name.trim()
  return t === '' || PLACEHOLDER.test(t)
}

/** The name to SHOW for a mob page: its stated name, unless that is a placeholder — then its title. */
export function shownMobName(name: string, page: string): string {
  return isPlaceholderMobName(name) ? page : name
}

/** The catalog with every placeholder name replaced by its page title; untouched entries are the same objects. */
export function withShownMobNames<T extends { name: string; page: string }>(mobs: readonly T[]): T[] {
  return mobs.map((m) => {
    const name = shownMobName(m.name, m.page)
    return name === m.name ? m : { ...m, name }
  })
}
