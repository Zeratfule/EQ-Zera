// keyOnlyViews.ts — the views App renders with nothing but the remount `key`.
//
// Each is character-scoped and takes no props: the `key` (App's character-rebuild counter) is the
// whole contract, because whatever they keep lives in the store or a renderer pref and is re-read
// on the remount. They sit in a table rather than as one `view === … &&` branch each so App's
// content switch does not gain a point of complexity per tab.
//   - Buffs: the buff/debuff timers.
//   - Timers (JOS-194): respawn clocks; the watch list lives in the store and the clocks are
//     re-derived by the fold a character switch kicks off.
//   - AAs: the Alternate Advancement planner; held ranks, the trio and the stored plan are all one
//     character's.

import type { JSX } from 'react'
import type { View } from './appViews'
import BuffsView from './features/buffs/BuffsView'
import TimersView from './features/timers/TimersView'
import AaPlannerView from './features/aa/AaPlannerView'

export const KEY_ONLY_VIEWS: Partial<Record<View, () => JSX.Element>> = {
  buffs: BuffsView,
  timers: TimersView,
  aa: AaPlannerView
}
