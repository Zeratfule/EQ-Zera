// gear/gearFilter.ts — THE GEAR TABLE'S MODEL: scale, then filter, then sort (JOS-284, phase 3).
//
// THE ORDER IS THE WHOLE DESIGN, and it is not negotiable. The global plus-state selector changes
// what every row IS — a weapon's ratio improves with every tier because DMG scales and DELAY does
// not (phase 0's rule, `gearScale.ts`'s header) — so a sort that ran on BASE numbers under a `+5`
// slider would be answering a question nobody asked. Everything below reads the SCALED vector:
//
//     scaleAll(rows, state) → filterGearRows(…) → sortGearRows(…)
//
// `scaleAll` is measured at ~18 ms for the whole 6,814-row index (tests/gearIndex.test.mts prints
// it every run), which is what lets the selector be a live slider rather than an Apply button.
//
// PURE AND NODE-TESTABLE (`tests/gearFilter.test.mts`), the plannerGroups/plannerClasses precedent:
// value imports are RELATIVE, nothing here touches React, storage, IPC or the corpus. The one rule
// this file does NOT own is the ERA verdict — that lives in `plannerData.eraHides`, which reaches
// the renderer's mob-catalog inversion and cannot be imported under the node runner. So it arrives
// as an injected predicate (`GearFilterDeps.eraHidden`) rather than being restated here, which is
// also what keeps the gear table and the exaltation browser from ever disagreeing about an era.
//
// ABSENT IS NOT ZERO, AND THE SORT IS WHERE THAT NOW LIVES. `GearStats` omits a key the item never
// stated (gear.ts, law 1), so a SORT puts absent LAST in both directions — ascending by haste must
// not rank six thousand plain items above the sixty-four that state one, and descending must not
// either. `gearRatio` is `undefined` for anything that is not a weapon, so a ratio sort never ranks
// 5,000 non-weapons at zero. `gearEffectiveHp` (JOS-336) obeys the same rule from the other side: a
// row stating NEITHER HP nor STA reads `undefined`, while a row stating just one reads that one —
// silence is not a zero, and a stated number is not silence.
//
// THERE IS NO NUMERIC FILTER LEFT IN THIS FILE (owner ruling 2026-08-13, JOS-302, fourth ask:
// *drop the min-ratio and stat-at-least filters completely - sorting services that need without
// spending toolbar real estate*). The stat-threshold chips (`hp 50`, `sv magic >= 20`), their
// parser and their `minRatio` companion are DELETED, not hidden. Their whole job was "show me the
// items that reach a number", and clicking a column header answers that better: a sort puts the
// best at the top and still shows you what the next ten look like, where a threshold makes you
// guess the cutoff and re-type it when you guessed wrong. What used to be a threshold's other job —
// putting the stat's COLUMN on the table — is the columns picker's now (JOS-297, gearColumns.ts):
// you ask for the column by name and then you sort it.
//
// WHAT SURVIVES IS FIVE CLOSED QUESTIONS ABOUT WHO A ROW IS — its name, its slots, its weapon kind,
// its classes, its effect kind — plus the two injected verdicts (era, ownership). Every one of them
// is a set membership rather than a number, which is why none of them needs the plus-state to mean
// anything and why the whole filter is now cheaper than the scale that precedes it.

import type { ClassAbbr } from '../../../../shared/classCombo'
import type { ItemUpgradeState } from '../../../../shared/itemUpgrade'
import type { GearRow, GearStatKey } from '../../../../shared/planner/gear'
import { gearEffectiveHp, gearRatio, scaleGearRow } from '../../../../shared/planner/gearScale'
import { weaponPicksMatch, type WeaponPick } from '../../../../shared/planner/weaponType'
import type { EquipSlot, SocketType } from '../../../../shared/planner/types'

// ---- the filter model ---------------------------------------------------------------------

/**
 * The effect filter, in the DONOR vocabulary (`SocketType`) plus the two answers a socket cannot
 * give. `any` does not filter; `has` is "states any effect line at all", which is the question a
 * player asks before they know which kind they want.
 */
export type EffectFilter = 'any' | 'has' | SocketType

