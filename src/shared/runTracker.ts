// runTracker.ts — WHERE YOU ARE IN A DUNGEON RUN, folded out of the modules the engine already
// publishes (owner, 2026-09-11, after a Befallen 4 (Refined) crawl: the game's own in-instance
// tracker "isn't sizeable and it's obtuse").
//
// PURE. No React, no DOM, no Electron, no clock read of its own — the live edge is handed in, so
// the same snapshots always fold to the same run and tests/runTracker.test.mts can import this file
// straight under tsx. Every import below is a sibling of this one; nothing here reaches the
// renderer or main.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// IT DERIVES NOTHING OF ITS OWN. Five module snapshots, read exactly as the farm meter reads its
// five (renderer/overlay/farmRows.ts is the precedent this file is built on):
//
//   the run itself   `progression.zoneStart / zoneName` — the zone timeline, raw names and all
//   kills + pace     `progression.killTs` (yours and a bound pet's) and `witnessTs` (everybody
//                    else's, which inside a group is your group)
//   the named        `kills.mobs` — the per-mob, per-TIER record, whose `firstTs`/`lastTs` bracket
//                    that tier's kills and therefore say whether this run is where one died
//   the keys         `loot` — the auto-sold key lines, as the loot ledger already holds them
//   the chest        `loot` rows whose `sourceKind` is `chest` — the instance reward chest
//   the doors        `progression.doorTs` — lockpicked doors, timestamps only
//   the deaths       `deaths.recaps`
//   the auto-sell    `coin` rows whose source is `sold`
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// WHAT A RUN IS, AND WHERE IT STARTS AND STOPS (measured on the owner's 2026-09-10 crawl, which
// tests/fixtures/befallen-run.log is):
//
//   [23:02:11] You have entered Befallen.                 ← the open world, outside the instance
//   [23:03:26] You have entered Befallen 4 (Refined).     ← THE RUN STARTS HERE
//   ...
//   [23:25:27] You have entered Befallen.                 ← THE RUN ENDS HERE
//   [23:26:06] You have entered West Commonlands.
//
// A run STARTS on a zone entry whose name carries an instance difficulty (`instanceTier` >= 0) and
// runs on through any further entry of the SAME instance — you can zone out of and back into one
// expedition — and ENDS at the first entry that is not that: a different place, or the same place
// with no instance on it. The bare `Befallen` above is the second of those, which is why this run
// ends at 23:25:27 and not at the West Commonlands line a minute later.
//
// A MANUAL RUN IS THE OPEN-WORLD CASE, and it is the same shape with a stated start: plenty of EQ
// dungeons are not instances at all, and "where am I in this crawl" is the same question there. It
// is session state and is never persisted — a run is a live thing, and an app restart ends one.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// A NAMED MOB IS ONE THE LOG SPELLED WITHOUT AN ARTICLE. `You have slain a cracked skeleton!` is
// the trash; `Baron Telyx V`Zher has been slain by Vasober!` is the named. That is world-model law
// 2's own boss-matching fold ("strip leading a/an/the for boss matching") used as a TEST rather
// than as a strip, and it is the log's own spelling rather than a roster this app would have to
// keep. MEASURED on the owner's run: it names exactly the fourteen he listed, in his order,
// including the two kills of `ice boned skeleton` — a mob whose name carries no article either.
//
// THE ROSTER IS NOT AVAILABLE AND NO "X of Y" IS CLAIMED. `src/main/data/respawns.json` is keyed by
// mob name and carries NO zone column, so there is no way to ask it what lives in Befallen; the mob
// catalog answers "what lives here" but not "which of those are named". Law 1: a count with no
// denominator is printed without one, rather than against a number this app made up.
//
// ─────────────────────────────────────────────────────────────────────────────────────────
// ONE FACT THE ENGINE DOES NOT EMIT, so nothing here claims it (law 1):
//
//   · WHO LANDED A NAMED KILL. The parser reads it (`Key::Killer` on the death event) and no module
//     carries it: the kills record is per mob, and `progression.recentKills` is a 50-row ring of
//     CREDITED kills only, so a group-mate's killing blow is in no snapshot by name.
//
// THE OTHER THREE WERE PARSER GAPS AND ARE NOW CLOSED (Z Engine, 2026-09-11). Every loot shape
// accepts a container source, so the reward chest is 24 rows carrying `sourceKind: chest` (28
// items with stack sizes counted) instead of 2 mis-named rows and 22 `unknown` lines; the chest's
// three key lines are back in `keys`, which is why this run pays ELEVEN and not eight; and the
// lockpick sentence is a `doorUnlocked` event with a column of its own. What is still refused is
// the ROW THAT CLAIMS NOTHING: a chest row on a FINISHED run that opened no chest is absent, not
// a zero, and a live run says `not yet` because that is a state rather than a measurement.

