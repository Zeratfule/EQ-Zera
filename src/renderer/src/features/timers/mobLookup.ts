// THE MAIN WINDOW'S DOOR to main's cache-first `mobs:lookup` — the twin of `overlay/mobLookup.ts`,
// which is the same one line against the other window's bridge.
//
// MODULE SCOPE IS THE POINT, not tidiness. `MobCard`'s effect depends on the lookup it was handed
// (`useMobKnowledge`'s dep list), so a function rebuilt inside a component would re-run that effect
// on every render — and a Timers row re-renders once a second forever, because it is a countdown.
// One identity for the whole window's lifetime is what makes the card cost one round trip per mob
// rather than one per tick.
//
// It lives here rather than beside the card because the DOOR is what differs between the two
// windows (`window.eq` in the app, `window.eqOverlay` over the game); the card itself is shared and
// takes it as a prop.

import type { MobKnowledge } from '@shared/types'

export const mainMobLookup = (name: string): Promise<MobKnowledge> => window.eq.lookupMob(name)