/**
 * Everything the table filters on, combinable — every field is ANDed, and each is INERT at its
 * empty value (`''`, `[]`, `'any'`, `false`). That is what makes "a slot, and a weapon kind, and a
 * class combo, and an effect kind, and an era" one object rather than five modes.
 *
 * THE LIST-VALUED FIELDS ARE UNIONS INSIDE AND AN AND BETWEEN (JOS-302). `slots` and `weaponTypes`
 * each keep a row that matches ANY of their entries, and the two narrowings then AND with each
 * other and with everything else — "a PRIMARY or SECONDARY, that is a one-hander, that a Paladin
 * can wear" is one question, not three modes.
 */
export interface GearFilters {
  /** the DEFERRED search text (the standing search law — the view owns the `useDeferredValue`) */
  text: string
  /**
   * The equip slots asked for. `[]` = every slot; several = the UNION (JOS-302, the owner's second
   * ask: *multiple slots can be chosen at once, e.g. PRIMARY + SECONDARY*). A row occupies several
   * slots of its own, so the test is "do the two lists intersect", never "is this THE slot".
   */
  slots: EquipSlot[]
  /**
   * THE CLASS COMBO THE TABLE IS READING FOR — AND ON THIS SURFACE IT NARROWS THE CORPUS
   * (owner ruling 2026-08-13, JOS-302, verbatim: *gear that does not match the class filter is
   * tagged with an off-filter chip instead of being filtered out - obviously wrong, it should just
   * be removed*).
   *
   * That OVERRULES the V2 "a filter and never a rule" law FOR THE GEAR SEARCH TABLE, and only for
   * it. The rest of V2 stands and is untouched: the planner build pane still CHIPS a donor whose
   * class list has drifted out of the plan's trio (`PlannerChips.MismatchChip`, drawn by PlanCell
   * and FarmList), because there the row is work you already planned and removing it would delete
   * a decision. Here the row is a candidate you have not chosen yet, and a candidate your character
   * cannot equip is not a candidate.
   *
   * TWO EMPTIES ARE STILL UNKNOWNS, and neither is a mismatch (`classMismatch`): an empty filter
   * asks for no class filter at all, and a page that stated NO class list is KEPT — silence is not
   * a refusal (law 1).
   */
  classes: ClassAbbr[]
  /**
   * Weapon skills and the categories that union several of them (JOS-302, the owner's third ask).
   * `[]` = every kind, non-weapons included; anything picked keeps only rows whose `Skill:` line
   * folds into the pick list (`shared/planner/weaponType.ts` owns that fold and its census).
   */
  weaponTypes: WeaponPick[]
  effect: EffectFilter
  /** hide rows the era join places outside the current expansion */
  eraOnly: boolean
  /**
   * THE OWNER'S CHECKBOX (JOS-285): keep only what this character owns or has looted.
   *
   * "Or looted" is not a softening — it is the second witness. The dump is one instant and the log
   * is a history, and an item you looted last week and put in a bag the dump does not cover is
   * still an item you have handled. `gearOwnership.ts` decides what qualifies (a wearable copy, an
   * exaltation made from one, or a loot line); this flag only says whether to apply it.
   */
  ownedOnly: boolean
}

export const DEFAULT_GEAR_FILTERS: GearFilters = {
  text: '',
  slots: [],
  // EMPTY, and it stays empty until something says otherwise — but note that the VIEW merges the
  // detected class combo into this field (`useGearClasses`), so an untouched Gear tab opens reading
  // for the character the app believes you are running. Since JOS-302 that is a NARROWING rather
  // than a decoration, which is why `GearView.emptyText` names the class picks when they are the
  // reason the table is empty, and why the picker's own chips sit in the toolbar saying so.
  classes: [],
  weaponTypes: [],
  effect: 'any',
  // ON by default — the same argument the exaltation browser's era toggle carries: more than half
  // the corpus drops in expansions this server has not opened, and a plan built on them is a wish
  // list. `plannerData.eraHides` is the one verdict; this flag only says whether to apply it.
  eraOnly: true,
  // OFF by default, and that is the search-first ruling again: the tab opens on the CORPUS, which
  // is the question a planner asks first ("what is out there"). "What do I already have" is the
  // second question and it is one click away.
  ownedOnly: false
}

