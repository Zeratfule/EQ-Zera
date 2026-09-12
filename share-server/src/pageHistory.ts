// pageHistory.ts — the History panel: what changed, each time this link was re-published.
//
// `hist:<id>` holds the states this share was published OVER, newest first (history.ts); the
// current state is the envelope the page is already rendering. So the panel is a list of
// TRANSITIONS: row `i` says what happened when snapshot `i` was replaced by the state after it —
// snapshot `i - 1`, or, for the newest stored snapshot, the profile on the page right now.
//
// WHAT A ROW SAYS, and what it deliberately does not:
//   * The DATE the row's state was published. Locale-free, like every other date on this page.
//   * AC and the four scores, as `old → new` with the signed delta when they moved, and as the
//     bare figure when they did not. Stating the unchanged ones too is what makes a row readable
//     on its own ("AC 247, Tank 74%"), and the arrow is then reserved for a real change.
//   * The SLOTS whose item name changed, `Old Name +3 → New Name +5`. Unchanged slots are
//     omitted — a row listing all twenty-four every time would bury the one that moved. A slot
//     that gained or lost an item reads `(empty) → …` / `… → (empty)`.
//   * Ten rows at most, then a muted count of what is not drawn. The cap is on the RENDERING,
//     not on the store: `/p/:id` hands the app all thirty.
//
// EVERY STRING HERE CAME FROM A STRANGER, so page.ts's one rule holds without exception: nothing
// reaches the output except through `esc()`, numbers included (via `String()`). And nothing here
// emits a `style=` attribute — the CSP has no `style-src 'unsafe-inline'`, so the panel's whole
// appearance lives in pageStyle.ts.

import type { CharacterProfileShare, ShareScores } from '../../src/shared/characterShare'
import type { HistoryItem, Snapshot } from './history'
import { esc } from './page'

/** How many rows the page draws. The rest are counted, not listed. */
export const HISTORY_ROWS = 10

/** The word a slot shows on the side of a transition where it wore nothing. */
const EMPTY = '(empty)'

const SCORE_ROWS: readonly [keyof ShareScores, string][] = [
  ['tank', 'Tank'],
  ['dps', 'DPS'],
  ['heal', 'Healer'],
  ['solo', 'Solo']
]

/** ISO date only, and only when the stored string really is one; otherwise it is shown whole. */
function dateOf(at: string): string {
  return /^\d{4}-\d{2}-\d{2}T/.test(at) ? at.slice(0, 10) : at
}

function signed(n: number): string {
  return n > 0 ? `+${String(n)}` : String(n)
}

/**
 * One measured figure: `old → new` plus the signed delta when it moved, the bare figure when it
 * did not. `suffix` is the unit the number is read in (`%` for a score, nothing for AC).
 */
function metricRow(label: string, from: number, to: number, suffix = ''): string {
  const value =
    from === to
      ? `${String(to)}${suffix}`
      : `${String(from)}${suffix} → ${String(to)}${suffix}`
  const delta =
    from === to ? '' : `<span class="d ${to > from ? 'up' : 'down'}">${esc(signed(to - from))}</span>`
  return `<li><span class="k">${esc(label)}</span><span class="v">${esc(value)}</span>${delta}</li>`
}

/** AC, then the four scores when BOTH states carried them (law 1: absent, never zeroed). */
function metricRows(from: Snapshot, to: Snapshot): string {
  const rows = [metricRow('AC', from.ac, to.ac)]
  if (from.scores && to.scores) {
    const before = from.scores
    const after = to.scores
    for (const [key, label] of SCORE_ROWS) rows.push(metricRow(label, before[key], after[key], '%'))
  }
  return `<ul class="deltas">${rows.join('')}</ul>`
}

function bySlot(items: readonly HistoryItem[]): Map<string, string> {
  return new Map(items.map((one) => [one.slot, one.item]))
}

/**
 * The slots whose item changed, in the NEWER state's order (which is the order the gear list on
 * this page uses), with the slots that disappeared appended. `labels` is the current profile's
 * slot → screen-label map; a slot the current profile no longer wears keeps its raw slot id,
 * which is honest rather than blank.
 */
function itemRows(from: Snapshot, to: Snapshot, labels: ReadonlyMap<string, string>): string {
  const before = bySlot(from.items)
  const after = bySlot(to.items)
  const slots = [...after.keys(), ...[...before.keys()].filter((slot) => !after.has(slot))]
  const rows = slots
    .filter((slot) => (before.get(slot) ?? '') !== (after.get(slot) ?? ''))
    .map((slot) => {
      const label = labels.get(slot) ?? slot
      const was = before.get(slot) ?? EMPTY
      const now = after.get(slot) ?? EMPTY
      return (
        `<li><span class="slot">${esc(label)}</span>` +
        `<span class="v">${esc(was)} → ${esc(now)}</span></li>`
      )
    })
  return rows.length ? `<ul class="changed">${rows.join('')}</ul>` : ''
}

/** One transition: the state `from` was published at, and everything that moved after it. */
function historyRow(from: Snapshot, to: Snapshot, labels: ReadonlyMap<string, string>): string {
  return (
    `<li><p class="when">${esc(dateOf(from.at))}</p>` +
    metricRows(from, to) +
    itemRows(from, to, labels) +
    `</li>`
  )
}

/**
 * The panel, or nothing at all when this share has never been re-published.
 *
 * `current` is the state on the page right now (page.ts builds it with `snapshotOf`), so the top
 * row says what the most recent re-share did; `profile` is there only for the slot labels.
 */
export function historyPanel(
  profile: CharacterProfileShare,
  current: Snapshot,
  history: readonly Snapshot[]
): string {
  if (!history.length) return ''
  const labels = new Map(profile.cells.map((cell) => [cell.slot, cell.label]))
  const shown = history.slice(0, HISTORY_ROWS)
  const rows = shown
    .map((snapshot, i) => historyRow(snapshot, i === 0 ? current : (history[i - 1] ?? current), labels))
    .join('')
  const rest = history.length - shown.length
  const more = rest > 0 ? `<p class="muted">${String(rest)} earlier snapshots</p>` : ''
  return (
    `<section class="panel"><h2>History</h2>` +
    `<p class="muted">What changed each time this link was re-shared. Newest first.</p>` +
    `<ol class="hist">${rows}</ol>${more}</section>`
  )
}
