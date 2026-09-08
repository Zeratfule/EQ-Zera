// YOUR DEFENCE — the block/parry/dodge/riposte readout (JOS-354).
//
// WHERE IT LIVES, AND WHY IT IS NOT A FIFTH DASHBOARD CELL. The dashboard is four equal panels
// answering four questions — WHO, WHEN, WHAT FIRED, WHOM (CombatView.DashboardGrid says so at
// length, and the arrangement is an owner ruling). Defence is not a fifth subject: it is the other
// half of the one the INCOMING direction already shows. So it lives inside that panel, and nowhere
// else in the app.
//
// …AND INSIDE IT, IT IS THE SECOND TAB (JOS-361, owner ruling 2026-08-14 after hands-on testing:
// "defense should be in a second tab (not selected by default) within the card. damage breakdown
// is first. mitigation is second"). It shipped STACKED above the incoming rows, which spent the
// top of the card on a block the reader had not asked for and pushed the ranked attacker list
// below the fold. The two are different questions about the same direction — what is hitting me,
// and how much of it I am turning aside — so they are two tabs of one card rather than one column
// of both. SegmentPanel.tsx owns the strip; this file owns the block.
//
// IT IS NEVER SHOWN IN THE OUTGOING DIRECTION — so the Outgoing card has no Mitigation tab at all,
// not a disabled one. A source's own `missBreakdown` there is the MOB's avoidance of YOUR swings,
// which is the opposite fact; offering a "Mitigation" tab over it would invite exactly the
// misreading this panel exists to end.
//
// THE BARS ARE THE APP'S `Bar`, coloured with the enemy hue like every other incoming row, so the
// panel reads as part of the direction it sits in rather than as a new visual language.

import { Box, Stack, Typography } from '@mui/material'
import { Bar, KIND_COLOR, QuietNote } from './combatShared'
import { defenseHeadline, defenseRows, riposteLine, ripostesTakenLine } from './defenseRows'
import { Tooltip } from '../../lib/Tooltip'
import type { DefenseView } from '@shared/combat'

/** The dimmed caption rows under the bars (riposte's two halves, and what mobs riposted). */
function Notes({ d }: { d: DefenseView }): React.JSX.Element | null {
  const lines = [riposteLine(d), ripostesTakenLine(d)].filter((l): l is string => l !== null)
  if (lines.length === 0) return null
  return (
    <Box sx={{ mt: 0.5 }}>
      {lines.map((l) => (
        <Typography key={l} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {l}
        </Typography>
      ))}
    </Box>
  )
}

export function DefensePanel({ d }: { d: DefenseView }): React.JSX.Element {
  const rows = defenseRows(d)
  return (
    // No bottom rule any more: the border existed to separate this block from the attacker rows
    // it used to sit on top of, and inside its own tab there is nothing below it to separate from.
    <Box data-testid="defense-panel">
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
        <Typography
          variant="caption"
          noWrap
          sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}
        >
          Your defence
        </Typography>
        <Typography variant="caption" color="text.secondary" data-testid="defense-headline" noWrap sx={{ minWidth: 0 }}>
          {defenseHeadline(d)}
        </Typography>
      </Stack>
      {d.swings === 0 ? (
        <QuietNote>Nothing has swung at you in this segment - no defensive rate to state yet.</QuietNote>
      ) : (
        rows.map((r) => (
          <Tooltip key={r.key} title={`${r.hint} ${r.count} of ${d.swings} swings aimed at you.`}>
            {/* The testid is what lets the headless harness read the RANKING off the screen
                (JOS-361) — a unit test can assert `defenseRows` order, but only the mounted panel
                can say the rows are drawn in it. */}
            <Box data-testid="defense-row">
              <Bar
                color={KIND_COLOR.enemy}
                // The four ACTIVE defences carry the accent stripe; the mob's own whiff and your
                // rune do not, so "what I did" is separable from "what happened" at a glance.
                accent={r.active ? KIND_COLOR.you : undefined}
                pct={r.fill}
                name={r.label}
                right={`${r.count} · ${r.pct.toFixed(1)}%`}
              />
            </Box>
          </Tooltip>
        ))
      )}
      <Notes d={d} />
    </Box>
  )
}
