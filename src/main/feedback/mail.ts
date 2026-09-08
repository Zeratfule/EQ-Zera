// feedback/mail.ts — THE ONE DOOR THAT OPENS A MAIL CLIENT.
//
// WHY THIS EXISTS AT ALL, AND WHY IT IS NOT A HOLE IN `allowedExternalUrl`.
//
// `src/main/security.ts` is https-ONLY and stays that way: `mailto:` is refused there by law and
// `tests/security.test.mts` pins the refusal, because that function validates URLs BUILT FROM
// WORLD DATA (wiki page titles) and a scheme that reaches a registered protocol handler is
// exactly the class of sink that law exists for. Nothing about this file weakens it.
//
// This channel is the opposite shape. The renderer supplies NO address and NO URL — only a
// subject and a body. The recipient is a COMPILED CONSTANT (`FEEDBACK_MAIL_TO`), the scheme is
// fixed, and the assembled URL is asserted to start with exactly `mailto:<that address>?` before
// anything is handed to the OS. So the set of things this door can ever open has exactly one
// member, whatever the renderer says. That is the whole trust story, and it is why the argument
// validation below is at the boundary rather than "because today's only caller is our own UI".
//
// ELECTRON IS IMPORTED LAZILY, INSIDE THE OPENER. The builder and the validation are pure and are
// unit-tested in the node runner (`tests/feedbackMail.test.mts`); a top-level `import { shell }
// from 'electron'` makes the whole module unimportable outside Electron ("does not provide an
// export named 'shell'"), which is the same reason `itemLookupParse.ts` was split out of
// `itemLookup.ts`. Here the cut is one dynamic import rather than a second file, because the
// electron-dependent half is a single line.

import { FEEDBACK_MAIL_TO, MAILTO_BODY_BUDGET, shortReport } from '../../shared/feedbackReport'

/** The one prefix a URL from this module may ever have. Asserted, never assumed. */
export const MAILTO_PREFIX = `mailto:${FEEDBACK_MAIL_TO}?`

/** Subject cap. A subject is one line naming the build and the kind of report; anything longer
 *  is a caller bug, not a long subject. */
export const MAX_MAIL_SUBJECT = 120

/** Body cap BEFORE the budget cut. `MAX_DESCRIPTION` is 4,000 and the blocks around it add a
 *  few hundred characters, so 8,000 is generous headroom over any real report and still a bound
 *  on what a compromised renderer can push through `encodeURIComponent`. */
export const MAX_MAIL_BODY = 8_000

/**
 * `mailto:` + the compiled recipient + the encoded subject and body.
 *
 * The body is pre-cut to `MAILTO_BODY_BUDGET` because a mail URL that overruns the OS's command
 * line does not error - it opens a truncated mail, or no mail at all. The cut says so in its own
 * last line, and every caller has put the full text on the clipboard before calling this.
 */
export function mailtoUrl(subject: string, body: string): string {
  const cut = shortReport(body, MAILTO_BODY_BUDGET).text
  return `${MAILTO_PREFIX}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(cut)}`
}

/**
 * Validate what the renderer sent and build the URL, or null.
 *
 * Pure, so the refusals are testable without Electron: two strings, both under their caps, and a
 * result that starts with the fixed recipient. The prefix assertion is redundant today (the
 * builder cannot produce anything else) and is kept because it is the invariant the whole channel
 * rests on, and a future edit to the builder must fail here rather than at a user's machine.
 */
export function feedbackMailUrl(subject: unknown, body: unknown): string | null {
  if (typeof subject !== 'string' || subject.length === 0 || subject.length > MAX_MAIL_SUBJECT) return null
  if (typeof body !== 'string' || body.length === 0 || body.length > MAX_MAIL_BODY) return null
  const url = mailtoUrl(subject, body)
  return url.startsWith(MAILTO_PREFIX) ? url : null
}

/**
 * Ask the OS to open the user's mail client on a message to the compiled address.
 *
 * Answers whether the OS accepted it, never throws: a machine with no mail client registered is a
 * user who still has the full report on their clipboard, not an exception for a dialog to render.
 */
export async function openFeedbackMail(subject: unknown, body: unknown): Promise<boolean> {
  const url = feedbackMailUrl(subject, body)
  if (url === null) return false
  try {
    const { shell } = await import('electron')
    await shell.openExternal(url)
    return true
  } catch {
    return false
  }
}
