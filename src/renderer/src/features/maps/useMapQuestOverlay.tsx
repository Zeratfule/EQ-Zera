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

import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import type { MapData } from '@shared/maps'
import type { NavBack } from '../../appRouting'
import type { JumpTarget } from './crossZone'
import { mapFromLoc } from './mapGeometry'
import { onMap as onMapBounds } from './onMap'
import { MapQuestLegend, MapQuestPins, MapTargetMarker } from './MapQuestLayer'
import { clearMapTarget, markCentred, setMapTarget, useMapTarget, wasCentred, type MapAnchor } from './mapTarget'
import type { MapViewport } from './useMapViewport'
import { useQuestLayer, type QuestLayer } from './useQuestLayer'
import { zoneLabel } from './zoneOptions'

export interface MapAnchorProps {
  /** `AppRouting.mapAnchor`: the place a quest chip asked for, or null */
  anchor?: MapAnchor | null
  anchorNonce?: number
  onAnchorApplied?: () => void
  /** the app's one Back contract — the target card's arrow presses it */
  nav?: NavBack
}

/** Land `anchor` once per nonce: record the target, and open its zone. The point waits for the map. */
function useAnchorLanding(props: MapAnchorProps, onJump: (to: JumpTarget) => void): void {
  const { anchor = null, anchorNonce = 0, onAnchorApplied } = props
  const applied = useRef<number | null>(null)
  useEffect(() => {
    if (anchor === null || applied.current === anchorNonce) return
    applied.current = anchorNonce
    setMapTarget(anchor)
    onJump({ zone: anchor.zone, at: null })
    onAnchorApplied?.()
  }, [anchor, anchorNonce, onAnchorApplied, onJump])
}

/**
 * THE MAP'S OWN EXTENT IS THE LAST WORD (./onMap.ts): a point outside the drawn map is never drawn
 * or centred as if it were real — the card says so instead. Checked for the target AND every pin.
 */
const onMap = (data: MapData, loc: { ns: number; ew: number }): boolean => onMapBounds(data.bounds, loc)

/** Centre on the target ONCE per target, when its own map is drawn, measured, and holds it. */
function useCentreTarget(target: MapAnchor | null, data: MapData | null, vp: MapViewport, onJump: (to: JumpTarget) => void): void {
  const ready = data !== null && target?.loc !== undefined && target.zone === data.zone && vp.size.w > 0
  useEffect(() => {
    if (!ready || target?.loc === undefined || data === null || wasCentred(target)) return
    markCentred(target)
    if (!onMap(data, target.loc)) return
    const at = mapFromLoc({ ns: target.loc.ns, ew: target.loc.ew, z: 0 })
    onJump({ zone: target.zone, at: { x: at.x, y: at.y } })
  }, [ready, target, data, onJump])
}

/** The quest layer for the map drawn, as one node for the surface. Null when no map is drawn. */
export function useMapQuestOverlay(args: { props: MapAnchorProps; vp: MapViewport; data: MapData | null; onJump: (to: JumpTarget) => void }): ReactNode {
  const { props, vp, data, onJump } = args
  useAnchorLanding(props, onJump)
  const target = useMapTarget()
  useCentreTarget(target, data, vp, onJump)
  const keep = useCallback((loc: { ns: number; ew: number }) => data !== null && onMap(data, loc), [data])
  const layer = useQuestLayer(data?.zone, target?.quest, keep)
  if (data === null) return null
  return <QuestOverlay data={data} vp={vp} target={target} layer={layer} nav={props.nav} />
}

/** The target as THIS map sees it: on it (with a mark to draw), off its extent, or not its zone. */
function targetOn(data: MapData, target: MapAnchor | null): { here: MapAnchor | null; mark: (MapAnchor & { loc: NonNullable<MapAnchor['loc']> }) | null; offMap: boolean } {
  if (target?.zone !== data.zone || target === null) return { here: null, mark: null, offMap: false }
  const loc = target.loc
  if (loc === undefined) return { here: target, mark: null, offMap: false }
  return onMap(data, loc) ? { here: target, mark: { ...target, loc }, offMap: false } : { here: target, mark: null, offMap: true }
}

/** The drawing: pins, the target's mark (only where the map holds it), and the corner card. */
function QuestOverlay(props: { data: MapData; vp: MapViewport; target: MapAnchor | null; layer: QuestLayer; nav: NavBack | undefined }): ReactNode {
  const { data, vp, target, layer, nav } = props
  const { here, mark, offMap } = targetOn(data, target)
  return (
    <>
      {layer.pins.length > 0 && <MapQuestPins pins={layer.pins} vp={vp} />}
      {mark && <MapTargetMarker target={mark} vp={vp} />}
      <MapQuestLegend
        offMap={offMap ? zoneLabel(data.zone) : null}
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
