// questPins.ts — THE QUEST TRACKER'S DOCUMENT: which catalog quests this character is following,
// which of their steps the player ticked by hand, and when the quest was recorded complete.
//
// PURE, AND A FIXED POINT IN BOTH DIRECTIONS — the `planner/validate.ts` contract, restated for a
// document with a much simpler shape. `sanitizeQuestPins` runs on the way IN (the IPC handler,
// because the renderer is untrusted here as everywhere) and on the way OUT (the store accessor,
// because a progress file is hand-editable and a downgrade may have written it), so "what a pin
// may contain" has exactly one definition and `sanitize(sanitize(x)) === sanitize(x)` by
// construction. `tests/questPins.test.mts` asserts that rather than assuming it.
//
// IT STRIPS RATHER THAN REJECTS, the same judgement `sanitizeExaltPlans` makes: a pin with a
// nonsense tick loses the tick, not the pin, and a list with one unreadable entry loses that entry
// rather than the player's whole tracker.
//
// WHAT A TICK IS, AND WHAT IT IS NOT. A tick is a STEP INDEX the player ticked BY HAND. Steps the
// LOG satisfies are never written here: they are re-derived from the loot history and the turn-in
// ledger on every read (shared/questProgress.ts), so a step the log ticks can un-tick itself when
// the evidence changes and a step the player ticked cannot. Two kinds of statement, one of which
// is ours to recompute and one of which is the user's to keep — the classUnlocks evidence rule
// applied to a checklist.
//
// `doneAt` is the same distinction one level up: the INSTANT a completion was recorded, either by
// the log's own turn-in (`TurnInEvent.ts`, EQ's clock) or by the player. It is a note on the pin,
// never the authority — `questProgress` re-derives completion from the evidence every time — so a
// pin that says done about a quest the evidence no longer supports simply shows the note.

/** One tracked quest. Keyed by the wiki PAGE title, which is what the whole catalog is keyed by. */
export interface QuestPin {
  page: string
  pinnedAt: number
  /** step indexes the player ticked by hand */
  ticks: number[]
  /** ts of the completion the player or the log recorded */
  doneAt?: number
}

export type QuestPins = QuestPin[]

/**
 * Most quests one character may track. A guard on renderer-supplied input reaching the store (the
 * `MAX_TURN_INS_PER_QUEST` rule: validate at the boundary, never trust today's only caller), not a
 * statement about how many quests a player may run — a tracker with fifty rows is already a list
 * nobody reads.
 */
export const MAX_QUEST_PINS = 50

/** Most hand ticks one pin may carry. The longest catalog walkthrough is far shorter than this. */
export const MAX_QUEST_TICKS = 200

/** Longest a page title may be. The catalog's longest is well under this; a longer one is junk. */
const MAX_PAGE_CHARS = 200

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A finite, non-negative whole millisecond, or `undefined`. Never NaN. */
function stamp(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined
  return Math.floor(v)
}

/** Step indexes: whole, non-negative, unique, ascending, capped. Anything else falls out. */
export function sanitizeTicks(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
    seen.add(Math.floor(v))
  }
  const out = [...seen]
  out.sort((a, b) => a - b)
  return out.slice(0, MAX_QUEST_TICKS)
}

/** One entry, or `null` when there is no page title to hang it on. */
function readPin(value: unknown): QuestPin | null {
  if (!isRecord(value)) return null
  const page = typeof value.page === 'string' ? value.page.trim().slice(0, MAX_PAGE_CHARS) : ''
  if (page === '') return null
  const pin: QuestPin = { page, pinnedAt: stamp(value.pinnedAt) ?? 0, ticks: sanitizeTicks(value.ticks) }
  const doneAt = stamp(value.doneAt)
  // Assigned rather than spread (the `classesProvenance` argument): absent already means "not
  // recorded done" to every reader, so writing an explicit `undefined` in would change a stored
  // file's bytes for no change in meaning — and this function is the READ path too.
  if (doneAt !== undefined) pin.doneAt = doneAt
  return pin
}

