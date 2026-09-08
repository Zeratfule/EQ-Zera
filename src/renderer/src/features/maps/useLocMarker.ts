// THE REACT HALF of the typed-/loc marker (JOS-98) — the state, the persistence effect, and the
// two gestures. Every RULE it applies lives in `locMarker.ts`, which is pure and node-tested; this
// file is the wiring, and it is deliberately the only part of the feature that cannot be driven by
// `node --test`.
//
// PERSISTED BY ONE EFFECT, not by each transition — the same shape `useZoneSelection` uses for the
// pinned zone, and for the same reason: there is exactly one place that can forget to write, and
// none of the reducers has to be impure to be correct.
//
// KEYED BY ZONE, READ BY ZONE. The whole map of markers is held in state and the CURRENT zone's is
// derived, rather than loading one zone's marker on every zone change. That is what makes walking
// out of a zone and back — or pinning another map and returning — free of a reload, and it is why
// clearing one zone's marker provably cannot touch another's (`clearLocMarker`).
//
// PLACING JUMPS, RESTORING DOES NOT. Typing a loc is a question ("where is that?") and the answer
// is useless off screen, so a placement centres the view on it at the search's own zoom. A marker
// restored from a previous session is NOT a question anyone just asked — snapping the viewport on
// mount would fight the zone's own fit and move a map the user never touched.

import { useCallback, useEffect, useState } from 'react'
import type { ZoneShort } from '@shared/maps'
import { JUMP_ZOOM } from './MapBody'
import { mapFromLoc, type EqLoc } from './mapGeometry'
import {
  clearLocMarker,
  loadLocMarkers,
  locMarkerFor,
  saveLocMarkers,
  setLocMarker,
  type LocMarkers
} from './locMarker'
import type { MapViewport } from './useMapViewport'

/** What the toolbar needs to state the marker, and what the surface needs to draw it. */
export interface LocMarkerState {
  /** This zone's marker in the game's own axes, or null. */
  marker: EqLoc | null
  /** A well-formed reading was entered: remember it for this zone, and go look at it. */
  place: (loc: EqLoc) => void
  /** Centre on the marker already placed. The chip's click. */
  show: () => void
  /** Forget this zone's marker. */
  clear: () => void
}

export function useLocMarker(zone: ZoneShort | null, vp: MapViewport): LocMarkerState {
  const [marks, setMarks] = useState<LocMarkers>(loadLocMarkers)
  useEffect(() => {
    saveLocMarkers(marks)
  }, [marks])

  const marker = locMarkerFor(marks, zone)
  const { centerOn, zoomedIn, view } = vp

  // Fitted ⇒ a marker is a few pixels from everything else, so the jump also zooms in; already
  // zoomed ⇒ keep the scale the user chose. Identical to the search jump, on purpose.
  const goTo = useCallback(
    (loc: EqLoc) => {
      const p = mapFromLoc(loc)
      centerOn(p.x, p.y, zoomedIn ? undefined : view.scale * JUMP_ZOOM)
    },
    [centerOn, zoomedIn, view.scale]
  )

  const place = useCallback(
    (loc: EqLoc) => {
      // No map open ⇒ nowhere to remember it. The field is gated on `hasMap`, so this is a guard,
      // not a path: a marker filed under no zone could never be found again.
      if (zone == null) return
      setMarks((prev) => setLocMarker(prev, zone, loc))
      goTo(loc)
    },
    [zone, goTo]
  )

  const show = useCallback(() => {
    if (marker != null) goTo(marker)
  }, [marker, goTo])

  const clear = useCallback(() => {
    if (zone == null) return
    setMarks((prev) => clearLocMarker(prev, zone))
  }, [zone])

  return { marker, place, show, clear }
}
