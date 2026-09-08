// coinTypes.ts — the `coin` module's transport: every coin the log said reached you, one row per
// sentence, and NO TOTAL ANYWHERE.
//
// Its own file on the characterTypes.ts precedent — `shared/types.ts` is at its measured ceiling.
//
// ── COIN IS NOT SUMMED HERE, AND THAT IS THE WHOLE DESIGN ─────────────────────────────────────
//
// `shared/acquireEvents.ts` states the law for the event; this file states it for the SNAPSHOT.
// EverQuest's platinum/gold/silver/copper conversion appears in no line the client prints, so a
// `total` field would be a number this repo cannot source (law 1). A consumer that wants
// platinum-per-hour declares the rate ITSELF, in the open, where a reader can see it and disagree.
//
// The same rule governs the denominations on a row: a field is present only when the LINE named it.
// `{ silver: 4 }` and `{ platinum: 0, silver: 4 }` are different facts — "the line did not say" is
// not "you got none".
//
// ── WHAT COUNTS AS INCOME, AND WHAT DOES NOT ──────────────────────────────────────────────────
//
// Three sources are rows; two coin sentences deliberately are not. A destroy payout ('item') is a
// refund on something you already had, and an unstated receipt says nothing about where it came
// from — either sitting in an income rate would be claiming to be income. Both stay in the event
// stream for whoever wants them.

/**
 * Where a row's coin came from:
 *   'corpse'  `You receive 5 gold, 5 silver and 8 copper from the corpse.` — coin loot. The line
 *             names no mob, so neither does the row.
 *   'vendor'  `You receive 9 gold 9 silver 4 copper from Klok Sasz for the Ringmail Neckguard(s).`
 *             — a manual sale. Carries `npc` and `item`.
 *   'sold'    `You looted <item> from <mob>'s corpse and sold it for 125 platinum.` — the AUTO
 *             vendor, and by far the largest coin stream a farming session produces. Its price was
 *             read and discarded by the parser until 2026-09-08, which is why plat-per-hour was
 *             unanswerable before.
 */
export type CoinRowSource = 'corpse' | 'vendor' | 'sold'

/** One coin sentence, zone-stamped the way a loot row is. */
export interface CoinRow {
  /** the LOG's clock, epoch millis. */
  ts: number
  source: CoinRowSource
  /** present ONLY when the line named this denomination. See the header. */
  platinum?: number
  gold?: number
  silver?: number
  copper?: number
  /** what was sold — the vendor line's item, or the auto-sold loot. */
  item?: string
  /** who paid, on the 'vendor' form. */
  npc?: string
  /** the zone the fold was standing in. Absent for rows folded before the scan reached a zone
   *  line — the same stamp, and the same absence, as a loot row's. */
  zone?: string
}

/**
 * The `coin` module's published state.
 *
 * `rows` is UNCAPPED, like the loot ledger and for the same reason: a rate is computed over the
 * whole run, so dropping the oldest rows would silently move the answer.
 */
export interface CoinSnap {
  /** shape version. */
  v: number
  rows: CoinRow[]
}

/** The delta is a WHOLE snapshot — the `RespawnDelta` posture; see hailTypes.ts. */
export type CoinDelta = CoinSnap

/** What a consumer holds before the fold has said anything. */
export const EMPTY_COIN_SNAP: CoinSnap = { v: 1, rows: [] }
