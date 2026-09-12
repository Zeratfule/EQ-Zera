// preload/celebrationPost.ts — "post celebrations to Discord", as one spread into `api`.
//
// Its own module, the way ./uiScale.ts, ./graphics.ts and ./discordApi.ts are: index.ts sits at the
// repo's 400-code-line factoring ceiling and the answer to that is a split, not a widened
// threshold. On `window.eq` these two methods are indistinguishable from the ones written there.
//
// TWO METHODS, AND NEITHER OF THEM POSTS ANYTHING. The messages are sent by MAIN, off the one
// function every celebration card already passes through (src/main/toast.ts); all a renderer can do
// through this bridge is state a preference and read back what was stored. There is no door here
// that would let a renderer put a message in somebody's channel.
//
// NO TOKEN COMES BACK. A `CelebrationPostView` is a boolean, a WEBHOOK ID the renderer already
// holds from `listDiscordChannels`, a list of kinds, and a sentence main wrote.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CelebrationPostPrefs, CelebrationPostView } from '../shared/celebrationPost'

export const celebrationPostBridge = {
  /** The stored preferences, plus whatever the last post failed with. OFF on a fresh install. */
  getCelebrationPost: (): Promise<CelebrationPostView> => ipcRenderer.invoke(IPC.celebrationPostGet),
  /**
   * Merge-patch them; resolves to what was ACTUALLY stored, normalized at the handler, so the card
   * can render main's answer rather than assume its request landed.
   */
  setCelebrationPost: (patch: Partial<CelebrationPostPrefs>): Promise<CelebrationPostView> =>
    ipcRenderer.invoke(IPC.celebrationPostSet, patch)
}
