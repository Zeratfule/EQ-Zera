// planner/plannerGroups.ts — HOW THE EFFECT BROWSER'S LIST IS GROUPED (V4, docs/plans/planner-v2.md).
//
// The browser used to fold its donors exactly one way — `groupByEffect()`, hardcoded — and that
// fold was the ceiling on every request of the 2026-08-05 owner round: "show me the best of each
// focus family", "let me browse a slot at a time", "which of these are Kunark". So the fold became
// a DECLARED AXIS, and this module is the whole of it: donors in, header-and-row model out, no
// React and no storage.
//
// THE OUTPUT IS STILL ONE FLAT UNIFORM ARRAY, because `useWindowedRows` is a fixed-row-height hook
// and the list must stay a bounded scroll box (AGENTS.md UI conventions). A header is a ROW of the
// same height as a donor row, not a container — expanding a group is a longer array and nothing
// else. That is the constraint the whole shape here exists to satisfy.
//
// PURE, AND NODE-TESTABLE ON PURPOSE (`tests/plannerGroups.test.mts`): value imports are RELATIVE
// (the repo-wide mobSearch precedent), the only thing taken from `plannerData` is a TYPE, and the
// era verdict — the one fact here that needs the mob catalog — is INJECTED as `eraOf`. W-A's
// layered verdict is the single owner of "which expansion is this donor in"; this module reads it
// and never re-decides it.
//
// A DONOR CAN APPEAR UNDER MORE THAN ONE HEADER, and only on the slot axis: a sword the wiki gives
// PRIMARY and SECONDARY is genuinely both, so it is listed under both. Every other axis is a
// function of the row, so the groups partition it.

import { ERA_LABEL, ERA_ORDER, eraRank, type Era } from '../../../../shared/planner/era'
import { effectOneLiner } from '../../../../shared/planner/effectText'
import { EQUIP_SLOTS, SOCKET_TYPES, type SocketType } from '../../../../shared/planner/types'
import type { DonorRow } from './plannerData'

/** The ONE spelling of a socket type in this feature's UI — the tabs, the headers and the rows. */
export const SOCKET_LABEL: Record<SocketType, string> = {
  proc: 'Proc',
  worn: 'Worn',
  focus: 'Focus',
  click: 'Click'
}

/**
 * What the list is grouped BY.
 *
 * `socket` is in the model and not in the picker: the browser's socket tabs are exclusive, so
 * grouping a one-socket list by socket would draw exactly one header. It stays because the model
 * is what a multi-socket surface (V8's host view) would group with, and because a supported axis
 * with no control is cheaper than an axis invented later under a deadline.
 *
 * V11's `instrument` is the next member, and deliberately absent: no instrument field exists in
 * the corpus yet, so the axis would draw empty groups. Its arrival is meant to be one line here.
 */
export type GroupAxis = 'effect' | 'family' | 'slot' | 'socket' | 'era'

export const AXIS_LABEL: Record<GroupAxis, string> = {
  effect: 'Effect',
  family: 'Focus family',
  slot: 'Slot',
  socket: 'Socket',
  era: 'Era'
}

/**
 * Which axes this socket tab offers. FAMILY IS A FOCUS AXIS ONLY — the rank in an effect name is
 * parsed for focus rows and nothing else (`normalize.parseFocusEffect`), so offering it on the
 * Proc tab would group 446 rows under one header called by their own names.
 */
export function axesFor(socket: SocketType): GroupAxis[] {
  return socket === 'focus' ? ['family', 'effect', 'slot', 'era'] : ['effect', 'slot', 'era']
}

/**
 * The default axis per socket tab (V4): focus self-organizes into families — "the best Improved
 * Healing, the best Burning Affliction" is the question that tab exists to answer — and every
 * other tab keeps the effect grouping the browser has always had.
 */
export function defaultAxis(socket: SocketType): GroupAxis {
  return socket === 'focus' ? 'family' : 'effect'
}

/** A stored axis is only honoured while it is legal for the socket it was stored under. */
export function isAxisFor(socket: SocketType, axis: string): axis is GroupAxis {
  return (axesFor(socket) as string[]).includes(axis)
}

/** One header row and the donor rows under it. */
export interface DonorGroup {
  /** `${axis}:${key}` — the React key and the identity the expanded-set remembers */
  id: string
  axis: GroupAxis
  /** what the header reads */
  label: string
  /** the muted note after the label; '' when the axis has nothing to add (never a placeholder) */
  note: string
  /**
   * THE ONE-LINER THE WHOLE GROUP SHARES — "Beneficial · Self · 2:24:00" (JOS-42 refinement 2).
   *
   * Under a family header every rank of Burning Affliction says the same three things about
   * itself, so the row was carrying identical text N times and paying for it in the one place
   * that mattered: the EFFECT NAME truncated ("Burning Af…", "String Resonan…") on every donor.
   * The fact belongs to the family, so it is stated once where there is room for it, and the rows
   * get their width back.
   *
   * '' means the rows do NOT agree (or none of them joined the spell DB), and then the rows keep
   * their own line — a header may only state what is true of everything under it.
   */
  says: string
  /** every row under this header shares it — the header can therefore state the extraction cost */
  socket: SocketType
  /** R3 — at least one donor here is haste-locked, so the header says so before you expand it */
  hasteLocked: boolean
  /** family axis: the highest tier PRESENT after filtering — the crown's threshold. Else null. */
  topTier: number | null
  donors: DonorRow[]
}

