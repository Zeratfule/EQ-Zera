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
// A PIN STORED BEFORE THIS (no `stepsKey`) has nothing to compare and the old text is gone.
// `LEGACY_MOVED` (./questStepsChanged.json, written by `npm run gen:quest-steps-changed`) names, for
// every quest whose step count or normalised step-at-index differs between some release since the
// tracker shipped (v1.19.0) and this build, the NEWEST such release. The pin's ticks were last
// written under the version the player last ran (main captures the stored What's-new version at
// launch, before this session can stamp it — src/main/launchVersion.ts), so `legacyRule(v)` drops an
// unsigned pin's hand ticks only for a quest whose steps moved at or after release v. That version
// can only LAG the true last run (it is stamped when the notes are shown), and a lag only widens the
// set: never a kept tick that should have gone. Unknown (a store that never recorded one) ⇒ every
// listed quest, the conservative union. Either way the pin then carries a key, so this happens once.
// The one case it cannot see is a DOWNGRADE (a newer build's stamp, then ticks on an older build).
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
  /** the `normaliseStep` version the hashes were made with; a key from another version is re-keyed, never judged */
  v?: number
  /** the step count */
  n: number
  /** ticked index → hash of that step's normalised text */
  at: Record<string, string>
}

/**
 * BUMP WHEN `normaliseStep` CHANGES WHAT IT KEEPS. A stored key made by another version has hashes
 * this one cannot compare, so it is re-keyed with every tick kept (a changed step COUNT still drops:
 * that is not a normaliser question).
 */
export const NORMALISER_VERSION = 1

interface ChangedFile {
  stepsDigest: string
  releases: string[]
  /** page → the newest release (MAJOR.MINOR.PATCH) whose steps for it differ from this build's */
  moved: Record<string, string>
}

/** page → the newest release since v1.19.0 whose steps for it differ from this build's. */
export const LEGACY_MOVED: ReadonlyMap<string, string> = new Map(Object.entries((changedJson as ChangedFile).moved))

/** `a` vs `b` as MAJOR.MINOR.PATCH (a leading `v` allowed); negative when `a` is older. */
function cmp(a: string, b: string): number {
  const x = a.replace(/^v/, '').split('.').map(Number)
  const y = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0)
  return 0
}

/**
 * Does an UNSIGNED pin on `page` lose its hand ticks? `lastRun` is the version the player last ran
 * (null when unknown): yes when the quest's steps moved in a release at or after it, or — unknown —
 * when they moved in any release since the tracker shipped.
 */
export function legacyRule(lastRun: string | null): (page: string) => boolean {
  const known = lastRun !== null && /^v?\d+\.\d+\.\d+$/.test(lastRun) ? lastRun : null
  return (page) => {
    const moved = LEGACY_MOVED.get(page)
    return moved !== undefined && (known === null || cmp(moved, known) >= 0)
  }
}

/** What the store keeps (`pinsLegacyBaseline`): the last-run version THIS build found on its first launch. */
export interface StoredBaseline {
  build: string
  lastRun: string | null
}

/**
 * THE BASELINE FOR UNSIGNED PINS, ONCE PER BUILD. A character's pins are reconciled when that
 * character is first opened, which may be a later launch than the update's first — by when the
 * What's-new stamp has moved to this build and would claim the player last ran it. So the value this
 * build's FIRST launch found (`launch`) is stored with the build it belongs to, and every later
 * launch of the same build reads it back; a newer build captures its own. `write` is what the caller
 * must store, when anything.
 */
export function resolveLegacyBaseline(stored: unknown, build: string, launch: string | null): { baseline: string | null; write?: StoredBaseline } {
  const s = stored as Partial<StoredBaseline> | null | undefined
  const valid = typeof s === 'object' && s !== null && typeof s.build === 'string' && (s.lastRun === null || typeof s.lastRun === 'string')
  if (valid && s.build === build) return { baseline: s.lastRun ?? null }
  return { baseline: launch, write: { build, lastRun: launch } }
}

/**
 * Every quest's steps, as one hash: what questStepsChanged.json was generated FROM. A test compares
 * it with the committed quests.json, so a quest refresh cannot ship without regenerating the file.
 */
export function questStepsDigest(quests: readonly { page: string; steps?: readonly string[] }[]): string {
  let h = 0x811c9dc5
  const text = quests.map((q) => `${q.page}\u001e${(q.steps ?? []).join('\u001f')}`).join('\u001d')
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${String(quests.length)}:${h.toString(16).padStart(8, '0')}`
}

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
  return { v: NORMALISER_VERSION, n: steps.length, at }
}

const sameKey = (a: StepsKey, b: StepsKey): boolean =>
  a.v === b.v && a.n === b.n && Object.keys(a.at).length === Object.keys(b.at).length && Object.entries(b.at).every(([k, v]) => a.at[k] === v)

type StepsOf = (page: string) => readonly string[] | undefined

/** The hand ticks that still name the step they were made on. */
function keptTicks(pin: QuestPin, steps: readonly string[], legacy: (page: string) => boolean): number[] {
  const key = pin.stepsKey
  if (key === undefined) return legacy(pin.page) ? [] : pin.ticks
  if (key.n !== steps.length) return []
  if (key.v !== NORMALISER_VERSION) return pin.ticks.filter((t) => t < steps.length)
  // A tick with no remembered hash was written by this build (a write keys every tick), so it stands.
  return pin.ticks.filter((t) => t < steps.length && (key.at[String(t)] ?? stepHash(steps[t])) === stepHash(steps[t]))
}

/** One pin, read against the catalog. Null when nothing about it changes. */
function reconcileOne(pin: QuestPin, stepsOf: StepsOf, legacy: (page: string) => boolean): QuestPin | null {
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
export function reconcileQuestTicks(pins: QuestPins, stepsOf: StepsOf, legacy: (page: string) => boolean = legacyRule(null)): QuestPins {
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
  const v = value as { v?: unknown; n?: unknown; at?: unknown }
  if (!isCount(v.n) || !isObject(v.at)) return null
  const at: Record<string, string> = {}
  for (const [k, h] of Object.entries(v.at).slice(0, maxEntries)) {
    if (/^\d{1,4}$/.test(k) && typeof h === 'string' && HASH_RE.test(h)) at[k] = h
  }
  return isCount(v.v) && v.v > 0 ? { v: v.v, n: v.n, at } : { n: v.n, at }
}
