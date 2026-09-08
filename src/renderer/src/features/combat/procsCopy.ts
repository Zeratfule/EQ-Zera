// THE PROCS CELL, AS TEXT — the same three columns the panel draws, in the same order.
//
// It used to serialize the whole analytics surface (coats, slow lines, two rate denominators,
// Tier-A contribution, the span ledger, the Tier-B effects report with deduped footnotes); the
// panel it mirrored is now a glanceable list, and the law that made this file worth keeping is
// that the paste is what the user is LOOKING AT. So it shrank with the panel, and both read the
// SAME `procListRows` — a second spelling is exactly how a paste and a screen start disagreeing.
//
// Every number here is folded on ingest by the engine from the authoritative event stream —
// never from the capped/truncated event ring — so this block carries NO `~` estimate treatment
// and no APPROX footer. That is the one structural difference from formatMobsText, which IS
// ring-derived. The `~ <lane>` mark that DOES appear means something else entirely: the game
// left that lane's NAME ambiguous (a shared emote). The count is exact.

import { MAX_WIDTH, statLines, subjectLine, table, type Col } from './copyTable'
import { procListRows, procSummary } from './procRows'
import type { SegmentView } from '@shared/combat'

// `fmtElapsed` lives in copyTable.ts beside `fmtDur`; re-exported so `copyText.ts` — and through
// it every JSX surface — keeps its import path.
export { fmtElapsed } from './copyTable'

const COLS: Col[] = [
  { header: 'Proc', align: 'left' },
  { header: 'PPM', align: 'right' },
  { header: 'Count', align: 'right' }
]

/** The Procs cell, as text: subject line, the header readout, then the ranked rows. */
export function formatProcsText(seg: SegmentView): string {
  const rows = procListRows(seg.procs)
  if (rows.length === 0) return [subjectLine('Procs', seg), 'No procs in this selection.'].join('\n')
  return [
    subjectLine('Procs', seg),
    ...statLines([procSummary(seg.procs).header]),
    '',
    ...table(
      COLS,
      rows.map((r) => [r.ambiguous ? `~ ${r.name}` : r.name, r.ppm, String(r.count)])
    )
  ].join('\n')
}

/** Re-exported so a consumer that only wants the width constant needn't learn two modules. */
export { MAX_WIDTH }
