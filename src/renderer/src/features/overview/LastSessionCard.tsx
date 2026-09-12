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

import { useCallback, useState, type JSX } from 'react'
import { Button, Paper, Stack, Typography } from '@mui/material'
import ShareIcon from '@mui/icons-material/Share'
import type { CoinSnap, DeathSnap, ProgressionSnap } from '@shared/types'
import { DashCard, QuietNote } from '../combat/combatShared'
import { useModule } from '../../lib/useModule'
import { formatDateTime } from '../../lib/formatDate'
import { lastSessionView, type LastSessionTile } from './lastSession'
import { SessionShareSlot } from './share/SessionShareSlot'

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

/**
 * The way out of the card - a picture, a file, a Discord post or a line of chat (share/).
 *
 * OFFERED ONLY WHEN THERE IS A SESSION, for `FightShareState.opener`'s reason: a button offering to
 * share the empty state is a button about nothing. The dialog is SESSION state and deliberately not
 * a preference - a tab switch unmounts this view, which is the same as closing it.
 */
function ShareButton({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <Button size="small" startIcon={<ShareIcon />} data-testid="session-share-open" onClick={onOpen}>
      Share
    </Button>
  )
}

export function LastSessionCard({
  onOpenSharingPrefs
}: {
  /** The way to Preferences, Sharing, when the surface holding this card has one to hand down. */
  onOpenSharingPrefs?: () => void
}): JSX.Element {
  const [sharing, setSharing] = useState(false)
  const open = useCallback(() => {
    setSharing(true)
  }, [])
  const close = useCallback(() => {
    setSharing(false)
  }, [])
  const view = lastSessionView({
    progression: useModule<ProgressionSnap>('progression'),
    coin: useModule<CoinSnap>('coin'),
    deaths: useModule<DeathSnap>('deaths')
  })
  return (
    <DashCard
      title="Last session"
      testId="overview-last-session"
      {...(view === null ? {} : { right: <ShareButton onOpen={open} /> })}
    >
      {view !== null && sharing && (
        <SessionShareSlot
          view={view}
          onClose={close}
          {...(onOpenSharingPrefs === undefined ? {} : { onOpenSharingPrefs })}
        />
      )}
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
