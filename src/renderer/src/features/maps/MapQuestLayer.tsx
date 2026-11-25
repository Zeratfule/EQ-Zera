// MapQuestLayer.tsx — the quest marks on the map surface (quest locations wave): the TARGET a quest
// chip jumped to, the QUEST PINS of the quests being followed, and the one control that names and
// toggles them.
//
// TWO MORE SYMBOLS, AND NEITHER LOOKS LIKE THE OTHER THREE. The surface already draws the map file's
// own labels (the pack author's colours), the wiki's spawn pins (amber teardrops) and the /loc the
// player typed (an info-blue crosshair). Quest pins are small green DIAMONDS — green is the app's
// quest colour (palette.ts) — and the target is a magenta double ring with a label: the one place
// the player just asked to see. The target is the player's to dismiss, from the label beside it;
// it never touches the typed /loc marker (mapTarget.ts says why).
//
// INERT LIKE THE OTHER LAYERS: the frame takes no pointer events so drag-to-pan works through it,
// and only the pins (for their hover) and the label's buttons take them back.

import type { JSX } from 'react'
import { Box, Chip, IconButton, Stack, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import type { QuestMapPin } from '../../../../shared/questMapPins'
import { PALETTE } from '../../../../shared/palette'
import { mapFromLoc } from './mapGeometry'
import type { MapAnchor } from './mapTarget'
import type { MapViewport } from './useMapViewport'
import { Tooltip } from '../../lib/Tooltip'

const PIN_PX = 9
const RING_PX = 22

const fmt = (l: { ns: number; ew: number; z?: number }): string =>
  `(${[l.ns, l.ew, ...(l.z === undefined ? [] : [l.z])].map(String).join(', ')})`

/** The quest pins for the map drawn. */
export function MapQuestPins({ pins, vp }: { pins: readonly QuestMapPin[]; vp: MapViewport }): JSX.Element {
  return (
    <div data-testid="maps-quest-pins" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {pins.map((p) => {
        const m = mapFromLoc({ ns: p.loc.ns, ew: p.loc.ew, z: p.loc.z ?? 0 })
        const at = vp.toScreen(m.x, m.y)
        return (
          <span
            key={p.key}
            data-testid="maps-quest-pin"
            data-quest={p.quest}
            data-loc={fmt(p.loc)}
            title={`${p.labels.join('\n')}\n${fmt(p.loc)}`}
            style={{
              position: 'absolute',
              left: at.px,
              top: at.py,
              width: PIN_PX,
              height: PIN_PX,
              marginLeft: -PIN_PX / 2,
              marginTop: -PIN_PX / 2,
              transform: 'rotate(45deg)',
              background: PALETTE.green,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.85)',
              pointerEvents: 'auto',
              zIndex: 2
            }}
          />
        )
      })}
    </div>
  )
}

/** The target's mark: a magenta double ring at the point. */
export function MapTargetMarker({ target, vp }: { target: MapAnchor & { loc: NonNullable<MapAnchor['loc']> }; vp: MapViewport }): JSX.Element {
  const m = mapFromLoc({ ns: target.loc.ns, ew: target.loc.ew, z: target.loc.z ?? 0 })
  const at = vp.toScreen(m.x, m.y)
  return (
    <div
      data-testid="maps-target-marker"
      data-zone={target.zone}
      data-loc={fmt(target.loc)}
      title={`${target.label} ${fmt(target.loc)}`}
      style={{
        position: 'absolute',
        left: at.px,
        top: at.py,
        width: RING_PX,
        height: RING_PX,
        marginLeft: -RING_PX / 2,
        marginTop: -RING_PX / 2,
        borderRadius: '50%',
        border: `3px double ${PALETTE.magenta}`,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.8), 0 0 10px rgba(244,114,182,0.6)',
        pointerEvents: 'none',
        zIndex: 5
      }}
    />
  )
}

/**
 * The corner card: what the target is (with its Back and its dismiss), and the quest-pin legend
 * that is also the layer's switch. Drawn only when there is something to say.
 */
export function MapQuestLegend(props: {
  target: MapAnchor | null
  onDismiss: () => void
  backLabel: string | null
  onBack: () => void
  pinsOn: boolean
  pinCount: number
  questCount: number
  onTogglePins: () => void
}): JSX.Element | null {
  const { target, onDismiss, backLabel, onBack, pinsOn, pinCount, questCount, onTogglePins } = props
  if (target === null && questCount === 0) return null
  return (
    <Stack
      spacing={0.5}
      alignItems="flex-start"
      sx={{ position: 'absolute', left: 8, bottom: 8, zIndex: 6, maxWidth: 'calc(100% - 16px)' }}
      data-testid="maps-quest-legend"
      // The surface under it pans on pointer-down; a click on this card is not a drag.
      onPointerDown={(e) => {
        e.stopPropagation()
      }}
    >
      {target !== null && <TargetCard target={target} onDismiss={onDismiss} backLabel={backLabel} onBack={onBack} />}
      {questCount > 0 && <PinsToggle on={pinsOn} count={pinCount} onToggle={onTogglePins} />}
    </Stack>
  )
}

/** What the target is, with the way Back (naming where it goes) and the dismiss. */
function TargetCard({ target, onDismiss, backLabel, onBack }: { target: MapAnchor; onDismiss: () => void; backLabel: string | null; onBack: () => void }): JSX.Element {
  return (
    <Box
      data-testid="maps-target-banner"
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.25, borderRadius: 1, bgcolor: 'background.paper', border: `1px solid ${PALETTE.magenta}`, maxWidth: '100%' }}
    >
      {backLabel !== null && (
        <Tooltip title={`Back to ${backLabel}`}>
          <IconButton size="small" data-testid="maps-target-back" aria-label={`Back to ${backLabel}`} onClick={onBack} sx={{ p: 0.25 }}>
            <ArrowBackIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
        {target.label}
        {target.loc ? ` ${fmt(target.loc)}` : ''}
      </Typography>
      <Tooltip title="Clear this mark">
        <IconButton size="small" data-testid="maps-target-dismiss" aria-label="Clear this mark" onClick={onDismiss} sx={{ p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

/** The quest-pin legend, which is also the layer's switch. */
function PinsToggle({ on, count, onToggle }: { on: boolean; count: number; onToggle: () => void }): JSX.Element {
  const swatch = { width: 8, height: 8, marginLeft: 8, transform: 'rotate(45deg)', background: on ? PALETTE.green : 'transparent', border: `1px solid ${PALETTE.green}` }
  return (
    <Tooltip title={on ? 'Hide quest pins' : 'Show quest pins'}>
      <Chip
        size="small"
        data-testid="maps-quest-pins-toggle"
        data-on={on ? 'true' : 'false'}
        onClick={onToggle}
        variant={on ? 'filled' : 'outlined'}
        icon={<span style={swatch} />}
        label={on ? `Quest pins · ${String(count)} here` : 'Quest pins off'}
        sx={{ bgcolor: on ? 'background.paper' : undefined }}
      />
    </Tooltip>
  )
}
