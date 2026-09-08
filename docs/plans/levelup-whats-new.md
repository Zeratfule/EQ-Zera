# Level-up celebration + "what's new at this level"

Status: DESIGN. Author: planning session (Fable), 2026-08-05. Owner-requested.
Companion to docs/plans/celebration-toasts.md (the toast infra it rides).
Constrained by AGENTS.md: celebrations law (live transitions only), law 1
(messages over inference — unlock data is scraped knowledge, labeled), law 10
(combo intervals join at read), lint ceilings, scraper etiquette.

## 0. What we are building, in one paragraph

When you ding, a **celebration toast** fires ("Level 24!" + "3 new spells ·
2 new skills") and a **"New at this level" panel** in the Leveling tab shows,
for your CURRENT class combo, exactly what just unlocked: **new spells**
(chip per class it belongs to, hover for details — cast time, mana, target,
type, duration from the spell DB) and **new skills** — disciplines, granted
combat skills (Double Attack), innate actives (Smite). The panel is also
browsable by level so it answers "what do I get at 30?" without waiting.

## 1. Data (measured 2026-08-05)

- **Spells: the data already exists.** spells.json (1,926 rows) carries
  `classes: "* Enchanter - Level 37"` — raw wikitext lines, one per class,
  WITH the level. A pure parser (`shared/spellLevels.ts`,
  `parseSpellClasses(text): {cls: ClassAbbr, level: number}[]`) unlocks
  per-class per-level lists at runtime (1.9k strings, trivial). Node-tested
  against the real committed DB with floors; dirty variants measured first.
- **Skills/discs/innates: OVERTURNED by wave O1 (measured) — the wiki DOES
  state unlock levels.** classes.json now carries `skillUnlocks` (450 rows /
  16 classes, incl. 3 structure-derived innates like SHD Harm Touch@1) and
  `discUnlocks` (33 rows / BER MNK RNG ROG). The central Disciplines page's
  "only Rogue poison disciplines are on Legends" statement is quoted into
  `disputed[]` for the 13 non-Rogue rows — O2's panel renders those with an
  honesty chip, never silently. Spell parser: shared/spellLevels.ts
  (2,001 pairs; BER/MNK/WAR have zero Spellpage spells — skills-only
  classes, the panel must not render an empty "new spells" section as an
  error for them).

## 2. Behavior

- Trigger: the existing level-up event (progression module), LIVE only —
  replay/hydration never toast (celebrations law). Multi-ding bursts (rare)
  queue like any toast (cap 3).
- Toast: title "Level 24!", subtitle "<n> new spells · <m> new skills"
  computed against the combo at the ding's timestamp (`comboAt` — law 10:
  intervals join at read). Unresolved combo ⇒ counts across candidate
  classes labeled `~ambiguous` chip style; zero unlocks ⇒ toast still
  celebrates, subtitle just the level.
- Click → main window → Leveling tab, "New at this level" panel anchored at
  that level (nonce routing, the openLoot idiom).
- Panel (features/leveling): level stepper (defaults to current level),
  spells list (name, class chips lit per combo, hover = spell card from
  spells.json fields), skills list (kind chip: disc / skill / innate),
  sourced-from-DB labeling. Windowed/fixed-height per the list law.

## 3. Waves

- **O1 (data):** shared/spellLevels.ts parser + tests; scrape:classes
  extension + regenerated classes.json + tests (structure measured first).
- **O2 (UI):** panel + toast producer + deep link + tests + e2e check.
  O2 dispatches after wave N (shares App.tsx/toast producer files).

## 4. As shipped (wave O2, 2026-08-05)

Everything in §2 landed. Five things the design did not say, all measured:

- **The unlock dataset rides `spells:catalog` with a flag**, not a channel of
  its own: `shared/ipc.ts` belonged to the concurrent parity wave the day this
  shipped, so `getLevelUnlocks()` invokes the existing door with
  `{unlocks:true}` and main branches on a VALIDATED flag
  (`src/main/data/levelUnlocks.ts` `isUnlocksRequest`). The wizard's bare
  invoke is untouched and no larger. A dedicated `spells:unlocks` channel is
  the right shape and is three lines away — the seam is commented at both ends.
- **Rows fold by NAME, not per DB row.** The committed wiki DB carries genuine
  duplicate pages (`Imbue Emerald` twice at CLR 29); counting a name twice
  would inflate the toast's headline over a bookkeeping artefact.
- **The panel sits LAST on the tab, outside the chart branch.** Above the
  charts it pushed the level plot under the first-run analytics bar at an
  860px window (measured: content area +141px, the chart's own click point
  landing on the notice). Below them it costs the plots nothing, works on a
  log with no dings at all, and a toast's deep link scrolls it into view on
  arrival. The charts column gained its own `overflow:auto` in the same pass —
  it had been growing the app's content area, which a view may never do.
- **`ToastCard` gained ONE affordance**: a payload with no reward block makes
  the CARD the click target. A level is not a reward you can hold, so T6's
  "the item card is the only affordance" needed the level-up case spelled out.
  **JOS-334 made that affordance VISIBLE**: the card prints a compact action
  ("See what's new at 24", `toastActionLabel` in `shared/toast.ts` so the
  wording is a test's business) firing the card's own `onOpen` — a pointer
  cursor is not an affordance in a window nobody hovers. It is the same link,
  not a second one, and a focus the label cannot NAME prints nothing at all.
- **`AppFocus` anchors are per-view optional fields** (`mob`, `quest`,
  `level`), each validated at the IPC handler and rebuilt field by field, so
  the closed union stays closed. The Sky per-quest anchor wave L flagged is
  finished here: `PoskyView` resets its filters around the quest and remounts
  that ONE accordion expanded (the nonce rides its React key), leaving every
  other accordion independently open as before.
