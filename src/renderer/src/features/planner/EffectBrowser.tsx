// planner/EffectBrowser.tsx — Effects mode: "which effect do I want, and who drops it?" (§5.2).
//
// THE LIST IS FLAT AND UNIFORM, and that is what lets it be windowed. Groups expand into their
// donors, so the natural shape is a tree — but `useWindowedRows` is a FIXED-row-height hook, and a
// growing list must live in a fixed-height scroll box (AGENTS.md UI conventions). So the tree is
// flattened into one row array of one height: a HEADER row, followed by its donor rows while it is
// open. Expanding is then just a longer array, and the DOM node count stays bounded whether the
// filter matches 3 groups or 300.
//
// WHAT THE HEADERS ARE IS A CHOICE NOW, NOT A CONSTANT (V4): `plannerGroups.ts` owns the axes —
// effect, focus family, slot, era — and this file owns none of that logic; it draws whatever
// groups it is handed and remembers which of them are open BY GROUP ID. Switching the axis
// therefore collapses everything, which is correct: the old ids named groups that no longer exist.
//
// EVERY DONOR ROW STATES ITS SOURCE, or says it has none. `sourceIndex` answers from the
// committed mob catalog; `quest` / `playerCrafted` ride on the donor row itself; an item with
// neither renders "no known source" rather than an empty space that reads like a loading state
// (law 1). Class chips are lit for the classes the SET can actually use — the wide-class donors
// light up most, which is precisely the R2 signal that makes them valuable.
//
// THE DONOR NAME HOVERS THE ITEM WINDOW AND CLICKS THROUGH TO THE LOOT DRILL-DOWN
// (`PlannerChips.DonorName`). Both affordances at once: the popup answers "what is it", the link
// answers "and everything else we know about it" — the drill now states the committed DBs' drop
// sources beside the observed ones, which is what made it a fair destination for a never-looted
// donor (see PlannerChips' header, and features/loot/ItemDbSources.tsx).
//
// …AND SINCE JOS-210 THE OTHER DIRECTION IS A FILTER TOO: name an ITEM and the list becomes the
// effects that can legally be socketed into it (`itemFits`, plannerPreset.ts — R2's slot and class
// halves plus R3's flat no on haste). Two doors, one narrowing: the Inventory tab's socket click
// (V8's preset, which also names the cell an add writes to) and the filter bar's own item picker,
// which reaches ANY item the DB carries rather than only the ones your set already hosts. It
// SURVIVES A KIND SWITCH — the four socket tabs move the preset's socket instead of clearing it,
// because "and what about its worn effects?" is one question about one item.
//
// TWO FILTERS SHRINK THE CORPUS BEFORE ANY OF THAT, and they are opposites in spirit.
//
// THE ERA FILTER IS ON BY DEFAULT and is the difference between a plan and a wish list. The
// committed corpus is scraped from a wiki that documents every expansion, so more than half the
// proc donors drop in Kunark and Velious zones this server has not opened; the toggle hides them,
// donors whose zones the era table cannot place stay visible with a quiet `era?`, and an effect
// whose every donor was hidden disappears with them — an effect row promising four donors that
// expand into nothing would be worse than not listing it.
//
// THE NON-EQUIPPABLE FILTER IS OFF BY DEFAULT, and it is R2 rather than taste: a donor with no
// equipment slot shares a slot with nothing, so its effect can never be socketed anywhere. 280 of
// the 1,462 donor rows are slotless — 213 of them in the Click tab, which is the potion mass, and
// 67 procs, which are poisons and coatings. Turning it on shows them chipped `no slot`, because an
// empty slot list is "the page stated none" (law 1) and just occasionally that is a wiki gap.
//
// AND SINCE JOS-329 THE BROWSER REMEMBERS WHERE YOU LEFT IT. Four things here were `useState` and
// were therefore erased by every tab and module switch — the socket/slot/trio FORM, the search box,
// JOS-210's item narrowing and which groups were expanded — while the era toggle, the
// non-equippable toggle and the group-by axis sitting right beside them on the same bar survived,
// because those three happened to have been written down. That inconsistency IS the bug the owner
// reported area-wide (*we're losing everything right now*): the bar looked like one row of controls
// and behaved like two. All four now go through the area's one mechanism (`gear/areaMemory.ts`),
// which also states why the item narrowing is session-scoped while the form is not.
//
// …AND WHEN THE TWO OF THEM EMPTY THE LIST, THE LIST SAYS SO (JOS-67). A player searched for a
// click effect that was real, legal and hidden by the slot filter, and got "No effects match these
// filters" — a true sentence that told them nothing (feedback 01KZCGXY8WC6YCD8W44W7EAS5H). An empty
// result now counts what the two view toggles are holding back and names them, because a filter
// that can hide everything must be able to admit it (`hiddenByView`, plannerData.ts).

