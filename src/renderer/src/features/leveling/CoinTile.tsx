// CoinTile — what this window PAID, beside what it levelled (roadmap 2 item 11).
//
// The Leveling tab's stat row answers "how fast is the bar moving" four ways and has never been
// able to answer the other half of the same question: was the camp worth it. The `coin` module
// makes that answerable for the first time, because the auto-vendor line
// (`You looted <item> from <mob>'s corpse and sold it for 125 platinum.`) is by far the largest
// coin stream a farming session produces and its price was read and discarded by the parser until
// 2026-09-08.
//
// ── THE LADDER IS A STATED ASSUMPTION, SAID ONCE ──────────────────────────────────────────────
//
// `shared/acquireEvents.ts` states the law: EQ's platinum/gold/silver/copper conversion appears in
// NO line the client prints, so a consumer that wants coin-per-hour DECLARES ITS OWN RATE IN THE
// OPEN. This tile's caption is where it says so, in the SAME words the Farm overlay's coin row
// carries (`COIN_LADDER_TEXT`), read from the one file that owns both the words and the
// arithmetic — `overlay/farmRows.ts`, which is pure, MUI-free and node-tested. Two spellings of an
// assumption is how an assumption stops being one.
//
// ── A TILE THE LOG CANNOT SUPPORT IS ABSENT, NOT BLANK ────────────────────────────────────────
//
// No coin row inside the window ⇒ this component renders NOTHING. That is the opposite of the
// em-dash rule its neighbours follow, and deliberately: an em-dash means "the log declined to state
// a quantity it was talking about", which is a real reading of a real range. A window with no coin
// sentence in it at all is not a coin reading; it is a range about something else, and a permanent
// blank fifth card in the stat row would be a control that never has an answer. `rangeHeroes`'
// four cards are the tab's promise; this one earns its place per window.
//
// ── IT IS MEASURED THE WAY ITS NEIGHBOURS ARE ─────────────────────────────────────────────────
//
// The WINDOW is the one the other tiles use: `stats.t0`/`stats.t1` are the instants and the zone
// membership is `coinZoneKeys(stats.zones)` — the zones `rangeStats` itself admitted — so the
// numerator and the denominator cover the same instants by construction, under a slice, under a
// drag, and under either tier membership. The HOUR is the tab's own toggle (`useRateBasis`), picked
// through `pickRate` exactly as `rangeHeroes` picks it, which also brings the just-arrived gate:
// under `RATE_MIN_MS` the rate is withheld and the caption states the total instead of a per-hour
// figure that would be the clock since the range opened, extrapolated.

import { type JSX } from 'react'
import { Box, Paper, Typography } from '@mui/material'
import PaidIcon from '@mui/icons-material/Paid'
import type { RangeStats } from '@shared/progressionStats'
import type { CoinSnap } from '@shared/coinTypes'
import { basisRead, pickRate } from '@shared/rateBasis'
import { useModule } from '../../lib/useModule'
import { useRateBasis } from '../timeslice/useRateBasis'
import { COIN_LADDER_TEXT, coinText, coinWindow, coinZoneKeys } from '../../overlay/farmRows'
import { NONE } from './rangeStatsRows'
import { PALETTE } from '../../../../shared/palette'

/** The hue: the AA ledger's amber, which is what coin looks like. */
const ACCENT = PALETTE.amber

export function CoinTile({ stats }: { stats: RangeStats }): JSX.Element | null {
  const { basis } = useRateBasis()
  const coin = useModule<CoinSnap>('coin')
  const read = basisRead(basis, stats)
  const window = coinWindow({
    rows: coin?.rows ?? [],
    range: { t0: stats.t0, t1: stats.t1 },
    spans: stats,
    zoneKeys: coinZoneKeys(stats.zones)
  })
  // Absent, not blank — see the header. A null snapshot (not hydrated) lands here too, which is the
  // honest drawing of "the log has not said anything about coin in this window".
  if (window.rows === 0) return null
  const perHour = pickRate(read, window.copperPerHourActive, window.copperPerHourWall)
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.25, flex: 1, minWidth: 150, borderLeft: `3px solid ${ACCENT}`, display: 'flex', gap: 1 }}
      data-testid="leveling-coin"
    >
      <Box sx={{ color: ACCENT, display: 'flex', alignItems: 'center' }}>
        <PaidIcon />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {/* The VALUE is the RATE, per denomination — the question the card is asking. What actually
            came in rides the caption, because a total with no hour beside it is not the reading
            this card is for, and because it is the honest answer when the rate is withheld. */}
        <Typography variant="h5" sx={{ lineHeight: 1.1, color: ACCENT }} noWrap data-testid="leveling-coin-value">
          {perHour === null ? NONE : coinText(perHour)}
        </Typography>
        <Typography variant="body2">Coin</Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {`per hour of ${read.word} time · ${coinText(window.copper)} in range · ${COIN_LADDER_TEXT}`}
        </Typography>
      </Box>
    </Paper>
  )
}
