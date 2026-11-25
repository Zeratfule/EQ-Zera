// questStepsSig.ts — A HAND TICK IS A STEP INDEX, SO IT IS ONLY TRUE OF THE STEP IT WAS MADE ON.
//
// The tracker stores the steps a player ticked by hand as bare indexes (shared/questPins.ts). When a
// quest's step list changes under them — a parser fix, a wiki edit, a refresh — index 1 can name a
// different step, and the tick becomes a claim the player never made. MEASURED: Harvester Quest went
// from 4 to 7 steps on 2026-11-25, so an old tick on "You Say 'What harvester?'" would have ticked
// "Shadowed Scythe (drops off a shadowed man)" as had.
//
// SO EVERY PIN REMEMBERS WHAT IT TICKED (`QuestPin.stepsKey`): the step COUNT, and for each ticked
// index a hash of that step's NORMALISED text. On read (main's store accessor):
//   - the count changed            ⇒ every hand tick of that quest is dropped (the list moved);
//   - a ticked step's meaning changed ⇒ THAT tick is dropped, the others stay.
// Only HAND ticks: the log's ticks are re-derived from evidence on every read (questProgress.ts);
// the completion note (`doneAt`) is not a step and stays.
//
// NORMALISED, because most text changes are not changes of meaning and must not cost a player their
// ticks. MEASURED between v1.30.1 and this build: 26 quests' step texts changed; 25 only re-rendered a
// step in place — a `{{Loc}}` written out as "(a, b)" or "Rivervale (a, b)", a heading line
// "==== Dreadscale Helm ====" become "Dreadscale Helm:". `normaliseStep` reads all 25 as unchanged
// (tests/questStepsSig.test.mts pins every one) and Harvester Quest as changed.
//
// A PIN STORED BEFORE THIS (no `stepsKey`) has nothing to compare and the old text is gone. It could
// have been ticked on ANY release since the tracker shipped (v1.19.0), so `LEGACY_CHANGED_PAGES`
// (./questStepsChanged.json, written by scripts/gen-quest-steps-changed.mts) lists every quest whose
// step count, or the normalised meaning of any step at its index, differs between ANY of those
// releases' quests.json and this one. An unsigned pin on a listed quest loses its hand ticks — the
// conservative answer, since we cannot know which release ticked it; every other unsigned pin keeps
// them. Either way the pin then carries a key, so this happens once per pin.
//
// THE WRITE PATH ADOPTS: the renderer's ticks were made against the catalog this build ships, so a
// write is keyed to it, never judged against an older one.
//
// PURE; tests/questStepsSig.test.mts.

import type { QuestPin, QuestPins } from './questPins'
import { ZONES } from './zones'
import changedJson from './questStepsChanged.json'

/** What a pin remembers about the steps its ticks were made on. */
export interface StepsKey {
  /** the step count */
  n: number
  /** ticked index → hash of that step's normalised text */
  at: Record<string, string>
}

/** Every quest whose steps moved between some release since v1.19.0 and this build. */
export const LEGACY_CHANGED_PAGES: ReadonlySet<string> = new Set((changedJson as { pages: string[] }).pages)

let ZONE_BEFORE_POINT: RegExp | null = null

/** "Rivervale (", "Eastern Wastes -2714": a zone's name written out right before a point. */
function zoneBeforePoint(): RegExp {
  if (ZONE_BEFORE_POINT) return ZONE_BEFORE_POINT
  const names = new Set<string>()
  for (const z of ZONES) for (const n of [z.name, ...(z.aliases ?? []), ...(z.mobCatalogNames ?? [])]) names.add(n)
  const alt = [...names]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  ZONE_BEFORE_POINT = new RegExp(`(?:${alt})\\s*(?=[(\\-+\\d])`, 'gi')
  return ZONE_BEFORE_POINT
}