import { type JSX, useCallback, useDeferredValue, useEffect, useMemo, useRef } from 'react'
import { Box, Typography } from '@mui/material'
import type { ClassAbbr } from '@shared/classCombo'
import type { SocketType } from '@shared/planner/types'
import { useWindowedRows } from '../../lib/useWindowedRows'
import EffectFilterBar from './EffectFilterBar'
import { DonorLine, GroupLine, ROW_HEIGHT } from './EffectRows'
import {
  CURRENT_ERA_LABEL,
  DEFAULT_FILTERS,
  donorEraOf,
  filterDonors,
  hiddenByView,
  useDonors,
  useEraOnly,
  useGroupBy,
  useNonEquip,
  type DonorFilters,
  type DonorRow,
  type HiddenByView
} from './plannerData'
import { browserRows, groupDonors, type BrowserRow, type GroupAxis } from './plannerGroups'
import { itemFits, type ItemFocus } from './plannerPreset'
import { sourceIndex } from './sourceIndex'
// JOS-329 — the gear area's one form-memory mechanism. It lives beside the Gear tab because the
// four tabs are ONE area (appViews.GEAR_AREA_VIEWS) and the rule they share had to have one home;
// this file already reaches across the same seam for `useGearIndex`'s siblings.
import {
  sanitizeBrowseForm,
  sanitizeItemFocus,
  sanitizeOpenGroups,
  type BrowseFormMemory
} from '../gear/areaMemory'
import { useRemembered, useRememberedSearch } from '../gear/useAreaMemory'
// JOS-344 — the donor names get the Gear tab's comparison pair. Same two hooks the Gear tab calls,
// across the same seam the four lines above already cross; see `compare` in the component.
import { ITEM_UPGRADE_BASE } from '@shared/itemUpgrade'
import { useGearCompare, useGearIndex, type GearCompareData } from '../gear/gearData'

// ---- the row pipeline ------------------------------------------------------------------

interface RowsInput {
  donors: readonly DonorRow[]
  filters: DonorFilters
  /** the DEFERRED search text (the standing search law) */
  text: string
  planClasses: readonly ClassAbbr[]
  view: { eraOnly: boolean; nonEquip: boolean }
  /**
   * The ITEM the browser is narrowed to (V8's preset host, or one picked by hand since JOS-210),
   * or null for the free browser. It is R2 and R3 in one object: only effects that can legally be
   * socketed into that item survive, which is also why haste-locked donors are OUT under it (owner
   * verdict 2026-08-05) while the free browser keeps them chipped, where R3 is taught.
   */
  focus: ItemFocus | null
  axis: GroupAxis
  open: ReadonlySet<string>
}

/**
 * Donors → the flat, windowable row array, in the THREE MEMOS the search law wants and not one —
 * plus, when the answer is EMPTY, what the view toggles are holding back (JOS-67).
 *
 * The FILTER is what a keystroke changes; the GROUPING keys off the filtered array's identity, so
 * switching the group-by axis never re-filters 1.6k rows and a keystroke never pays for a fold it
 * is about to redo; the row flattening keys off the groups and the expanded set. The fourth memo
 * only ever runs when there is nothing to draw, and `NOTHING_HIDDEN` keeps that case free.
 */
