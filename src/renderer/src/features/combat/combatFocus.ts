// combatFocus.ts — what it takes to open the Combat tab ON something, from whichever surface
// asked. Its own file (no React, no MUI, no data imports) so a routing caller never has to
// import the combat view itself — the same reason features/mobs/mobTarget.ts exists.

import type { CombatScope } from './dashboardData'

/**
 * "Open the Combat tab on this." The payload another tab hands the combat view.
 *
 * `selection` is a value the combat SELECTOR understands: the `LIVE_SELECTION` sentinel
 * ('__live__') for the fight scope's head row — which re-resolves every tick, so it follows
 * you from the open pull into the next one — or a concrete segment id ('e<n>' / 'zone' /
 * 'zs<n>'). Overview always sends the sentinel: its DPS card IS the head row, by construction
 * (both resolve through `fightScopeOptions`).
 */
export interface CombatFocus {
  scope: CombatScope
  selection: string
  /**
   * OPEN THE SHARE DIALOG on arrival (2026-09-11). The meter overlays' Share button is the only
   * caller: an overlay holds no channel list and performs no fetch, so what it asks for is the
   * app, on this fight, with the dialog up. Absent everywhere else - an ordinary deep link into
   * the Combat tab is not a request to start sharing.
   */
  share?: boolean
}
