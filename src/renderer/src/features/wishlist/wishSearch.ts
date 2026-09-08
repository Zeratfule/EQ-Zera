// wishlist/wishSearch.ts — ONE ADD CONTROL, TWO INDICES, ONE RESULT LIST (JOS-326).
//
// THE WHOLE CORPUS, NOT A CORNER OF IT. The app already carries two searchable views of the same
// 8.6 MB item database, and until this ticket a player had to know which surface to be standing on
// to reach either:
//   * the GEAR INDEX (`shared/planner/gear.ts`, ~6.8k rows) — every EQUIPPABLE item, described in
//     numbers. It answers "I want that breastplate".
//   * the DONOR CORPUS (`shared/planner/types.ts PlannerDonor`, ~1.5k rows) — one row per
//     (item, EFFECT). It answers "I want whatever drops Improved Healing III", and it reaches
//     items the gear index cannot: a potion or a weapon coating states no equip slot, so it is not
//     a gear row at all, and it is still a thing somebody wants.
// A wish list that could only search one of them would send the user back to the tab they came
// from, which is the opposite of what a list you write yourself is for. So both are searched and
// the answers arrive in ONE list, each row saying which kind it is.
//
// A ROW IS AN OFFER, AND THE TWO KINDS OFFER DIFFERENT THINGS. Adding a gear hit records "I want
// this item"; adding a donor hit records "I want this item, for this effect", and the effect
// context is what lets the wish list state the merge tier the effect extracts at and what that
// costs. Both land on the same `itemKey`, so the list dedupes them — whichever you click first is
// the line you get, and the other row goes to "wished".
//
// GROUPED BY ITEM, GEAR ROW FIRST. An item with two effects produces three offers, and scattering
// them through the ranking would read as three unrelated results with the same name. One item's
// offers are adjacent, and the item that best matches what was typed leads.
//
// THE ERA FILTER IS DELIBERATELY NOT APPLIED HERE, and that is the difference between a plan and a
// wish list — the effect browser's own header says so in as many words. Hiding Velious donors is
// right when the question is "what can I socket this week"; a WISH is allowed to be aspirational,
// and refusing to let someone write down a thing they want because the server has not opened yet
// would be the app overruling the user about the user's own list. The era toggle lives on the LIST,
// where it hides rows from the ROUTE and states how many it is holding back (WishGroups).
//
// PURE AND NODE-TESTABLE (`tests/wishSearch.test.mts`): the two row types arrive as data, every
// value import is relative, and nothing here touches React, IPC or storage.

import type { ClassAbbr } from '@shared/classCombo'
import type { GearRow } from '@shared/planner/gear'
import type { EquipSlot, ExtractTier, SocketType } from '@shared/planner/types'
import type { WishEntry, WishKind } from '@shared/planner/wishlist'
import type { DonorRow } from '../planner/plannerData'

/** Shortest query worth running — one letter matches thousands of items and says nothing. */
export const MIN_WISH_QUERY = 2

/** How many rows the picker will draw. A cap, not a page: a longer query is the way to narrow. */
export const WISH_HIT_LIMIT = 40

/**
 * ONE OFFER IN THE ADD CONTROL'S RESULT LIST.
 *
 * `key` is the corpus's spelling of the identity (`itemKey(name)`) — the same field both row types
 * carry, so a hit is built by copying rather than translating. It becomes the entry's `itemKey`
 * when the offer is taken (`wishFromHit`).
 *
 * `wikiSources` and `eraTag` ride along so the row can draw its era chip from the same three
 * witnesses everything else in this app uses, without a second index lookup: a `{ key, wikiSources,
 * eraTag }` IS an `EraSubject` (plannerData.ts).
 */
export interface WishHit {
  key: string
  name: string
  kind: WishKind
  iconId?: number
  slots: EquipSlot[]
  classes: ClassAbbr[]
  /** donor hits only — the effect this offer is FOR, and the socket it occupies */
  effect?: string
  socket?: SocketType
  tierRequired?: ExtractTier
  /** donor hits only — the parenthetical the wiki wrote after the effect */
  detail?: string
  wikiSources?: { mob: string; zone?: string }[]
  eraTag?: string
}

// ---- turning a corpus row into a wish -------------------------------------------------------

/** A gear row someone wants: the item, and nothing about an effect (law 1 — silence, not a guess). */
export function wishFromGear(row: Pick<GearRow, 'key' | 'name'>, now: number): WishEntry {
  return { itemKey: row.key, name: row.name, kind: 'gear', addedAt: now, source: 'user' }
}

/**
 * A donor row someone wants: the item, PLUS what they want it for. Both halves of the context are
 * carried because they answer different questions later — the effect names the reason, the socket
 * is what lets the row state a merge cost on a machine whose corpus no longer has the row.
 */
