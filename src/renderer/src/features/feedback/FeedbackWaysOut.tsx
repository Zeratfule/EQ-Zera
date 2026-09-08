// FeedbackWaysOut — the three ways a report leaves a build that cannot POST one.
//
// THIS ROW IS DARK-BUILD ONLY, and that is a decision rather than an omission. A build with an
// ingest endpoint has Send, and Send does everything these three do plus carry the attachments as
// files; offering all four at once would make the user choose between a button that works and
// three that are a worse version of it. If this fork ever compiles in an endpoint, the row should
// be re-judged then, on that build's terms.
//
// What each one is for, and why there are three rather than one:
//   * MAIL is the owner's direction — feedback goes to a mailbox. It is also the only one that
//     reaches someone privately.
//   * A GITHUB ISSUE is the public option, and the one that survives being forgotten about.
//   * COPY is the fallback that cannot fail: no mail client, no browser, no network. It is also
//     what makes the other two honest, because both of them truncate.
//
// EVERY ONE OF THEM PUTS THE FULL REPORT ON THE CLIPBOARD FIRST. A `mailto:` body has a hard
// ceiling in the OS's own command line and an issue URL has one in `MAX_LINK_LEN`, so both can
// carry a cut report; the clipboard carries the whole thing (main's clipboard channel takes up to
// a million characters). The truncation note in the cut text says where the rest is.
//
// Attachments are NOT carried by any of the three. Neither a mail URL nor an issue URL can hold a
// file, so the report's attachments block states what was prepared and tells the reader that a
// saved log slice is attached by hand. Saying "attached" would be a lie found out after sending.

import { useEffect, useState, type JSX } from 'react'
import { Button, Stack, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { FEEDBACK_MAIL_TO, formatReport, githubIssueUrl } from '@shared/feedbackReport'
import { copyText } from '../../lib/clipboard'
import type { FeedbackAttachments, FeedbackContext, FeedbackState } from './useFeedback'

/** What the status line says when the OS took the mail. State, never process. */
const MAIL_OPENED =
  'Your mail app opened with the report; the full text is on your clipboard - attach any saved ' +
  'log slice by hand.'

/** …and when it did not. The clipboard still has everything, so this is an alternative, not an
 *  apology. The address is INTERPOLATED from the same constant main asserts on, so the sentence
 *  can never name a mailbox the app does not actually open. */
const MAIL_REFUSED =
  `No mail app opened. The full report is on your clipboard - paste it into a mail to ${FEEDBACK_MAIL_TO}.`

/** The issue link is dead when the URL cannot be built at all; the caption says what to do
 *  instead rather than leaving a greyed button with no explanation. */
const ISSUE_UNAVAILABLE = 'Copy the report and paste it into a new issue.'

/**
 * The report as text, for whichever door the user picks. Built on demand from the same three
 * previews the dialog is already showing, so what leaves is what was on screen.
 */
function buildReport(
  state: FeedbackState,
  ctx: FeedbackContext,
  attachments: FeedbackAttachments
): string {
  return formatReport({
    draft: state.draft,
    env: ctx.env,
    log: attachments.log.slice,
    inventory: attachments.inventory.dump?.meta ?? null,
    achievements: attachments.achievements.dump?.meta ?? null
  })
}

/** `EQ Zera bug report - v1.7.0`. The version is in the subject because it is the first thing
 *  the reader needs and the last thing a person remembers to include. */
function mailSubject(state: FeedbackState, ctx: FeedbackContext): string {
  return `EQ Zera ${state.fields.type} report - v${ctx.env.appVersion}`
}

/** The copy button's transient state: a label that says "Copied" for a moment, the CopyButton
 *  precedent in features/combat. No toast - a copy is not an event worth a banner. */
function useCopied(): { copied: boolean; markCopied: (ok: boolean) => void } {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return {
    copied,
    markCopied: (ok: boolean) => {
      if (ok) setCopied(true)
    }
  }
}

export interface FeedbackWaysOutProps {
  state: FeedbackState
  ctx: FeedbackContext
  attachments: FeedbackAttachments
}

export default function FeedbackWaysOut({
  state,
  ctx,
  attachments
}: FeedbackWaysOutProps): JSX.Element {
  const [status, setStatus] = useState<string | null>(null)
  const { copied, markCopied } = useCopied()
  // The SAME gate as Send: the shared validator's verdict, so a report that could not be sent
  // cannot be mailed either. A half-written draft in the owner's inbox is a report nobody can act
  // on, and the description field is already saying why.
  const blocked = state.problem !== null
  const report = buildReport(state, ctx, attachments)
  const issueUrl = githubIssueUrl(mailSubject(state, ctx), report)

  const mail = (): void => {
    // Clipboard FIRST, always: the mail body is cut to fit the OS's URL ceiling, and the status
    // line's promise that "the full text is on your clipboard" has to be true before the mail
    // client opens on top of this window.
    void copyText(report)
      .then(async () => await window.eq.openFeedbackMail(mailSubject(state, ctx), report))
      .then((opened) => {
        setStatus(opened ? MAIL_OPENED : MAIL_REFUSED)
      })
      .catch(() => {
        setStatus(MAIL_REFUSED)
      })
  }

  return (
    <Stack spacing={0.75} data-testid="feedback-ways-out">
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button
          size="small"
          variant="contained"
          disabled={blocked}
          data-testid="feedback-mail"
          startIcon={<MailOutlineIcon fontSize="small" />}
          onClick={mail}
        >
          Send by email
        </Button>
        <Button
          size="small"
          variant="outlined"
          component="a"
          href={issueUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          disabled={blocked || issueUrl === null}
          data-testid="feedback-issue"
          endIcon={<OpenInNewIcon fontSize="small" />}
          // The issue body is cut to fit the link ceiling, so the whole report goes on the
          // clipboard on the way out - the same promise the mail button makes.
          onClick={() => void copyText(report)}
        >
          Open a GitHub issue
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={blocked}
          data-testid="feedback-copy"
          startIcon={<ContentCopyIcon fontSize="small" />}
          onClick={() => void copyText(report).then(markCopied)}
        >
          {copied ? 'Copied' : 'Copy report'}
        </Button>
      </Stack>
      {issueUrl === null && (
        <Typography variant="caption" color="text.secondary" data-testid="feedback-issue-note">
          {ISSUE_UNAVAILABLE}
        </Typography>
      )}
      {status !== null && (
        <Typography variant="caption" color="text.secondary" data-testid="feedback-mail-status">
          {status}
        </Typography>
      )}
    </Stack>
  )
}
