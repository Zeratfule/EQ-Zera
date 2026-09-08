// THE ZONE SELECTOR — the map viewer's one way to say "show me somewhere else".
//
// IT IS ALWAYS ON SCREEN, and that is the whole point of the control. The viewer used to offer
// zone selection ONLY in its empty state, so the moment a map drew, the way back to the list
// disappeared with it (feedback: "no clear and easily seen way to go back to map selection after
// selecting a map"). A selector that vanishes once it has been used is a door that locks behind
// you. This one sits in the toolbar in every state, stating the zone on screen.
//
// IT IS ALSO THE CROSS-ZONE BROWSER. The log can only ever point at ONE zone — the one you are
// standing in — so a corpus of ~600 maps is otherwise unreachable while you are logged in
// somewhere. Typing filters by EITHER spelling (the stem on disk or the long name the table gives
// it), which matters because the two rarely resemble each other: `soldungb` is Nagafen's Lair.
//
// A PICK PINS (JOS-97). It used to hold only until the next zone line, on the argument that a
// manual detour surviving zoning "would leave you reading the wrong map with nothing on screen
// saying so" — the second half of which was the real requirement, not the first. A v0.10.0 user
// asked for the map they chose to still be there after visiting another tab; it was not, because
// nothing distinguished "the app picked this" from "I picked this". So the pick now sets a MODE
// (`zoneFollow.ts`), the toolbar STATES which mode is in force right beside this control, and
// `Current zone` is the labelled way back to following the log.

import type { HTMLAttributes, JSX } from 'react'
import { Autocomplete, Stack, TextField, Typography } from '@mui/material'
import type { ZoneShort } from '@shared/maps'
import { filterZones, zoneLabel, zoneOptions } from './zoneOptions'

/** Wide enough for the long names the table actually carries; never shrinks, never grows. */
const SELECT_W = 232

/** What MUI hands `renderOption`, with its `any`-typed `key` pinned to what it actually is. */
type OptionProps = HTMLAttributes<HTMLLIElement> & { key: string }

export interface ZoneSelectProps {
  /** Every stem any installed pack provides, ascending. */
  zones: readonly ZoneShort[]
  /** The stem on screen — the selector's value, so the control states where you are. */
  zone: ZoneShort | null
  onPick: (zone: ZoneShort) => void
}

export default function ZoneSelect({ zones, zone, onPick }: ZoneSelectProps): JSX.Element {
  return (
    <Autocomplete
      size="small"
      autoHighlight
      openOnFocus
      // Clearing would mean "no map", which is not a destination — zoning or another pick is.
      disableClearable={zone != null}
      options={zoneOptions(zones, zone)}
      value={zone}
      onChange={(_e, next: ZoneShort | null) => {
        if (next != null) onPick(next)
      }}
      getOptionLabel={zoneLabel}
      filterOptions={(opts, state) => filterZones(opts, state.inputValue)}
      noOptionsText={zones.length === 0 ? 'No map files were found.' : 'No zone matches.'}
      // MUI 6 puts `key` inside `renderOption`'s props and declares it `any`. Spreading it onto
      // the element is a React warning, so it is split out — and the parameter is annotated so
      // the `any` stops at this boundary rather than travelling into the row.
      renderOption={(props: OptionProps, z) => {
        const { key, ...rest } = props
        return (
          <li key={key} {...rest} data-testid="maps-zone-row">
            <Stack spacing={0} sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {zoneLabel(z)}
              </Typography>
              {/* The stem is what the file on disk is called — the only name every pack is
                  certain to share. Shown under the long one so both spellings are visible and
                  either can be typed. */}
              <Typography variant="caption" color="text.secondary" noWrap>
                {z}
              </Typography>
            </Stack>
          </li>
        )
      }}
      sx={{ width: SELECT_W, flexShrink: 0 }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Zone"
          placeholder="Find a zone…"
          slotProps={{ htmlInput: { ...params.inputProps, 'data-testid': 'maps-zone-filter' } }}
        />
      )}
    />
  )
}
