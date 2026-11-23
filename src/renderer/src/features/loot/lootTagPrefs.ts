// The loot tags' renderer pref: whether a recipe ingredient wears the "tradeskill" tag on loot
// rows. Default ON. Its own key, distinct from the pickups strip's `eq.loot.showTradeskill`
// (which hides ingredients from that push surface, a different question).

import { useBoolPref } from '../combat/useCombatPrefs'

export const TRADESKILL_TAG_KEY = 'eq.loot.tradeskillTag'

/** Live across every reader in this window: the Preferences card writes, the loot rows read. */
export function useTradeskillTagPref(): [boolean, (v: boolean) => void] {
  return useBoolPref(TRADESKILL_TAG_KEY, true)
}
