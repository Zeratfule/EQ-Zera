// THE REACT HALF of the logged-/loc marker — what the map does when the log says where you are.
// Every rule it applies lives in `loggedLoc.ts`, which is pure and node-tested; this file is the
// wiring.
//
// ONLY A NEW READING ACTS. The view is unmounted on every tab switch, so "the reading on screen" and
// "a reading that just arrived" have to be told apart or every return to the tab would move the
// floor and the view. The reading present at mount is recorded as already seen; only a different
// one — a /loc typed while the tab is open — runs the floor rule and the pan.
//
// THE PAN IS MODEST. A new reading in follow mode re-centres the view only when the dot would be
// off screen, at the scale the user chose; a view that can already see it is left exactly where it
// is. Pinned never moves: you are reading that map on purpose.

import { useCallback, useEffect, useRef } from 'react'
import type { LoggedLoc } from '@shared/characterTypes'
import type { ZoneShort } from '@shared/maps'
import { JUMP_ZOOM } from './MapBody'
import { inActiveBand, type FloorBand } from './floorSlice'
import { mapFromLoc } from './mapGeometry'
import {
  currentLoggedLoc,
  floorForNewLoc,
  floorShowing,
  inView,
  loggedLocKey,
  type LoggedLocSource
} from './loggedLoc'
import type { MapViewport } from './useMapViewport'
import type { ZoneMode } from './zoneFollow'

/** What the toolbar's chip and the surface's marker need. */
export interface LoggedLocState {
  /** The reading the drawn map may show, or null. */
  loc: LoggedLoc | null
  /** It sits outside the floor on screen, so the marker is drawn dimmed. */
  offFloor: boolean
  /** Centre on it and show its floor. The chip's click. */
  show: () => void
}

export interface LoggedLocArgs {
  snap: LoggedLocSource | null | undefined
  /** The zone actually DRAWN, never the one being fetched. */
  drawn: ZoneShort | null
  mode: ZoneMode
  bands: readonly FloorBand[]
  floor: number | null
  onFloor: (floor: number | null) => void
  vp: MapViewport
}

export function useLoggedLoc({ snap, drawn, mode, bands, floor, onFloor, vp }: LoggedLocArgs): LoggedLocState {
  const loc = currentLoggedLoc(snap, drawn)
  const key = loggedLocKey(snap?.loc)
  const seen = useRef(key)
  const { rect, centerOn, zoomedIn, view } = vp

  useEffect(() => {
    if (key === seen.current) return
    seen.current = key
    if (loc == null) return
    const next = floorForNewLoc({ mode, bands, floor, z: loc.z })
    if (next !== floor) onFloor(next)
    const p = mapFromLoc(loc)
    if (mode === 'follow' && !inView(rect, p)) centerOn(p.x, p.y)
  }, [key, loc, mode, bands, floor, onFloor, rect, centerOn])

  const show = useCallback(() => {
    if (loc == null) return
    const next = floorShowing(bands, floor, loc.z)
    if (next !== floor) onFloor(next)
    const p = mapFromLoc(loc)
    centerOn(p.x, p.y, zoomedIn ? undefined : view.scale * JUMP_ZOOM)
  }, [loc, bands, floor, onFloor, centerOn, zoomedIn, view.scale])

  const offFloor = loc != null && !inActiveBand(bands, floor, loc.z)
  return { loc, offFloor, show }
}