/**
 * Clean a whole tracker. Deduped by page (the FIRST entry for a page wins, so a hand-edited file
 * with a repeat keeps the one nearest the top rather than silently preferring the last write),
 * capped at `MAX_QUEST_PINS`.
 */
export function sanitizeQuestPins(value: unknown): QuestPins {
  if (!Array.isArray(value)) return []
  const out: QuestPins = []
  const seen = new Set<string>()
  for (const raw of value) {
    const pin = readPin(raw)
    if (!pin || seen.has(pin.page)) continue
    seen.add(pin.page)
    out.push(pin)
    if (out.length >= MAX_QUEST_PINS) break
  }
  return out
}

/** Where a page sits in the list, or -1. A loop rather than `findIndex`: this module is domain. */
function indexOf(pins: readonly QuestPin[], page: string): number {
  for (let i = 0; i < pins.length; i++) if (pins[i].page === page) return i
  return -1
}

/** The list with one entry replaced. */
function replace(pins: readonly QuestPin[], at: number, pin: QuestPin): QuestPins {
  const out: QuestPins = []
  for (let i = 0; i < pins.length; i++) out.push(i === at ? pin : pins[i])
  return out
}

/**
 * Track a quest, or stop tracking it. Untracking DROPS the row whole — its hand ticks go with it,
 * because a checklist you put away is a statement that you are done with it, and keeping ghost
 * ticks for a quest the tracker no longer shows would resurrect them the day it is pinned again.
 *
 * A pin past the cap is refused rather than evicting somebody else's row: the tracker is a list
 * the player built, and silently dropping the oldest of it is a worse answer than not adding.
 */
export function togglePin(pins: readonly QuestPin[], page: string, now: number): QuestPins {
  // EVERY FOLD SANITIZES ITS INPUT FIRST, so its OUTPUT is a valid tracker whatever it was handed.
  // The renderer folds over a document it loaded from main and main folds nothing, but the folds
  // are also the store's own edit vocabulary and a fold that can launder junk through is a hole in
  // the one validator. Sanitizing is a fixed point, so on a clean list this costs a copy.
  const clean = sanitizeQuestPins(pins)
  const wanted = page.trim().slice(0, MAX_PAGE_CHARS)
  if (wanted === '') return clean
  const at = indexOf(clean, wanted)
  if (at >= 0) {
    const out: QuestPins = []
    for (let i = 0; i < clean.length; i++) if (i !== at) out.push(clean[i])
    return out
  }
  if (clean.length >= MAX_QUEST_PINS) return clean
  return [...clean, { page: wanted, pinnedAt: stamp(now) ?? 0, ticks: [] }]
}

/** Tick (or un-tick) one step by hand. A quest that is not pinned is left alone. */
export function setTick(pins: readonly QuestPin[], page: string, step: number, on: boolean): QuestPins {
  const clean = sanitizeQuestPins(pins)
  const at = indexOf(clean, page)
  if (at < 0 || !Number.isFinite(step) || step < 0) return clean
  const want = Math.floor(step)
  const pin = clean[at]
  const next = on ? sanitizeTicks([...pin.ticks, want]) : pin.ticks.filter((t) => t !== want)
  return replace(clean, at, { ...pin, ticks: next })
}

/** Note that this quest was completed at `ts`. Re-recording a completion keeps the FIRST instant. */
export function markDone(pins: readonly QuestPin[], page: string, ts: number): QuestPins {
  const clean = sanitizeQuestPins(pins)
  const at = indexOf(clean, page)
  const when = stamp(ts)
  if (at < 0 || when === undefined || clean[at].doneAt !== undefined) return clean
  return replace(clean, at, { ...clean[at], doneAt: when })
}

/** Take the completion note back off. The hand ticks stay: they are a different statement. */
export function clearDone(pins: readonly QuestPin[], page: string): QuestPins {
  const clean = sanitizeQuestPins(pins)
  const at = indexOf(clean, page)
  if (at < 0 || clean[at].doneAt === undefined) return clean
  const { doneAt: _dropped, ...rest } = clean[at]
  return replace(clean, at, rest)
}
