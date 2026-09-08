// SoundPicker — the pack→sound picker, and the two pack helpers everything audio-shaped shares.
// Extracted from AlertsView.tsx (Wave D factoring).
//
// IT IS THE EDITOR'S PICKER NOW. The alert LIST used to mount this too (through an `inGrid`
// escape hatch); it mounts AudioPicker.tsx instead, whose first select also offers the two voice
// outputs — that is where the owner asked the sound/voice choice to live. The dialog keeps this
// plain pack+sound pair because the dialog already has the Speech block right below it, which is
// authoritative for the channel, the phrase and the voice: a second control for `audio` six
// inches away would be two ways to say one thing in one form. The `inGrid`/`display: contents`
// mechanism moved WITH the row, to AudioPicker.

import type { JSX } from 'react'
import { MenuItem, Select, Stack } from '@mui/material'
import type { SoundPack } from '@shared/types'
import { USER_SOUNDS_PACK_ID } from '@shared/userSounds'
import { preferredPack } from '@shared/soundPacks'
import { DEFAULT_PACK_ID } from './suggestions'

/**
 * How a pack reads in a picker's first dropdown. A pack the user dropped into
 * `<userData>/soundpacks` by hand is tagged "(user)" to distinguish it from the shipped and
 * registry-installed ones; "My sounds" (JOS-68) is not, because its NAME already says whose
 * it is and "My sounds (user)" says it twice.
 */
export function packLabel(p: SoundPack): string {
  if (p.id === USER_SOUNDS_PACK_ID) return p.name
  return p.source === 'user' ? `${p.name} (user)` : p.name
}

/**
 * The pack a picker falls back to when the alert's own pack is missing (uninstalled) or a
 * brand-new alert has no pack yet — never "whatever happens to sort first".
 *
 * IT IS THE USER'S DEFAULT FIRST NOW (JOS-273). It used to be the shipped pack, full stop, which
 * is half of why deleting that pack accomplished nothing: every picker went straight back to it.
 * `preferred` is the stored default-pack preference (useAlertsStore feeds it down); the shipped
 * pack is what an install with no preference means, and the first installed pack is the last
 * resort for a machine that has neither.
 */
export function fallbackPack(packs: SoundPack[], preferred?: string): SoundPack | undefined {
  return preferredPack(packs, preferred, DEFAULT_PACK_ID) ?? undefined
}

/** First selectable soundId in a pack ('' when packs haven't loaded yet). */
export function firstSoundId(pack: SoundPack | undefined): string {
  return pack ? Object.keys(pack.sounds)[0] ?? '' : ''
}

/** The pack→sound picker used in the add/edit dialog. */
export default function SoundPicker({
  packs,
  packId,
  soundId,
  defaultPackId,
  onChange
}: {
  packs: SoundPack[]
  packId: string
  soundId: string
  /** The user's default pack (JOS-273) — what an unresolvable pack falls back to. */
  defaultPackId?: string
  onChange: (packId: string, soundId: string) => void
}): JSX.Element {
  const pack = packs.find((p) => p.id === packId) ?? fallbackPack(packs, defaultPackId)
  const soundIds = pack ? Object.keys(pack.sounds) : []
  return (
    <Stack direction="row" spacing={1}>
      <Select
        size="small"
        value={pack?.id ?? ''}
        onChange={(e) => {
          const np = packs.find((p) => p.id === e.target.value)
          const firstSound = np ? Object.keys(np.sounds)[0] : ''
          onChange(e.target.value, firstSound)
        }}
        sx={{ minWidth: 130 }}
      >
        {packs.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {packLabel(p)}
          </MenuItem>
        ))}
      </Select>
      <Select
        size="small"
        value={pack?.sounds[soundId] ? soundId : soundIds[0] ?? ''}
        onChange={(e) => onChange(pack?.id ?? packId, e.target.value)}
        sx={{ minWidth: 170 }}
      >
        {soundIds.map((sid) => (
          <MenuItem key={sid} value={sid}>
            {pack?.sounds[sid]?.label ?? sid}
          </MenuItem>
        ))}
      </Select>
    </Stack>
  )
}
