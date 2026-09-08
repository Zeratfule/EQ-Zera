// questCatalog — the committed wiki quest catalog, indexed by PAGE TITLE (EQ Zera, ROADMAP §1).
//
// WHY THIS EXISTS AT ALL. The quest-item celebration toast is pushed into an overlay window that
// is MUI-free and FETCHES NOTHING (T5): whatever the card names, main resolved first. The
// renderer's detector knows only which quest PAGES a looted item belongs to (it sends them as
// `ToastRequest.questPages`), so main needs the other half of the join — page title back to the
// catalog entry with its steps, giver and start zone — before `toastQuestCard` can cut the card.
//
// AND WHY IT IS NOT `questItemIndex.ts`. That index answers "which quests use this ITEM" and is
// keyed by item name; this one answers "what IS this quest" and is keyed by page. Same JSON, two
// directions, and folding them into one map would mean every caller of either paid for both.
//
// Imported, not read from disk, exactly like posky/quests/spells in itemLookup.ts: electron-vite
// INLINES an ES-imported JSON into the main bundle, while a path-relative readFile would miss in
// `out/main/` in production. No `electron` import lives here on purpose — that is what lets a
// unit test exercise the SHIPPED index rather than a mirror of it.

import questsJson from '../renderer/src/data/eqlegends/quests.json'
import type { QuestData, QuestEntry } from '../shared/types'

const questData = questsJson as unknown as QuestData

/**
 * The exact-title map and its case-insensitive fallback, built together in ONE pass the first
 * time anything asks. 904 entries is cheap, but it is not free, and a boot that never shows a
 * quest-item toast should never pay for it.
 */
interface PageIndex {
  exact: Map<string, QuestEntry>
  lower: Map<string, QuestEntry>
}

let index: PageIndex | null = null

function pageIndex(): PageIndex {
  if (index) return index
  const exact = new Map<string, QuestEntry>()
  const lower = new Map<string, QuestEntry>()
  for (const q of questData.quests) {
    // First entry wins on a duplicate title, so the answer does not depend on scrape order.
    if (!exact.has(q.page)) exact.set(q.page, q)
    const key = q.page.trim().toLowerCase()
    if (!lower.has(key)) lower.set(key, q)
  }
  index = { exact, lower }
  return index
}

/**
 * The catalog quest with this wiki page title, or undefined when the catalog has no such page.
 *
 * Exact title first, then a case-insensitive retry: MediaWiki titles differ in case all the time
 * (`Bone chips Felwithe` for `Bone Chips Felwithe`), and a card that silently vanished over a
 * capital letter would look exactly like a bug. An unknown title yields NOTHING rather than a
 * fabricated entry — the caller drops that page and draws the rest (law 1).
 */
export function questByPage(page: string): QuestEntry | undefined {
  const title = page.trim()
  if (title === '') return undefined
  const idx = pageIndex()
  return idx.exact.get(title) ?? idx.lower.get(title.toLowerCase())
}
