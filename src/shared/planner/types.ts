// planner/types.ts — the EXALTATION PLANNER's shared data model (docs/plans/exaltation-planner.md §3.1).
//
// A plan is "which effects do I want socketed where, and which donor item do I farm for each".
// The types here are the seam between three owners: main builds `PlannerDonor` rows out of the
// committed item DB, the renderer edits `ExaltPlan`s, and the store persists them per character.
// Pure types + the pure modules beside them (normalize.ts, rules.ts) — zero runtime deps, so the
// node test runner imports them directly and both tsconfigs see the same file.
//
// Load-bearing constraints encoded here:
//   * EquipSlot is CLOSED and MEASURED. The 18 members are exactly the distinct equip slots the
//     committed corpus states (11,155 item pages, 32 raw tokens → 18 canonical; see normalize.ts).
//     There is deliberately NO CHARM: zero pages in the corpus name one, and a slot no item can
//     ever occupy would render as a permanently empty cell claiming a game fact we never observed.
//   * …and a PLAN is keyed by `PlanSlotId`, which is those 18 plus the SECOND ear, wrist and ring
//     (JOS-67) plus the TWO ANY SLOTS (JOS-104). Two different questions: an item states which SLOT
//     it occupies, a character has how many PLACES to wear one. See the block above `PairedSlot`
//     for the evidence and the additive-store argument, and the block above `AnyCell` for the
//     place that constrains no slot at all.
//   * SocketType omits Ornamentation (R5 — cosmetic, token-gated, not in game) and folds
//     `kind:'combat'` into 'proc' (D2 — the wiki spells procs `Combat Effect:`; measured
//     proc 0 / combat 453).
//   * Empty arrays mean UNKNOWN, never "none" (law 1). A donor with `classes: []` is a donor
//     whose page did not state a usable class list — the UI says so, it does not assume ALL.

import type { ClassAbbr } from '../classCombo'
import type { EffectFacts } from './effectText'

/**
 * Canonical equipment slots, normalized from the dirty wiki tokens (normalize.ts owns the
 * variant table). This is the COMPATIBILITY vocabulary — what R2 compares a donor against — and
 * it stays eighteen. How many of each a character WEARS is a separate question, answered by
 * `PLAN_SLOTS` below.
 */
export type EquipSlot =
  | 'PRIMARY'
  | 'SECONDARY'
  | 'RANGE'
  | 'AMMO'
  | 'HEAD'
  | 'FACE'
  | 'EAR'
  | 'NECK'
  | 'SHOULDERS'
  | 'BACK'
  | 'CHEST'
  | 'ARMS'
  | 'WRIST'
  | 'HANDS'
  | 'FINGER'
  | 'WAIST'
  | 'LEGS'
  | 'FEET'

/**
 * Every equip slot, in character-sheet order. The SLOT FILTER's option list and the ranking axis
 * the browser groups by; the Inventory board draws `PLAN_SLOTS` instead, which is this list with
 * the three paired slots doubled.
 */
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  'HEAD',
  'FACE',
  'EAR',
  'NECK',
  'SHOULDERS',
  'BACK',
  'CHEST',
  'ARMS',
  'WRIST',
  'HANDS',
  'FINGER',
  'WAIST',
  'LEGS',
  'FEET',
  'PRIMARY',
  'SECONDARY',
  'RANGE',
  'AMMO'
]

// ---- how many of each you actually WEAR (JOS-67) ---------------------------------------
//
// THE GAME GIVES YOU TWO EARS, TWO RINGS AND TWO WRISTS, and the planner used to give you one of
// each. `ExaltPlan.slots` was keyed by `EquipSlot`, so a Record could hold exactly one FINGER cell
// — which a player reported as "only allows one finger slot focus effect" (feedback
// 01KZCGQ5M395WN93FQD40RXZC6, v0.6.3). The design doc had already written the limitation down as a
// v1 simplification and parked it as open question §8.1; the report is the answer to that question.
//
// THE EVIDENCE IS THE GAME'S OWN INVENTORY DUMP, not the wiki and not a memory of EverQuest: a
// `/outputfile inventory` writes ONE top-level row per equipped slot, and in the committed 295-line
// dump `Ear`, `Wrist` and `Fingers` each appear TWICE (see shared/planner/inventorySlots.ts, whose
// `equippedHosts` used to take the first of each and say so). Three tokens, twice each — that is
// the whole rule, and nothing else in the eighteen repeats.
//
// SO A PLAN IS KEYED BY A CELL, NOT BY A SLOT. `PlanSlotId` is the eighteen plus three second
// cells; `equipSlotOf` maps a cell back to the compatibility vocabulary, and R2 is asked about the
// SLOT exactly as before — two rings are two places to wear a FINGER item, not a new kind of item.
// The widening is ADDITIVE in the store (D4's argument, and `classesProvenance`'s): every plan ever
// written keys cells by the eighteen names, all of which are still legal, so no migration
// transforms anything and `tests/plannerStore.test.mts` pins the round trip.

