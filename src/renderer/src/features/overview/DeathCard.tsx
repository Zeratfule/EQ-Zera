// DeathCard — WHAT THE LAST FIFTEEN SECONDS LOOKED LIKE, on the glance surface.
//
// EverQuest tells you that you died and nothing else. The recap module keeps its own ring of
// incoming instants off the LOG's clock and quotes the last fifteen seconds on a `playerDeath`, so
// this card can answer the question the game leaves open: who was hitting you, with what, and how
// hard, in the seconds before the screen went grey.
//
// IT SAYS `damage in the last 15 s`, NEVER `the damage that killed you`. The log prints no hit
// points, so how much of that window you were alive for is unknowable (deathTypes.ts, law 6). The
// window's length rides in the snapshot precisely so the caption can state it.
//
// NOT GATED ON HYDRATION, like the two feeds it sits beside: the deaths module's snapshot is
// complete and correct during the startup replay, and a spinner over a real past death would be a
// lie in the other direction. The LIVE half of this feature is the celebration card
// (`features/deaths/useDeathToast.ts`), which is the one surface that has to tell a replay from
// news.
//
// THE HIT LIST IS THE GROWING THING HERE, so it is the thing in a FIXED-height scroll box of its
// own (AGENTS.md's law). Fifteen seconds of a raid boss is a few hundred rows; the card must be
// the same height either way.
//
// Every word it prints comes from `../deaths/deathCard.ts`, which is pure and node-tested - this file
// chooses no content at all.

import type { JSX } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { DeathSnap } from '@shared/types'
import { DashCard, QuietNote } from '../combat/combatShared'
import { useModule } from '../../lib/useModule'
import { formatDateTime, formatTime } from '../../lib/formatDate'
import { formatNum } from '../../lib/formatRate'
import { deathCardView, type DeathCardView, type DeathShareRow } from '../deaths/deathCard'

/** The hit list's scroll box. Explicit, and the panel's whole size contract. */
const HITS_HEIGHT = 150

/** The head line: who killed you, where, and when. */
function DeathHead({ view }: { view: DeathCardView }): JSX.Element {
  const where = [view.zone, formatDateTime(view.ts)].filter((s) => s !== '').join(' · ')
  return (
    <>
      <Typography variant="subtitle2" data-testid="overview-death-killer" noWrap sx={{ minWidth: 0 }}>
        {view.killer === '' ? 'You died' : `Killed by ${view.killer}`}
      </Typography>
      <Typography variant="caption" color="text.secondary" data-testid="overview-death-when" noWrap sx={{ minWidth: 0 }}>
        {where}
      </Typography>
      <Typography variant="caption" color="text.secondary" data-testid="overview-death-taken" sx={{ mt: 0.25 }}>
        {formatNum(view.taken)} damage in the last {view.windowSec} s
      </Typography>
    </>
  )
}

/** One share list — the attackers, or the skills. Both read the same, so they are one component. */
function ShareList({ label, rows, testId }: { label: string; rows: DeathShareRow[]; testId: string }): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
      <Typography variant="caption" color="text.disabled" noWrap sx={{ display: 'block' }}>
        {label}
      </Typography>
      {rows.map((r) => (
        <Stack key={r.key} direction="row" spacing={0.75} data-testid={testId} sx={{ minWidth: 0 }}>
          <Typography variant="caption" noWrap sx={{ minWidth: 0, flexGrow: 1 }} title={r.name}>
            {r.name === '' ? 'no name stated' : r.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {formatNum(r.amount)}
          </Typography>
        </Stack>
      ))}
    </Box>
  )
}

/** The window itself, newest first, inside its own bounded scroller. */
function HitList({ view }: { view: DeathCardView }): JSX.Element {
  return (
    <Box
      data-testid="overview-death-hits"
      sx={{ height: HITS_HEIGHT, overflow: 'auto', minWidth: 0, mt: 0.5 }}
    >
      {view.hits.map((h) => (
        <Stack key={h.key} direction="row" spacing={0.75} data-testid="overview-death-hit" sx={{ minWidth: 0, py: 0.15 }}>
          <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
            {formatTime(h.ts)}
          </Typography>
          <Typography variant="caption" noWrap sx={{ minWidth: 0, flexGrow: 1 }} title={`${h.attacker} ${h.skill}`}>
            {[h.attacker, h.skill].filter((s) => s !== '').join(' · ')}
          </Typography>
          <Typography
            variant="caption"
            color={h.crit ? 'secondary.main' : 'text.secondary'}
            sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
          >
            {formatNum(h.amount)}
          </Typography>
        </Stack>
      ))}
    </Box>
  )
}

/** The spells you resisted in the window. One line, because a resist carries no amount. */
function ResistLine({ view }: { view: DeathCardView }): JSX.Element | null {
  if (view.resists.length === 0) return null
  const names: string[] = []
  for (const r of view.resists) names.push(r.spell === '' ? 'an unnamed spell' : r.spell)
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      data-testid="overview-death-resists"
      noWrap
      sx={{ mt: 0.25, minWidth: 0 }}
      title={names.join(', ')}
    >
      Resisted: {names.join(' · ')}
    </Typography>
  )
}

export function DeathCard(): JSX.Element {
  const view = deathCardView(useModule<DeathSnap>('deaths'))
  return (
    <DashCard title="Last death" testId="overview-death">
      {view === null ? (
        <QuietNote>No deaths in this log.</QuietNote>
      ) : (
        <>
          <DeathHead view={view} />
          <Stack direction="row" spacing={1} sx={{ mt: 0.75, minWidth: 0 }}>
            <ShareList label="Who hit you" rows={view.byAttacker} testId="overview-death-attacker" />
            <ShareList label="What hit you" rows={view.bySkill} testId="overview-death-skill" />
          </Stack>
          <HitList view={view} />
          <ResistLine view={view} />
          <Typography variant="caption" color="text.disabled" data-testid="overview-death-footer" sx={{ mt: 0.25 }}>
            {view.footer}
          </Typography>
        </>
      )}
    </DashCard>
  )
}
