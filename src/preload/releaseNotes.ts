// preload/releaseNotes.ts — the what's-new half of the app bridge (JOS-73). Two methods.
//
// Its own module, spread into `api` in index.ts, for the same reason ./perf.ts, ./graphics.ts
// and ./dev.ts are: that file sits at the repo's 400-code-line factoring ceiling and the answer
// to that is a split, not a widened threshold. On `window.eq` these two are indistinguishable
// from the methods written out there.
//
// THE NOTES DO NOT CROSS THIS BRIDGE. `src/shared/releaseNotes.ts` is committed source the
// renderer imports directly (the bundler inlines it, like the spell DB), so what travels here is
// exactly one string: the release this install has already been shown.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'

export const releaseNotesBridge = {
  /** The newest release this install has been shown notes for — null on a fresh install, which
   *  is the state that means "no news", not "everything is news". */
  getReleaseNotesSeen: (): Promise<string | null> => ipcRenderer.invoke(IPC.releaseNotesSeenGet),
  /**
   * Stamp it, or CLEAR it with `null`.
   *
   * Clearing is a real state, not a reset: an absent key is the fresh install every user starts
   * from, and the DEV variant control writes it to reproduce that. Resolves to what was ACTUALLY
   * stored — main validates the shape and answers with the file's own value.
   */
  setReleaseNotesSeen: (version: string | null): Promise<string | null> =>
    ipcRenderer.invoke(IPC.releaseNotesSeenSet, version)
}
