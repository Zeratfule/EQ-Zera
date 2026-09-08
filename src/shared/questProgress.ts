// questProgress.ts — WHAT THE LOG CAN SAY ABOUT A CATALOG QUEST, and nothing it cannot.
//
// The Quests tab's checklist has two authors. The PLAYER ticks steps by hand (shared/questPins.ts
// keeps those). The LOG ticks what it can actually witness, which is a short list and is the whole
// subject of this file:
//
//   * a step naming an item you have LOOTED lights (the rule QuestPage already drew, lifted here
//     so the tracker and the page agree by construction);
//   * a completed TURN-IN to the quest's giver ticks the hand-in steps naming the items it carried;
//   * when every required item has reached the giver, the quest is COMPLETE;
//   * a HAIL step ticks when the log carries a greeting to the NPC that step names.
//
// THE HAIL WITNESS ARRIVED AFTER THE RULE, and the seam is why that cost one field rather than a
// feature. `You say, 'Hail, X'` is the only line of your own chat the parser claims (shared/
// hailTypes.ts states why: a hail opens every NPC dialogue tree, so the sequence of them IS the
// sequence of quest steps a session attempted). The engine's `hails` module publishes those rows,
// `features/quests/useQuestProgress.ts` reads that module and hands them over as
// `QuestEvidence.hails`, and `hailSatisfied` below ticks a step when one of them matches the NPC
// the step names — through `giverMatches`, the SAME fold the turn-in join runs, so "The Great
// Oowomp" on a wiki page and "Great Oowomp" in a log line are one subject on the same terms
// everywhere in the app. A second name matcher for hails is exactly the drift that fold prevents.
//
// WHAT A HAIL STILL DOES NOT SAY (law 6 — say what the log cannot say, never invent): whether the
// NPC answered, whether the step's dialogue actually advanced, or which quest the greeting was
// about. The log prints no reply of its own to a hail. So this ticks the step whose WORDING names
// the NPC you greeted, and nothing beyond that: a hail step naming nobody stays manual, and a hail
// to somebody else ticks nothing.
//
// AND WHAT THIS MODULE DELIBERATELY CANNOT SAY AT ALL (the same law):
//
//   * WIKI PLURALS. Several `requiredItems` are the wiki's plural ("Infected Rat Livers") while the
//     log offers the singular ("Infected Rat Liver"). Those quests never auto-complete here, and
//     that is the honest ending: a de-pluralizer is a fuzzy cross-source name matcher, which is
//     exactly what law 12 refuses. The fix, when somebody wants it, is a VERIFIED rename row in the
//     item overlay — knowledge, not a matcher.
//   * A QUEST WITH NO `requiredItems` (161 of the 904). Completion here is "every required item
//     reached the giver", and a quest that requires nothing has no such moment. It can be ticked by
//     hand and it can never auto-complete, said plainly rather than approximated.
//
// THE GIVER JOIN IS THE HARD HALF, and it is a FOLD, not a match. `TurnInEvent.npc` is the log's
// exact spelling; the catalog's `giver` is whatever the wiki page's author typed, and 52 of the 883
// non-empty ones are not one clean name: comma lists ("Ostorm, Genni, Gardern, Vilissia"), a
// trailing "(NPC)" or a coordinate parenthetical, a "Loc: -3813, 1668, -102" clause, an "and
// others". `giverCandidates` reads that field into the NAMES it states and folds each through
// `mobKey` — the app-wide canonical mob key (src/shared/mobKey.ts), the same fold the Overview tab
// and main's lookup already use, so a giver and an NPC are one subject on the same terms everywhere
// else in the app. It never guesses at a name the field does not contain.
//
// Pure and dependency-light (mobKey + questItemKey, both shared), so `npm test` exercises it with
// no Electron and no React. Relative value imports, the mobSearch.ts precedent.

import type { QuestEntry, TurnInEvent } from './types'
import { mobKey } from './mobKey'
import { questItemKey } from './questIndex'

/** Shortest a name fragment may be before it is allowed to match a step by substring. */
const MIN_NAME_CHARS = 3

/**
 * Leading articles, stripped for MATCHING only (world-model law 2's boss rule, applied to a giver).
 * "The Great Oowomp" on a wiki page and "Great Oowomp" in a log line are one NPC; display keeps
 * whichever spelling its own source used.
 */
function stripArticle(key: string): string {
  return key.replace(/^(?:a|an|the)\s+/, '')
}

/** Everything after a `loc:` / `Loc:` marker is coordinates, never part of a name. */
function dropLocClause(text: string): string {
  return text.replace(/\s*\bloc\s*:.*$/i, '')
}

/** Trailing parentheticals: "(NPC)", "(loc: 59, 350, -27.81)", "(310, 200)", "(miner)". */
function dropTrailingParen(text: string): string {
  let out = text.trim()
  let prev = ''
  while (out !== prev) {
    prev = out
    out = out.replace(/\s*\([^()]*\)\s*$/, '').trim()
  }
  return out
}

/** Is this fragment a name at all, or the wreckage of a coordinate list? */
function looksLikeName(text: string): boolean {
  return text.length >= 2 && /[a-z]/i.test(text) && !/^[-\d.\s]+$/.test(text)
}

