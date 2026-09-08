// ============================================================================
// PerfSection — "Stalls by …", the Analytics tab's one cross-tab (JOS-372).
// ============================================================================
//
// Its own file for `CoverageSection.tsx`'s reason: `AnalyticsBits.tsx` is at the repo's
// 400-code-line ceiling and a section is the natural unit to split off.
//
// WHAT IT IS FOR. The Live section above it says how often this fleet's sessions stalled. This
// says WHERE those stalls landed, and that is a question a daily counter cannot be asked at all:
// `usage_daily` carries ONE dimension per row, so it can count stalls and can never cross them
// with the window mode, the class of machine, or whether an overlay was locked at the time. The
// cube in `perf_daily` exists for exactly those three crossings and nothing else.
//
// THREE CUTS OF ONE POPULATION, AND THE COPY HAS TO SAY SO. Every list below is the SAME session
// reports sliced a different way, so a row from one list plus a row from another counts reports
// twice. Nothing in this component adds two rows together and the caption says why not.
//
// EACH ROW CARRIES ITS OWN DENOMINATOR, and the lists arrive ordered by it (`main/triage/
// perfCube.ts`): a slice of four reports at 100% is noise, and a UI that sorted by rate would put
// it at the top where it reads as a finding.
//
// HOUSE RULE: no em dashes in user-facing copy.

import type { JSX } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import type { TriageAnalyticsData, TriagePerfSlice } from '@shared/triage'
import { formatNum } from '../../lib/formatRate'
import { rateLabel } from './analyticsRows'
import { Section } from './AnalyticsBits'

/** One cut: a label, its share, and the two numbers the share is made of. */
function PerfSlices({ rows }: { rows: readonly TriagePerfSlice[] }): JSX.Element {
  if (rows.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        Nothing reported in this cut yet.
      </Typography>
    )
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) max-content 1fr', columnGap: 1.5, rowGap: 0.25 }}>
      {rows.map((r) => (
        <Box key={r.id} sx={{ display: 'contents' }}>
          <Typography variant="caption">{r.id}</Typography>
          <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {rateLabel(r.rate)}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatNum(r.stalls)} of {formatNum(r.reports)} reports
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export function PerfSection({ data }: { data: TriageAnalyticsData }): JSX.Element {
  const p = data.perf
  return (
    <Section title="Stalls by - where the bad ones land">
      <Typography variant="caption" color="text.secondary">
        The section above counts stalls fleet-wide; this crosses them with the three facts a daily
        counter cannot cross them with. A report counts here when its WORST probe tick was{' '}
        {p.stallLabel}. Read every rate against the fleet rate, never against another cut - these
        are the same reports sliced three ways, so nothing here may be added up.
      </Typography>
      {p.reports === 0 ? (
        <Typography variant="caption" color="text.secondary" data-testid="analytics-perf-empty">
          The perf cube has no rows in this window. There is no backfill and cannot be - the
          pipeline keeps no raw events, so this table starts the day its ingest went live.
        </Typography>
      ) : (
        <Stack spacing={1}>
          <Typography variant="caption" data-testid="analytics-perf-fleet" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            Fleet: {formatNum(p.stalls)} of {formatNum(p.reports)} reports · {rateLabel(p.rate)}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 2 }}>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                By EverQuest window mode
              </Typography>
              <PerfSlices rows={p.byWindowMode} />
            </Stack>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                By machine class (tier = the weaker of cores/RAM, x integrated|discrete GPU)
              </Typography>
              <PerfSlices rows={p.byMachineClass} />
            </Stack>
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                By locked overlay (locked arms the process-wide mouse hook)
              </Typography>
              <PerfSlices rows={p.byLocked} />
            </Stack>
          </Box>
        </Stack>
      )}
    </Section>
  )
}
