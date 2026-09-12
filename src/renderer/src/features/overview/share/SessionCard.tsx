// overview/share/SessionCard — the picture of a play session.
//
// A FIXED 720 CSS PIXELS WIDE, `FightCard`'s width and for its reason rather than a layout
// preference: this is photographed by `webContents.capturePage` (main/ipc/cardCapture.ts) and the
// photograph is what ends up in a Discord channel, so it has ONE width on every machine and at
// every text size. Nothing inside it is a link or a control - every affordance would be a dead
// pixel in the copy - which is why the buttons sit outside it, in the dialog.
//
// IT DRAWS THE WIRE SHAPE, NOT THE MODULES (`shared/sessionShare.ts`). The card, the plain-text
// summary and the Discord embed all read one `SessionShare`, so the three cannot disagree about
// what the night was - and what main posts is exactly what the reader pressed the button on.
//
// THE NUMBERS WEAR THE APP'S OWN SPELLING (`lib/formatRate`, `lib/formatDate`), because this is the
// same reading the Overview card gives; the TEXT summary is the one place exact figures are spelled
// out instead - see `sessionShareText`, which says why.

import type { JSX } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { SessionShare } from '@shared/sessionShare'
import { sessionDuration } from '@shared/sessionShare'
import { FONTS, PALETTE, withAlpha } from '../../../../../shared/palette'
import { formatDateTime } from '../../../lib/formatDate'
import { formatNum, formatRate } from '../../../lib/formatRate'

/** The card's one width, in CSS pixels. See the header for why it is not responsive. */
export const SESSION_CARD_WIDTH = 720

/** One tile of the headline row. Four of them, and each is allowed to say nothing. */
interface SessionTileSpec {
  id: string
  value: string
  label: string
}

/** Who this session was, how long it ran, and where. Each part may be absent and then is unsaid. */
function SessionCardHeader({ session }: { session: SessionShare }): JSX.Element {
  const who = [session.character ?? '', session.classes.join(' / ')].filter((s) => s !== '').join('  ')
  const when = session.t0 > 0 && session.t1 > 0 ? `${formatDateTime(session.t0)} to ${formatDateTime(session.t1)}` : ''
  const context = [when, session.zones.join(' · ')].filter((s) => s !== '').join('  ·  ')
  return (
    <Stack direction="row" alignItems="flex-end" sx={{ gap: 1, minWidth: 0 }}>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography
          data-testid="session-card-who"
          noWrap
          sx={{ fontFamily: FONTS.display, fontSize: 22, lineHeight: 1.1, color: PALETTE.text }}
        >
          {who === '' ? 'A session' : who}
          {session.level !== undefined && (
            <Typography component="span" sx={{ ml: 1, fontSize: 14, color: 'text.secondary' }}>
              level {session.level}
            </Typography>
          )}
        </Typography>
        {context !== '' && (
          <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
            {context}
          </Typography>
        )}
      </Box>
      <Typography
        sx={{ fontFamily: FONTS.display, fontSize: 13, letterSpacing: 2, color: PALETTE.accent, flexShrink: 0 }}
      >
        EQ ZERA
      </Typography>
    </Stack>
  )
}

/** The headline pair: how long it ran, and how much of that the range query calls play. */
function SessionCardTotals({ session }: { session: SessionShare }): JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ flexWrap: 'wrap' }} useFlexGap>
      <Typography
        data-testid="session-card-duration"
        sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: PALETTE.accent, fontVariantNumeric: 'tabular-nums' }}
      >
        {sessionDuration(session.durationMs)}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        played
      </Typography>
      {session.activeMs > 0 && (
        <Typography variant="caption" sx={{ color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
          {sessionDuration(session.activeMs)} active
        </Typography>
      )}
    </Stack>
  )
}

/** ONE tile. The Overview card's own shape, so the picture reads as the card it came from. */
function SessionCardTile({ tile }: { tile: SessionTileSpec }): JSX.Element {
  return (
    <Box
      data-testid={`session-card-${tile.id}`}
      sx={{
        px: 1,
        py: 0.5,
        flex: '1 1 0',
        minWidth: 0,
        borderRadius: 0.5,
        bgcolor: withAlpha(PALETTE.text, 0.06)
      }}
    >
      <Typography
        noWrap
        sx={{ fontSize: 20, lineHeight: 1.2, color: PALETTE.accent, fontVariantNumeric: 'tabular-nums' }}
      >
        {tile.value}
      </Typography>
      <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary' }}>
        {tile.label}
      </Typography>
    </Box>
  )
}

/** The four tiles, in the four currencies the log actually states (never an experience number). */
function tilesOf(session: SessionShare): SessionTileSpec[] {
  return [
    { id: 'kills', value: formatNum(session.kills), label: 'kills' },
    { id: 'levels', value: `+${session.levelEquiv.toFixed(2)}`, label: 'levels of progress' },
    { id: 'deaths', value: String(session.deaths), label: 'deaths' },
    { id: 'coin', value: session.coin ?? '-', label: 'coin looted' }
  ]
}

/** The hardest pull of the night, when the snapshot still held the fight that was it. */
function SessionCardBest({ session }: { session: SessionShare }): JSX.Element | null {
  const best = session.bestFight
  if (best === undefined) return null
  const where = best.zone === undefined ? '' : ` · ${best.zone}`
  return (
    <Typography data-testid="session-card-best" variant="caption" noWrap sx={{ color: 'text.secondary', minWidth: 0 }}>
      Best fight: {best.name}
      {where} - {formatRate(best.dps)}
    </Typography>
  )
}

/** What came out of it. Named items only; the tile above counts every line the log wrote. */
function SessionCardDrops({ session }: { session: SessionShare }): JSX.Element | null {
  if (session.drops.length === 0) return null
  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.disabled' }}>
        Drops
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }} useFlexGap>
        {session.drops.map((drop) => (
          <Typography
            key={drop.name}
            data-testid="session-card-drop"
            noWrap
            sx={{
              px: 0.75,
              py: 0.25,
              fontSize: 12,
              borderRadius: 0.5,
              maxWidth: 220,
              color: PALETTE.text,
              bgcolor: withAlpha(PALETTE.accent, 0.12)
            }}
          >
            {drop.name}
            {drop.count > 1 && ` x${drop.count}`}
          </Typography>
        ))}
      </Stack>
    </Stack>
  )
}

export default function SessionCard({ session }: { session: SessionShare }): JSX.Element {
  return (
    <Box
      data-testid="session-share-card"
      data-drops={String(session.drops.length)}
      sx={{
        width: SESSION_CARD_WIDTH,
        flexShrink: 0,
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        bgcolor: PALETTE.bg,
        border: '1px solid',
        borderColor: withAlpha(PALETTE.accent, 0.5),
        borderRadius: 1
      }}
    >
      <SessionCardHeader session={session} />
      <SessionCardTotals session={session} />
      <Stack direction="row" spacing={0.75} sx={{ minWidth: 0 }}>
        {tilesOf(session).map((tile) => (
          <SessionCardTile key={tile.id} tile={tile} />
        ))}
      </Stack>
      <SessionCardBest session={session} />
      <SessionCardDrops session={session} />
      <Typography variant="caption" sx={{ color: 'text.disabled', alignSelf: 'flex-end' }}>
        EQ Zera
      </Typography>
    </Box>
  )
}