/**
 * The NPC names a catalog `giver` field states, folded with `mobKey`.
 *
 * The parenthetical and the `loc:` clause are stripped BEFORE the list is split, deliberately:
 * both of them contain commas ("Marlyn McMerin Loc: -3813, 1668, -102"), so splitting first would
 * shred one name into three fragments of which two are numbers.
 *
 * AND THE PARENTHETICAL GOES FIRST OF THE TWO. The catalog writes the coordinates both ways —
 * "Marlyn McMerin Loc: -3813, 1668, -102" bare, "Jemoz Lerkarson (loc: 59, 350, -27.81)" wrapped —
 * and cutting at the `loc:` of the wrapped one leaves a dangling "(" that the paren strip can no
 * longer see. Whole brackets first, then whatever `loc:` clause is left in the open.
 *
 * Returns [] for an absent or unreadable field. A quest whose giver this cannot read is a quest the
 * log can never complete for you, which is a thing to say rather than to paper over.
 */
export function giverCandidates(giver: string | undefined): string[] {
  if (typeof giver !== 'string') return []
  const trimmed = dropTrailingParen(dropLocClause(dropTrailingParen(giver)))
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of trimmed.split(/\s*,\s*|\s+and\s+|\s+or\s+/i)) {
    const name = dropTrailingParen(raw)
    if (!looksLikeName(name)) continue
    const key = mobKey(name)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/**
 * The keys ONE name is indexed and looked up under: the `mobKey` fold, plus its article-stripped
 * form when it has an article. Exported so a giver INDEX (the completion watch builds one over the
 * catalog rather than walking 904 quests per turn-in) and `giverMatches` agree by construction
 * rather than by two people spelling the same fold twice.
 */
export function nameKeys(name: string): string[] {
  const key = mobKey(name)
  if (key === '') return []
  const bare = stripArticle(key)
  return bare === key ? [key] : [key, bare]
}

/**
 * Does this log NPC give this quest? Exact equality on the canonical keys — never a substring,
 * never a distance. Law 12: a cross-source name disagreement is knowledge, and the only folds
 * applied here are the two this repo has already verified (`mobKey`'s quote/copy-number fold, and
 * law 2's leading article).
 */
export function giverMatches(giver: string | undefined, npc: string): boolean {
  const candidates = giverCandidates(giver)
  if (candidates.length === 0) return false
  const wanted = new Set(nameKeys(npc))
  for (const c of candidates) {
    for (const k of nameKeys(c)) if (wanted.has(k)) return true
  }
  return false
}

/** What a walkthrough step is asking you to do, as far as its own wording says. */
export interface StepKind {
  kind: 'hail' | 'handin' | 'other'
  /** the NPC the step names, when it is a hail and names one */
  npc?: string
}

/**
 * Both spellings the catalog uses — `You say, 'Hail, X'` and `You Say 'Hail X'` — plus the missing
 * comma after Hail, the double-quote variant, and a missing closing quote. The NPC is whatever
 * follows, with the quote and the sentence punctuation taken off.
 */
const HAIL_RE = /^\s*you\s+say\s*,?\s*['"`‘’“”]?\s*hail\b\s*,?\s*([^'"`‘’“”]*)/i

/** Hand-in steps: "Hand in three Fire Beetle Eyes.", "Give Nicholas the Kilij Plans", "Turn in …". */
const HANDIN_RE = /^\s*(?:hand|give|turn\s+in)\b/i

/**
 * Read one step. Wording only — this never consults the quest, the log or the catalog, so a step
 * that reads like a hand-in IS a hand-in here even when the sentence turns out to be advice
 * ("Hand-in dialogue and faction hits needed."). That costs nothing: a hand-in step that names no
 * item is only ever ticked when the quest is already complete.
 */
export function classifyStep(step: string): StepKind {
  const hail = HAIL_RE.exec(step)
  if (hail) {
    const npc = hail[1].replace(/[.!?,;:]+\s*$/, '').trim()
    return npc === '' ? { kind: 'hail' } : { kind: 'hail', npc }
  }
  return HANDIN_RE.test(step) ? { kind: 'handin' } : { kind: 'other' }
}

/** Everything the log has to say about this character, as one bundle. */
export interface QuestEvidence {
  /** questItemKey of every item this character has looted */
  held: ReadonlySet<string>
  turnIns: readonly TurnInEvent[]
  /**
   * The greetings the `hails` module published (`HailRow`, newest last), verbatim as the lines
   * spelled the NPC — see the header. OPTIONAL because a caller with no hail reader is a caller
   * that ticks no hail step, which is a first-class state and not an error: absent reads as `[]`.
   */
  hails?: readonly { npc: string; ts: number }[]
}

/** One quest's state, as the log and the player's own ticks leave it. */
export interface QuestProgress {
  page: string
  /** step indexes the log satisfies */
  auto: Set<number>
  /** steps naming a held item (the existing rule) */
  lit: Set<number>
  /** required item keys turned in to the giver */
  turnedIn: Set<string>
  complete: boolean
  completeAt?: number
  total: number
  /** |auto ∪ ticks| */
  done: number
}

/** The quest's required items as counting keys, blanks dropped. */
function requiredKeys(q: Pick<QuestEntry, 'requiredItems'>): Set<string> {
  const keys = new Set<string>()
  for (const name of q.requiredItems ?? []) {
    const key = questItemKey(name)
    if (key !== '') keys.add(key)
  }
  return keys
}

/** What reached the giver, and the instant the last required item did. */
function readTurnIns(
  q: Pick<QuestEntry, 'giver' | 'requiredItems'>,
  turnIns: readonly TurnInEvent[],
  required: Set<string>
): { turnedIn: Set<string>; completeAt?: number } {
  const turnedIn = new Set<string>()
  let completeAt: number | undefined
  // In log order, which is the order the module appends in. The COMPLETING event is the first one
  // after which every required key has been seen — an instant off EQ's own clock, never Date.now().
  for (const t of turnIns) {
    if (!giverMatches(q.giver, t.npc)) continue
    for (const item of t.items) {
      const key = questItemKey(item)
      if (required.has(key)) turnedIn.add(key)
    }
    if (completeAt === undefined && required.size > 0 && turnedIn.size === required.size) {
      completeAt = t.ts
    }
  }
  return completeAt === undefined ? { turnedIn } : { turnedIn, completeAt }
}

/** Does this step's text name any of these item keys? Substring, lower-cased, short keys ignored. */
function namesAny(lowerStep: string, keys: Iterable<string>): boolean {
  for (const key of keys) {
    if (key.length >= MIN_NAME_CHARS && lowerStep.includes(key)) return true
  }
  return false
}

/** A hail step is satisfied when the evidence carries a hail to the NPC the step names. */
function hailSatisfied(npc: string | undefined, hails: readonly { npc: string }[]): boolean {
  if (npc === undefined) return false
  for (const h of hails) if (giverMatches(npc, h.npc)) return true
  return false
}

/**
 * One step, decided. Split out because the walk below would otherwise carry the whole rule set at
 * the measured complexity ceiling, and because each branch is a separate claim worth reading alone.
 */
function stepIsAuto(
  step: string,
  ctx: { required: Set<string>; turnedIn: Set<string>; complete: boolean },
  hails: readonly { npc: string }[]
): boolean {
  const lower = step.toLowerCase()
  const kind = classifyStep(step)
  if (kind.kind === 'hail') return hailSatisfied(kind.npc, hails)
  if (kind.kind !== 'handin') return false
  if (namesAny(lower, ctx.turnedIn)) return true
  // A hand-in step that names none of the quest's items ("Give her the Potion of Sorrow and 1000
  // GP.") is only ever ticked by the quest being finished — there is nothing else about it the log
  // could be reading.
  return !namesAny(lower, ctx.required) && ctx.complete
}

/**
 * ONE quest's progress against the log and the player's own ticks.
 *
 * Completion is `countTurnIns`' rule read cumulatively: every required item has reached the giver.
 * The Sky ledger asks for all of them in ONE trade because a Sky quest is run repeatedly and each
 * run is an event; a catalog quest is asked here only whether it is DONE, and a player who hands
 * over half a list, zones, and comes back has still done it.
 */
export function questProgress(
  q: QuestEntry,
  evidence: QuestEvidence,
  ticks: readonly number[]
): QuestProgress {
  const steps = q.steps ?? []
  const required = requiredKeys(q)
  const { turnedIn, completeAt } = readTurnIns(q, evidence.turnIns, required)
  const complete = required.size > 0 && turnedIn.size === required.size
  const hails = evidence.hails ?? []

  const auto = new Set<number>()
  const lit = new Set<number>()
  const ctx = { required, turnedIn, complete }
  for (let i = 0; i < steps.length; i++) {
    if (namesAny(steps[i].toLowerCase(), evidence.held)) lit.add(i)
    if (stepIsAuto(steps[i], ctx, hails)) auto.add(i)
  }

  const done = new Set(auto)
  for (const t of ticks) if (t >= 0 && t < steps.length) done.add(t)

  const out: QuestProgress = {
    page: q.page,
    auto,
    lit,
    turnedIn,
    complete,
    total: steps.length,
    done: done.size
  }
  if (completeAt !== undefined) out.completeAt = completeAt
  return out
}

/**
 * THE SILENT BASELINE, as a pure transition (the `newlyCompletedTurnIns` contract).
 *
 * `prev === null` is "we have not observed anything yet" and returns [] — the hydration replay hands
 * a watch every completion this character ever made, and celebrating those on launch is the one
 * failure the celebrations law exists to prevent. After that, a page that has BECOME complete is
 * news exactly once, because the caller advances the baseline to what it just fired on.
 */
export function newlyCompleted(
  prev: ReadonlyMap<string, boolean> | null,
  next: ReadonlyMap<string, boolean>
): string[] {
  if (prev === null) return []
  const out: string[] = []
  for (const [page, complete] of next) {
    if (complete && prev.get(page) !== true) out.push(page)
  }
  return out
}