/**
 * The flat row union the browser windows.
 *
 * `best` is the crown: the row carries the family's highest tier among the rows that survived the
 * filters — "the best one you can currently see", which is why it is computed here and not baked
 * into the donor at index build.
 *
 * `namesEffect` is the other half of the same story: under an EFFECT header the effect is already
 * on screen and repeating it on every row would be noise, but under a family, slot or era header
 * it is the row's most important fact ("Improved Healing I" is not "Improved Healing III").
 *
 * `namesSays` is the same idea applied to the effect's one-liner (JOS-42): the header states it
 * whenever every row under it agrees, and then the rows do not repeat it. That is the width the
 * effect name needed.
 *
 * `groupId` is what makes a donor row's React key unique: on the slot axis one donor is genuinely
 * listed twice (PRIMARY and SECONDARY), and (key, effect) alone would collide.
 */
export type BrowserRow =
  | { kind: 'header'; group: DonorGroup; expanded: boolean }
  | {
      kind: 'donor'
      donor: DonorRow
      groupId: string
      best: boolean
      namesEffect: boolean
      namesSays: boolean
    }

/** Which expansion the browser's era join places a donor in; null when nothing places it. */
export type EraOf = (donor: DonorRow) => Era | null

/** One donor's place on one axis: its group key, that group's label, and its declared order. */
interface Facet {
  key: string
  label: string
  /** position in a DECLARED order (slots, sockets, eras); 0 where the axis has none */
  rank: number
}

const NO_SLOT: Facet = { key: 'none', label: 'No slot', rank: EQUIP_SLOTS.length }
const NO_ERA: Facet = { key: 'unknown', label: 'era?', rank: ERA_ORDER.length }

function slotFacets(donor: DonorRow): Facet[] {
  // Slotless rows are the R2 escape hatch (the non-equippable toggle); they group together rather
  // than vanishing, because the list is showing them on purpose when it shows them at all.
  if (donor.slots.length === 0) return [NO_SLOT]
  return donor.slots.map((s) => ({ key: s, label: s, rank: EQUIP_SLOTS.indexOf(s) }))
}

function facetsOf(donor: DonorRow, axis: GroupAxis, eraOf: EraOf): Facet[] {
  switch (axis) {
    case 'effect':
      return [{ key: donor.effect, label: donor.effect, rank: 0 }]
    case 'family': {
      // A focus row always has a family (its own name when the name states no rank — law 1); a row
      // from another tab has none, and falls back to the effect rather than to an invented group.
      const family = donor.family ?? donor.effect
      return [{ key: family, label: family, rank: 0 }]
    }
    case 'slot':
      return slotFacets(donor)
    case 'socket':
      return [{ key: donor.socket, label: SOCKET_LABEL[donor.socket], rank: SOCKET_TYPES.indexOf(donor.socket) }]
    case 'era': {
      const era = eraOf(donor)
      return era === null ? [NO_ERA] : [{ key: era, label: ERA_LABEL[era], rank: eraRank(era) }]
    }
  }
}

interface Bucket extends Facet {
  socket: SocketType
  hasteLocked: boolean
  donors: DonorRow[]
}

