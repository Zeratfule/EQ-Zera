// combat/share/FightCard — the picture of a fight.
//
// A FIXED 720 CSS PIXELS WIDE, for `ShareCard`'s reason rather than a layout preference: this is
// photographed by `webContents.capturePage` (main/ipc/cardCapture.ts) and the photograph is what
// ends up in a Discord channel, so it has ONE width on every machine and at every text size. A
// reader who narrows the window gets a scrollbar around the card, never a differently proportioned
// card. Nothing inside it is a link or a control - every affordance would be a dead pixel in the
// copy - which is also why the buttons sit outside it, in the dialog.
//
// IT DRAWS THE WIRE SHAPE, NOT THE SEGMENT (`shared/fightShare.ts`). The card, the plain-text
// summary and the Discord embed all read one `FightShare`, so the three cannot disagree about what
// the fight was - and what main posts is exactly what the reader pressed the button on.
//
// THE NUMBERS WEAR THE METER'S OWN SPELLING (`lib/formatRate`), because this IS a meter: `21.7k`
// and `471 dps` are what every bar in the app says, and a share card that scaled differently would
// read as another app's screenshot. The TEXT summary is the one place exact figures are spelled out
// instead - see `fightShareText`, which says why.

import type { JSX } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { FightShare, FightShareMember } from '@shared/fightShare'
import { fightClock } from '@shared/fightShare'
import { FONTS, PALETTE, withAlpha } from '../../../../../shared/palette'
import { formatDate } from '../../../lib/formatDate'
import { formatNum, formatRate } from '../../../lib/formatRate'
import { KIND_COLOR } from '../combatShared'

/** The card's one width, in CSS pixels. See the header for why it is not responsive. */
export const FIGHT_CARD_WIDTH = 720

/** How tall one member row's bar is. Dense enough that 24 of them still read as one meter. */
const BAR_H = 16

/** The colour a row's bar is drawn in - the meter's own vocabulary, so the card reads as the tab. */
function rowColor(member: FightShareMember): string {
  if (member.isYou) return KIND_COLOR.you ?? PALETTE.accent
  if (member.pet === true) return KIND_COLOR.pet ?? PALETTE.cyan
  return KIND_COLOR.member ?? PALETTE.green
}

/** Who this fight was against, where, when, and for how long. */
function FightCardHeader({ fight }: { fight: FightShare }): JSX.Element {
  const when = fight.startedAt > 0 ? formatDate(fight.startedAt) : ''
  const context = [fight.zone ?? '', when].filter((s) => s !== '').join('  ·  ')
  return (
    <Stack direction="row" alignItems="flex-end" sx={{ gap: 1, minWidth: 0 }}>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography
          data-testid="fight-card-mob"
          noWrap
          sx={{ fontFamily: FONTS.display, fontSize: 22, lineHeight: 1.1, color: PALETTE.text }}
        >
          {fight.mob}
        </Typography>
        {/* Each part is allowed to be absent, and then it is simply not said - the share card's
            standing rule (law 1: a zone the log never stated is not a zone to invent). */}
        {context !== '' && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
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

/** The headline pair: the fight's total, and how long it took to do it. */
function FightCardTotals({ fight }: { fight: FightShare }): JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ flexWrap: 'wrap' }} useFlexGap>
      <Typography
        data-testid="fight-card-total"
        sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: PALETTE.accent, fontVariantNumeric: 'tabular-nums' }}
      >
        {formatNum(fight.totalDamage)}
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        damage
      </Typography>
      <Typography variant="caption" sx={{ color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
        {fightClock(fight.durationMs)}
      </Typography>
    </Stack>
  )
}

/**
 * ONE MEMBER: rank, name, bar, and the three numbers.
 *
 * THE BAR IS THE SHARE, not a fill of the largest row. The card is read next to the embed, whose
 * percentages are shares of the fight - a bar drawn on a different denominator from the number
 * printed beside it is the kind of quiet disagreement nobody notices until they are arguing about
 * it in a channel.
 */
function MemberRow({ member, rank }: { member: FightShareMember; rank: number }): JSX.Element {
  const color = rowColor(member)
  return (
    <Stack data-testid="fight-card-row" direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        sx={{ width: 20, flexShrink: 0, textAlign: 'right', color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}
      >
        {rank}
      </Typography>
      <Box sx={{ position: 'relative', flexGrow: 1, minWidth: 0, height: BAR_H, borderRadius: 0.5, overflow: 'hidden', bgcolor: withAlpha(PALETTE.text, 0.06) }}>
        <Box sx={{ position: 'absolute', inset: 0, width: `${String(Math.round(member.share * 100))}%`, bgcolor: withAlpha(color, 0.42) }} />
        <Typography
          noWrap
          sx={{
            position: 'relative',
            px: 0.75,
            fontSize: 12,
            lineHeight: `${String(BAR_H)}px`,
            fontWeight: member.isYou ? 700 : 400,
            color: member.isYou ? color : PALETTE.text
          }}
        >
          {member.name}
        </Typography>
      </Box>
      <Typography
        data-testid="fight-card-row-dps"
        sx={{ width: 92, flexShrink: 0, textAlign: 'right', fontSize: 12, color, fontVariantNumeric: 'tabular-nums' }}
      >
        {formatRate(member.dps)}
      </Typography>
      <Typography
        sx={{ width: 64, flexShrink: 0, textAlign: 'right', fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
      >
        {formatNum(member.damage)}
      </Typography>
      <Typography
        sx={{ width: 40, flexShrink: 0, textAlign: 'right', fontSize: 12, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}
      >
        {Math.round(member.share * 100)}%
      </Typography>
    </Stack>
  )
}

export default function FightCard({ fight }: { fight: FightShare }): JSX.Element {
  return (
    <Box
      data-testid="fight-share-card"
      data-members={String(fight.members.length)}
      sx={{
        width: FIGHT_CARD_WIDTH,
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
      <FightCardHeader fight={fight} />
      <FightCardTotals fight={fight} />
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        {fight.members.map((member, i) => (
          <MemberRow key={`${member.name}#${String(i)}`} member={member} rank={i + 1} />
        ))}
      </Stack>
      <Typography variant="caption" sx={{ color: 'text.disabled', alignSelf: 'flex-end' }}>
        EQ Zera
      </Typography>
    </Box>
  )
}