/** What the pure model cannot answer for itself — see the header. */
export interface GearFilterDeps {
  /** `plannerData.eraHides(row, true)`, injected. Default: nothing is ever hidden by era. */
  eraHidden?: (row: GearRow) => boolean
  /**
   * Does this character own or have they looted this row (`gearOwnership.ts`)? Injected for the
   * same reason `eraHidden` is: the answer comes from a live dump and the loot module, neither of
   * which a pure filter may reach.
   *
   * DEFAULT: NOTHING QUALIFIES — so a caller that turns `ownedOnly` on without supplying an
   * answer gets an EMPTY table rather than a filter that silently did nothing. An empty table is
   * visible and the view names the toggle responsible for it (the JOS-67 law); a no-op filter is
   * a control that lies about being on.
   */
  ownedOrLooted?: (row: GearRow) => boolean
}

// ---- the predicates ------------------------------------------------------------------------

/**
 * R2's class half, three-valued — the SAME rule `plannerData.classFit` reads, restated here in the
 * one direction this table needs. Both empties are unknowns and neither is a mismatch: an empty
 * filter asks for no filter, and a page that stated no class list stayed silent (law 1).
 *
 * SINCE JOS-302 THIS IS WHAT REMOVES A ROW rather than what chips one — see `GearFilters.classes`.
 * The three-valued shape is unchanged and is the reason the change is safe to make: the only rows
 * it can remove are rows that STATED a class list and stated one that excludes every class asked
 * for. A page the wiki left silent about is never removed by a guess.
 */
export function classMismatch(rowClasses: readonly ClassAbbr[], filter: readonly ClassAbbr[]): boolean {
  if (rowClasses.length === 0 || filter.length === 0) return false
  return !rowClasses.some((c) => filter.includes(c))
}

/**
 * Does this row sit in ANY of the slots asked for? Empty asks for no slot filter (JOS-302).
 *
 * Two lists meet here — the slots the item can occupy and the slots the player asked about — so the
 * question is an intersection, and a two-handed sword that the corpus places in PRIMARY answers
 * "PRIMARY or SECONDARY" the same way a dagger does.
 */
export function slotMatches(row: GearRow, slots: readonly EquipSlot[]): boolean {
  if (slots.length === 0) return true
  return slots.some((s) => row.slots.includes(s))
}

/** Does this row state an effect of the kind asked for? */
export function effectMatches(row: GearRow, effect: EffectFilter): boolean {
  if (effect === 'any') return true
  if (effect === 'has') return row.effects.length > 0
  return row.effects.some((e) => e.socket === effect)
}

/**
 * WHO THIS ROW IS — the whole local half of the filter since the numeric one was dropped: the name,
 * the slots, the kind of weapon, the class combo and the effect kind.
 *
 * All five AND, and all five are inert while empty — see `GearFilters`. Two of them are UNIONS
 * inside (slots, weapon types), which is the JOS-302 shape: several answers to one question,
 * ANDed against the answers to the others.
 *
 * NONE OF THE FIVE READS THE SCALED VECTOR, and that is worth noticing rather than exploiting: the
 * pipeline still scales BEFORE it filters, because the SORT downstream reads the scaled numbers and
 * the memo split (GearView) is what keeps a keystroke from re-scaling 6,814 rows. Reordering the
 * stages to save the scale would trade a correct order for an optimisation nobody has measured a
 * need for.
 */
function matchesIdentity(row: GearRow, filters: GearFilters): boolean {
  const needle = filters.text.trim().toLowerCase()
  if (needle !== '' && !row.searchKey.includes(needle)) return false
  if (!slotMatches(row, filters.slots)) return false
  if (!weaponPicksMatch(row.skill, filters.weaponTypes)) return false
  if (!effectMatches(row, filters.effect)) return false
  return !classMismatch(row.classes, filters.classes)
}

/**
 * The whole filter for one row — the local predicates above, ANDed, and the two injected verdicts.
 *
 * The two injected ones are LAST on purpose: both reach data outside this module (the mob-catalog
 * inversion, a parsed dump), and a row rejected by a cheap local predicate never pays for them.
 */
export function matchesGear(row: GearRow, filters: GearFilters, deps: GearFilterDeps = {}): boolean {
  if (!matchesIdentity(row, filters)) return false
  if (filters.ownedOnly && !(deps.ownedOrLooted?.(row) ?? false)) return false
  return !(filters.eraOnly && (deps.eraHidden?.(row) ?? false))
}

/** The filtered rows, in the input's order — SORTING is the next stage's job, never this one's. */
export function filterGearRows<T extends GearRow>(
  rows: readonly T[],
  filters: GearFilters,
  deps: GearFilterDeps = {}
): T[] {
  return rows.filter((r) => matchesGear(r, filters, deps))
}

