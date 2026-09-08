// LastSessionCard — WHAT LAST NIGHT WAS WORTH, on the surface you open before you start playing.
//
// The Leveling tab can answer this and more, over any range you care to drag. This card answers it
// for the ONE range you did not have to choose: the session before the one you are in, bounded by
// two logouts the log actually stated (`lastSession.ts` states exactly which two, and why fewer
// than two of them is an empty state rather than a guess).
//
// A TILE ROW, like the leveling panel's, and for the same reason: a missing fact is visibly
// missing rather than an em-dash mid-sentence, and the number gets the reader's attention while
// the words are demoted to a caption. Coin and the zones ride underneath as lines, because a
// list of places is prose and `12p 5g` is two facts rather than one number.
//
// NOT GATED ON HYDRATION: this is a HISTORY surface by definition. The whole subject is a stretch
// of the log that ended before the app was started.
//
// It chooses no content — every string comes from `lastSession.ts`, which is pure and node-tested.

import type { JSX } from 'react'
import { Paper, Stack, Typography } from '@mui/material'
import type { CoinSnap, DeathSnap, ProgressionSnap } from '@shared/types'
import { DashCard, QuietNote } from '../combat/combatShared'
import { useModule } from '../../lib/useModule'
import { formatDateTime } from '../../lib/formatDate'
import { lastSessionView, type LastSessionTile } from './lastSession'

/** ONE tile. The leveling card's shape, deliberately: two tile rows on one page must read alike. */
function SessionTile({ tile }: { tile: LastSessionTile }): JSX.Element {
  return (
    <Paper
      variant="outlined"
      data-testid={`overview-last-session-${tile.id}`}
      sx={{ px: 1, py: 0.5, minWidth: 0, flex: '1 1 0', bgcolor: 'action.hover' }}
    >
      <Typography
        variant="h6"
        noWrap
        sx={{ color: 'primary.main', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}
      >
        {tile.value}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', minWidth: 0 }}>
        {tile.label}
      </Typography>
    </Paper>
  )
}

export function LastSessionCard(): JSX.Element {
  const view = lastSessionView({
    progression: useModule<ProgressionSnap>('progression'),
    coin: useModule<CoinSnap>('coin'),
    deaths: useModule<DeathSnap>('deaths')
  })
  return (
    <DashCard title="Last session" testId="overview-last-session">
      {view === null ? (
        <QuietNote>No earlier session in this log.</QuietNote>
      ) : (
        <>
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="overview-last-session-when"
            noWrap
            sx={{ minWidth: 0 }}
          >
            {formatDateTime(view.t0)} to {formatDateTime(view.t1)}
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.75, minWidth: 0 }}>
            {view.tiles.map((t) => (
              <SessionTile key={t.id} tile={t} />
            ))}
          </Stack>
          {view.coin !== '' && (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="overview-last-session-coin"
              sx={{ mt: 0.75, minWidth: 0 }}
            >
              Coin looted: {view.coin}
            </Typography>
          )}
          {view.zones !== '' && (
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="overview-last-session-zones"
              noWrap
              title={view.zones}
              sx={{ mt: 0.25, minWidth: 0 }}
            >
              {view.zones}
            </Typography>
          )}
        </>
      )}
    </DashCard>
  )
}
