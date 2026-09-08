// THIS WINDOW'S DOOR to main's cache-first `mobs:lookup` (JOS-194 round 6).
//
// `lib/hoverCards.tsx` draws the same mob card in both windows and takes the bridge as a prop,
// because the app calls it `window.eq` and a floating window calls it `window.eqOverlay`. This is
// the overlay bundle's half of that, at MODULE scope so every card in this window depends on ONE
// stable function identity rather than a new closure per render — a card whose effect re-ran on
// every tick of a countdown would re-fetch on a timer.
//
// Its own file rather than a line in `feedHoverCards.tsx`: the respawn window needs the door and
// nothing else from the event feed's item card.

import type { MobKnowledge } from '@shared/types'

export const overlayMobLookup = (name: string): Promise<MobKnowledge> => window.eqOverlay.lookupMob(name)