import type { CoinRow } from './coinTypes'
import type { DeathSnap } from './deathTypes'
import type { KillsSnap } from './kills'
import type { ProgressionSnap } from './progressionTypes'
import type { LootEvent } from './types'

/**
 * `main/log/parseWorld.ts TIER_ADJ`, as the engine still carries it
 * (`engine/crates/fold/src/jsfn.rs tier_adj`). The four adjectives are the whole vocabulary; a
 * parenthetical outside them is an instance whose difficulty this app has never decoded.
 */
const TIER_ADJ: Record<string, number> = { awakened: 1, adaptive: 2, fused: 3, refined: 4 }

/** The kill record's two non-difficulties, restated as the only two negative answers this file
 *  gives: `-1` no instance at all, `-2` the log did not say (or said something unknown). */
export const RUN_OPEN_WORLD = -1
export const RUN_UNKNOWN_TIER = -2

/** ` - Solo` / ` - Group 2` and everything after it — instance SELECTION, never part of a name. */
const SOLO_GROUP_RE = /\s*-\s*(Solo|Group)\b.*$/i
/** A trailing tier parenthetical with the instance ordinal: ` 4 (Refined)`. */
const TIER_ORDINAL_RE = /\s+\d+\s*\([^)]*\)\s*$/
/** A bare trailing parenthetical: ` (Awakened)`. */
const TIER_PAREN_RE = /\s+\([^)]*\)\s*$/
/** The adjective itself, wherever the two strips above found one. */
const ADJECTIVE_RE = /\(([A-Za-z]+)\)\s*$/
/** The instance SELECTOR with no adjective after it — `The Plane of Hate - Solo`, a base instance. */
const INSTANCE_SUFFIX_RE = /\s-\s*(Solo|Group)\b/i

/**
 * The PLACE a zone line named, with every piece of instance noise taken off and its original
 * casing kept (law 2: canonicalize at boundaries, display raw). `Befallen 4 (Refined)` is
 * `Befallen`; `The Ruins of Old Paineel - Solo 4 (Refined)` is `The Ruins of Old Paineel`.
 */
export function runBase(zone: string): string {
  return zone.replace(SOLO_GROUP_RE, '').replace(TIER_ORDINAL_RE, '').replace(TIER_PAREN_RE, '').trim()
}

/**
 * The instance difficulty a zone line stated: 0 (a base instance) through 4 (Refined),
 * `RUN_OPEN_WORLD` for a bare zone name, `RUN_UNKNOWN_TIER` for the empty string or an adjective
 * the table above has never met.
 */
export function instanceTier(zone: string): number {
  const adj = ADJECTIVE_RE.exec(zone)
  if (adj) return TIER_ADJ[adj[1].toLowerCase()] ?? RUN_UNKNOWN_TIER
  if (INSTANCE_SUFFIX_RE.test(zone)) return 0
  return runBase(zone) === '' ? RUN_UNKNOWN_TIER : RUN_OPEN_WORLD
}

/** One named mob going down, with the instant the log stamped it. */
export interface RunNamed {
  /** RAW display name, exactly as the slain line spelled it. */
  name: string
  at: number
}