// ---- the sort ------------------------------------------------------------------------------

/**
 * Any numeric column, plus the DERIVED ones. `RATIO` is `gearRatio` (never a second opinion on
 * DMG/DELAY), `EFF_HP` is `gearEffectiveHp` (JOS-336 — raw HP plus raw STA, likewise never a second
 * opinion), and `name` is the only non-numeric axis.
 *
 * A DERIVED KEY IS NOT A VECTOR KEY, and the union says so: `GearStats` has no `EFF_HP` field and
 * never will. Nothing indexes it, nothing scales it, and nothing stores it — it is computed from the
 * vector at the moment somebody asks, which is exactly why the plus-state moves it for free.
 */
export type GearSortKey = 'name' | 'RATIO' | 'EFF_HP' | GearStatKey

export interface GearSort {
  key: GearSortKey
  dir: 'asc' | 'desc'
}

/** The table opens on the highest AC — a ranking, so the first screen says something. */
export const DEFAULT_GEAR_SORT: GearSort = { key: 'AC', dir: 'desc' }

/**
 * The number a sort reads, or `undefined` when the row states none (which sorts LAST, both ways).
 *
 * THE DERIVED ARMS COME FIRST AND EACH DELEGATES. `gearRatio` and `gearEffectiveHp` both live in
 * `shared/planner/gearScale.ts` beside the scaler, so the cell the table DRAWS and the number the
 * sort RANKS by are one function call rather than two agreeing implementations — which is the
 * property that lets `GearTable` render every column with `statText(sortValue(row, key), key)` and
 * never learn that two of the keys are not vector fields.
 */
export function sortValue(row: GearRow, key: GearSortKey): number | undefined {
  if (key === 'name') return undefined
  if (key === 'RATIO') return gearRatio(row.stats)
  if (key === 'EFF_HP') return gearEffectiveHp(row.stats)
  return row.stats[key]
}

/**
 * A new, sorted array — never a mutation of the caller's, because the filtered array is a memo
 * another render still holds.
 *
 * NAME IS THE TIEBREAK EVERYWHERE, so the order is TOTAL: four hundred rows sharing `AC 20` would
 * otherwise re-shuffle on every re-sort (`Array.prototype.sort` is stable, but the array reaching
 * it is a fresh filter each time), and a windowed list whose rows swap under the scrollbar is the
 * bug that looks like a rendering fault.
 */
export function sortGearRows<T extends GearRow>(rows: readonly T[], sort: GearSort): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.key === 'name') return sign * a.name.localeCompare(b.name)
    const av = sortValue(a, sort.key)
    const bv = sortValue(b, sort.key)
    if (av === undefined || bv === undefined) {
      if (av === bv) return a.name.localeCompare(b.name)
      return av === undefined ? 1 : -1
    }
    return av === bv ? a.name.localeCompare(b.name) : sign * (av - bv)
  })
}

// ---- the plus-state stage -------------------------------------------------------------------

/**
 * Every row at `state`, as a PURE MAP — `scaleGearRow`'s own answer, kept in the caller's row type
 * so a renderer row that carries extra fields (the widened `searchKey`, and the ownership join
 * phase 4 will hang off `row.key`) survives the scaling.
 *
 * The base rows are never mutated: the next slider position starts from the same numbers, which is
 * what makes dragging the selector reversible rather than cumulative.
 */
export function scaleAll<T extends GearRow>(rows: readonly T[], state: ItemUpgradeState): T[] {
  return rows.map((r) => ({ ...r, stats: scaleGearRow(r, state).stats }))
}

/**
 * The three stages composed, for callers that want the answer in one call (the unit test, and any
 * future consumer that is not a React tree). THE VIEW DOES NOT USE THIS: it runs the stages in
 * separate memos so a keystroke re-filters without re-scaling 6,814 rows, and a header click
 * re-sorts without re-filtering them.
 */
export function gearTableRows<T extends GearRow>(
  rows: readonly T[],
  state: ItemUpgradeState,
  opts: { filters: GearFilters; sort?: GearSort; deps?: GearFilterDeps }
): T[] {
  const scaled = scaleAll(rows, state)
  return sortGearRows(filterGearRows(scaled, opts.filters, opts.deps), opts.sort ?? DEFAULT_GEAR_SORT)
}
