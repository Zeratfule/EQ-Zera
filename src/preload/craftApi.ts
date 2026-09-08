// craftApi.ts — the slice of the main app's bridge that is about TRADESKILLS (the Crafting tab).
//
// A separate file for FILE MASS, not for scope — the planner.ts/roster.ts/windows.ts pattern, and
// the rule those files state: `src/preload/index.ts` sits at the measured 400-code-line ceiling and
// the answer is to SPLIT rather than to ratchet. This object is spread into the bridge, so the
// method below is an ordinary member of the one `window.eq` surface.
//
// ONE READ OVER COMMITTED BYTES. It cannot reject and it never needs re-asking: the recipes are
// derived from the corpus compiled into the main bundle, so they cannot change while the app runs.
// The renderer fetches ONCE per window (`features/crafting/useCraftIndex.ts`) and every filter,
// search and ownership join is a pure pass over what arrived.

import { ipcRenderer } from 'electron'
import { CRAFT_INDEX_CHANNEL, type CraftIndex } from '../shared/craft'

export const craftApi = {
  /** Every tradeskill recipe the committed item corpus states — ~2,450 rows, built lazily in main
   *  and memoized there. Fetch ONCE and cache. */
  getCraftIndex: (): Promise<CraftIndex> => ipcRenderer.invoke(CRAFT_INDEX_CHANNEL)
}