/** The three equipment slots a character wears TWO of. Measured from the game's own dump. */
export type PairedSlot = 'EAR' | 'FINGER' | 'WRIST'

export const PAIRED_SLOTS: readonly PairedSlot[] = ['EAR', 'WRIST', 'FINGER']

/** The SECOND cell of each paired slot. */
export type SecondCell = 'EAR2' | 'WRIST2' | 'FINGER2'

// ---- the two places that constrain no slot at all (JOS-104) -----------------------------
//
// THE GAME GIVES YOU TWO "ANY SLOT" PLACES, and the planner gave you none — reported by a v0.12.0
// player as "missing 2x any slots" (feedback 01KZGHFSF6TW32TA4SMJQNWJE9).
//
// THE SLOT IS OFFICIAL. Daybreak's own 2026-07-28 update notes describe an Improved Bash AA
// choosing gear from "the primary, secondary, or Any slots" — the devs enumerate it as a peer of
// the two hands, capitalized as a proper slot name.
// (https://www.everquestlegends.com/patch-notes/eql-update-notes-7-28-2026)
// A community FAQ states the count and the kind in one line — "Two slots that take any item type"
// (https://www.everquestguides.com/everquest-articles/everquest-legends-the-new-player-faq/), and
// it is UNOFFICIAL, so it is cited as corroboration rather than as the basis. eqlwiki.com has no
// page, category or sentence about the slot at all (searched 2026-08-08); its `Equipment_By_Slot`
// page is stale classic-EQ data that says so itself, so its silence proves nothing either way.
//
// THE BASIS IS THE GAME'S OWN INVENTORY DUMP, same witness JOS-67 rested on and read the same
// way. In the committed 295-line dump (`tests/fixtures/Primitive_freeport-Inventory.txt`) the
// client writes `Any Slot` TWICE at top level — once as the FIRST equipment row and once between
// `Waist` and `Ammo` — and both rows hold real gear that is not empty:
//
//     Any Slot   Brigandine Tunic +1        (the corpus states its slot: CHEST)
//     …
//     Chest      Red Dragonscale Armor +1   (CHEST)
//     …
//     Any Slot   Midnight Clad Straps +2    (CHEST)
//
// Three chest-slot items worn at once, in three different places, with the Chest row filled
// separately — so these are two EXTRA places to wear something, not another spelling of a slot the
// eighteen already have. `shared/outputs/inventory.ts` has carried the token in `EQUIP_LOCATIONS`
// since the outputs model landed, and `inventorySlots.ts` mapped it to `null` and said in writing
// that it was "a real place to wear something and it is not one of the eighteen". That was true;
// what was missing was the cell.
//
// AND ITS SOCKETS ARE REAL — which is the one thing NO source states, in either direction. The
// dump prints `Any Slot-Slot2`, `-Slot7`, `-Slot8` children under both rows, the same `-Slot<n>`
// shape every other equipped item's exaltation sockets take (`Face-Slot7  Polished Mithril Mask
// (Exaltation)`). The client is printing exaltation sockets on an any-slot item, so a planner cell
// here plans exactly what the other cells plan, and the measurement stands in for the missing doc.
//
// AN ANY CELL NAMES NO EQUIP SLOT, AND THAT IS THE MODEL GAP. `equipSlotOf` was TOTAL — every cell
// answered with one of the eighteen — and R2 was asked `[equipSlotOf(cell)]`. There is no eighteen
// to answer with here: the client's own name for the place is "Any Slot", and the wiki corpus
// states ZERO items with an `ANY` slot token (normalize.ts's measured 32-token inventory), so ANY
// is a property of the PLACE and never of an item. So `equipSlotOf` now returns `null` here and
// `hostSlotsOf` is what R2 asks — the eighteen for an any-cell, exactly one for everything else.
//
// …AND R2 IS ABOUT TWO ITEMS ANYWAY, WHICH IS WHY THIS COSTS NOTHING. eqlwiki's Exaltations page
// puts the restriction on the donor: an exaltation carries "the equipment slot restrictions of
// their source item" (https://eqlwiki.com/Exaltations), and the destination it must match is the
// HOST ITEM. For the other twenty-one cells the cell's slot and the host's slot are the same fact,
// so asking the cell was a free shortcut; here the shortcut has nothing to return, and the cell
// correctly constrains nothing while the host still constrains everything.
//
// WHAT IS NOT CLAIMED: both any-slot rows in the one dump we hold happen to carry CHEST items, so
// "any equip slot is legal here" rests on the client's own token NAME (and the FAQ's wording)
// rather than on a measurement covering all eighteen. That is stated rather than hidden, and it
// errs the safe way — a cell that declines to constrain lets the user plan what they can see
// themselves wearing, where a guessed constraint would refuse a socket the game allows
// (awaiting-sample law).

