// questTypes.ts — the wiki QUEST CATALOG's shape (produced by scripts/scrape-quests.ts).
//
// Moved out of ./types.ts (the mobTypes.ts precedent) when the quest locations wave added the
// per-step facts and that barrel reached its measured 400-code-line ceiling; ./types.ts
// re-exports everything here, so every `@shared/types` import keeps working.
//
// The SECOND local-first source for item knowledge. Item pages only carry a quest
// association when someone filled in their `|relatedquests` field, so classic turn-in
// items (Dwarven Ale, Guard Bracelet, …) look quest-less from the item side. The linkage
// actually lives on the QUEST pages, which this catalog indexes item-first.
//
// THE PER-STEP FACTS (quest locations wave). The step text (`QuestEntry.steps`) is plain prose for
// a reader: the scraper drops every `[[link]]` target and used to drop every `{{Loc|Zone|a, b}}`
// template outright, and those are exactly the facts a map jump needs. So the scraper keeps them
// beside the text, INDEX-ALIGNED with `steps` — `stepLinks[i]` and `stepLocs[i]` describe
// `steps[i]` — and the step list itself keeps its shape (a hand tick is a step INDEX,
// shared/questPins.ts, so the list must not move; tests/questStepRefs.test.mts pins that).
//
// FACTS, NOT VERDICTS. Nothing here says which zone a bare coordinate is in: that is a judgement
// over these facts plus the zone table and the bestiary, made at read time by the pure resolver
// (shared/questLocations.ts), so a zone-table fix reaches every quest without a re-scrape.
//
// Coordinates are /loc ORDER, the same convention as the bestiary's `MobLoc`: north-south first,
// then east-west, then the optional elevation. The map transform is `mapFromLoc` and nothing else.

/** One `[[Target]]` / `[[Target|Label]]` link in a step, in page order. Item links are left out. */
export interface QuestStepLink {
  /** the link TARGET — a wiki page title (an NPC, a zone, another quest) */
  page: string
  /** the text the step shows for it, only when it differs from `page` */
  label?: string
}

/** A bare point, /loc order. */
export interface QuestPoint {
  ns: number
  ew: number
  z?: number
}

/** One coordinate the step's own words state, from prose or from a `{{Loc}}` template. */
export interface QuestStepLoc {
  ns: number
  ew: number
  z?: number
  /** The zone a `{{Loc|Zone|…}}` template names, VERBATIM. Absent for a coordinate in prose. */
  zone?: string
  /** Char offset of the coordinate in the step's TEXT, so a reader can scope it to its sentence. */
  at: number
}

/**
 * One thing a walkthrough TABLE says to pick up off the ground, at the point the table states
 * (scripts/sources/questGroundSpawns.ts) — or, `kind: 'object'`, the world object that table's
 * section says to combine them in. Same /loc order as `QuestStepLoc`. Facts only: which map the
 * point is on is decided at read time (shared/questGroundSpawns.ts), as for the steps.
 */
export interface QuestGroundSpawn {
  /** the item (or object) as the table names it: its link's target when the cell links one */
  item: string
  ns: number
  ew: number
  z?: number
  /** the zone the table states for this row (a Zone column, or the row's `{{Loc}}`), VERBATIM */
  zone?: string
  /** the row's other cells (the area, a nearby NPC, how to reach it), plain text */
  note?: string
  /** the row's non-item links, the NPCs its note names — read by the zone rules like `stepLinks` */
  links?: QuestStepLink[]
  /** the section's heading and words BEFORE the table, plain text — the scene the table is in */
  context?: string
  /** 'object' (the only value written): a world object to use, a combine station, not an item to pick up. A plain string because a JSON import widens literals. */
  kind?: string
}

/** One quest scraped from an eqlwiki quest page (Category:Quests + quest subcategories). */
export interface QuestEntry {
  /** display name (the wiki page title) */
  name: string
  /** wiki page title (linkable) */
  page: string
  /** "Start Zone" cell */
  startZone?: string
  /** "Quest Giver" NPC */
  giver?: string
  /**
   * Where the giver stands, as the page's header "Location" row states it (/loc order) — only a
   * point it states unambiguously. A quest-page fact about the giver, resolved like any other.
   */
  giverLocs?: QuestPoint[]
  /** "Minimum Level" (numeric part only) */
  minLevel?: number
  /** classes the quest is offered to ("All" when unrestricted) */
  classes?: string[]
  /** "Related Zones" cell */
  relatedZones?: string[]
  /** "Related NPCs" cell */
  relatedNpcs?: string[]
  /** reward items (from the Reward section's item boxes/links) */
  rewards?: { name: string }[]
  /** items the quest body references (turn-ins / collectibles), reward items excluded */
  requiredItems?: string[]
  /** page carries an experience-reward marker */
  expReward?: boolean
  /**
   * The quest's steps as plain text, one per line, from the wiki's Quick List / Checklist /
   * Short Walkthrough when the page has one, else its Walkthrough with the NPC dialogue,
   * faction lines and exp markers stripped (scripts/sources/questPage.ts `extractSteps`). A
   * `{{Loc}}` template reads as its coordinate (scripts/sources/questStepRefs.ts).
   */
  steps?: string[]
  /**
   * Per step, the links its wikitext carried (`stepLinks[i]` is `steps[i]`'s), item links left
   * out. Present only when some step links something.
   */
  stepLinks?: QuestStepLink[][]
  /** Per step, the coordinates its words state. Present only when some step states one. */
  stepLocs?: QuestStepLoc[][]
  /** The ground spawns (and the object they combine in) the page's tables locate. Present only when some are. */
  groundSpawns?: QuestGroundSpawn[]
}

export interface QuestData {
  scrapedAt: string
  /** human-readable provenance, e.g. "eqlwiki.com Category:Quests (+ subcategories)" */
  source: string
  quests: QuestEntry[]
}