/** Highest tier among these rows; null when none of them carries one (every non-focus group). */
function topTierOf(donors: readonly DonorRow[]): number | null {
  let top: number | null = null
  for (const d of donors) {
    if (d.familyTier !== undefined && (top === null || d.familyTier > top)) top = d.familyTier
  }
  return top
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Rows inside a FAMILY group: tier DESC, then effect name, then the corpus order main served
 * (`Array.sort` is stable). Tier-first is the whole point of the axis — the family's best line is
 * the row you want, and it is at the top with the crown on it.
 */
function sortFamily(donors: DonorRow[]): void {
  donors.sort((a, b) => (b.familyTier ?? 0) - (a.familyTier ?? 0) || byName(a.effect, b.effect))
}

/**
 * GROUP ORDER, per axis:
 *   effect → donor count DESC then name (the browser's standing rule: the effect with the most
 *            donors is the one you can realistically go and get)
 *   family → top tier DESC, then donor count, then name — a family that reaches III is a deeper
 *            choice than one that stops at I, whatever the count
 *   slot / socket / era → their own DECLARED order (character-sheet order, unlock order, release
 *            order), with the "no slot" / "era?" buckets last. Alphabetising an era list would put
 *            Kunark before Velious by accident and Classic after both.
 */
function compareGroups(a: Ranked, b: Ranked): number {
  const [x, y] = [a.group, b.group]
  if (x.axis === 'effect') return y.donors.length - x.donors.length || byName(x.label, y.label)
  if (x.axis === 'family') {
    return (y.topTier ?? 0) - (x.topTier ?? 0) || y.donors.length - x.donors.length || byName(x.label, y.label)
  }
  return a.rank - b.rank || byName(x.label, y.label)
}

/** The note after a family header: the best line as WRITTEN, unless it just repeats the label. */
function familyNote(donors: readonly DonorRow[], label: string): string {
  const top = donors[0]?.effect ?? ''
  return top === label ? '' : top
}

/**
 * The one-liner every SPEAKING donor here shares, or '' (see `DonorGroup.says`).
 *
 * MEASURED over the committed corpus (2026-08-06, `buildPlannerDonors`): 29 focus families — 27
 * unanimous, 1 where a single line is joined and the other ranks are silent, and exactly 1 that
 * genuinely disagrees (Percussion Resonance carries both `Self · 1:57:00` and `Self · 2:12:00`).
 * That distribution is why the rule is what it is:
 *
 *   * SILENT ROWS DO NOT VETO. A rank the spell DB never joined states nothing at all (law 1 —
 *     5.8% of effect rows miss the join), and letting one silence a header that is true of every
 *     row that speaks would trade a fact for nothing.
 *   * A DISSENTER STILL DOES. Two different durations under one family means no line is true of
 *     the family, so the header says nothing and every row speaks for itself.
 *
 * The row-level half is `rowNamesSays`: a row goes quiet exactly when its own line is the one the
 * header took, which is the same rule read from the other end and needs no second decision.
 */
function sharedSays(donors: readonly DonorRow[]): string {
  let says = ''
  for (const d of donors) {
    const line = effectOneLiner(d)
    if (line === '') continue
    if (says === '') says = line
    else if (says !== line) return ''
  }
  return says
}

/**
 * Does this row DRAW a one-liner of its own? False in the two quiet cases and no others: the
 * header already states exactly this row's line, or the row never had one to state.
 */
function rowNamesSays(donor: DonorRow, groupSays: string): boolean {
  const line = effectOneLiner(donor)
  return line !== '' && line !== groupSays
}

/** A group plus the DECLARED order of its axis — the rank is an ordering input, not group state. */
interface Ranked {
  group: DonorGroup
  rank: number
}

function toGroup(bucket: Bucket, axis: GroupAxis): Ranked {
  if (axis === 'family') sortFamily(bucket.donors)
  return {
    rank: bucket.rank,
    group: {
      id: `${axis}:${bucket.key}`,
      axis,
      label: bucket.label,
      note: axis === 'family' ? familyNote(bucket.donors, bucket.label) : '',
      // FAMILY ONLY. Every other axis groups rows whose effects genuinely differ, so there is no
      // shared line to lift; the effect axis could lift one, but its rows have the room already
      // (the header names the effect, so the row does not) and moving it would buy nothing.
      says: axis === 'family' ? sharedSays(bucket.donors) : '',
      socket: bucket.socket,
      hasteLocked: bucket.hasteLocked,
      topTier: axis === 'family' ? topTierOf(bucket.donors) : null,
      donors: bucket.donors
    }
  }
}

/**
 * Donors → groups, on one axis. Filtering happens before this (`plannerData.filterDonors`) and the
 * caller memoizes on the filtered array's identity, so this runs once per filter change and never
 * per keystroke (the standing search law).
 */
export function groupDonors(rows: readonly DonorRow[], axis: GroupAxis, eraOf: EraOf): DonorGroup[] {
  const buckets = new Map<string, Bucket>()
  for (const donor of rows) {
    for (const facet of facetsOf(donor, axis, eraOf)) {
      const bucket = buckets.get(facet.key)
      if (bucket) {
        bucket.donors.push(donor)
        bucket.hasteLocked ||= donor.hasteLocked
      } else {
        buckets.set(facet.key, { ...facet, socket: donor.socket, hasteLocked: donor.hasteLocked, donors: [donor] })
      }
    }
  }
  const ranked = [...buckets.values()].map((b) => toGroup(b, axis))
  return ranked.sort(compareGroups).map((r) => r.group)
}

/**
 * Groups → the windowed row array: a header, then its donors while it is open. Collapsed groups
 * contribute exactly one row, which is what keeps a 400-effect list a 400-row list.
 */
export function browserRows(groups: readonly DonorGroup[], open: ReadonlySet<string>): BrowserRow[] {
  const rows: BrowserRow[] = []
  for (const group of groups) {
    const expanded = open.has(group.id)
    rows.push({ kind: 'header', group, expanded })
    if (!expanded) continue
    const namesEffect = group.axis !== 'effect'
    for (const donor of group.donors) {
      const best = group.topTier !== null && donor.familyTier === group.topTier
      // Per ROW, not per group: a family whose header took the common line can still hold one
      // rank that says something else, and that rank must keep saying it.
      const namesSays = rowNamesSays(donor, group.says)
      rows.push({ kind: 'donor', donor, groupId: group.id, best, namesEffect, namesSays })
    }
  }
  return rows
}
