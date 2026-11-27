// THE TYPED-/loc MARKER — one dot, in a colour nothing else on this surface uses (JOS-98).
//
// A THIRD AUTHORITY NEEDS A THIRD SYMBOL. The surface already carries two, and a user must never
// have to ask which source a mark came from:
//
//   * the MAP FILE's own labels — round dots in the pack author's colours, because those colours
//     ENCODE a category (zone connection, banker, merchant…) and recolouring them destroys meaning;
//   * the WIKI's spawn pins, the search-jump flash and the selection ring — all the theme's warning
//     tone, because they are all "the app found this for you".
//
// This is neither. It is the one position on the map the USER stated, so it takes the theme's info
// tone and a crosshair rather than a pin or a ring — a shape that reads as "this exact point"
// rather than "something is around here". It is also the only mark on the surface that PERSISTS
// across a restart, which is the other reason it cannot look like the search flash.
//
// INERT, like the label and pin layers: `pointerEvents:'none'` on the frame so drag-to-pan works
// straight through it, re-enabled on the crosshair itself so its tooltip works. Clearing it is
// deliberately NOT a click on the map — the toolbar's chip owns that, next to the box the loc was
// typed into, so the affordance sits where the user's attention already is and a stray click on a
// map can never delete something they typed.
//
// THE LOGGED /loc (`MapLoggedLocMarker`) shares the crosshair and differs in tone and caption: the
// game wrote it to the log (loggedLoc.ts), it is never persisted, and it says the minute it was read.

import type { JSX } from 'react'
import { useTheme } from '@mui/material'
import type { EqLoc } from './mapGeometry'
import { formatLoc } from './locMarker'
import type { MapViewport } from './useMapViewport'

/** Outer diameter of the ring, CSS pixels. Fixed, like the pins: a mark is not a distance. */
const RING_PX = 18
/** How far each tick reaches beyond the ring — enough to find at a glance on a busy map. */
const TICK_PX = 7

export interface MapLocMarkerProps {
  /** Where the user said they were, in MAP coordinates — already through `mapFromLoc`. */
  at: { x: number; y: number }
  /** The reading itself, so the tooltip can state it in the game's own words and order. */
  loc: EqLoc
  vp: MapViewport
}

/** One arm of the crosshair. Four of these plus the ring is the whole symbol. */
function tick(color: string, style: React.CSSProperties): JSX.Element {
  return <span style={{ position: 'absolute', background: color, ...style }} />
}

export function MapLocMarker({ at, loc, vp }: MapLocMarkerProps): JSX.Element {
  const color = useTheme().palette.info.main
  return (
    <Crosshair
      at={at}
      vp={vp}
      color={color}
      testId="maps-loc-marker"
      dataLoc={formatLoc(loc)}
      title={`The location you entered - /loc ${formatLoc(loc)}`}
    />
  )
}

/**
 * THE GAME'S OWN /loc — a fourth authority, so a fourth look: the same crosshair (it is still "this
 * exact point") in the theme's success tone, with its label written beside it so it can never be
 * mistaken for the pasted one or for a live position. The label carries the minute it was read.
 * Off the floor on screen it dims rather than vanishing, like the geometry around it.
 */
export function MapLoggedLocMarker({
  at,
  loc,
  label,
  dim,
  vp
}: MapLocMarkerProps & { label: string; dim: boolean }): JSX.Element {
  const color = useTheme().palette.success.main
  return (
    <Crosshair
      at={at}
      vp={vp}
      color={color}
      testId="maps-logged-loc-marker"
      dataLoc={formatLoc(loc)}
      title={`${label} - ${formatLoc(loc)}`}
      caption={label}
      dim={dim}
    />
  )
}

interface CrosshairProps {
  at: { x: number; y: number }
  vp: MapViewport
  color: string
  testId: string
  dataLoc: string
  title: string
  caption?: string
  dim?: boolean
}

function Crosshair({ at, vp, color, testId, dataLoc, title, caption, dim = false }: CrosshairProps): JSX.Element {
  const p = vp.toScreen(at.x, at.y)
  const half = RING_PX / 2
  const arm = { width: 2, height: TICK_PX, marginLeft: -1 } as const
  const bar = { height: 2, width: TICK_PX, marginTop: -1 } as const
  return (
    <div
      data-testid={testId}
      data-loc={dataLoc}
      data-dim={dim ? 'true' : undefined}
      style={{
        position: 'absolute',
        left: p.px,
        top: p.py,
        width: 0,
        height: 0,
        pointerEvents: 'none',
        zIndex: 4,
        opacity: dim ? 0.45 : 1
      }}
    >
      {caption != null && (
        <span
          data-testid={`${testId}-label`}
          style={{
            position: 'absolute',
            left: half + TICK_PX + 4,
            top: -9,
            whiteSpace: 'nowrap',
            fontSize: 12,
            fontWeight: 600,
            color,
            textShadow: '0 0 3px rgba(0,0,0,0.9)'
          }}
        >
          {caption}
        </span>
      )}
      <span
        title={title}
        style={{
          position: 'absolute',
          left: -half,
          top: -half,
          width: RING_PX,
          height: RING_PX,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.75)',
          pointerEvents: 'auto'
        }}
      />
      {tick(color, { ...arm, left: 0, top: -half - TICK_PX })}
      {tick(color, { ...arm, left: 0, top: half })}
      {tick(color, { ...bar, top: 0, left: -half - TICK_PX })}
      {tick(color, { ...bar, top: 0, left: half })}
    </div>
  )
}
