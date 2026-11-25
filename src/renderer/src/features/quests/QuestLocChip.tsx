// QuestLocChip.tsx — one "where" on a quest page: "Rylin Coil · Ak'Anon (1469, -190)".
//
// A chip with a MAP STEM and a POINT is a jump: the Maps tab on that zone, centred on the point,
// with a target marker (features/maps/mapTarget.ts). A chip with a stem and no point opens the zone
// and marks nothing. A chip without a stem — a zone the table cannot place, or a coordinate whose
// zone the words do not settle — is plain text: the numbers are real, the map would be a guess.
//
// WHERE THE NUMBERS CAME FROM is the hover, in one clause: the quest page, the NPC's own wiki page,
// or both agreeing. The resolver's longer reasoning is the audit script's business, not the
// player's (AGENTS.md tooltip diet).

import type { JSX } from 'react'
import { Chip } from '@mui/material'
import PlaceIcon from '@mui/icons-material/Place'
import type { QuestLocChip as Loc } from '../../../../shared/questLocations'
import type { MapAnchor } from '../maps/mapTarget'
import { Tooltip } from '../../lib/Tooltip'
import { formatQuestLoc } from './questLocIndex'

/** The chip's words: who, where, the point — each only when known. */
export function chipLabel(c: Pick<Loc, 'name' | 'zoneName' | 'loc'>): string {
  const head = [c.name, c.zoneName].filter((s): s is string => s !== undefined && s !== '').join(' · ')
  const point = c.loc ? formatQuestLoc(c.loc) : ''
  return [head, point].filter((s) => s !== '').join(' ')
}

/** One clause on where the numbers came from. */
function provenance(c: Loc): string {
  const who = c.name ?? 'the NPC'
  if (c.sources.includes('quest') && c.sources.includes('npc')) return `The quest page and ${who}'s wiki page agree`
  if (c.sources.includes('npc')) return `From ${who}'s wiki page`
  return 'From the quest page'
}

function hover(c: Loc): string {
  if (c.zone === undefined) return `${provenance(c)}. ${c.zoneName === undefined ? 'The zone is not stated' : 'No map for this zone'}`
  return `${provenance(c)}. Show on the map`
}

export function QuestLocChip({ chip, quest, onOpenMap }: { chip: Loc; quest: string; onOpenMap?: (a: MapAnchor) => void }): JSX.Element {
  const label = chipLabel(chip)
  const zone = chip.zone
  const jump =
    zone !== undefined && onOpenMap
      ? () => {
          onOpenMap({ zone, label: chipLabel({ name: chip.name, zoneName: chip.zoneName }), quest, ...(chip.loc ? { loc: chip.loc } : {}) })
        }
      : undefined
  return (
    <Tooltip title={hover(chip)}>
      <Chip
        size="small"
        variant="outlined"
        color={jump ? 'success' : 'default'}
        icon={jump ? <PlaceIcon sx={{ fontSize: 14 }} /> : undefined}
        label={label}
        onClick={jump}
        data-testid="quest-loc-chip"
        data-zone={zone ?? ''}
        data-loc={chip.loc ? formatQuestLoc(chip.loc) : ''}
        data-sources={chip.sources.join('+')}
        sx={{ maxWidth: '100%', height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
      />
    </Tooltip>
  )
}