function useVisibleRows(input: RowsInput): { rows: BrowserRow[]; hidden: HiddenByView } {
  const { donors, filters, text, planClasses, view, focus, axis, open } = input
  const filtered = useMemo(() => {
    const rows = filterDonors(donors, { ...filters, text }, planClasses, view)
    // ONE pass, ONE rule — `itemFits` (plannerPreset.ts), which is R3's flat no on haste plus R2's
    // two halves asked about the HOST rather than the set: an effect can only move into an item it
    // shares a slot AND a class with. Nothing about it is restated here.
    return focus === null ? rows : rows.filter((d) => itemFits(d, focus))
  }, [donors, filters, text, planClasses, view, focus])
  const groups = useMemo(() => groupDonors(filtered, axis, donorEraOf), [filtered, axis])
  const rows = useMemo(() => browserRows(groups, open), [groups, open])
  const hidden = useMemo(
    () =>
      rows.length > 0 ? NOTHING_HIDDEN : hiddenByView(donors, { ...filters, text }, planClasses, view),
    [rows.length, donors, filters, text, planClasses, view]
  )
  return { rows, hidden }
}

// ---- the browser ---------------------------------------------------------------------

/** The answer for every render that HAS rows — a constant, so the memo below never allocates. */
const NOTHING_HIDDEN: HiddenByView = { era: 0, nonEquip: 0 }

interface RowListProps {
  rows: readonly BrowserRow[]
  win: { start: number; end: number; topPad: number; bottomPad: number }
  planClasses: readonly ClassAbbr[]
  /** the item keys already on the wish list — the `wished` chip and the control's REMOVE state */
  wished: ReadonlySet<string>
  ready: boolean
  /** what the two view toggles are holding back — only consulted when `rows` is empty (JOS-67) */
  hidden: HiddenByView
  /** the item the list is narrowed to, so an empty list can name it (JOS-210) */
  item: string | null
  onToggle: (id: string) => void
  /** absent until the wish document has loaded — `DonorLineProps.onToggleWish` argues why */
  onToggleWish?: (donor: DonorRow, wished: boolean) => void
  onOpenLoot?: (item: string) => void
  /** the comparison seam behind the donor-name hover (JOS-344) — a STABLE object, see below */
  compare: GearCompareData
}

/**
 * WHY THE LIST IS EMPTY, in one sentence that names the filter responsible.
 *
 * "No effects match these filters" is true of a typo and of a filter quietly holding back four
 * real answers, and the second is the case a user reported (JOS-67). The counts come from
 * `hiddenByView`; the toggles they name are two controls up, in the filter bar.
 *
 * AND WHEN AN ITEM IS THE NARROWING, IT IS NAMED (JOS-210). "No effects match these filters" over a
 * list filtered to one item reads as a broken search; "Nothing on the Proc tab can be socketed into
 * X" is the answer, and it is usually the true one — most items share a slot with only a slice of
 * the corpus, and R2 is the reason rather than anything the user typed.
 */
function emptyText(ready: boolean, hidden: HiddenByView, item: string | null): string {
  if (!ready) return 'Reading the item database…'
  const parts: string[] = []
  if (hidden.era > 0) parts.push(`${String(hidden.era)} outside ${CURRENT_ERA_LABEL}`)
  if (hidden.nonEquip > 0) parts.push(`${String(hidden.nonEquip)} with no equipment slot`)
  const head = item === null ? 'No effects match these filters' : `Nothing here can be socketed into ${item}`
  if (parts.length === 0) return `${head}.`
  return `${head} - but ${parts.join(' and ')} are hidden by the toggles above.`
}

/** The bounded scroll box (AGENTS.md UI conventions) and the window of rows inside it. */
function RowList(props: RowListProps): JSX.Element {
  const { rows, win, planClasses, wished, ready, hidden, item, onToggle, onToggleWish, onOpenLoot, compare } = props
  return (
    <>
      <Box sx={{ height: win.topPad }} />
      {rows.slice(win.start, win.end).map((row: BrowserRow) =>
        row.kind === 'header' ? (
          <GroupLine key={row.group.id} group={row.group} expanded={row.expanded} onToggle={onToggle} />
        ) : (
          <DonorLine
            key={`${row.groupId}:${row.donor.key}:${row.donor.effect}`}
            donor={row.donor}
            planClasses={planClasses}
            wished={wished.has(row.donor.key)}
            best={row.best}
            namesEffect={row.namesEffect}
            namesSays={row.namesSays}
            onToggleWish={onToggleWish}
            onOpenLoot={onOpenLoot}
            compare={compare}
          />
        )
      )}
      <Box sx={{ height: win.bottomPad }} />
      {rows.length === 0 && (
        <Typography variant="body2" color="text.secondary" data-testid="planner-effects-empty" sx={{ p: 2 }}>
          {emptyText(ready, hidden, item)}
        </Typography>
      )}
    </>
  )
}

