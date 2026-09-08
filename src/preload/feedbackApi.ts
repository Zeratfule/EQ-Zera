// feedbackApi.ts — the slice of the bridge that is about GETTING A REPORT OUT OF A DARK BUILD.
//
// A separate file for FILE MASS, not for scope — the questsApi.ts/craftApi.ts pattern and the rule
// those files state: `src/preload/index.ts` sits at the measured 400-code-line ceiling and the
// answer is to SPLIT rather than to ratchet. This object is spread into the bridge, so the method
// below is an ordinary member of the one `window.eq` surface and no call site knows where it was
// defined.
//
// The other feedback methods stay in index.ts beside the rest of the dialog's calls; only the new
// one lands here, because moving working lines would be a diff about nothing.

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'

export const feedbackApi = {
  /**
   * Open the user's mail client on a report to the app's compiled feedback address.
   *
   * NO ADDRESS AND NO URL CROSS THIS CALL, on purpose: a subject and a body, and main assembles
   * the rest from a compiled constant, then asserts the recipient before the OS sees it
   * (src/main/feedback/mail.ts states why that is the whole trust story). Resolves to whether the
   * OS accepted it — false for anything main refused, so the caller's status line tracks what
   * actually opened rather than that a call was made.
   */
  openFeedbackMail: (subject: string, body: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.feedbackOpenMail, subject, body)
}
