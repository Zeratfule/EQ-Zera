// QuestWhere.tsx — the two "where" lists of a quest page (quest locations wave): where each needed
// item comes from, and where each NPC the quest involves stands.
//
// Both read what shared/questLocations.ts already resolved and draw it; neither decides anything.
// An item no mob drops has no line at all (quest rewards and ground spawns drop from nobody, and
// "no known source" under every one of them would be noise), and an NPC the bestiary cannot place
// is listed by name only, exactly as the section always listed them.

import type { JSX } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { QuestItemSources, QuestLocations } from '../../../../shared/questLocations'
import type { MapAnchor } from '../maps/mapTarget'
import { QuestLocChip } from './QuestLocChip'

type OpenMap = ((a: MapAnchor) => void) | undefined

/** Chips one needed item shows; the map's quest layer still draws every point. */
const MAX_ITEM_CHIPS = 4

/** One needed item: the mobs that drop it, each with its points, and how many more there are. */
function ItemLine({ src, quest, onOpenMap }: { src: QuestItemSources; quest: string; onOpenMap: OpenMap }): JSX.Element {
  // Points past the first few, plus droppers past the listed ones: one honest count, not a list.
  const hidden = Math.max(0, src.chips.length - MAX_ITEM_CHIPS) + src.more
  return (
    <Box data-testid="quest-item-source" data-item={src.item}>
      <Typography variant="caption" sx={{ fontWeight: 600, mr: 0.75 }}>
        {src.item}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
        drops from
      </Typography>
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ display: 'inline-flex', verticalAlign: 'middle' }}>
        {src.chips.slice(0, MAX_ITEM_CHIPS).map((c) => (
          <QuestLocChip key={c.key} chip={c} quest={quest} onOpenMap={onOpenMap} />
        ))}
        {hidden > 0 && (
          <Typography variant="caption" color="text.disabled" data-testid="quest-item-source-more">
            +{hidden} more
          </Typography>
        )}
      </Stack>
    </Box>
  )
}

/** "Where to get it", under the needed items. Nothing when no needed item has a known dropper. */
export function ItemSourcesList({ items, quest, onOpenMap }: { items: readonly QuestItemSources[]; quest: string; onOpenMap: OpenMap }): JSX.Element | null {
  if (items.length === 0) return null
  return (
    <Stack spacing={0.5} sx={{ mt: 1 }} data-testid="quest-item-sources">
      <Typography variant="caption" className="eq-display-label" sx={{ color: 'text.secondary' }}>
        Where to get it
      </Typography>
      {items.map((src) => (
        <ItemLine key={src.item} src={src} quest={quest} onOpenMap={onOpenMap} />
      ))}
    </Stack>
  )
}

/** "NPCs involved": each name, and its chips when the bestiary places it. */
export function NpcList({ npcs, quest, onOpenMap }: { npcs: QuestLocations['npcs']; quest: string; onOpenMap: OpenMap }): JSX.Element {
  return (
    <Stack spacing={0.5} data-testid="quest-npcs">
      {npcs.map((n) => (
        <Stack key={n.name} direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap" data-testid="quest-npc">
          <Typography variant="body2" color="text.secondary">
            {n.name}
          </Typography>
          {n.chips.map((c) => (
            <QuestLocChip key={c.key} chip={c} quest={quest} onOpenMap={onOpenMap} />
          ))}
        </Stack>
      ))}
    </Stack>
  )
}