/**
 * THE THREE WRITES THE FILTER BAR MAKES — and, since JOS-326, there is nothing left for any of them
 * to clear.
 *
 * They used to have a second job. While the Inventory tab could hand the browser a `BrowsePreset`
 * — one socket of one host, arrived at by clicking a cell — every filter control had to say
 * whether touching it contradicted the cell you came from, and the four kind tabs had to MOVE the
 * preset's socket rather than drop the item (JOS-210's bug half). The board is gone with this
 * ticket and the preset with it, so all three writes are the plain ones underneath.
 *
 * WHAT SURVIVES IS THE PART THAT WAS A SEARCH CAPABILITY. `pickItem` is the filter bar's own item
 * picker — the OTHER door JOS-210 opened, and the one that reaches ANY item the DB carries rather
 * than only the ones a set already hosted. It is untouched, and the narrowing it makes still
 * survives a kind switch: the picked item is its own state, and no filter write clears it.
 *
 * A plain function, not a hook — it closes over state the caller already holds and calls nothing
 * of React's.
 */
function filterWrites(ctx: {
  filters: DonorFilters
  setOwn: (f: DonorFilters) => void
  setPicked: (f: ItemFocus | null) => void
}): {
  change: (f: DonorFilters) => void
  setSocket: (s: SocketType) => void
  pickItem: (f: ItemFocus | null) => void
} {
  const { filters, setOwn, setPicked } = ctx
  return {
    change: (next) => {
      setOwn(next)
    },
    setSocket: (socket) => {
      setOwn({ ...filters, socket })
    },
    pickItem: (next) => {
      setPicked(next)
    }
  }
}

export interface EffectBrowserProps {
  /**
   * The class trio the browse is filtered for — R2's class half. It used to be the SELECTED SET's
   * (`ExaltPlan.classes`); with the sets' switcher gone it is a machine-class browse preference
   * (`useBrowseClasses`), and PlannerView owns it because the disagree chip lives in the toolbar.
   */
  classes: readonly ClassAbbr[]
  /** the item keys already on the wish list — `itemKey`, which is `DonorRow.key` */
  wished: ReadonlySet<string>
  /**
   * Put this donor on the wish list, or take it off (JOS-343 — `useWishlist`'s `add` and `remove`,
   * wrapped by PlannerView). The row hands back the state it was drawn in, so the handler never has
   * to close over the wished set and can stay a stable callback across an edit.
   *
   * UNDEFINED UNTIL THE DOCUMENT HAS LOADED, and every row draws NO control rather than a wrong one
   * while it is (`EffectRows.DonorLineProps.onToggleWish` states the failure it prevents).
   */
  onToggleWish?: (donor: DonorRow, wished: boolean) => void
  /** deep-link a donor into the Loot tab's item drill-down (App's `openLoot`) */
  onOpenLoot?: (item: string) => void
}

