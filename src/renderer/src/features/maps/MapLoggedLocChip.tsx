// THE LOGGED /loc, STATED ON THE TOOLBAR — what the game last said your position was, in the game's
// own order, and the one click that takes you to it (and to its floor, when you are looking at a
// different one). No delete: the reading is the game's, not yours, and it goes away on its own the
// moment you leave the zone (loggedLoc.ts).
//
// WHEN THIS MAP CANNOT SHOW IT (a pinned map of somewhere else, or a zone with no map name) the
// chip says where the reading is rather than the toolbar showing nothing.
//
// A native `title`, never a popper — this sits on the toolbar's wrapping row (MapToolbar's JOS-143
// rule).

import type { JSX } from 'react'
import { Chip } from '@mui/material'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import type { LoggedLoc } from '@shared/characterTypes'
import { formatLoc } from './locMarker'
import { loggedLocLabel } from './loggedLoc'

export interface MapLoggedLocChipProps {
  loc: LoggedLoc | null
  onShow: () => void
  elsewhere: { zone: string; mapped: boolean } | null
}

export default function MapLoggedLocChip({ loc, onShow, elsewhere }: MapLoggedLocChipProps): JSX.Element | null {
  if (loc != null) {
    return (
      <Chip
        size="small"
        color="success"
        variant="outlined"
        icon={<MyLocationIcon />}
        data-testid="maps-logged-loc-chip"
        data-loc={formatLoc(loc)}
        title={`Where your last /loc put you: ${formatLoc(loc)}. Click to centre on it.`}
        label={loggedLocLabel(loc)}
        onClick={onShow}
      />
    )
  }
  if (elsewhere == null) return null
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={<MyLocationIcon />}
      data-testid="maps-logged-loc-elsewhere"
      title={
        elsewhere.mapped
          ? 'Your last /loc is on another map. Current zone shows it.'
          : 'Your last /loc is in a zone with no map yet.'
      }
      label={`Your /loc: ${elsewhere.zone}`}
    />
  )
}