/** The two slot-agnostic places a character wears something. Measured from the game's own dump. */
export type AnyCell = 'ANY1' | 'ANY2'

export const ANY_CELLS: readonly AnyCell[] = ['ANY1', 'ANY2']

const ANY_CELL_SET: ReadonlySet<string> = new Set<string>(ANY_CELLS)

/** True for the two cells that constrain no equip slot. The one runtime test of `AnyCell`. */
export function isAnyCell(cell: PlanSlotId): cell is AnyCell {
  return ANY_CELL_SET.has(cell)
}

/**
 * One cell of a plan: an equip slot, the second of a pair, or one of the two any-slots. This is
 * what `ExaltPlan.slots` is keyed by and what the Inventory board draws — never what a donor
 * states about itself.
 */
export type PlanSlotId = EquipSlot | SecondCell | AnyCell

/**
 * Every cell, in character-sheet order, each pair adjacent — the board's grid order.
 *
 * The two any-slots come LAST rather than where the dump prints them (first, and between Waist and
 * Ammo). The dump's order is the client's equipment indexing, this list is the board's reading
 * order, and the two have never matched; appending leaves all twenty-one existing cells exactly
 * where the user already found them and reads as what these are — the extra places.
 */
export const PLAN_SLOTS: readonly PlanSlotId[] = [
  'HEAD',
  'FACE',
  'EAR',
  'EAR2',
  'NECK',
  'SHOULDERS',
  'BACK',
  'CHEST',
  'ARMS',
  'WRIST',
  'WRIST2',
  'HANDS',
  'FINGER',
  'FINGER2',
  'WAIST',
  'LEGS',
  'FEET',
  'PRIMARY',
  'SECONDARY',
  'RANGE',
  'AMMO',
  'ANY1',
  'ANY2'
]

/** `EAR2` → `EAR`. The table, not a suffix strip: three facts beat a regex over a key space. */
const EQUIP_OF_CELL: Record<SecondCell, PairedSlot> = {
  EAR2: 'EAR',
  WRIST2: 'WRIST',
  FINGER2: 'FINGER'
}

/**
 * The equipment slot a cell occupies, or `null` for the two that occupy none (JOS-104).
 *
 * The eighteen answer themselves, the three second cells consult the table, and an any-cell
 * answers NULL — which is a fact about the place, not a missing value: nothing about ANY 1 says
 * whether the thing in it is a ring or a breastplate. Callers that want the R2 question answered
 * ask `hostSlotsOf` instead; callers that want a FILTER (the browser's slot select) take the null
 * as "no slot filter", which is the same word that control already uses.
 */
export function equipSlotOf(cell: PlanSlotId): EquipSlot | null {
  if (isAnyCell(cell)) return null
  return EQUIP_OF_CELL[cell as SecondCell] ?? (cell as EquipSlot)
}

/**
 * The equip slots a cell may host — what R2 is really asked (rules.ts `socketCompatibility`).
 *
 * One slot for the twenty-one named cells; ALL EIGHTEEN for an any-cell, because the place states
 * no restriction and the restriction that does apply belongs to the host item. A donor whose page
 * stated no slot at all still fails, there as everywhere: it shares a slot with nothing.
 */
export function hostSlotsOf(cell: PlanSlotId): readonly EquipSlot[] {
  const slot = equipSlotOf(cell)
  return slot === null ? EQUIP_SLOTS : [slot]
}