export default function EffectBrowser({
  classes,
  wished,
  onToggleWish,
  onOpenLoot
}: EffectBrowserProps): JSX.Element {
  const { donors, ready } = useDonors()
  const era = useEraOnly()
  const nonEquip = useNonEquip()
  // JOS-329. Four pieces of this browser's state used to be `useState` and were therefore destroyed
  // by every tab and module switch (the JOS-90/97/116 law, reported area-wide). Each is now on the
  // tier `areaMemory.AREA_FORM_TIER` assigns it: the FORM (socket tab, slot, "usable by these
  // classes") survives a restart with the era/non-equippable/group-by keys it sits beside; the
  // search box, the item narrowing and the expanded groups last the session. `DEFAULT_FILTERS` is
  // passed IN rather than imported by the sanitizer, so "proc leads" has exactly one home.
  const [storedForm, setStoredForm] = useRemembered<BrowseFormMemory>('eq.planner.filters', (raw) =>
    sanitizeBrowseForm(raw, DEFAULT_FILTERS)
  )
  // The item the browser is narrowed to (JOS-210's filter-bar picker). It was the second of two
  // doors into one narrowing; with the Inventory tab's preset gone it is the only one, so the
  // merge that used to arbitrate between them (`useItemFocus`) is gone with it and this state IS
  // the focus.
  const [picked, setPicked] = useRemembered<ItemFocus | null>('eq.planner.item', sanitizeItemFocus)
  const focus = picked
  // `DonorFilters` carries `text` and the stored form does not (different tiers), so the two are
  // recombined here — the same shape every control below has always been handed.
  const filters = useMemo<DonorFilters>(() => ({ ...DEFAULT_FILTERS, ...storedForm }), [storedForm])
  const setOwn = useCallback(
    (next: DonorFilters) => {
      setStoredForm({ socket: next.socket, slot: next.slot, trioOnly: next.trioOnly })
    },
    [setStoredForm]
  )
  // The three filter-bar writes — `filterWrites` above.
  const { change, setSocket, pickItem } = filterWrites({ filters, setOwn, setPicked })
  const groupBy = useGroupBy(filters.socket)
  const [text, setText] = useRememberedSearch('eq.planner.search')
  const [openIds, setOpenIds] = useRemembered<string[]>('eq.planner.open', sanitizeOpenGroups)
  // The row flattener wants a Set and the store wants a list; the memo is the seam, and it keys on
  // the stored array so `browserRows` re-runs when a group opens and never merely because we drew.
  const open = useMemo<ReadonlySet<string>>(() => new Set(openIds), [openIds])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Warm the source index AFTER mount, not on the render path: the first donor row to ask for a
  // source would otherwise pay the whole ~33k-link build inside a paint (design §4.2, "off-path").
  useEffect(() => {
    sourceIndex()
  }, [])

  // The input echoes instantly; the FILTER runs on the deferred value (the standing search law).
  const deferredText = useDeferredValue(text)
  // Read out of the tuples so the memo's dependency list names the VALUES: the setter half of
  // each tuple is a fresh identity nothing here depends on.
  const view = useMemo(() => ({ eraOnly: era[0], nonEquip: nonEquip[0] }), [era, nonEquip])
  const { rows, hidden } = useVisibleRows({
    donors,
    filters,
    text: deferredText,
    planClasses: classes,
    view,
    focus,
    axis: groupBy[0],
    open
  })
  const win = useWindowedRows({ count: rows.length, rowHeight: ROW_HEIGHT, scrollRef })

  /**
   * WHAT A HOVERED DONOR NAME IS COMPARED AGAINST (JOS-344) — the Gear tab's own two hooks, called
   * here for the first time outside `features/gear`.
   *
   * THE COST IS TWO CACHED READS PER WINDOW AND NOTHING PER HOVER. `useGearIndex` is cached for the
   * life of the window (one IPC, shared with the Gear tab, which is the tab next door in this same
   * area), and `useGearCompare` re-asks `plannerInventory` once per mount and once per
   * `inventory:autoReloaded`. Both maps are memos over data that moves only when the corpus arrives
   * or the player re-exports; a hover costs one `Map.get`.
   *
   * AT BASE, ALWAYS. `ITEM_UPGRADE_BASE` is a module constant, so the memo inside `useGearCompare`
   * is stable — and it is the honest state for this surface: the Gear tab has a plus-state slider
   * and this browser has none, so the item card here states the numbers the corpus states and the
   * card's "simulated at Tier N" line correctly never appears.
   */
  const gear = useGearIndex()
  const compare = useGearCompare(gear.rows, ITEM_UPGRADE_BASE)

  // Toggling reads the CURRENT list rather than taking a functional update, because the stored
  // value is the source of truth and `useRemembered`'s setter writes what it is given — there is no
  // "previous state" the store has not already seen.
  const toggle = (id: string): void => {
    setOpenIds(openIds.includes(id) ? openIds.filter((k) => k !== id) : [...openIds, id])
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
      <EffectFilterBar
        filters={filters}
        setFilters={change}
        setSocket={setSocket}
        text={text}
        setText={setText}
        era={era}
        nonEquip={nonEquip}
        groupBy={groupBy}
        focus={focus}
        setFocus={pickItem}
      />

      <Box
        ref={scrollRef}
        data-testid="planner-effect-list"
        sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}
      >
        <RowList
          rows={rows}
          win={win}
          planClasses={classes}
          wished={wished}
          ready={ready}
          hidden={hidden}
          item={focus?.name ?? null}
          onToggle={toggle}
          onToggleWish={onToggleWish}
          onOpenLoot={onOpenLoot}
          compare={compare}
        />
      </Box>
    </Box>
  )
}
