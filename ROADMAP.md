# EQ Zera — roadmap

Two features requested at fork time, with a design grounded in what the codebase already has.
File references are to the current tree.

---

## 1. Quest-item drop popup

**Goal.** When a quest item lands in your loot, a small window pops up naming the quest(s) it
belongs to and listing the quest's steps.

### What already exists

- Loot lines are parsed by the Rust engine (`engine/crates/eqlog/src/parse/world.rs:60`) into
  `LootEventE { item, source, count, … }` (`src/shared/logEvents.ts:77`) and folded into the
  `loot` module (`engine/crates/fold/src/modules/loot.rs`). The renderer already subscribes via
  `useLootHistory()` (`src/renderer/src/features/loot/useLootHistory.ts`).
- **Item → quest linkage exists**: `src/main/questItemIndex.ts` indexes 904 scraped quests
  (`src/renderer/src/data/eqlegends/quests.json`) by required item and by reward, with quest
  giver and start zone. `lookupItem()` (`src/main/itemLookup.ts`) returns it as
  `ItemKnowledge.questUses`.
- **A popup-on-event mechanism exists**: the celebration *toast* overlay. Renderer detectors
  (`src/renderer/src/components/AppCelebrations.tsx`) call `window.eq.showToast(...)`; main
  validates and enriches with `lookupItem` (`src/main/toast.ts:90`) and pushes to the `toast`
  overlay window. Users can already move/lock/disable that overlay in Preferences → Overlays.

### What is missing

- **Quest step text.** `quests.json` has names, givers, zones, items, rewards — but no steps.
  The raw wikitext for all 933 quest pages **is committed** under
  `scripts/sources/cache/quests/*.wikitext`, and those pages carry `== Quick List ==` /
  `== Walkthrough ==` bullet lists. No network needed to add steps.

### Plan

1. **Data** — extend `scripts/sources/questPage.ts` to extract the step bullets (prefer
   `Quick List`, fall back to `Walkthrough`; strip wiki markup, keep `[[Item]]` names as plain
   text). Add `steps?: string[]` to `QuestEntry` (`src/shared/types.ts:469`). Re-run
   `npm run scrape:quests` (cache-first, so it is fast). Budget: ~1 day incl. markup edge cases.
2. **Payload** — add a `questItem` toast kind (`src/shared/toast.ts:102`) carrying
   `{ item, quests: [{ name, giver, startZone, role: 'required'|'reward', steps }] }`.
   Main attaches the quest data from `questItemIndex` in `src/main/toast.ts`.
3. **Detector** — a new always-mounted hook beside `AppCelebrations.tsx`: on each *live*
   loot row (not replayed history), if `lookupItem(item).questUses.length > 0`, fire the toast.
   Follow the live-gating pattern in `features/loot/useNotablePickups.ts`.
4. **Card** — render in the toast overlay: item icon (already served via `eqimg://item/<id>`),
   quest name(s), giver + zone, numbered steps, with the step that mentions the looted item
   highlighted. Click-through to the Posky tracker / quest page where applicable.
5. **Preferences** — a toggle ("Quest item pop-ups"), a dedupe window (don't re-pop the same
   item within N minutes), and an "only quests for my class" filter using `QuestEntry.classes`.
6. **Tests** — unit test the step extractor against 3–4 committed wikitext fixtures; unit test
   the detector's live/replay gate; add one e2e using `appendAt()` to play a loot line.

Alternative considered: a dedicated overlay kind. Rejected for v1 — it costs entries in
`OVERLAY_KINDS`, `overlayLayout.ts`, `overlayHotZone.ts`; the toast strip already does the job.

### As shipped (2026-09-07)

Steps 1–6 are in. Where the build departed from the plan above, and why:

- **The detector matches synchronously against the committed catalog, not `lookupItem`.** The
  renderer already holds `questsByItem()` (shared/questIndex.ts, the same join the Quests tab
  uses), so a loot line is answered with no IPC and no wiki dependence; `lookupItem` would also
  have pulled in Sky quests, which have their own turn-in celebration. Live-only gating keys on the
  loot snapshot's LENGTH (several items loot in one second), seeded silently on the first snapshot
  and reset on a character switch (`features/quests/useQuestItemToast.ts`).
- **Main still resolves the card.** The request carries the quest PAGE titles (`questPages`, capped
  at 3, validator-gated to the `questItem` kind); main resolves each from its own catalog import
  (`main/questCatalog.ts`) through the pure `shared/toastQuest.ts` formatter, which cuts a 6-step
  window around the lit step and numbers it honestly (`before`/`after`). The looted item's own stat
  card rides `itemName` exactly like a Sky reward.
