// THE THREE WAYS OUT of a DARK build (mail / GitHub issue / clipboard), driven in the real app.
//
// This fork compiles in no ingest endpoint (`COMPILED_FEEDBACK_API_URL = ''`), so the dialog's
// Send button is honestly disabled and the report leaves by one of three doors instead. What each
// assertion here is about is a SEAM, which is why they are not unit tests:
//   * the gate  — the three buttons run the SAME `validateDraft` verdict Send does, which is
//                 renderer state and can only be watched flipping in a running dialog;
//   * the link  — the issue `href` in the DOM is the string main will hand to `allowedExternalUrl`,
//                 which refuses an over-long or off-repo URL SILENTLY (a dead button, no error);
//   * the copy  — "Copied" appears only after MAIN answers that the text reached the OS clipboard,
//                 an IPC hop into Electron's `clipboard` module.
// The pure halves (`formatReport`, `githubIssueUrl`, `mailtoUrl`) are pinned with no app running
// in tests/feedbackReport.test.mts and tests/feedbackMail.test.mts.
//
// SEND BY EMAIL IS NEVER CLICKED. It asks the OS to open a mail client, and a CI runner is not the
// place to discover which one is registered. Its presence and its gate are asserted; the URL it
// would build is pinned where no OS is involved.
//
// Its own module because tests/e2e/feedback.e2e.mts sits at the repo's max-lines budget: split,
// never ratchet (the combatPrefsSteps.mts precedent, same reason).

import type { Page } from 'playwright-core'
import { check, countOf, settle } from './appHarness.mjs'

export const MAIL = '[data-testid="feedback-mail"]'
export const ISSUE = '[data-testid="feedback-issue"]'
export const COPY = '[data-testid="feedback-copy"]'

const WAYS_OUT = [MAIL, ISSUE, COPY]

/** The prefilled issue link's one legal shape. Anything else is a button that opens nothing. */
const ISSUE_PREFIX = 'https://github.com/Zeratfule/EQ-Zera/issues/new?title='

export interface WaysOutDeps {
  /** The spec's own reader, so both files agree on what a disabled MUI button looks like. */
  disabledState: (page: Page, selector: string) => Promise<boolean | null>
  /** …and its own typist, which waits for MUI's helper text to catch up with the keystrokes. */
  setDescription: (page: Page, text: string) => Promise<void>
  textOf: (page: Page, selector: string) => Promise<string>
}

/** Are all three ways out in the state we expect? A missing button (`null`) is never that state. */
async function allWaysOut(page: Page, want: boolean, deps: WaysOutDeps): Promise<boolean> {
  for (const sel of WAYS_OUT) {
    if ((await deps.disabledState(page, sel)) !== want) return false
  }
  return true
}

/** The issue link, as main will actually see it. */
async function stepIssueLink(page: Page): Promise<void> {
  const href = await page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLAnchorElement | null)?.href ?? '',
    ISSUE
  )
  check(
    'the issue link is prefilled, points inside this fork, and is short enough for main to open it',
    href.startsWith(ISSUE_PREFIX) && href.includes('&body=') && href.length <= 2048,
    `${String(href.length)} chars: ${href.slice(0, 90)}`
  )
}

/**
 * The whole row, from an empty draft to a copy on the clipboard.
 *
 * The draft is left EMPTY on the way out, because the step that follows this one in the spec opens
 * by asserting that an empty report is not sendable.
 */
export async function stepWaysOut(page: Page, deps: WaysOutDeps): Promise<void> {
  let present = true
  for (const sel of WAYS_OUT) present &&= (await countOf(page, sel)) === 1
  if (!check('a build that cannot send offers mail, a GitHub issue and a copy', present)) return

  check(
    '…all three gated by the SAME validator Send is: an empty draft opens none of them',
    await allWaysOut(page, true, deps)
  )
  await deps.setDescription(page, 'The overlay meter goes blank right after I zone into Plane of Sky.')
  check('…and a valid draft opens all three', await allWaysOut(page, false, deps))

  await stepIssueLink(page)
  await page.click(COPY)
  // "Copied" is main's answer, not the click's: `copyText` resolves false for anything the
  // clipboard handler refused, and the label only changes on true.
  const label = await settle(() => deps.textOf(page, COPY), (t) => /Copied/i.test(t), {
    timeoutMs: 8_000
  })
  check('"Copy report" confirms only what main actually wrote to the clipboard', /Copied/i.test(label), label)
  await deps.setDescription(page, '')
}