/** One kind of key this run paid out, and how many of it. */
export interface RunKey {
  name: string
  count: number
  /** when the FIRST of them dropped. */
  at: number
}

/**
 * WHAT THE INSTANCE'S REWARD CHEST PAID, once one has been opened.
 *
 * STACK SIZES COUNT — `4 Bone Chips` is four items, the same rule the key rows apply — so
 * `items` is `kept + sold + merged` and never a line count. A chest drops nothing and is not a
 * mob: these items are in the item totals and in no per-mob statistic anywhere.
 */
export interface RunChest {
  /** everything the chest handed over. */
  items: number
  /** kept as they came (including anything routed to storage). */
  kept: number
  /** auto-vendored on pickup — the coin is in `coinAutoSold`. */
  sold: number
  /** consumed on pickup to upgrade an item you already had. */
  merged: number
}

/** What one run of a dungeon looks like from the log's side. */
export interface RunState {
  /** the run is still open — no zone line has ended it, and no `End run` was pressed. */
  active: boolean
  /** the zone line's own words, instance suffix and all. '' when there is no run. */
  zone: string
  /** `runBase(zone)` — the place, without the instance noise. */
  base: string
  /** the stated difficulty, or one of the two non-difficulties. Absent when there is no run. */
  tier?: number
  startedAt: number
  /** absent while the run is open. */
  endedAt?: number
  /** the run was STARTED BY HAND (`Start run here`), so its edges are the user's, not a zone line's. */
  manual: boolean
  /** kills credited to you or to a bound pet. */
  kills: number
  /** kills the log credited to somebody else — inside a group, your group. */
  groupKills: number
  /** the named, in the order they went down. */
  named: RunNamed[]
  /** keys picked up, one row per kind, first drop first. The chest pays some of them. */
  keys: RunKey[]
  /** the reward chest, all zeroes until one is opened. See RunChest. */
  chest: RunChest
  /** locks picked open during the run. */
  doors: number
  deaths: number
  /** every denomination the auto-sell lines named, summed as they were stated. NO ladder is
   *  applied here: EQ prints its conversion in no line of the log, so the consumer that divides
   *  declares its own rate in the open (shared/acquireEvents.ts). */
  coinAutoSold: { platinum: number; gold: number; silver: number; copper: number }
}

/** What a surface holds before the fold has named an instance. */
export const NO_RUN: RunState = {
  active: false,
  zone: '',
  base: '',
  manual: false,
  startedAt: 0,
  kills: 0,
  groupKills: 0,
  named: [],
  keys: [],
  chest: { items: 0, kept: 0, sold: 0, merged: 0 },
  doors: 0,
  deaths: 0,
  coinAutoSold: { platinum: 0, gold: 0, silver: 0, copper: 0 }
}

/** The half-open stretch a run occupies. `t1` is the live edge while the run is open. */
interface RunWindow {
  zone: string
  startedAt: number
  endedAt?: number
  t1: number
}

/**
 * THE RUN THE ZONE TIMELINE DESCRIBES — the most recent one, open or finished.
 *
 * Walks back to the newest interval that is an instance, then back again over every immediately
 * preceding interval of the SAME instance (a zone-out-and-back is one run), then forward to the
 * first interval that is neither. Null when the log has named no instance at all.
 */
function instanceWindow(snap: ProgressionSnap, nowMs: number): RunWindow | null {
  const n = snap.zoneName.length
  let last = -1
  for (let i = n - 1; i >= 0; i--) {
    if (instanceTier(snap.zoneName[i]) >= 0) {
      last = i
      break
    }
  }
  if (last < 0) return null
  const zone = snap.zoneName[last]
  let first = last
  while (first > 0 && snap.zoneName[first - 1] === zone) first -= 1
  const after = last + 1
  const open = after >= n
  const endedAt = open ? undefined : snap.zoneStart[after]
  return { zone, startedAt: snap.zoneStart[first], endedAt, t1: endedAt ?? Math.max(nowMs, snap.lastTs) }
}