- **The card** (`overlay/ToastQuestBlock.tsx`, MUI-free) lists quest name, turn-in/reward tag,
  giver · zone, the numbered step window with the lit step in green, and is the click target: it
  deep-links to that quest's page via the new `AppFocus { view: 'quests', quest: page }`, which
  gained a `useFocusSlot` in appRouting and an anchor on `QuestsView`.
- **Preferences → Overlays → Quest item pop-ups**: on/off, "only quests my classes can take"
  (`questOpenTo` over the resolved loadout), and the repeat window as a 1 / 5 / 15 / 60 min choice
  (renderer localStorage prefs, `eq.questToast.*`).
- **Tests**: `toastQuest`, `toastPayload`, `questItemToast`, `questToastPrefs` unit suites and
  `tests/e2e/quest-item-toast.e2e.mts`, which appends a live Bone Chips loot line and asserts the
  card, the lit step, the deep link and the preference.
- **Known limit**: the first quest shown is the catalog's first match, so an omnibus page ("All
  Positive Faction Quests") can outrank the item's own quest. A ranking pass (prefer a quest whose
  name carries the item, then fewer steps) is a small follow-up in `questItemToastRequests`.

---

## 2. Up-to-date loot tables for all zones

**Goal.** A "Zone loot" view: pick a zone, see every mob in it and what each drops, with your
own observed drop counts alongside the wiki's list.

### What already exists

- `src/main/data/items.json` — 11.5k items, **5,557 with `dropsFrom: [{ mob, zone }]`**.
- `src/renderer/src/data/eqlegends/mobs.json` — 7,918 mobs, 7,892 with `zones`, 4,424 with
  `drops`.
- `src/renderer/src/lib/itemSources.ts` inverts mobs.json into 32.8k item→mob links.
- `src/renderer/src/features/mobs/mobZone.ts` already does the **zone → mobs** join.
- `src/shared/mobDrops.ts` merges wiki drops with your seen counts; `src/shared/lootRates.ts`
  computes per-zone observed drop rates; `src/main/mobDropEra.ts` flags out-of-era drops.
- Zone selector UI exists in `features/maps/MapZoneSelect.tsx` / `zoneOptions.ts`.

So the data and 80% of the joins exist; what's missing is the view and a refresh routine.

### Plan

1. **View** — new `src/renderer/src/features/zoneloot/ZoneLootView.tsx`: zone selector
   (reuse `MapZoneSelect`), then a table grouped by mob: mob (level), item, wiki rarity, *your*
   seen count and per-hour rate from `lootRates`, era flag. Search box filters items across the
   zone. Add the route via `useAppRouting` and a nav entry (see how `MobsView` is mounted in
   `App.tsx`).
2. **Item drill-down** — clicking an item opens the existing loot item page (`features/loot`),
   which already shows stats, quest uses and recipes.
3. **Freshness** — the wiki scrapers exist (`npm run scrape:items`, `scrape:mobs`,
   `scrape:quests`; all hit `eqlwiki.com/api.php` at 1 req/s with a disk cache). Add a single
   `npm run refresh:data` that runs the three in order and prints a diff summary (items added /
   drops changed). Run it before each release; the `scrapedAt` stamp in each JSON (currently
   2026-08-22) is shown in the view footer as "Wiki data as of …".
   Shipped 2026-09-07 as `scripts/refresh-data.mts`; see SETUP.md.
4. **Later: in-app refresh** — a button in Preferences that downloads a pre-built data bundle
   from your own GitHub release (a JSON tarball produced by `refresh:data` in CI) so users get
   fresh tables without a full app update. Needs the GitHub repo first.
5. **Community counts (optional, later)** — aggregate players' observed drop counts. Would
   require a backend; upstream's `infra/` Terraform is a starting point but is a real service
   to run. Not needed for v1.

---

## Housekeeping before either feature

- Create the GitHub repo and replace `Zeratfule/EQ-Zera` (see `SETUP.md`).
- Get `npm run typecheck && npm run lint && npm test` green on your machine as the baseline.
- ~~Bump `version` in `package.json` to `0.2.0`~~ — WRONG for this tree (found 2026-09-07):
  `src/shared/releaseNotes.ts` documents that package.json stays `0.1.0` forever and CI stamps the
  version FROM THE TAG; the notes list must ascend and the newest inherited entry is 1.16.0. The
  first EQ Zera release is therefore tagged `v1.17.0`, whose notes entry is already in place.

---

# Roadmap 2 — 2026-09-08

