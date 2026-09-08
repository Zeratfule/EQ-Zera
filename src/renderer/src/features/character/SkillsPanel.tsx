// character/SkillsPanel — WHAT THE CLIENT LAST SAID EACH SKILL IS WORTH, and how much of that this
// log watched.
//
// Two numbers, side by side, because they are two different facts and neither derives the other
// (skillTypes.ts): the VALUE is the client's own — it counts every tick since the character was
// made, most of them long before any log this app has read — and the UPS are what this fold saw.
// A row that added them together would be inventing history. `skillRows.ts` decides every string
// here and is pure and node-tested.
//
// `+3 this session` IS COUNTED, NOT DIFFERENCED. The session is the stretch since the newest login
// the log states (`sessionStartOf`), and the count is of ticks on the skill's own curve inside it —
// so a log with no logout in it says nothing at all rather than restating `ups` under a second
// name. See skillRows.ts for why that count is a lower bound on a very long session.
//
// FIXED HEIGHT IS A CONTRACT (AGENTS.md): a character has upwards of sixty skills and every one of
// them can tick, so the list lives in an explicit-height scroll box of its own.

import { type JSX, useDeferredValue, useMemo, useState } from 'react'
import { Box, Paper, Stack, TextField, Typography } from '@mui/material'
import type { ProgressionSnap, SkillSnap } from '@shared/types'
import { sessionStartOf } from '@shared/timeslice'
import { useModule } from '../../lib/useModule'
import { formatDate } from '../../lib/formatDate'
import { normalizeQuery } from '../../lib/search'
import { skillRows, type SkillPanelRow } from './skillRows'

/** The list's scroll box. Explicit, and the panel's whole size contract. */
const LIST_HEIGHT = 240

/** One skill: what it is worth, what this log watched, and when it last moved. */
function SkillRowLine({ row }: { row: SkillPanelRow }): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="baseline"
      data-testid="character-skill-row"
      data-skill={row.name}
      sx={{ minWidth: 0, py: 0.3, px: 0.5 }}
    >
      <Typography variant="caption" noWrap sx={{ minWidth: 0, flexGrow: 1 }} title={row.name}>
        {row.name}
      </Typography>
      {row.sessionText !== '' && (
        <Typography variant="caption" color="success.main" data-testid="character-skill-session" sx={{ flexShrink: 0 }}>
          {row.sessionText}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }} title="ups this log watched">
        {row.ups}×
      </Typography>
      <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
        {formatDate(row.lastTs, { month: 'numeric', day: 'numeric' })}
      </Typography>
      <Typography
        variant="body2"
        data-testid="character-skill-value"
        sx={{ flexShrink: 0, minWidth: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      >
        {row.valueText}
      </Typography>
    </Stack>
  )
}

export default function SkillsPanel(): JSX.Element {
  const snap = useModule<SkillSnap>('skills')
  const progression = useModule<ProgressionSnap>('progression')
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const sessionStart = progression ? sessionStartOf(progression) : null
  const rows = useMemo(
    () => skillRows(snap, sessionStart, normalizeQuery(deferred)),
    [snap, sessionStart, deferred]
  )

  return (
    <Paper variant="outlined" data-testid="character-skills" sx={{ p: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ flexShrink: 0 }}>
          Skills
        </Typography>
        <TextField
          size="small"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
          }}
          placeholder="Search skills"
          slotProps={{ htmlInput: { 'data-testid': 'character-skills-search' } }}
          sx={{ width: 180 }}
        />
        <Typography variant="caption" color="text.secondary" data-testid="character-skills-count" sx={{ ml: 'auto' }}>
          {rows.length}
        </Typography>
      </Stack>
      {/* Said ONCE: the big number is the client's own running total, the small one is this log. */}
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 0.5 }}>
        The value is what the client last printed; the count is what this log watched.
      </Typography>
      <Box sx={{ height: LIST_HEIGHT, overflow: 'auto', minWidth: 0 }}>
        {rows.length === 0 ? (
          <Typography variant="caption" color="text.disabled" data-testid="character-skills-empty">
            No skill-ups in this log yet.
          </Typography>
        ) : (
          rows.map((row) => <SkillRowLine key={row.key} row={row} />)
        )}
      </Box>
    </Paper>
  )
}