/** How many entries of an ASCENDING timestamp column fall inside `[t0, t1)` — half-open at the top,
 *  the same membership `rangeStats` and every loot surface apply. */
function countIn(column: readonly number[], t0: number, t1: number): number {
  let n = 0
  for (const ts of column) {
    if (ts >= t0 && ts < t1) n += 1
  }
  return n
}

/**
 * THE NAMED, IN KILL ORDER — out of the per-tier kill record, which is the only snapshot in this
 * app that carries a mob's NAME beside the instants it died at.
 *
 * A tier run brackets that tier's kills with `firstTs`/`lastTs`, so an instant of either that lands
 * inside this run is a kill that happened here. Both are taken when both land (the owner's run
 * killed `ice boned skeleton` twice, 24 seconds apart, and both are his); the kills BETWEEN them
 * are not knowable from this record and none is invented.
 */
function namedIn(kills: KillsSnap, t0: number, t1: number): RunNamed[] {
  const out: RunNamed[] = []
  for (const [key, info] of Object.entries(kills.mobs)) {
    const name = info.display || key
    if (/^(a|an|the)\s/i.test(name)) continue
    for (const run of Object.values(info.tiers)) {
      if (run.firstTs >= t0 && run.firstTs < t1) out.push({ name, at: run.firstTs })
      if (run.lastTs !== run.firstTs && run.lastTs >= t0 && run.lastTs < t1) out.push({ name, at: run.lastTs })
    }
  }
  out.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
  return out
}

/** The log's own word for a key: the item's NAME ends in `Key`. There is no item-kind flag in any
 *  loot line, so this is what the line says rather than a lookup this app would have to hold. */
const KEY_RE = /\bkey$/i

/** Keys the run paid out, one row per kind, in the order the first of each dropped. */
function keysIn(loot: readonly LootEvent[], t0: number, t1: number): RunKey[] {
  const rows: RunKey[] = []
  const seen = new Map<string, RunKey>()
  for (const e of loot) {
    if (e.ts < t0 || e.ts >= t1 || !KEY_RE.test(e.item)) continue
    const held = seen.get(e.item)
    if (held) {
      held.count += e.count ?? 1
      continue
    }
    const row = { name: e.item, count: e.count ?? 1, at: e.ts }
    seen.set(e.item, row)
    rows.push(row)
  }
  return rows
}

/**
 * THE REWARD CHEST, folded off the loot ledger by the source discriminator the parser now writes.
 *
 * A `chest` source is read by NAME nowhere: `Reward Chest` is what one container is called, not a
 * marker. A destroy carries no source at all and so cannot reach this; every other disposition is
 * either the auto-vendor, the merge, or something you still have.
 */
function chestIn(loot: readonly LootEvent[], t0: number, t1: number): RunChest {
  const out: RunChest = { items: 0, kept: 0, sold: 0, merged: 0 }
  for (const e of loot) {
    if (e.ts < t0 || e.ts >= t1 || e.sourceKind !== 'chest') continue
    const n = e.count ?? 1
    out.items += n
    if (e.disposition === 'sold') out.sold += n
    else if (e.disposition === 'combined') out.merged += n
    else out.kept += n
  }
  return out
}

/** Every denomination the auto-sell lines named inside the run, summed as stated. A denomination
 *  a line did not name contributes nothing — "the line did not say" is not "you got none". */
function autoSoldIn(coin: readonly CoinRow[], t0: number, t1: number): RunState['coinAutoSold'] {
  const out = { platinum: 0, gold: 0, silver: 0, copper: 0 }
  for (const row of coin) {
    if (row.ts < t0 || row.ts >= t1 || row.source !== 'sold') continue
    out.platinum += row.platinum ?? 0
    out.gold += row.gold ?? 0
    out.silver += row.silver ?? 0
    out.copper += row.copper ?? 0
  }
  return out
}

