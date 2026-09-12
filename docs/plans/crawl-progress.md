# Crawl progress - an ESTIMATE of Dungeon Crawl completion (2026-09-12)

## What this is, and the one sentence that governs it

EQ Legends' Dungeon Crawl instances carry a completion meter. **The game shows that number in its
own in-instance window and prints it in no log line.** There is therefore nothing to parse, and this
feature does not claim to have parsed it. What it does is reconstruct an approximation from two
things this repo can hold honestly:

1. the run the log *can* be folded into (`src/shared/runTracker.ts` - kills, group kills, and the
   named mobs the log spelled without an article), and
2. a committed, per-zone table of rare creatures and kill totals gathered from the community wiki
   (`src/renderer/src/data/eqlegends/crawlRosters.json`).

Every reading carries `estimated: true` in the type, the overlay block is titled
**`Crawl (estimated)`**, and the caption under it says
**`Estimate from community counts, not the game's own tracker.`** If a user could mistake it for the
game's own percentage, that would be a wrong answer rather than a feature.

## The pieces

| File | What it is |
| --- | --- |
| `src/renderer/src/data/eqlegends/crawlRosters.json` | the table: 19 zones, keyed by the zone name the log prints in `You have entered <Zone>.` |
| `src/shared/crawlRoster.ts` | the PURE fold: name/zone normalization, roster lookup, `crawlProgress()`. Imports no data - the table is passed in. |
| `src/renderer/src/overlay/crawlRows.ts` | the renderer's glue: loads the JSON once, turns a progress into rows and owns the copy. |
| `src/renderer/src/overlay/RunOverlay.tsx` | draws the block, or nothing at all when the table has never described the zone. |
| `scripts/fetch-crawl-rosters.mts` | the maintenance refresher. Not wired into any build or runtime path. |
| `tests/crawlRoster.test.mts` | 14 tests: the folds, the three refusals, the committed table's shape, and the owner's real Befallen crawl. |

`runTracker.ts` is unchanged except its header, which now says the roster exists as an estimate
layered on top. **How a named mob is detected did not change** - that law is still "the log spelled
it without a leading article", and this feature was not allowed to move it.

## Provenance of the data (verified 2026-09-12)

Row by row, `source` carries the URLs and `notes` carries what the source actually said. The
sources are:

- **eqlwiki.com zone pages**, specifically the infobox rows `Rare NPCs:` and - where a page has no
  such row - `Notable NPCs:`.
- **`eqlwiki.com/Talk:Dungeon_Crawl`**, whose hand-maintained table states rare counts and
  kills-to-complete for a few zones (measured at difficulty 0, level 50).
- **`eqlwiki.com/Dungeon_Crawl`**, which carries the dev statement that Fear labels no rare
  creatures.
- **one blog post** (chasingdings.com, 2026-09-09) for Nagafen's Lair: 10 rares, ~100 mobs at D4.
- **the official patch notes** (everquestlegends.com, 2026-09-09) for Plane of Sky: all Sky bosses
  are flagged rare.

### The three confidence values, and what each is allowed to buy

| `confidence` | Means | May it be a denominator? |
| --- | --- | --- |
| `stated on wiki` | a published number, or a row the wiki explicitly labelled **Rare NPCs** - i.e. a list that claims to be the game's own rare flag | yes: `rareCount` when stated, else `rares.length` |
| `player report` | a blog or a patch note; somebody's measurement, published once | yes, same rule - and it is the weakest of the three |
| `inferred` | a **named-mob list** (a `Notable NPCs` row, the zone map's labels) - **not** the game's rare flag | **no.** `rareTotal` is `null` unless a `rareCount` was published separately |

The `inferred` refusal is the heart of the feature. A named mob may be ordinary trash as far as the
crawl is concerned, and a real rare may be missing from a `Notable NPCs` row entirely - so counting
such a list as a total would invent a denominator. Those zones say `Rares killed: X` and stop. Two
`inferred` rows (Plane of Hate, Temple of Cazic-Thule) *do* print a total, because the Talk page
published explicit counts for them even though their name lists are guesses.

`rareCount` and `killsToComplete` are independent of `rares.length` on purpose: Lower Guk's row
states **25 rares / ~124 kills** while the page's own list names only 24 of them (the notes say
`evil eye` is the likely 25th). `null` in either field means "nobody published this", never zero.
Fear's `rareCount: 0` with `rares: []` is the opposite: a stated zero, which is a measurement.

## Two honest limits (both pinned by tests)

1. **The log and the wiki disagree about apostrophes.** The owner's Befallen run prints
   ``skeleton L`rodd``; the wiki row says `Skeleton Lrodd`. Unifying the backtick and the curly
   apostrophe onto `'` is not enough for that pair, so the **match key drops the mark entirely**
   (`mobMatchKey`). That widening is what takes the owner's real run from 11 matched rares to 12.
2. **A rare the log spells with a leading article can never be counted.** `runTracker`'s test for a
   named mob *is* the absent article, so the eight `The …` names in the table (`The Prophet`,
   `The Goblin King`, `The Thaumaturgist`, `The Blood Artist`, `The Tenderizer`,
   `The Widowmistress`, `The Ishva Mal`, `The Spiroc Lord`) never reach `run.named` in the first
   place. That understates progress in those five zones. The list is pinned in
   `tests/crawlRoster.test.mts` so a table refresh that adds a ninth such name is visible.

Also known, and not a defect to fix here: players report the meter behaving inconsistently in Plane
of Sky, raid-only bosses (Lord Nagafen, Lady Vox, Phinigel Autropos, Master Yael) are excluded from
the lists because a raid instance is not a crawl, and it is unknown whether the crawl counts a zone's
raid boss at all where one can be reached.

## What the overlay draws

Only when `rosterForZone(run.base)` finds a row. A zone with no row draws **nothing new at all**.

```
Crawl (estimated)
Rares            11 of 25          <- a published total exists
Kills            131 of ~124 (100%) <- only when killsToComplete is published; capped at 100
Estimate from community counts, not the game's own tracker.
```

…and where no total was published, the first line becomes `Rares killed · 12`. The kill line counts
your kills and your group's together, because the instance's meter advances on a dead mob rather
than on who got credit for it.

## Refreshing the table

```
npx tsx scripts/fetch-crawl-rosters.mts --dry   # fetch, print the diff, write nothing
npx tsx scripts/fetch-crawl-rosters.mts         # …and write it
```

It is a **maintenance** script: no npm script, no build step, no runtime path, and the app therefore
gains no outbound origin. It obeys the scraper law in AGENTS.md - one serialized request at a time,
1 s apart, exponential backoff honouring `Retry-After`, `maxlag=5`, and titles batched at 50 through
the MediaWiki API. (That last point is a deliberate departure from `index.php?title=…&action=raw`,
which would be one request per zone; the law says pull in bulk through the site's API where one
exists.)

What it rebuilds: `rares`, from each row's own cited eqlwiki page (`Rare NPCs` row, falling back to
`Notable NPCs`), plus `rareCount` / `killsToComplete` where `Talk:Dungeon_Crawl` states them.

What it will not touch: `aliases`, `notes`, `confidence` and `source`. Each is a human judgement the
wiki does not state, and a scraper able to overwrite `confidence` could promote a named-mob list into
a denominator - the one thing this design exists to prevent. It prints a per-zone diff summary; a
re-scrape is a data change, not a refresh, so read it rather than skimming it.
