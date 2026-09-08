// OverlaySnapSetting — Preferences → Overlays (JOS-217).
//
// NOT ON SCREEN THIS RELEASE (JOS-359). `SNAP_RELEASE_HOLD` (shared/overlaySnap.ts) holds the
// feature out of the 2026-08-14 build, and PreferencesView does not build this item while it
// stands. The card is kept whole rather than deleted because the hold is a hold: lifting it is one
// line, and this file is what that line brings back.
//
// ONE SWITCH, AND IT SHIPS OFF. Three reports asked for overlays that line up; one of the same
// reports complained that an earlier snap FOUGHT them. The owner's ruling is therefore that this
// is opt-in and that nothing changes for anybody who does not opt in — so the OFF caption says
// plainly that drags are free-form, which is the state almost every reader of this card is in.
//
// STATE, NEVER PROCESS (the repo's UI law): the captions say what the window will DO — line up
// with the other overlays, the app window, and the screen edges — and never mention `will-move`,
// the work area, or the fact that main is doing the arithmetic.
//
// THE DISTANCE IS QUOTED FROM THE CODE. `SNAP_DISTANCE_PX` is the same constant the geometry snaps
// at (shared/overlaySnap.ts), so the sentence a user reads cannot drift from the behaviour they
// get. That is the entire reason the constant lives in `shared/` rather than in main.
//
// ONE BORDER: PreferencesView already wraps each item in an outlined Paper, so this renders bare
// Stacks — a Paper here would draw a second frame inside the first.

import { type JSX, useCallback, useState } from 'react'
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { SNAP_DISTANCE_PX, type OverlaySnapPrefs } from '@shared/overlaySnap'
import { recordPref, usePrefsSeed } from './prefsHydration'

/**
 * The prefs blob, SEEDED from the pane's hydration snapshot and written back on every change —
 * the OverlayAutoHideSetting shape exactly (JOS-340): no first frame to be wrong in, optimistic
 * locally, authoritative from main's reply, and that reply goes back into the snapshot so the next
 * mount of this card seeds from the same truth.
 */
function useOverlaySnap(): [OverlaySnapPrefs, (patch: Partial<OverlaySnapPrefs>) => void] {
  const [prefs, setPrefs] = useState<OverlaySnapPrefs>(usePrefsSeed().overlaySnap)

  const update = useCallback((patch: Partial<OverlaySnapPrefs>) => {
    setPrefs((cur) => ({ ...cur, ...patch }))
    void window.eq.setOverlaySnap(patch).then((stored) => {
      setPrefs(stored)
      recordPref('overlaySnap', stored)
    })
  }, [])

  return [prefs, update]
}

export function OverlaySnapSetting(): JSX.Element {
  const [prefs, update] = useOverlaySnap()
  return (
    <Stack spacing={0.5} data-testid="pref-overlay-snap">
      <FormControlLabel
        control={
          <Switch
            size="small"
            data-testid="pref-snap-overlays"
            checked={prefs.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
        }
        label={<Typography variant="body2">Snap overlays into line while you drag them</Typography>}
      />
      <Typography variant="caption" color="text.secondary">
        {prefs.enabled
          ? `Dragging an overlay within ${SNAP_DISTANCE_PX} pixels of another overlay, this app's window, or the edge of your screen lines it up exactly - edge to edge, or flush with it. Keep dragging and it lets go.`
          : 'Off. Overlays go exactly where you drop them, with nothing pulling them into line.'}
      </Typography>
    </Stack>
  )
}
