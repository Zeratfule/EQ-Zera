// THREE PICKS ABOVE THE FIGURE (EQ Zera, 2026-09-08): race, sex, face.
//
// It used to be one Select of twenty-four fused actor codes ("Dwarf · female"), which could say
// who you are but not that a dwarf woman has seven faces and a dwarf man eight. Splitting it into
// race + sex + face is what makes the third control possible at all, and the split is also the
// honest shape: race and sex name the ACTOR the archives carry, the face names a texture on it.
//
// THE FACE CONTROL DRAWS WHAT THE PAYLOAD SAYS AND NOTHING ELSE (world-model law 1). Main measures
// the faces off the archive's own file list and sends them (`faces`) with the one the bare head
// binds (`defaultFace`); this file offers those and no others, so a race whose face 0 does not
// exist never gets a button for it. No install, no payload, no face control.
//
// This is the STORAGE half too - modelPrefs.ts is the DOM-free vocabulary, and everything here
// that touches localStorage degrades rather than throws (JOS-105): a refused store still lets the
// pick hold for the session.

import { type JSX, useMemo, useState } from 'react'
import { MenuItem, Select, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import {
  RACE_KEY,
  RACE_OPTIONS,
  SEX_KEY,
  actorCode,
  faceKey,
  readFace,
  readPick,
  storedFace,
  type ModelPick,
  type Sex
} from './modelPrefs'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage refused - the pick still holds for this session */
  }
}

/** Who the card draws, and the three ways to change it. */
export interface ModelPrefs extends ModelPick {
  /** the archives' own three-letter code for race + sex */
  actor: string
  /** the reader's stored face for THIS actor, before any payload has said which faces exist */
  face: number | undefined
  setRace: (race: string) => void
  setSex: (sex: Sex) => void
  setFace: (face: number) => void
}

export function useModelPrefs(): ModelPrefs {
  const [pick, setPick] = useState<ModelPick>(() => readPick(read(RACE_KEY), read(SEX_KEY)))
  // Faces are remembered PER ACTOR, so the map is the state and storage is only its seed: picking
  // a face, switching to a dwarf and coming back must show the face that was picked.
  const [faces, setFaces] = useState<Record<string, number | undefined>>({})
  const actor = actorCode(pick.race, pick.sex)
  const face = useMemo(() => (actor in faces ? faces[actor] : storedFace(read(faceKey(actor)))), [actor, faces])
  return {
    ...pick,
    actor,
    face,
    setRace: (race: string): void => {
      setPick((p) => ({ ...p, race }))
      write(RACE_KEY, race)
    },
    setSex: (sex: Sex): void => {
      setPick((p) => ({ ...p, sex }))
      write(SEX_KEY, sex)
    },
    setFace: (next: number): void => {
      setFaces((f) => ({ ...f, [actor]: next }))
      write(faceKey(actor), String(next))
    }
  }
}

function RacePicker({ prefs }: { prefs: ModelPrefs }): JSX.Element {
  return (
    <Select size="small" value={prefs.race} onChange={(e) => { prefs.setRace(e.target.value) }} fullWidth data-testid="character-model-race">
      {RACE_OPTIONS.map((r) => (
        <MenuItem key={r.code} value={r.code} disabled={!r.modelled} data-testid={`character-model-race-${r.code}`}>
          {r.modelled ? r.label : `${r.label} - no model in this app yet`}
        </MenuItem>
      ))}
    </Select>
  )
}

function SexPicker({ prefs }: { prefs: ModelPrefs }): JSX.Element {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      fullWidth
      value={prefs.sex}
      onChange={(_e, v: Sex | null) => { if (v !== null) prefs.setSex(v) }}
      data-testid="character-model-sex"
    >
      <ToggleButton value="M" data-testid="character-model-sex-M">Male</ToggleButton>
      <ToggleButton value="F" data-testid="character-model-sex-F">Female</ToggleButton>
    </ToggleButtonGroup>
  )
}

/** The faces this actor has, numbered the way a player counts them: the F digit plus one. */
function FacePicker({ prefs, faces, defaultFace }: { prefs: ModelPrefs; faces: readonly number[]; defaultFace?: number }): JSX.Element {
  const chosen = readFace(prefs.face, faces, defaultFace)
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={chosen ?? null}
      onChange={(_e, v: number | null) => { if (v !== null) prefs.setFace(v) }}
      sx={{ flexWrap: 'wrap' }}
      data-testid="character-model-face-picker"
    >
      {faces.map((f) => (
        <ToggleButton key={f} value={f} data-testid="character-model-face-option" data-face={f} sx={{ px: 1, minWidth: 32 }}>
          {f + 1}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

export function ModelPickers({ prefs, faces, defaultFace }: { prefs: ModelPrefs; faces?: readonly number[]; defaultFace?: number }): JSX.Element {
  return (
    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
      <RacePicker prefs={prefs} />
      <SexPicker prefs={prefs} />
      {faces && faces.length > 0 && <FacePicker prefs={prefs} faces={faces} defaultFace={defaultFace} />}
      <Typography variant="caption" color="text.disabled">
        The game files decide which faces exist for each race.
      </Typography>
    </Stack>
  )
}