Items 1 and 2 above shipped 2026-09-07, plus "preview this item on my character" (Gear tab and every
item page → the Character tab's model, `shared/characterModel.ts applyPreview`). This is the next
program, in build order. Each item names what already exists, the plan, and the honest limit the
research found. Research reports live in the session; the load-bearing facts are restated here.

## Shared engine wave (ships first; the trackers below read it)

The fold is Rust now (`engine/crates/fold`); every "new number" is a fold module, and the protocol
needs no change for one (`ModuleState` is untyped). Five things the log says that no module publishes:

| line | today | wave |
|---|---|---|
| `You say, 'Hail, X'` | `unknown` | `hail` kind + `hails` module (recent 200) |
| `Your faction standing with F has been adjusted by -3.` / `could not possibly get any worse` | `unknown` (243 fixture lines; only the `adjusted by` form has a magnitude) | `factionHit` kind + `faction` module (Σ delta, saturation COUNTED never summed) |
| `You looted X … and sold it for 125 platinum.` | price discarded (non-capturing group) | `coins` on the sold loot event + `coin` module over corpse/vendor/sold; NO totals in shared code (the plat ladder is not in the log) |
| `You have become better at X! (56)` | parsed, consumed only by class inference | `skills` module (last value, ups, history) |
| `You have been slain by X!` | parsed; the combat ring stores incoming hits without the attacker | `deaths` module folds its own 60 s ring of incoming damage + resists and writes a recap per death - the combat engine is untouched, so every total stays byte-identical (law 8) |

Gate: `cargo test` ×3, clippy `-D warnings`, `check:rust-factoring`, the parity oracle with the
sold-coins field declared as an intended divergence (goldens are frozen), `build:engine`.

## 3. Upgrade finder

Exists: `shared/build/optimizer.ts` scores ONE row (`itemScore`) and a set is a sum, so a verdict
needs only the row and the worn item in each cell it could occupy; `gearCompare.equippedCells`
lists those cells; `GearRow.wikiSources` + `lib/itemSources.sourcesFor` give mobs and zones.
Plan: `shared/build/upgradeFinder.ts` (`upgradeVerdict`, `farmPlan`), one renderer hook shared by
Zone Loot (an "+14 Chest" chip, an "Upgrades only" toggle) and the item page (an upgrade line), and
a "Where to farm" panel on the Build tab ranking zones by summed gain. Limits stated on screen: worn
items count at their +N and drops at base; a worn item the index cannot score gets no verdict; no
dump means no verdicts; sources carry no rarity, so the only ranking is summed gain.

## 4. Quest tracker

Exists: the turn-in module (`You offered … / You complete the trade with NPC.`) names the NPC and
the exact items; `posky/turnInCelebration.countTurnIns` is the matching rule (giver equality, every
required item offered, superset allowed). Plan: pin catalog quests per character
(`ProgressState.questPins`, additive key, split store file), a step checklist with manual ticks and
log-driven ticks (looted item lights, turn-in to the giver ticks the hand-in steps), completion when
every required item has been turned in to the giver, celebrated once per live transition through
the existing `questComplete` signal and toast. Hail steps tick from the `hails` module once the
engine wave lands (the pure `questProgress` accepts hail evidence from day one). Known limits: 52
givers are comma lists or carry `(loc: …)` (a giver-candidates fold handles them), wiki plurals
(`Infected Rat Livers`) never match the log's singular and are NOT de-pluralised (law 12), 161
quests list no required items and can never auto-complete.

## 5. Tradeskill helper (Crafting tab)

Exists: `items.json` `craftedBy` on 2,475 items (2,120 with ingredients; 355 stated none) with
tradeskill, trivial, container, yield; holdings from the dump via `planner/ownership.ts` on the same
key. Plan: a main-side `craft:index` (the `gear:index` precedent), a Crafting tab in the gear area:
"You can make now", "One ingredient away", all recipes with have/need per ingredient. Tradeskill
names normalised (`:Tailoring`, `Jewelcrafting`, `Make Poison`…; unknown kept verbatim). Limits:
"can make" means "holds the ingredients" (no skill values exist anywhere); "Returned on Success"
ingredients are not consumed; the reference dump holds exactly one recipe ingredient, so the useful
surface is "one away" and "what am I missing".

## 6. Wish-list drop alerts

Exists: the wish list is per character with a module-scope store safe to read from an always-mounted
detector; alerts have a closed `AppSignal` set with a compile-time tripwire; `LootEvent.zone` is
stamped. Missing: the log has NO "someone else looted" line (zero in 138 fixtures), so v1 is YOUR
loot only. Plan: `wishDrop` and `wishZone` app signals with two seeded alerts (user-configurable
sound, speech, banner), a `wishDrop` toast (the item card) and a zone-entry toast naming the wished
items that drop here (`sourcesFor` ∪ `catalogZonesFor` through `zoneKey`), silent baseline on
hydration, an `AppFocusView 'wishlist'` deep link.

## 7. Death recap

Reads the `deaths` module: a card in the app (and a toast) on a LIVE death: killer, damage taken in
the last 15 s by attacker and by skill, the hits in order, what you resisted. Historical deaths list
on the Combat tab. Never on replay.

## 8. Camp meter overlay ("Farm" kind - `camp` already means logging out here)

Everything is composed from `rangeStats` + `windowLootRates` + the `coin` module over a custom
slice `{t0: zoneStart[last], t1: lastTs}` (the XP overlay's exact idiom): kills/h, drops/h, XP/h,
plat/h (the ladder rate declared on screen), the next watched respawn worded as a gap. Registering
an overlay kind costs ~12 edits including three exhaustive `Record<OverlayKind, …>` maps and the
closed telemetry enum.

## 9. Faction tracker, 10. Skill-up tracker, 11. Plat/hour line

Tabs/panels over the `faction`, `skills` and `coin` modules: standing by faction with hits and
saturation counts and the quests/NPCs that faction gates (`relatedNpcs`); skills with last value
and ups per session; plat/hour on the Leveling tab beside XP/hour.

## Polish

- "While you were away" summary on return (offline gaps from `progression`).
- Quest popup ranking (item's own quest before an omnibus page); Zone Loot zone aliases in "Yours".

## Still yours

Code signing. (The repo is github.com/Zeratfule/EQ-Zera, private, since 2026-09-08; the placeholders are filled and the initial commit is in.)

## Roadmap 2 - as shipped (2026-09-08)

Every item above landed the same day, each behind its own unit suite and e2e spec:

| item | where | proof |
|---|---|---|
| engine wave | `eqlog` kinds `hail`, `factionHit`, sold `coins`; fold modules `hails`, `faction`, `coin`, `skills`, `deaths` | 64 / 435 / 295 cargo tests, clippy clean, factoring register widened by hand for the seven arms a new kind costs (`engine/factoring-baseline.json` comment) |
| 3 upgrade finder | `shared/build/upgradeFinder.ts`, Zone Loot chip + toggle, item-page line, Build tab "Where to farm" | `upgrade-finder.e2e` (Plane of Hate: 401 drops, 85 upgrades on the reference dump) |
| 4 quest tracker | `shared/questPins.ts`, `shared/questProgress.ts`, Quests tab tracked section + checklist, eighth celebration watch | `quest-tracker.e2e` (A Job for Nanrum completes on a live turn-in; ticks survive a relaunch) |
| 5 crafting | `main/craftIndex.ts` (`craft:index`), Crafting tab in the gear area | `crafting.e2e` (2,451 recipes; "one away" requires holding at least one ingredient) |
| 6 wish alerts | `wishDrop` / `wishZone` signals + seeds, toasts, `AppFocusView 'wishlist'` | `wish-alerts.e2e` (Earthen Blade, The Hole) |
| 7 death recap | `deaths` module → `death` toast + Overview "Last death" card | `death-recap.e2e` (276 taken, killer named) |
| 8 farm meter | overlay kind `farm` (before the strips; `conCard` is pinned last), the declared coin ladder, `RATE_MIN_MS` gate | `farm-overlay.e2e` |
| 9 / 10 / 11 | Character tab faction + skills panels, Leveling coin tile, Overview last-session card | `character-trackers.e2e` |

Not done, on purpose: others' loot lines (the log has none), a plat total anywhere in shared code
(the ladder is declared per surface), rarity in Zone Loot (needs a mob rescrape), in-app data
refresh and community counts (need the GitHub repo).

## Go-live and owner requests, 2026-09-08 evening (v1.19.0)

- Repository: `github.com/Zeratfule/EQ-Zera`, public. CI (`.github/workflows/ci.yml`) on every
  push and pull request; `release.yml` publishes the installer to GitHub Releases on a `v*` tag.
- Self-update ON, unsigned: the feed and installer come over HTTPS from this repo's releases and the
  installer is checked against the sha512 in `latest.yml`; `publisherName` is commented out so the
  Authenticode check skips rather than fails. A card names a new version (click to download, click
  to restart); the nav chip and Preferences offer the same. Signing: the six `AZURE_*` secrets are
  already passed by `release.yml`; add them and restore `publisherName` (SETUP.md, "Releasing").
- Feedback without a server: the dialog opens the sender's mail app addressed to the author, opens
  a GitHub issue, or copies the whole report (`shared/feedbackReport.ts`, `main/feedback/mail.ts`).
- The character model has race, sex and face controls (12 classic races + Iksar; faces measured from
  the archives, `EqModelPayload.faces`/`defaultFace`); Vah Shir, Froglok and Drakkin are named as not
  modelled yet (different archives and face schemes, see the research in the session).
- A new original EQZ icon (`scripts/gen-icon.mts`, `docs/plans/app-icon.md`), a purpose-drawn tray
  icon; the inherited voice pack removed with a store migration (schema 15) re-pointing stored alerts.
- Build tab item names show the item card on hover; Preferences → Thanks credits EverQuest Companion.
