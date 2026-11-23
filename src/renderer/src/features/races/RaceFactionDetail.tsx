// RaceFactionDetail — one faction a race unlock needs maxed: whether it is, what this log has seen
// it move by, and the fastest stated ways to raise it (shared/raceUnlockPlan.ts ranks them).
//
// THE LOG NUMBER IS A CHANGE, NEVER A STANDING. EverQuest never prints where a standing is, only
// that it moved, so the row says "seen in your log" beside the sum and nothing else.

import type { JSX } from 'react'
import { Box, Chip, Link, Stack, Typography } from '@mui/material'
import type { FactionLoss } from '../../../../shared/factionSources'
import type { RaceFactionPlan, RaiseWay } from '../../../../shared/raceUnlockPlan'

/** What a way prints when the wiki names the faction and no amount. */
export const AMOUNT_UNKNOWN = 'amount unknown'

export interface RaceLinks {
  onOpenMob: (name: string) => void
  onOpenQuest: (page: string) => void
}

function signed(n: number): string {
  return n > 0 ? `+${String(n)}` : String(n)
}

function gainText(way: RaiseWay): string {
  if (way.gain === null) return AMOUNT_UNKNOWN
  return way.kind === 'mob' ? `${signed(way.gain)} per kill` : signed(way.gain)
}

function lossText(l: FactionLoss): string {
  return l.delta === null ? `lowers ${l.faction}` : `lowers ${l.faction} ${String(l.delta)}`
}

function MaxedChip({ plan }: { plan: RaceFactionPlan }): JSX.Element {
  if (plan.maxedBy === 'achievement') {
    return <Chip size="small" color="success" label="maxed" data-testid="race-faction-maxed" sx={{ height: 18 }} />
  }
  if (plan.maxedBy === 'log') {
    return <Chip size="small" color="success" variant="outlined" label="maxed in your log" data-testid="race-faction-maxed" sx={{ height: 18 }} />
  }
  return <Chip size="small" variant="outlined" label="not maxed" sx={{ height: 18 }} />
}

function SeenLine({ plan }: { plan: RaceFactionPlan }): JSX.Element {
  const seen = plan.seen
  let text = 'Not in your log yet.'
  if (seen !== null && seen.hits > 0) {
    text = `Change seen in your log: ${signed(seen.delta)} over ${String(seen.hits)} line${seen.hits === 1 ? '' : 's'}.`
  } else if (seen !== null) text = 'Seen in your log, with no stated change.'
  return (
    <Typography variant="caption" color="text.secondary" data-testid="race-faction-seen" sx={{ display: 'block' }}>
      {text}
    </Typography>
  )
}

function WayRow({ way, links }: { way: RaiseWay; links: RaceLinks }): JSX.Element {
  const where = [...way.zones, ...(way.giver === undefined ? [] : [way.giver])].join(', ')
  return (
    <Stack direction="row" spacing={1} alignItems="center" data-testid={`race-way-${way.kind}`} sx={{ minWidth: 0, flexWrap: 'wrap' }}>
      <Typography
        variant="caption"
        data-testid="race-way-gain"
        color={way.gain === null ? 'text.disabled' : 'success.main'}
        sx={{ minWidth: 92, fontVariantNumeric: 'tabular-nums' }}
      >
        {gainText(way)}
      </Typography>
      <Link
        component="button"
        variant="caption"
        underline="hover"
        onClick={() => {
          if (way.kind === 'mob') links.onOpenMob(way.name)
          else links.onOpenQuest(way.page)
        }}
      >
        {way.name}
      </Link>
      {way.level !== undefined && (
        <Typography variant="caption" color="text.secondary">
          lvl {way.level}
        </Typography>
      )}
      {where !== '' && (
        <Typography variant="caption" color="text.disabled" noWrap sx={{ minWidth: 0, maxWidth: 320 }} title={where}>
          {where}
        </Typography>
      )}
      {way.hurts.map((l) => (
        <Chip key={l.faction} size="small" color="warning" variant="outlined" label={lossText(l)} data-testid="race-way-hurts" sx={{ height: 18 }} />
      ))}
    </Stack>
  )
}

function WayList({ title, ways, links }: { title: string; ways: RaiseWay[]; links: RaceLinks }): JSX.Element | null {
  if (ways.length === 0) return null
  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.6 }}>
        {title}
      </Typography>
      {ways.map((w) => (
        <WayRow key={`${w.kind}:${w.page}`} way={w} links={links} />
      ))}
    </Box>
  )
}

export default function RaceFactionDetail({ plan, links }: { plan: RaceFactionPlan; links: RaceLinks }): JSX.Element {
  const none = plan.mobs.length === 0 && plan.quests.length === 0
  return (
    <Box data-testid="race-faction" data-faction={plan.faction} data-maxed={plan.maxed} sx={{ py: 0.75, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {plan.faction}
        </Typography>
        <MaxedChip plan={plan} />
      </Stack>
      <SeenLine plan={plan} />
      {!plan.maxed && (
        <>
          <WayList title="Kill to raise" ways={plan.mobs} links={links} />
          <WayList title="Turn-ins that raise it" ways={plan.quests} links={links} />
          {none && (
            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
              The wiki names no kill or turn-in that raises this faction.
            </Typography>
          )}
        </>
      )}
    </Box>
  )
}
