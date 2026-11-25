// useMapQuestOverlay.tsx — the Maps tab's half of a quest location jump (quest locations wave):
// land the inbound anchor, keep the target, and compose the quest layer the surface draws.
//
// THE ANCHOR LANDS ON MOUNT AS WELL AS ON A NONCE CHANGE — the QuestsView anchor idiom, for the
// same reason: the link that switched to this tab arrives at a view that has never run this
// effect. Landing is three things in order: the target is recorded (mapTarget.ts, above the
// view, so leaving and returning keeps it), the zone is opened through the search jump's OWN path
// (`useSearchJump.onJump` — it parks the point until the map has loaded and the pane has a size,
// then centres and zooms exactly like a sidebar hit), and the payload is retired so a later visit
// opens on the map as it stands.
//
// Opening the zone goes through `pick`, so it PINS the map the way any manual pick does (JOS-97):
// the player asked to look at Ak'Anon, and the next zone line must not snatch it away.

import { useEffect, useRef, type ReactNode } from 'react'
import type { MapData } from '@shared/maps'
import type { NavBack } from '../../appRouting'
import type { JumpTarget } from './crossZone'
import { mapFromLoc } from './mapGeometry'
import { MapQuestLegend, MapQuestPins, MapTargetMarker } from './MapQuestLayer'
import { clearMapTarget, setMapTarget, useMapTarget, type MapAnchor } from './mapTarget'
import type { MapViewport } from './useMapViewport'
import { useQuestLayer } from './useQuestLayer'

export interface MapAnchorProps {
  /** `AppRouting.mapAnchor`: the place a quest chip asked for, or null */
  anchor?: MapAnchor | null
  anchorNonce?: number
  onAnchorApplied?: () => void
  /** the app's one Back contract — the target card's arrow presses it */
  nav?: NavBack
}

/** Land `anchor` once per nonce: record the target, then jump the way a sidebar hit does. */
function useAnchorLanding(props: MapAnchorProps, onJump: (to: JumpTarget) => void): void {
  const { anchor = null, anchorNonce = 0, onAnchorApplied } = props
  const applied = useRef<number | null>(null)
  useEffect(() => {
    if (anchor === null || applied.current === anchorNonce) return
    applied.current = anchorNonce
    setMapTarget(anchor)
    const at = anchor.loc ? mapFromLoc({ ns: anchor.loc.ns, ew: anchor.loc.ew, z: anchor.loc.z ?? 0 }) : null
    onJump({ zone: anchor.zone, at: at ? { x: at.x, y: at.y } : null })
    onAnchorApplied?.()
  }, [anchor, anchorNonce, onAnchorApplied, onJump])
}

/** The quest layer for the map drawn, as one node for the surface. Null when no map is drawn. */
export function useMapQuestOverlay(args: { props: MapAnchorProps; vp: MapViewport; data: MapData | null; onJump: (to: JumpTarget) => void }): ReactNode {
  const { props, vp, data, onJump } = args
  useAnchorLanding(props, onJump)
  const target = useMapTarget()
  const layer = useQuestLayer(data?.zone, target?.quest)
  if (data === null) return null
  const here = target !== null && target.zone === data.zone ? target : null
  const nav = props.nav
  return (
    <>
      {layer.pins.length > 0 && <MapQuestPins pins={layer.pins} vp={vp} />}
      {here?.loc && <MapTargetMarker target={{ ...here, loc: here.loc }} vp={vp} />}
      <MapQuestLegend
        target={here}
        onDismiss={clearMapTarget}
        backLabel={nav?.origin?.label ?? null}
        onBack={() => {
          nav?.back()
        }}
        pinsOn={layer.on}
        pinCount={layer.pins.length}
        questCount={layer.quests}
        onTogglePins={layer.toggle}
      />
    </>
  )
}