export interface RunTrackerArgs {
  /** the `progression` module's snapshot — the zone timeline and the kill columns. */
  snap: ProgressionSnap
  /** the `kills` module's snapshot — the per-mob, per-tier record. */
  kills: KillsSnap
  /** every loot event this character has, oldest first (the `loot` module's snapshot). */
  loot: readonly LootEvent[]
  /** the `coin` module's rows. */
  coin: readonly CoinRow[]
  /** the `deaths` module's recaps. CAPPED at 50 by that module, which is the ceiling on the one
   *  number this file reads off it. */
  deaths: DeathSnap
  /** the instant an OPEN run is measured to. Absent ⇒ the LOG's own clock (`snap.lastTs`), which
   *  is what keeps this function a pure fold of its inputs. */
  nowMs?: number
  /**
   * A run the user started by hand, and the instant they ended it. Session state, never persisted;
   * it OUTRANKS the zone timeline, because pressing `Start run here` in an open-world dungeon is a
   * statement about where you are that no zone line is going to make.
   */
  manualStart?: number | null
  manualEnd?: number | null
}

/** How many of a capped recap column fall inside the run. Its own pass rather than a `map`: the
 *  recaps are objects and this file counts timestamps. */
function deathsIn(deaths: DeathSnap, t0: number, t1: number): number {
  let n = 0
  for (const recap of deaths.recaps) {
    if (recap.ts >= t0 && recap.ts < t1) n += 1
  }
  return n
}

/** The window a manual run occupies, or null when the user has not started one. */
function manualWindow(args: RunTrackerArgs, nowMs: number): RunWindow | null {
  const start = args.manualStart
  if (start === null || start === undefined) return null
  const n = args.snap.zoneName.length
  const endedAt = args.manualEnd ?? undefined
  return {
    zone: n > 0 ? args.snap.zoneName[n - 1] : '',
    startedAt: start,
    endedAt,
    t1: endedAt ?? Math.max(nowMs, args.snap.lastTs)
  }
}

/**
 * THE RUN, from the five snapshots — the whole of what this window draws.
 *
 * `NO_RUN` when the log has named no instance and nobody has pressed `Start run here`: an empty
 * window is a STATE, and the surface says which one rather than drawing zeroes.
 */
export function runTracker(args: RunTrackerArgs): RunState {
  const { snap } = args
  const nowMs = args.nowMs ?? snap.lastTs
  const win = manualWindow(args, nowMs) ?? instanceWindow(snap, nowMs)
  if (win === null) return NO_RUN
  const { startedAt, t1 } = win
  return {
    active: win.endedAt === undefined,
    zone: win.zone,
    base: runBase(win.zone),
    tier: instanceTier(win.zone),
    startedAt,
    endedAt: win.endedAt,
    manual: args.manualStart !== null && args.manualStart !== undefined,
    kills: countIn(snap.killTs, startedAt, t1),
    groupKills: countIn(snap.witnessTs, startedAt, t1),
    named: namedIn(args.kills, startedAt, t1),
    keys: keysIn(args.loot, startedAt, t1),
    chest: chestIn(args.loot, startedAt, t1),
    doors: countIn(snap.doorTs, startedAt, t1),
    deaths: deathsIn(args.deaths, startedAt, t1),
    coinAutoSold: autoSoldIn(args.coin, startedAt, t1)
  }
}

/** How long the run has been going: to its end, or to the instant it is being read at. */
export function runElapsedMs(state: RunState, nowMs: number): number {
  if (state.startedAt === 0) return 0
  return Math.max(0, (state.endedAt ?? nowMs) - state.startedAt)
}

/**
 * Kills per minute over that stretch, or null when there is no stretch to divide by.
 *
 * Null is "there was no minute to divide by", never a zero somebody stated — the same refusal
 * `farmRows` makes, in the unit a single crawl is read in.
 */
export function runKillsPerMin(state: RunState, nowMs: number): number | null {
  const ms = runElapsedMs(state, nowMs)
  return ms > 0 ? ((state.kills + state.groupKills) * 60_000) / ms : null
}
