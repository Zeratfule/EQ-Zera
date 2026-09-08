// TrackedQuests.tsx — the QUESTS YOU ARE FOLLOWING, at the top of the Quests tab (EQ Zera).
//
// 904 quests is a catalog; the two or three you are actually running are a to-do list, and they go
// first for the reason the held-items section goes above the search: the tab answers "what am I in
// the middle of" before it answers "find me a quest".
//
// ONE ROW PER PIN, and each row is the whole state in one line: the name, where it starts, how far
// down the checklist you are, and a Complete chip when the log has seen every required item reach
// the giver. Clicking it opens the quest page, which is the only place any of it can be changed.
//
// THE ORDER IS THE TRACKER'S OWN. Pins are appended as they are made, so the list reads in the
// order the player built it — no sort, and nothing here re-derives a ranking the user did not ask
// for (which is also the no-munging law: `QuestPin` is a shared domain type and this is renderer
// code, so the walking below is loops).

import { type JSX } from 'react'
import { Chip, Paper, Stack, Typography } from '@mui/material'
import type { QuestEntry } from '@shared/types'
import type { QuestProgress } from '../../../../shared/questProgress'
import type { QuestPins } from '../../../../shared/questPins'
import { QUEST_BY_PAGE } from './questSearch'

/** One tracked quest, ready to draw. Built by a loop below, never by a filter over the pins. */
interface TrackedRow {
  quest: QuestEntry
  progress: QuestProgress | undefined
}

function Row({ row, onOpen }: { row: TrackedRow; onOpen: (q: QuestEntry) => void }): JSX.Element {
  const { quest, progress } = row
  const where = [quest.giver, quest.startZone].filter(Boolean).join(' · ')
  const total = progress?.total ?? (quest.steps ?? []).length
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="baseline"
      role="button"
      tabIndex={0}
      data-testid="quest-tracked-row"
      data-page={quest.page}
      onClick={() => onOpen(quest)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(quest)
      }}
      sx={{ py: 0.4, px: 0.75, borderRadius: 1, cursor: 'pointer', minWidth: 0, '&:hover': { bgcolor: 'action.hover' } }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0 }}>
        {quest.name}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
        {where}
      </Typography>
      <Typography sx={{ flexGrow: 1 }} />
      <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }} data-testid="quest-tracked-steps">
        {String(progress?.done ?? 0)}/{String(total)} steps
      </Typography>
      {progress?.complete === true && (
        <Chip size="small" color="success" variant="outlined" label="Complete" data-testid="quest-tracked-complete" />
      )}
    </Stack>
  )
}

/**
 * The section. Present even when empty, because "nothing tracked yet" is the one place the feature
 * explains itself — a section that hides when it has no rows can never teach anybody to make one.
 */
export function TrackedQuests({
  pins,
  progressByPage,
  onOpen
}: {
  pins: QuestPins
  progressByPage: Map<string, QuestProgress>
  onOpen: (q: QuestEntry) => void
}): JSX.Element {
  const rows: TrackedRow[] = []
  for (const pin of pins) {
    const quest = QUEST_BY_PAGE.get(pin.page)
    // A pin whose page this build's catalog no longer knows is dropped from the DRAWING and left
    // alone on disk: a re-scrape that renames a page must not delete the player's tracker.
    if (quest) rows.push({ quest, progress: progressByPage.get(pin.page) })
  }
  return (
    <Paper variant="outlined" sx={{ p: 1.25, flexShrink: 0 }} data-testid="quest-tracked">
      <Typography variant="caption" className="eq-display-label" sx={{ display: 'block', color: 'text.secondary', mb: 0.75 }}>
        Tracking · {rows.length}
      </Typography>
      {rows.length === 0 ? (
        <Typography variant="caption" color="text.disabled" data-testid="quest-tracked-empty">
          Nothing tracked yet - open a quest and press Track this quest.
        </Typography>
      ) : (
        <Stack spacing={0.25} sx={{ maxHeight: 180, overflow: 'auto' }}>
          {rows.map((row) => (
            <Row key={row.quest.page} row={row} onOpen={onOpen} />
          ))}
        </Stack>
      )}
    </Paper>
  )
}