/**
 * The cells one equip slot occupies, in board order — one for most, two for the paired three.
 *
 * The any-cells are deliberately NOT returned: this answers "where does a FINGER item naturally
 * go", and the honest answer is the finger cells. They are reachable from the board instead (see
 * `features/planner/plannerReplace.ts`), which is where they exist and where they fill themselves.
 */
export function cellsForSlot(slot: EquipSlot): PlanSlotId[] {
  return PLAN_SLOTS.filter((c) => equipSlotOf(c) === slot)
}

/** What an any-cell is CALLED — the client's own words for the place, numbered like a pair. */
const ANY_LABEL: Record<AnyCell, string> = { ANY1: 'ANY SLOT 1', ANY2: 'ANY SLOT 2' }

/**
 * What a cell is CALLED. A paired slot's two cells are numbered ("FINGER 1", "FINGER 2") because a
 * board that drew "FINGER" twice would read as a bug; the two any-cells are numbered for the same
 * reason and keep the client's own noun; every other cell is its own slot name.
 */
export function planSlotLabel(cell: PlanSlotId): string {
  if (isAnyCell(cell)) return ANY_LABEL[cell]
  const slot = equipSlotOf(cell)
  if (slot === null || !(PAIRED_SLOTS as readonly string[]).includes(slot)) return cell
  return `${slot} ${cell === slot ? '1' : '2'}`
}

/**
 * The four TRANSFERABLE socket types, in unlock order. Ornamentation is excluded on purpose
 * (R5): it is cosmetic, comes from a Marketplace token rather than a tier, and is not in game.
 */
export type SocketType = 'focus' | 'click' | 'worn' | 'proc'

/**
 * The four socket types as VALUES, in unlock order — the filter toggle's row, and the closed
 * allowlist main re-validates a renderer-supplied plan against (a union alone cannot do that at
 * runtime). Same arrangement as EQUIP_SLOTS above: one list, no second opinion.
 */
export const SOCKET_TYPES: readonly SocketType[] = ['focus', 'click', 'worn', 'proc']

/** The item tier a donor must be merged to before that socket's effect can be EXTRACTED (R1). */
export type ExtractTier = 1 | 2 | 3 | 4

/**
 * One effect as it exists on one donor item — the denormalized row main serves over IPC. An
 * item with three effects contributes three donors; the (key, effect) pair is the row identity.
 */
export interface PlannerDonor extends EffectFacts {
  /** `itemKey(name)` — the corpus's canonical, `+N`-stripped, case-folded key. */
  key: string
  name: string
  iconId?: number
  /** normalized equip slots; `[]` = the page stated none (quest/tradeskill oddities, non-equippable) */
  slots: EquipSlot[]
  /** normalized classes; `[]` = UNKNOWN (never "nobody"), 16 entries = ALL */
  classes: ClassAbbr[]
  /** effect name as written ("Improved Healing III") */
  effect: string
  /** the parenthetical as written ("Combat, Casting Time: Instant") */
  detail?: string
  // V6 — `spellType` / `spellTarget` / `spellDuration` arrive from `EffectFacts` above: the
  // committed spell DB joined by case-folded effect name at index build. All three are absent
  // when the join missed (5.8% of rows), and the row then simply says less (law 1, never a guess).
  /**
   * V5 — the FOCUS family this effect belongs to, parsed off its own name at index build
   * ("Improved Healing III" → "Improved Healing"). Present on focus rows ONLY: a rank in the name
   * is the corpus's only magnitude signal and "which is best" is a focus question, so a proc's
   * Roman numeral is deliberately left unparsed (see normalize.ts `parseFocusEffect`).
   */
  family?: string
  /**
   * The rank within `family` — 3 for "Improved Healing III", 14 for "Percussion Resonance 14",
   * 1 for a focus name that states no rank at all. Comparable only INSIDE one family, and named
   * apart from `tierRequired` above, which is the unrelated merge tier the effect extracts at.
   */
  familyTier?: number
  /** which socket this effect occupies; `combat` folded to `proc` (D2) */
  socket: SocketType
  /** merge tier required to extract it (R1: focus +1, click +2, worn +3, proc +4) */
  tierRequired: ExtractTier
  /** R3 — haste never travels as an exaltation. Flagged, never hidden. */
  hasteLocked: boolean
  quest: boolean
  playerCrafted: boolean
  reqLevel?: number
  /**
   * What the ITEM PAGE itself says about where this drops (`|dropsfrom`) — a SECOND witness
   * beside the renderer's mob-catalog inversion (`features/planner/sourceIndex.ts`), which
   * inverts `|known_loot` from the other side of the same wiki.
   *
   * They disagree by omission in both directions: measured 2026-08-04, 126 effect-bearing donor
   * keys are neither quest nor crafted and yet have NO catalog source, and 43 of those name a
   * zone here. Absent when the page carried no `|dropsfrom`; an entry's `zone` is absent when
   * the page listed the mob under no zone heading (unknown, never guessed — law 1).
   */
  wikiSources?: { mob: string; zone?: string }[]
  /**
   * The item page's own era banner, VERBATIM ("Velious", "Chardok Revamp") — the THIRD witness,
   * and the weakest, so it is the last one consulted. Zone provenance decides an era whenever it
   * can; this tag only speaks when neither the mob catalog nor `wikiSources` placed the item
   * anywhere (`shared/planner/era.ts layeredVerdict`). Absent when the page opened with no banner.
   */
  eraTag?: string
}

