# Planner v2 — owner feedback round, 2026-08-05

Status: DESIGN, waves not started. Author: planning session (Fable), 2026-08-05.
Builds ON `exaltation-planner.md` (rules R1–R6, decisions D1–D8, the shipped
v0.4.0 planner) — read that first; nothing there is restated except where this
round OVERTURNS it. Constrained by `AGENTS.md` as usual: 400-line ceiling, one
nowrap toolbar row, search law, world-model law 1 (empty = unknown, never
none), law 12 (renames are knowledge, never fuzzy).

## 0. What this round is, in one paragraph

The owner used the shipped planner in anger and came back with a list. Two
themes: **trust** (the class trio is a stale one-time seed; Kunark epics leak
through the era filter; summoned/GM items don't belong in the browser at all)
and **scannability** (grouping is hardcoded to effect-name; focus effects
should self-organize into "best Improved Healing, best Burning Affliction…";
every proc/worn row should say what the effect *does* without a wiki trip; a
host item should be browsable slot-by-slot like the in-game item window).
Plus: Board becomes **Inventory** and learns to fill itself from an inventory
dump, and the module grows a collapsible teacher for the exaltation rules.

## 1. Corrections of record (owner, 2026-08-05)

- The inferred trio can be WRONG and there is no way to say so in the planner
  (owner's live case: shows `rog pal ber`, truth is `pal enc mnk` after a
  loadout switch + Sky clear). Provenance exists (`classCombo.ts`
  `user > who > inferred`) — the planner just never surfaces or rebinds it
  (`PlannerView.tsx` seeds once at set creation, then the set's `classes`
  array is orphaned).
- Ragebringer and the Beastlord epic render CLEAN (no era chip) with the
  era filter ON. Root cause measured: `shared/planner/era.ts` maps
  `epics: 'classic'` / `epicquests: 'classic'`, and quest-reward epics have
  zero droppers, so the zone layer (R6's layer 1) never fires. Epics are a
  KUNARK system; 188 pages carry those two tags.
- Summoned items (mage-conjured) appear as donors. No effect can be pulled
  off a summoned item (owner assertion — encode as R7 after a one-source
  verification, same bar as R1–R6).
- GM-event items appear. They should not.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| V1 | `epics`/`epicquests` eraTag → **kunark**, one line in `era.ts` + test pinning Ragebringer out-of-era | Epics shipped with Kunark; the tag IS the era signal the zone layer can't provide for dropperless quest rewards |
| V2 | The set's class trio is a **FILTER, not a rule** (owner, 2026-08-05: "sets are really a filtering experience"). It follows live detection until the user edits it (then pinned, `provenance: user`, with a "detected: X Y Z — apply" chip on disagreement) — but nothing is ever ENFORCED by it: a donor outside the filter is hidden by the browser filter like any other, and anything ALREADY IN the set/build that no longer matches the current filters is kept and **highlighted as a mismatch** (chip idiom, same family as the era chip), never removed or blocked | Filtering is reversible and legible; enforcement would make a re-inference or loadout switch silently invalidate work. Mismatch-highlighting is how the set stays honest about both |
| V3 | The class picker is the **Sky tracker's chip multi-select autocomplete**, extracted into a shared component first (it is 9 inline MUI lines in `PoskyView.tsx`, the only Autocomplete in the renderer), capped at `MAX_COMBO_SLOTS` | One idiom for "pick several from a closed list" everywhere; the extraction is its own commit so Posky provably does not change |
| V4 | Grouping becomes a **declared model, not a fold**: `groupBy: effect \| slot \| socket \| era` (persisted per socket type in the existing `DonorView` object), rendered as header rows in the SAME two-variant windowed row union (headers are 44px rows too — `useWindowedRows` survives) | The one hardcoded `groupByEffect()` is the ceiling on every request in this round; headers-as-rows keeps the windowing law |
| V5 | **Focus family + tier are parsed once, in main, at index build** (`effectIndex.ts`): `Improved Healing III` → `{family: 'Improved Healing', tier: 3}`; focus default view groups by family, sorts tier-desc, crowns the best row per family | The Roman numeral is the ONLY magnitude signal in the corpus (no percent field exists anywhere — measured); parsing at the boundary, once, is law 2 |
| V6 | **Effect one-liners join `spells.json` by case-folded name at index build** (94.4% of 1,523 effect rows match) and ship on `PlannerDonor` as 2–3 new fields (target/type/duration composed renderer-side); misses render nothing, never a guess | The join is measured and cheap; the donor payload is already a one-shot cached IPC fetch. Damage/heal magnitudes are NOT in the corpus — that gap belongs to the additive layer (§4), not to synthesis |
| V7 | Board → **Inventory**. Auto-fill: `InventoryDump`'s closed `EQUIP_LOCATIONS` set joins the planner's `EquipSlot` via a **hand-authored table** (law 12 — `Fingers` vs `FINGER`; `Any Slot` maps to nothing), fills each cell's host from what is equipped, hand-picked hosts win over auto-fill, and an instructions card teaches `/output inventory` (the discovery/watch/reload plumbing already exists) | The shared-outputs header explicitly demands the hand join; no renderer code consumes `InventoryDump` yet, so this is greenfield with the parser already paid for |
| V8 | **Host slot view**: selecting a host shows its unlocked sockets R1-style (Focus @+1 … Proc @+4) with current plan contents; clicking a socket opens the effect browser pre-filtered to that socket + the host's slot/classes | The item-window mental model from the game (owner's screenshot); it is a FILTER PRESET over the existing browser, not a second browser |
| V9 | **Exclusions are knowledge, not heuristics**: a committed curated list (additive layer §4) seeds `summoned` and `gm-event` flags; the `Summoned:` name prefix is the only automatic rule (it is the item's own name, not an inference). GM-event-ness lives in the wiki item's NOTES prose (owner, 2026-08-05: no category page exists) — so a **post-processing pass at scrape time** flags pages whose notes match GM-event phrasing into a GENERATED candidate list, reviewed by hand once and committed to the additive layer (flag mechanically, admit by hand — law 12's shape). Excluded items are dropped from the DONOR index only — they stay in item lookup | 8 name-prefix hits are safe; the notes text is the item's own page (a boundary canonicalization, not a guess); everything the text pass misses is hand-named as spotted |
| V10 | The **explainer** is a collapsible card above the browser rendering R1–R6 from `rules.ts` exports (never restating numbers), dismissed state persisted, re-opened from a permanent `?` in the toolbar | Teaching the system was always §5's intent; dismiss-without-loss is the owner's explicit ask |
| V11 | Bard instrument grouping is **deferred to the additive layer**: no instrument field exists (measured: 9 incidental mentions, all tradeskill components). When the layer carries `instrument: wind \| string \| brass \| percussion \| singing`, V4's grouping model picks it up as one more axis for free | Building the axis now with no data would render empty groups; the grouping model is designed so the data's arrival is the whole diff |

## 3. Waves (post-v0.6.1; order is dependency order, not priority)

- **W-A (trust, small, ships first)**: V1 era fix + test; V9 `Summoned:`
  prefix exclusion + the additive-layer file stub with the first curated
  entries (BL epic, Ragebringer already covered by V1; GM list starts empty);
  R7 verification note in `exaltation-planner.md` §1.
- **W-B (class binding)**: V3 extraction commit, then V2 in the planner —
  binding semantics in `usePlans.ts` (a `classesProvenance` field per set),
  the disagree-chip, `ClassPickerDialog` replaced by the shared autocomplete.
- **W-C (grouping engine)**: V4 model + V5 focus families. Rewrites
  `flatten()`/`groupByEffect()`; `EffectFilterBar` gains the group-by
  control; per-socket defaults: focus → family, everything else → effect.
  The 400-line ceiling WILL bite `EffectBrowser.tsx` — plan the split
  (grouping model → `plannerGroups.ts`) before writing, not after.
- **W-D (one-liners)**: V6 fields through `effectIndex.ts` → `PlannerDonor`
  → a muted second line… no — SAME 44px row, appended muted inline text after
  the effect name (windowing law); truncated with title-attr overflow.
- **W-E (inventory)**: V7 rename + join table + auto-fill + instructions
  card + manual override precedence.
- **W-F (host view)**: V8 socket pane + browser filter presets.
- **W-G (explainer)**: V10.
- **W-H (additive layer, owner-gated)**: §4 built out — only on the owner's
  explicit go.

## 4. The additive item-knowledge layer (and the agentic research loop)

The corpus keeps proving the same shape of gap: facts that exist in the world
but not in any parseable wiki field (focus percentages, damage/heal magnitudes,
bard instrument types, GM-event provenance, summoned-item status beyond the
name prefix). The owner's proposal — an agentic loop that researches known
items one at a time and writes STRUCTURED findings — fits the codebase's
existing overlay pattern (messageOverlay): a committed
`src/main/data/itemsResearch.json` keyed by the same `itemKey()`, carrying
only fields the scrape can never produce, each with `{value, source, checkedAt}`
provenance, merged in `itemsDb.ts` AFTER the wiki record so a rescrape stays
idempotent and the two layers never fight. `effectIndex.ts` reads the merged
view and every consumer above it is unchanged.

Status: **shape agreed, loop NOT commissioned** (owner: "not sure we're
reaching for this yet"). W-A creates the file and the merge point with curated
hand entries only — which is exactly the schema the loop would later fill, so
commissioning it becomes a data decision, not a code change.

**JOS-25 filled the two tables that need no loop** (2026-08-06), through the
same file and the same merge — no second path:

- **GM-event × 10.** Swept from the corpus's own `|notes` prose (`summary`)
  plus the `|gmitem` template param. The bar is UNHEDGED prose *and* no drop
  source / quest / recipe anywhere on the page; six of the ten carry an
  effect, so the V9 exclusion moved 40 → 45 pages. **Five mentions were
  refused and named in `tests/itemsResearchLayer.test.mts`**, the loudest
  being `Dabner's Staff of Recall`, which states `|gmitem` and a live
  `|dropsfrom` mob in one template — flagging it would have hidden a
  farmable donor. The others: `Shield of Hatred` ("Possibly … ?"),
  `Da Oogly Stick` / `Gnome Sandwich` (GM *item*, never GM *event*),
  `Stone of Gnoming` ("GM Only item" — and SOLD in Sunset Home).
- **GM-only × 3 — the ruling (owner, 2026-08-06, JOS-64): GM-only and
  GM-event both mean unfarmable.** Three of those five refusals were about
  PHRASING, not facts: nothing hedged, no farm route on the page, and no plan
  a player can execute. `Da Oogly Stick` ("This item is a GM item."),
  `Gnome Sandwich` ("GM item occasionally handed out.") and
  `Stone of Gnoming` ("GM Only item." — the wiki's Sunset Home is the GM
  zone, not a player vendor) are now filed under a SECOND flag, `gmOnly`,
  with the same treatment: verbatim source line, no farm route, excluded as
  donors. Two of the three carry a click illusion, so the V9 exclusion moved
  45 → 47 pages. A second boolean rather than one `unfarmable` field because
  the layer states FACTS AS PAGES WRITE THEM and the tripwire re-derives each
  table from its own anchored prose; the VERDICT is one exported function,
  `isUnfarmable()`, which is the only thing `effectIndex.ts` asks. The two
  surviving refusals are refused on facts and stay refused:
  `Dabner's Staff of Recall` names a live drop mob (still a DONOR) and
  `Shield of Hatred` asks a question.
- **Bard instruments × 47.** Fully derivable from the committed corpus, so no
  new scrape happened: 42 pages state the family in the stats block
  (`Wind Resonance: 12`, older `Stringed Instrument`) and 5 state it in
  `|focus_effect` (`Brass Resonance 14`, already folded in as a focus effect —
  see normalize.ts's focus-rank note). Normalized to five families
  (wind 15 · string 12 · brass 11 · percussion 8 · all 1). A raw-wikitext
  sweep of the gitignored scrape cache found the SAME 47 and nothing more, so
  this is the wiki's whole answer, not the scrape's. No consumer reads
  `instrument` yet — V11's grouping axis is what will.

Both tables restate something the pages say, which is the one real hazard of a
layer that overlays the scrape: a stale entry looks like fact. So
`tests/itemsResearchLayer.test.mts` re-derives BOTH from `items.json` and fails
on any disagreement in either direction — the zone table's anti-fuzzy tripwire,
applied to curation.

## 5. Open questions — ANSWERED (owner, 2026-08-05)

- Q1 → **the combo is a filter, not a rule.** V2 rewritten above: loose
  association, mismatch-highlighting on the current build, nothing enforced.
  Existing sets keep their authored trio (pinned) with the disagree-chip.
- Q2 → **researched (integrator, 2026-08-05), and the record is EMPTY both
  ways**: eqlwiki Exaltations, the official 7/14 patch notes, the
  eqlegends.wiki exaltation guide and eqlegendstools' donor lists none state
  whether summoned/temporary items can merge or donate. Design motive to
  block it is obvious (conjured items are unlimited free merge copies), but
  motive is not a rule. R7 therefore stays **owner-observed, unverified** —
  excluded from the donor index anyway (wrongly hiding a few donors is
  recoverable; wrongly listing them poisons trust). THE DECISIVE TEST is
  in-game and takes 30 seconds: attempt to merge two identical summoned
  items — a refusal makes extraction structurally impossible and graduates
  R7 to verified. Owner to run it when convenient.
- Q3 → **no category page exists; GM-event-ness is prose in the item's wiki
  notes.** V9 grew the post-processing pass: scrape-time text flagging into a
  generated candidate list, hand-reviewed once, committed to the additive
  layer. Several EFFECTS are GM-event-only — the pass should flag by effect
  as well as by item, so one review catches the whole family.
