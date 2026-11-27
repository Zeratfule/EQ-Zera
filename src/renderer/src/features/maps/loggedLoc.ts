// WHERE THE LOG SAID YOU ARE — the `/loc` the game wrote to the log, as the map reads it. Pure: no
// React, no DOM, so every rule here is node-tested (tests/mapLoggedLoc.test.mts).
//
// THE FACT THIS RESTS ON, MEASURED 2026-11-27: EverQuest Legends DOES write the answer to `/loc`
// into the log file — `[Fri Nov 27 16:44:57 2026] Your Location is 218.95, 91.12, 17.90`, read in
// `eqlog_<Char>_freeport.txt`. The engine parses that line (eqlog `parse/loc.rs`, anchored on the
// game's own system line so a tell or a say quoting it is never a position) and the character
// module files it — LIVE TAIL ONLY, under the zone held at that moment, dropped by any zone line or
// new session. So `CharacterSnap.loc` is already "where you stood at your last /loc since you
// arrived here"; this module decides only whether the map ON SCREEN may draw it.
//
// TWO MARKERS, TWO AUTHORITIES. The typed marker (locMarker.ts) is a position the user pasted, kept
// per zone in localStorage across restarts. This one is a position the GAME stated, held by the
// engine and never persisted: a stored "you" from yesterday would be a dot claiming to be you while
// you stand somewhere else. Writing one into the other would make the paste box silently overwrite
// what the game said, and the game's reading outlive the visit it was true for.
//
// NOT LIVE TRACKING. One dot per `/loc` you type; it does not follow you, and its label states the
// minute it was read so it never reads as a live position.

import type { LoggedLoc } from '@shared/characterTypes'
import type { ZoneShort } from '@shared/maps'
import { zoneShortName } from '../../../../shared/zones'
import { formatTime } from '../../lib/formatDate'
import { bandOfZ, type FloorBand } from './floorSlice'
import type { MapPos, ViewRect } from './mapGeometry'
import type { ZoneMode } from './zoneFollow'

/** The two fields of `CharacterSnap` this reads — narrowed so a test can hand it a literal. */
export interface LoggedLocSource {
  zone?: string
  loc?: LoggedLoc
}

/**
 * The logged position the DRAWN map may show, or null.
 *
 * Three refusals, each a different lie avoided: no loc at all; a loc filed under a zone the
 * character is no longer in (the engine already drops it on a zone line — this is the second
 * lock, so a snapshot caught mid-change can never draw yesterday's dot); and a map on screen that
 * is not that zone's (a pinned map of somewhere else, or the previous zone's map still drawn while
 * the new one loads).
 */
export function currentLoggedLoc(snap: LoggedLocSource | null | undefined, drawn: ZoneShort | null): LoggedLoc | null {
  const loc = snap?.loc
  if (loc == null || drawn == null) return null
  if (loc.zone !== snap?.zone) return null
  return zoneShortName(loc.zone) === drawn ? loc : null
}

/**
 * A current reading the drawn map cannot show — you pinned another zone, or your zone has no map
 * name — so the toolbar can say where it is instead of showing nothing. Null when there is no
 * current reading, or when the drawn map already shows it.
 */
export function loggedLocElsewhere(
  snap: LoggedLocSource | null | undefined,
  drawn: ZoneShort | null
): { zone: string; mapped: boolean } | null {
  const loc = snap?.loc
  if (loc == null || loc.zone !== snap?.zone || currentLoggedLoc(snap, drawn) != null) return null
  return { zone: loc.zone, mapped: zoneShortName(loc.zone) != null }
}

/** One reading's identity, so a view can tell a NEW /loc from the one it mounted with. */
export function loggedLocKey(loc: LoggedLoc | null | undefined): string | null {
  return loc == null ? null : `${String(loc.ts)}|${String(loc.ns)}|${String(loc.ew)}|${String(loc.z)}`
}

/**
 * Does this render bring a reading the view has not acted on? `seen` is the identity last acted on
 * (or present at mount). A reading that arrives while the map it belongs to is still loading is NOT
 * consumed — `drawable` is null until that map is drawn — so it acts the moment the map lands.
 */
export function readingToAct(seen: string | null, snapLoc: LoggedLoc | null | undefined, drawable: LoggedLoc | null): boolean {
  return drawable != null && loggedLocKey(snapLoc) !== seen
}

/** `16:44` — the minute the log stamped the line, local, 24h, through the app's one formatter. */
export function loggedLocTime(loc: LoggedLoc): string {
  return formatTime(loc.ts, { hour: '2-digit', minute: '2-digit' })
}

/** What the marker and the chip call it. The minute is the point: this is a reading, not a feed. */
export function loggedLocLabel(loc: LoggedLoc): string {
  return `You (from /loc, ${loggedLocTime(loc)})`
}

/**
 * The floor that shows this z, given the floor on screen.
 *
 * All levels (`null`) already shows every elevation and stays put. A specific floor that does not
 * hold the z moves to the one that does; a z no band can place keeps the floor the user chose.
 */
export function floorShowing(bands: readonly FloorBand[], floor: number | null, z: number): number | null {
  if (floor == null) return null
  const band = bandOfZ(bands, z)
  return band < 0 ? floor : band
}

/**
 * THE FLOOR RULE FOR A NEW /loc, stated once.
 *
 * A new reading moves the floor ONLY when the map is following you AND you are already looking at
 * one specific floor: that pair means "show me my level", and the /loc you just typed is the
 * freshest statement of it. Pinned keeps whatever you chose — you are reading a map on purpose —
 * and All levels is left alone because it already shows the marker. Nothing here runs on a mount
 * or a tab switch, only on a reading the view had not seen, so a floor you pick after a /loc holds
 * until you type the next one.
 */
export function floorForNewLoc(
  args: { mode: ZoneMode; bands: readonly FloorBand[]; floor: number | null; z: number }
): number | null {
  if (args.mode !== 'follow') return args.floor
  return floorShowing(args.bands, args.floor, args.z)
}

/** Is a map point inside the visible window? The modest pan only moves a view that cannot see it. */
export function inView(rect: ViewRect, p: MapPos): boolean {
  return p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY
}