/**
 * One row of the HOST PICKER's item search (`window.eq.plannerSearchItems`). Deliberately not a
 * `PlannerDonor`: a host is any equippable item, effect-bearing or not, and the picker only needs
 * enough to draw a row and decide slot/class compatibility. Built by src/main/planner/effectIndex.ts.
 */
export interface PlannerItemHit {
  /** `itemKey(name)` — the same key a PlannerDonor carries, so the two indices join */
  key: string
  name: string
  iconId?: number
  /** normalized equip slots; `[]` = the page stated none */
  slots: EquipSlot[]
  /** normalized classes; `[]` = UNKNOWN (never "nobody") */
  classes: ClassAbbr[]
}

/** A planned socket inside a set: the effect the user wants, and the donor they chose to farm. */
export interface PlanSocket {
  effect: string
  /** `PlannerDonor.key` — which donor item supplies it (an effect can have many donors) */
  donorKey: string
}

/** One CELL of a plan: an optional host item plus up to one socket of each type. */
export interface PlanSlot {
  /** `itemKey(name)` of the host item; absent = the user hasn't picked one yet */
  hostKey?: string
  hostName?: string
  sockets: Partial<Record<SocketType, PlanSocket>>
}

/**
 * WHERE A SET'S CLASS FILTER CAME FROM (planner-v2 V2).
 *
 * `detected` — the set is FOLLOWING live class-combo inference: a loadout switch or a fresh
 * `/who` rewrites the filter, because a set that was seeded once and then orphaned goes stale
 * silently (the owner's live case: the planner showed `rog pal ber` long after the truth was
 * `pal enc mnk`).
 * `user` — the user edited the trio, so it is PINNED. Detection never overwrites it; when the two
 * disagree the toolbar offers the detected trio as a chip and applying it is one click.
 *
 * ABSENT MEANS `user`, and that is the honest reading rather than a default: every set stored
 * before this field existed carries a trio a person typed (or accepted) at creation, and silently
 * re-binding those to today's detection would rewrite work nobody asked us to touch.
 */
export type ClassesProvenance = 'detected' | 'user'

/** A named exaltation set. Persisted per character under `ProgressState.exaltPlans` (D4). */
export interface ExaltPlan {
  /** `crypto.randomUUID()` — stable across renames, the React key and the CRUD handle */
  id: string
  name: string
  /** the target loadout this set is built for (D5); 1–3 classes, defaulting to the inferred combo */
  classes: ClassAbbr[]
  /**
   * V2 — whether `classes` is following detection or pinned by the user. OPTIONAL and additive,
   * exactly like `exaltPlans` itself (D4): every reader defaults (absent ⇒ `user`, see the type),
   * so no schema bump and no migration step — `tests/plannerStore.test.mts` pins that a set
   * written without it round-trips byte-for-byte.
   */
  classesProvenance?: ClassesProvenance
  createdAt: number
  updatedAt: number
  /**
   * The plan's cells, keyed by `PlanSlotId` — twenty-three: the eighteen equip slots, the second
   * ear/wrist/ring (JOS-67, because you wear two of each), and the two any-slots (JOS-104).
   * Widened ADDITIVELY both times: every key a past build could write is still a legal key, so
   * nothing needs migrating and `tests/plannerStore.test.mts` pins the round trip.
   */
  slots: Partial<Record<PlanSlotId, PlanSlot>>
}
