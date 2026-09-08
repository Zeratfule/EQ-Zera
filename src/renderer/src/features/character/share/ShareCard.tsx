// character/share/ShareCard — the thing a player actually shares.
//
// A FIXED 720 CSS PIXELS WIDE, and that is a screenshot's dimension rather than a layout choice.
// Everything else in this app is responsive because a window can be any size; this card is
// photographed by `webContents.capturePage` (main/ipc/characterShare.ts) and the photograph is
// what ends up in a Discord channel, so it has ONE width on every machine, at every text size, and
// a reader who narrows the window gets a scrollbar around the card rather than a differently
// proportioned card. That is also why nothing inside it is a hover surface, a link or a control:
// a share card is a picture, and every affordance on it would be a dead pixel in the copy.
//
// ONE COMPONENT, TWO CALLERS. The Share dialog renders it from your own live sheet; the viewer
// renders it from a stranger's decoded string. Both hand it the same `CharacterProfileShare`, so
// what you see before you copy is exactly what the person you send it to sees — which is the whole
// reason the profile is a wire shape rather than a bag of props.

import type { JSX } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { CharacterProfileShare } from '@shared/characterShare'
import { FONTS, PALETTE, withAlpha } from '../../../../../shared/palette'
import { formatDate } from '../../../lib/formatDate'
import { ShareFigure, ShareGearGrid, ShareScoreRow, ShareTotalsRow } from './ShareCardParts'

/** The card's one width, in CSS pixels. See the header for why it is not responsive. */
export const SHARE_CARD_WIDTH = 720

/** Who this is: the name, the level, the loadout, and the app's mark. */
function CardHeader({ profile }: { profile: CharacterProfileShare }): JSX.Element {
  return (
    <Stack direction="row" alignItems="flex-end" sx={{ gap: 1, minWidth: 0 }}>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography sx={{ fontFamily: FONTS.display, fontSize: 22, lineHeight: 1.1, color: PALETTE.text }}>
          {profile.name ?? 'A character'}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {/* Each part is allowed to be absent, and then it is simply not said - the identity
              line's rule (CharacterIdentity.tsx), kept on a card that a stranger will read. */}
          {[
            profile.level === undefined ? '' : `Level ${String(profile.level)}`,
            profile.classes.join(' / ')
          ]
            .join(profile.level !== undefined && profile.classes.length ? '  ·  ' : '')
            .trim()}
        </Typography>
      </Box>
      <Typography
        sx={{ fontFamily: FONTS.display, fontSize: 13, letterSpacing: 2, color: PALETTE.accent, flexShrink: 0 }}
      >
        EQ ZERA
      </Typography>
    </Stack>
  )
}

export interface ShareCardProps {
  profile: CharacterProfileShare
  /** the figure's last drawn frame, when this card is being built from a live sheet */
  image?: string | null
  /** the viewer's provenance line; absent on your own card, where it would be telling you your own name */
  sharedLine?: string
}

export default function ShareCard({ profile, image = null, sharedLine }: ShareCardProps): JSX.Element {
  return (
    <Box
      data-testid="character-share-card"
      data-cells={String(profile.cells.length)}
      sx={{
        width: SHARE_CARD_WIDTH,
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
      <CardHeader profile={profile} />
      <Stack direction="row" spacing={1} alignItems="stretch" sx={{ minWidth: 0 }}>
        <ShareFigure look={profile.look} image={image} />
        <ShareGearGrid cells={profile.cells} />
      </Stack>
      <ShareTotalsRow totals={profile.totals} />
      <ShareScoreRow scores={profile.scores} />
      <Typography variant="caption" sx={{ color: 'text.disabled' }} data-testid="character-share-stamp">
        {sharedLine ?? `Gear as of ${formatDate(profile.capturedAt)}`}
      </Typography>
    </Box>
  )
}
