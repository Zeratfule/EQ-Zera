// storeUiSkin.ts — the persisted half of the in-game UI skin: whether the player accepted the
// use-at-your-own-risk notice (shared/uiSkinDisclaimer.ts). One boolean through the `settingsStore`
// door, like storeCloseToTray.ts; an absent or malformed value reads as "not yet".

import { settingsStore } from './store'

export function getUiSkinAccepted(): boolean {
  return settingsStore.get('uiSkinAccepted') === true
}

export function setUiSkinAccepted(): void {
  settingsStore.set('uiSkinAccepted', true)
}