export function wishFromDonor(donor: Pick<DonorRow, 'key' | 'name' | 'effect' | 'socket'>, now: number): WishEntry {
  return {
    itemKey: donor.key,
    name: donor.name,
    kind: 'donor',
    effect: donor.effect,
    socket: donor.socket,
    addedAt: now,
    source: 'user'
  }
}

/** Whichever kind the picked offer is. The one call site the add control needs. */
export function wishFromHit(hit: WishHit, now: number): WishEntry {
  if (hit.kind === 'gear' || hit.effect === undefined || hit.socket === undefined) {
    return wishFromGear(hit, now)
  }
  return wishFromDonor({ key: hit.key, name: hit.name, effect: hit.effect, socket: hit.socket }, now)
}

// ---- the search -----------------------------------------------------------------------------

/**
 * HOW WELL AN ITEM ANSWERS WHAT WAS TYPED. Lower is better, and the three tiers are the three
 * honest readings of a substring match:
 *   0 — the NAME starts with it. Someone typing "blade" meant the blades.
 *   1 — the NAME contains it. "light" finds "Blade of Light" second, which is right.
 *   2 — only the EFFECT text contains it. The item is a real answer to "who drops Improved
 *       Healing", and it is not what a name search meant, so it sorts under both of the above.
 */
function nameScore(name: string, needle: string): number {
  const lower = name.toLowerCase()
  if (lower.startsWith(needle)) return 0
  return lower.includes(needle) ? 1 : 2
}

// Both builders assign the optional fields rather than spreading them, so an absent one stays
// ABSENT instead of becoming an explicit `undefined` — the store round-trips these, and an
// `eraTag: undefined` is a byte of nothing that survives a JSON write as a missing key anyway but
// reads as a claim in a diff.

function gearHit(row: GearRow): WishHit {
  const hit: WishHit = {
    key: row.key,
    name: row.name,
    kind: 'gear',
    slots: row.slots,
    classes: row.classes
  }
  if (row.iconId !== undefined) hit.iconId = row.iconId
  if (row.wikiSources !== undefined) hit.wikiSources = row.wikiSources
  if (row.eraTag !== undefined) hit.eraTag = row.eraTag
  return hit
}

function donorHit(row: DonorRow): WishHit {
  const hit: WishHit = {
    key: row.key,
    name: row.name,
    kind: 'donor',
    slots: row.slots,
    classes: row.classes,
    effect: row.effect,
    socket: row.socket,
    tierRequired: row.tierRequired
  }
  if (row.iconId !== undefined) hit.iconId = row.iconId
  if (row.detail !== undefined) hit.detail = row.detail
  if (row.wikiSources !== undefined) hit.wikiSources = row.wikiSources
  if (row.eraTag !== undefined) hit.eraTag = row.eraTag
  return hit
}

/** One item's offers, held together so they can be ranked as one thing and drawn adjacent. */
interface ItemOffers {
  key: string
  name: string
  score: number
  gear: WishHit | null
  donors: WishHit[]
}

function offersFor(
  gear: readonly GearRow[],
  donors: readonly DonorRow[],
  needle: string
): Map<string, ItemOffers> {
  const byItem = new Map<string, ItemOffers>()
  const open = (key: string, name: string): ItemOffers => {
    const existing = byItem.get(key)
    if (existing) return existing
    const fresh: ItemOffers = { key, name, score: nameScore(name, needle), gear: null, donors: [] }
    byItem.set(key, fresh)
    return fresh
  }
  for (const row of gear) {
    if (row.searchKey.includes(needle)) open(row.key, row.name).gear = gearHit(row)
  }
  for (const row of donors) {
    if (row.searchKey.includes(needle)) open(row.key, row.name).donors.push(donorHit(row))
  }
  return byItem
}

/**
 * The unified corpus search: both indices, one ranked list, capped.
 *
 * The rank is (name score, name length, name) — the last two are the same tiebreak main's own
 * `searchPlannerItems` uses, so the same query ranks the same way whichever picker asked it. A
 * query shorter than `MIN_WISH_QUERY` answers with nothing rather than with the whole corpus.
 */
export function searchWishCorpus(
  gear: readonly GearRow[],
  donors: readonly DonorRow[],
  query: string,
  limit: number = WISH_HIT_LIMIT
): WishHit[] {
  const needle = query.trim().toLowerCase()
  if (needle.length < MIN_WISH_QUERY) return []
  const items = [...offersFor(gear, donors, needle).values()].sort(
    (a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name)
  )
  const out: WishHit[] = []
  for (const item of items) {
    if (out.length >= limit) break
    if (item.gear !== null) out.push(item.gear)
    for (const donor of [...item.donors].sort((a, b) => (a.effect ?? '').localeCompare(b.effect ?? ''))) {
      out.push(donor)
    }
  }
  return out.slice(0, limit)
}