/**
 * A step's MEANING for tick purposes: case, markup, punctuation, numbers and every written-out point
 * (with the zone name a `{{Loc}}` writes in front of it) removed, whitespace collapsed.
 */
export function normaliseStep(text: string): string {
  return text
    .replace(/\{\{[^{}]*\}\}|\[\[|\]\]|'''?|<[^>]+>/g, ' ')
    .replace(zoneBeforePoint(), ' ')
    .replace(/\([^()]*\d[^()]*\)/g, ' ')
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** FNV-1a 32 of a step's normalised text, 8 hex digits. */
export function stepHash(text: string): string {
  const s = normaliseStep(text)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The key for `ticks` made on `steps`. */
export function stepsKeyFor(steps: readonly string[], ticks: readonly number[]): StepsKey {
  const at: Record<string, string> = {}
  for (const t of ticks) if (t < steps.length) at[String(t)] = stepHash(steps[t])
  return { n: steps.length, at }
}

const sameKey = (a: StepsKey, b: StepsKey): boolean =>
  a.n === b.n && Object.keys(a.at).length === Object.keys(b.at).length && Object.entries(b.at).every(([k, v]) => a.at[k] === v)

type StepsOf = (page: string) => readonly string[] | undefined

/** The hand ticks that still name the step they were made on. */
function keptTicks(pin: QuestPin, steps: readonly string[], legacy: ReadonlySet<string>): number[] {
  const key = pin.stepsKey
  if (key === undefined) return legacy.has(pin.page) ? [] : pin.ticks
  if (key.n !== steps.length) return []
  // A tick with no remembered hash was written by this build (a write keys every tick), so it stands.
  return pin.ticks.filter((t) => t < steps.length && (key.at[String(t)] ?? stepHash(steps[t])) === stepHash(steps[t]))
}

/** One pin, read against the catalog. Null when nothing about it changes. */
function reconcileOne(pin: QuestPin, stepsOf: StepsOf, legacy: ReadonlySet<string>): QuestPin | null {
  const steps = stepsOf(pin.page)
  if (steps === undefined) return null
  const ticks = keptTicks(pin, steps, legacy)
  const key = stepsKeyFor(steps, ticks)
  if (pin.stepsKey !== undefined && ticks.length === pin.ticks.length && sameKey(pin.stepsKey, key)) return null
  return { ...pin, ticks, stepsKey: key }
}

/**
 * THE READ PATH. Returns the SAME array when nothing changed, so the caller can skip a write.
 */
export function reconcileQuestTicks(pins: QuestPins, stepsOf: StepsOf, legacy: ReadonlySet<string> = LEGACY_CHANGED_PAGES): QuestPins {
  let moved = false
  const out = pins.map((p) => {
    const next = reconcileOne(p, stepsOf, legacy)
    if (next === null) return p
    moved = true
    return next
  })
  return moved ? out : pins
}

/** THE WRITE PATH: every pin on a catalog quest is keyed to the current steps; no tick dropped. */
export function adoptStepsKeys(pins: QuestPins, stepsOf: StepsOf): QuestPins {
  return pins.map((p) => {
    const steps = stepsOf(p.page)
    return steps === undefined ? p : { ...p, stepsKey: stepsKeyFor(steps, p.ticks) }
  })
}

const HASH_RE = /^[0-9a-f]{8}$/

/** The stored key, cleaned: null when unusable (the pin is then read as one stored before keys). */
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10000

export function sanitizeStepsKey(value: unknown, maxEntries: number): StepsKey | null {
  if (!isObject(value)) return null
  const v = value as { n?: unknown; at?: unknown }
  if (!isCount(v.n) || !isObject(v.at)) return null
  const at: Record<string, string> = {}
  for (const [k, h] of Object.entries(v.at).slice(0, maxEntries)) {
    if (/^\d{1,4}$/.test(k) && typeof h === 'string' && HASH_RE.test(h)) at[k] = h
  }
  return { n: v.n, at }
}
