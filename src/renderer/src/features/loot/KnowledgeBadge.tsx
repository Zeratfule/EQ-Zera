import type { JSX } from 'react'
import { Chip, Stack } from '@mui/material'
import type { ItemKnowledge } from '@shared/types'
import { knowledgeTags, type KnowledgeTagKind } from '../../lib/itemKnowledgeView'
import { useTradeskillTagPref } from './lootTagPrefs'

const TAG_COLOR: Record<KnowledgeTagKind, 'warning' | 'secondary' | 'info'> = {
  lore: 'warning',
  quest: 'secondary',
  tradeskill: 'info'
}

// Compact enough that three tags fit beside a name in a narrow row; never shrinks or wraps.
const TAG_SX = { height: 18, fontSize: 10, flexShrink: 0, '& .MuiChip-label': { px: 0.75 } } as const

// Every tag the item earns (lib/itemKnowledgeView `knowledgeTags`), side by side. The hover is a
// NATIVE `title`: a MUI popper anchored inside a clickable row opens over the neighbouring row.
export function KnowledgeBadge({
  knowledge,
  isPosky
}: {
  knowledge?: ItemKnowledge
  isPosky: boolean
}): JSX.Element | null {
  const [showTradeskill] = useTradeskillTagPref()
  if (!knowledge) return null
  const tags = knowledgeTags(knowledge, { isPosky, showTradeskill })
  if (tags.length === 0) return null
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" component="span" sx={{ flexShrink: 0 }}>
      {tags.map((t) => (
        <Chip
          key={t.kind}
          size="small"
          color={TAG_COLOR[t.kind]}
          variant="outlined"
          label={t.label}
          title={t.title}
          data-testid={`loot-tag-${t.kind}`}
          sx={TAG_SX}
        />
      ))}
    </Stack>
  )
}
