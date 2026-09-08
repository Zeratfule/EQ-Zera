// WHICH ZONE THE MAP VIEWER IS POINTED AT — the mode, the transitions, and where both are
// remembered. Pure: no React, no DOM beyond a `getItem/setItem` pair it is HANDED, so the whole
// rule set is node-testable (tests/mapZoneFollow.test.mts).
//
// THE DEFECT THIS EXISTS FOR (JOS-97, a v0.10.0 report): "Would be nice to keep selected map when
// you move off of the tab (seems to reset if I move to the loot tab as an example)." The viewer
// had ONE rule — the character's zone wins, always — so a manual pick was overwritten twice over:
// by the next zone line, and by simply LEAVING THE TAB. `App` mounts exactly one feature view at a
// time, so the Maps view is destroyed on the way out and remounted on the way back, and the
// remount's first effect re-applied the character's zone over the pick that had just been
// restored from localStorage. Choosing a map was therefore something the app undid, not something
// it remembered.
//
// TWO MODES, AND THE MODE IS THE STATE.
//
//   * `follow` — the map tracks the character's zone. This is what the viewer has always done and
//     it is still the fresh-install default, so nobody who never pins sees any change.
//   * `pinned` — a manual pick holds. Zone lines are ignored, navigation and restarts do not
//     disturb it, and the ONLY way out is asking for it: the toolbar's Current zone control.
//
// WHY A MODE RATHER THAN A TIMEOUT OR A HEURISTIC ("hold the pick until you zone TWICE", "hold it
// for five minutes"): the user asked for a map and the app has no way to know when they are done
// with it. Any rule that expires a pick on the app's own schedule is the original bug with a
// delay. The mode is set by the user in both directions and is stated on screen in both — an
// invisible mode would be the next confusion report, so `MapToolbar` renders which one is in force
// beside the selector.
//
// PERSISTENCE IS MACHINE-LOCAL localStorage beside the zone itself (`useMapData.ts` carries why
// the map prefs are deliberately not in `UI_PREF_SPECS`): which map you are reading is a fact
// about this window, not a setting worth carrying to another machine.

import type { ZoneShort } from '@shared/maps'

/** Does the map follow the character's zone, or hold the zone the user picked? */
export type ZoneMode = 'follow' | 'pinned'

/** The zone stem the viewer was last showing, so a relaunch opens where you left off. */
export const LAST_ZONE_KEY = 'eq.maps.zone'
/**
 * Which mode that zone is held in. Absent — a fresh install, or one that predates JOS-97 — reads
 * as `follow`, so an upgrade changes nothing for anyone who has never pinned.
 */
export const ZONE_MODE_KEY = 'eq.maps.zoneMode'

/** What the viewer is pointed at, and why. `zone: null` is the honest "no map is open". */
export interface ZoneSelection {
  zone: ZoneShort | null
  mode: ZoneMode
}

/** The two `localStorage` methods this module uses — passed in so the rules are testable. */
export interface ZoneStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * THE LOG STATED A ZONE.
 *
 * Only called when the character's zone is actually stated (see `MapsView`'s effect gate), so a
 * `null` `auto` here means a REAL zone the hand-authored table cannot place — which clears the map
 * rather than leaving the previous one drawn under a name it does not belong to (world-model
 * law 1, and the reason `MapsEmpty` says which name it could not place).
 *
 * Pinned ignores it entirely, and returns the SAME object so a zone line arriving while you read
 * another map costs the viewer not even a re-render.
 */
export function onCharacterZone(state: ZoneSelection, auto: ZoneShort | null): ZoneSelection {
  if (state.mode === 'pinned') return state
  if (state.zone === auto) return state
  return { zone: auto, mode: 'follow' }
}

/**
 * THE USER PICKED A ZONE — from the toolbar's selector or a cross-zone search hit.
 *
 * A pick is always a pin: it is the only way a zone other than the character's gets on screen, and
 * an unpinned pick is exactly the state the report was about.
 */
export function onPick(zone: ZoneShort): ZoneSelection {
  return { zone, mode: 'pinned' }
}

/**
 * THE USER ASKED FOR THE CURRENT ZONE — snap there now, and follow from now on.
 *
 * `stated` is whether the log has said where the character is AT ALL. When it has not (a fresh
 * install, or a replay that has not reached a zone line yet) the remembered zone STAYS on screen —
 * the same courtesy the follow path has always extended — because the alternative is answering
 * "show me where I am" by blanking the pane.
 */
export function onFollowCurrent(
  state: ZoneSelection,
  auto: ZoneShort | null,
  stated: boolean
): ZoneSelection {
  return { zone: stated ? auto : state.zone, mode: 'follow' }
}

/**
 * Read the remembered selection. Everything unrecognised folds to the default (`follow`), and so
 * does a pin with nothing pinned: a stored `pinned` whose zone is gone would hold the viewer on
 * nothing at all, with a Current zone button as the only way to make it draw anything.
 */
export function loadZoneSelection(store: ZoneStore = localStorage): ZoneSelection {
  const raw = store.getItem(LAST_ZONE_KEY)
  const zone = raw == null || raw === '' ? null : raw
  const mode = store.getItem(ZONE_MODE_KEY) === 'pinned' && zone != null ? 'pinned' : 'follow'
  return { zone, mode }
}

/**
 * Remember it, and hand the selection straight back so a caller can persist inline.
 *
 * The MODE is always written, in both directions — a "sticky" store that only ever recorded
 * `pinned` would strand a user who asked to follow again on the far side of one restart (the
 * JOS-90 un-tick lesson). The ZONE is written only when there is one: a follow into a zone this
 * install has no map name for leaves the last real zone remembered, which is what makes the next
 * launch open somewhere rather than nowhere.
 */
export function saveZoneSelection(sel: ZoneSelection, store: ZoneStore = localStorage): ZoneSelection {
  store.setItem(ZONE_MODE_KEY, sel.mode)
  if (sel.zone != null) store.setItem(LAST_ZONE_KEY, sel.zone)
  return sel
}
