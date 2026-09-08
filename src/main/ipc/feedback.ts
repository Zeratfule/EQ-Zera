// IPC: in-app feedback — the four channels behind the report dialog (§4.3).
//
// EVERY RENDERER-SUPPLIED STRING IS VALIDATED HERE, at the boundary, not deeper in and not
// "because today's only caller is the app's own UI". That is the same law `sounds:getData`'s
// `packId` obeys, and it applies for the same reason: a handler is a public function of the
// renderer process, and the renderer is the part of this app most likely to be running
// someone else's code some day.
//
// What that means concretely:
//   * `windowMinutes` must be one of `LOG_WINDOW_CHOICES` — an enum, not a range. It reaches a
//     read of the user's game log; an arbitrary number would let the renderer choose how much
//     of it to materialize.
//   * the draft goes through `validateDraft` — the SAME pure validator the dialog gates Send on
//     and the ingest Lambda runs, so the three can never disagree about what "valid" means.
//
// Nothing here reaches past `src/main/feedback/index.ts`: the façade is the whole surface, and
// the slicer/queue/transport stay private to it. Registration is one line in
// `src/main/ipc/index.ts`, owned by the IPC-surface agent.
//
// ONE MODULE IS IMPORTED BESIDE THE FAÇADE AND NOT THROUGH IT: `../feedback/mail`. It shares
// nothing with the slicer, the queue or the transport — it neither reads the log nor touches the
// network — and it is deliberately importable in the node test runner, which the façade (Electron
// `dialog`, the window registry) is not. Re-exporting it through index.ts would pull Electron
// into `tests/feedbackMail.test.mts` for no gain. If the façade ever grows a mail concern, that
// is the moment to fold it in.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { LOG_WINDOW_CHOICES, validateDraft, type SubmitErrorCode } from '../../shared/feedback'
import {
  buildAchievementsPreview,
  buildInventoryPreview,
  buildLogSlice,
  feedbackContext,
  saveSliceToFile,
  submitFeedback
} from '../feedback'
import { openFeedbackMail } from '../feedback/mail'

/** The window selector's ONLY legal values (15 / 30 / 60 minutes). */
function isWindowChoice(v: unknown): v is (typeof LOG_WINDOW_CHOICES)[number] {
  return typeof v === 'number' && (LOG_WINDOW_CHOICES as readonly number[]).includes(v)
}

/** A rejection shaped like every other `SubmitResult`, so the dialog has one code path. */
function refuse(
  message: string,
  field?: string
): { ok: false; error: SubmitErrorCode; message: string; queued: boolean; field?: string } {
  return { ok: false, error: 'invalid_payload', message, queued: false, ...(field === undefined ? {} : { field }) }
}

export function registerFeedbackIpc(): void {
  // Header context: versions, channel, queued count, whether this build has an endpoint.
  ipcMain.handle(IPC.feedbackContext, async () => await feedbackContext())

  // Build the scrubbed slice and return a CAPPED preview. The gz bytes never cross IPC.
  // An unrecognized window is null (the dialog's "no log to attach" state), never a guess.
  ipcMain.handle(IPC.feedbackBuildSlice, async (_e, windowMinutes: unknown) =>
    isWindowChoice(windowMinutes) ? await buildLogSlice(windowMinutes) : null
  )

  // Write the FULL slice to a user-chosen path via the OS save dialog.
  ipcMain.handle(IPC.feedbackSaveSlice, async (_e, windowMinutes: unknown) =>
    isWindowChoice(windowMinutes) ? await saveSliceToFile(windowMinutes) : { ok: false }
  )

  // Package the CURRENT inventory dump and return a CAPPED preview (JOS-296). No arguments to
  // validate, and that is the design: the renderer does not get to say WHICH file is read. Main
  // resolves the dump for the active character through the outputs registry, so a compromised
  // renderer cannot turn this into a read-any-file primitive the way a path parameter would.
  ipcMain.handle(IPC.feedbackBuildInventory, async () => await buildInventoryPreview())

  // The achievements dump, on the identical no-arguments terms (JOS-441).
  ipcMain.handle(IPC.feedbackBuildAchievements, async () => await buildAchievementsPreview())

  // Open the user's mail client on a report to the COMPILED feedback address. The renderer hands
  // over a subject and a body and nothing else — no address, no URL, no scheme — and mail.ts
  // validates both against their caps and asserts the recipient before the OS is asked anything.
  // Answers false for input it refused, so the dialog's status line tracks what actually opened.
  ipcMain.handle(IPC.feedbackOpenMail, async (_e, subject: unknown, body: unknown) =>
    await openFeedbackMail(subject, body)
  )

  // Submit. NEVER rejects: a network failure resolves with `{ok:false, queued:true}`.
  ipcMain.handle(IPC.feedbackSubmit, async (_e, draft: unknown, opts: unknown) => {
    const valid = validateDraft(draft)
    if (!valid.ok) return refuse(valid.message, valid.field)
    if (typeof opts !== 'object' || opts === null) return refuse('Missing send options.', 'opts')
    const { attachLog, windowMinutes, attachInventory, attachAchievements } = opts as {
      attachLog?: unknown
      windowMinutes?: unknown
      attachInventory?: unknown
      attachAchievements?: unknown
    }
    if (typeof attachLog !== 'boolean') return refuse('attachLog must be true or false.', 'attachLog')
    if (!isWindowChoice(windowMinutes)) {
      return refuse(`windowMinutes must be one of: ${LOG_WINDOW_CHOICES.join(', ')}.`, 'windowMinutes')
    }
    // Same law as `attachLog`: a boolean, checked at the boundary. There is no path, window or
    // count to validate beside it — the dump is whichever one main resolves.
    if (typeof attachInventory !== 'boolean') {
      return refuse('attachInventory must be true or false.', 'attachInventory')
    }
    if (typeof attachAchievements !== 'boolean') {
      return refuse('attachAchievements must be true or false.', 'attachAchievements')
    }
    return await submitFeedback(valid.value, {
      attachLog,
      windowMinutes,
      attachInventory,
      attachAchievements
    })
  })
}
