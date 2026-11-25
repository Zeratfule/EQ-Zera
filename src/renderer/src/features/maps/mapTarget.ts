// mapTarget.ts — THE QUEST TARGET: a place another tab asked the Maps tab to show (quest locations).
//
// A FOURTH AUTHORITY, AND IT IS NOT THE USER'S. The surface already carries the map file's labels,
// the wiki's spawn pins and the /loc the USER typed (useLocMarker.ts, persisted per zone). A quest
// page's "Rylin Coil · Ak'Anon (1469, -190)" is none of those: it is the app pointing at something
// on the player's behalf. So it never touches the typed /loc marker — that one is the player's own
// statement and a click on a quest chip must not overwrite it — and it gets its own symbol and its
// own lifetime.
//
// SESSION-LIFETIME, KEPT ABOVE THE VIEW. The Maps tab unmounts on every tab switch (the JOS-90
// law), and a target you dismissed must stay dismissed while one you did not must still be there
// when you come back from checking the quest. So it lives here, in module scope, until it is
// dismissed or replaced by the next jump — never in localStorage: a target is a question asked in
// this session, not a setting, and a relaunch should not reopen it.

import { useSyncExternalStore } from 'react'
import type { ZoneShort } from '@shared/maps'

/** /loc order: north-south, east-west, then elevation when stated. */
export interface TargetLoc {
  ns: number
  ew: number
  z?: number
}

/** What a deep link into the Maps tab carries. `loc` absent ⇒ open the zone, mark nothing. */
export interface MapAnchor {
  zone: ZoneShort
  loc?: TargetLoc
  /** what is there, as the chip said it: "Rylin Coil · Ak'Anon" */
  label: string
  /** the quest page the jump came from, so its pins can be drawn beside the target */
  quest?: string
}

let target: MapAnchor | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Point the map at `next` (replacing any earlier target). */
export function setMapTarget(next: MapAnchor): void {
  target = next
  emit()
}

/** The player dismissed it. */
export function clearMapTarget(): void {
  target = null
  emit()
}

/**
 * Targets the view has already centred on. A target is centred ONCE, when its map is first drawn
 * and measured; coming back to the tab later shows the mark without moving a map the player has
 * since panned. Keyed on the target object, so the next jump (a new object) centres again.
 */
const centred = new WeakSet<MapAnchor>()

export function wasCentred(t: MapAnchor): boolean {
  return centred.has(t)
}

export function markCentred(t: MapAnchor): void {
  centred.add(t)
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** The live target, or null. */
export function useMapTarget(): MapAnchor | null {
  return useSyncExternalStore(subscribe, () => target)
}
