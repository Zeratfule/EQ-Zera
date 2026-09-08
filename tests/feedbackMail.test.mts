// ============================================================================
// feedbackMail.test.mts — the one door that can open a mail client, and its fixed recipient.
// ============================================================================
//
// WHAT IS ACTUALLY AT STAKE. `src/main/security.ts` is https-ONLY and refuses `mailto:` by law —
// tests/security.test.mts pins that refusal and this suite does not touch it. `feedback:openMail`
// exists BESIDE that function, and the reason it is not a hole is a single property: the renderer
// supplies no address, no scheme and no URL, so the set of things this channel can open has
// exactly one member. That property is what these tests are for.
//
// WHY THE OPENER IS TESTABLE HERE AT ALL: `src/main/feedback/mail.ts` imports Electron LAZILY,
// inside the one line that needs it (a top-level `import { shell } from 'electron'` makes a module
// unimportable in the node runner — "does not provide an export named 'shell'"). So the builder,
// the caps and every refusal path run here with no Electron; the only thing this suite cannot
// reach is the `shell.openExternal` call itself, which is one line behind a URL these tests have
// already proved.
//
// No Electron, no network, no fixtures — this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAILTO_PREFIX,
  MAX_MAIL_BODY,
  MAX_MAIL_SUBJECT,
  feedbackMailUrl,
  mailtoUrl,
  openFeedbackMail
} from '../src/main/feedback/mail'
import { FEEDBACK_MAIL_TO, MAILTO_BODY_BUDGET, TRUNCATION_NOTE } from '../src/shared/feedbackReport'

const SUBJECT = 'EQ Zera bug report - v1.7.0'

test('the recipient is COMPILED IN and is the first thing in the URL', () => {
  assert.equal(MAILTO_PREFIX, `mailto:${FEEDBACK_MAIL_TO}?`)
  assert.equal(FEEDBACK_MAIL_TO, 'Zeratfule@gmail.com')
  assert.ok(mailtoUrl(SUBJECT, 'a report').startsWith('mailto:Zeratfule@gmail.com?'))
})

test('subject and body are percent-encoded, newlines included', () => {
  const url = mailtoUrl('a & b', 'first line\nsecond line')
  assert.ok(url.includes('subject=a%20%26%20b'))
  assert.ok(url.includes('body=first%20line%0Asecond%20line'))
  // A raw newline in a URL handed to the OS is the shape that gets a command line split in two.
  assert.ok(!url.includes('\n'))
})

test('the body is cut to the mail budget, and the cut says so', () => {
  const body = Array.from({ length: 400 }, (_, i) => `line ${String(i)} of a long report`).join('\n')
  assert.ok(body.length > MAILTO_BODY_BUDGET)
  const url = mailtoUrl(SUBJECT, body)
  assert.ok(url.includes(encodeURIComponent(TRUNCATION_NOTE)))
  // What the OS receives is the ENCODED string; the budget is on the text, and the point of the
  // budget is that the encoded whole stays inside a Windows command line.
  const encoded = url.slice(url.indexOf('&body=') + '&body='.length)
  assert.ok(decodeURIComponent(encoded).length <= MAILTO_BODY_BUDGET)
})

test('a report that fits is carried whole, with no note bolted on', () => {
  const url = mailtoUrl(SUBJECT, 'The overlay meter goes blank when I zone.')
  assert.ok(url.endsWith(encodeURIComponent('The overlay meter goes blank when I zone.')))
  assert.ok(!url.includes(encodeURIComponent(TRUNCATION_NOTE)))
})

// ---- what the boundary refuses -----------------------------------------------------------

test('feedbackMailUrl takes two strings and nothing else', () => {
  assert.equal(feedbackMailUrl(undefined, 'body'), null)
  assert.equal(feedbackMailUrl(null, 'body'), null)
  assert.equal(feedbackMailUrl(42, 'body'), null)
  assert.equal(feedbackMailUrl({ toString: () => 'x' }, 'body'), null)
  assert.equal(feedbackMailUrl(SUBJECT, undefined), null)
  assert.equal(feedbackMailUrl(SUBJECT, 12), null)
  assert.equal(feedbackMailUrl(SUBJECT, ['a']), null)
})

test('…and refuses empty or over-cap values on both', () => {
  assert.equal(feedbackMailUrl('', 'body'), null)
  assert.equal(feedbackMailUrl(SUBJECT, ''), null)
  assert.equal(feedbackMailUrl('s'.repeat(MAX_MAIL_SUBJECT + 1), 'body'), null)
  assert.equal(feedbackMailUrl(SUBJECT, 'b'.repeat(MAX_MAIL_BODY + 1)), null)
  // At the cap exactly, both are accepted — the boundary is a limit, not an off-by-one.
  assert.ok(feedbackMailUrl('s'.repeat(MAX_MAIL_SUBJECT), 'body') !== null)
  assert.ok(feedbackMailUrl(SUBJECT, 'b'.repeat(MAX_MAIL_BODY)) !== null)
})

test('a renderer-supplied URL cannot become the recipient, whatever it says', () => {
  // The renderer has no address parameter at all, so the worst it can do is put one in the text.
  const url = feedbackMailUrl('evil@example.com?to=evil@example.com', 'mailto:evil@example.com')
  assert.ok(url !== null)
  assert.ok(url.startsWith(MAILTO_PREFIX))
  // Everything hostile is inside the ENCODED query, where it is text.
  assert.equal(url.indexOf('mailto:'), url.lastIndexOf('mailto:'))
  assert.ok(!url.includes('@example.com?'))
})

test('openFeedbackMail answers false for input it refused, without asking the OS anything', async () => {
  // Electron is never reached on these paths, which is exactly why they can be asserted here.
  assert.equal(await openFeedbackMail(undefined, 'body'), false)
  assert.equal(await openFeedbackMail(SUBJECT, undefined), false)
  assert.equal(await openFeedbackMail(7, 8), false)
  assert.equal(await openFeedbackMail('', ''), false)
  assert.equal(await openFeedbackMail('s'.repeat(MAX_MAIL_SUBJECT + 1), 'body'), false)
  assert.equal(await openFeedbackMail(SUBJECT, 'b'.repeat(MAX_MAIL_BODY + 1)), false)
})

test('openFeedbackMail never throws when there is no Electron to ask', async () => {
  // Outside Electron the lazy `import('electron')` fails; the contract is a `false`, not a
  // rejection, because a machine with no mail client is a user who still has the clipboard.
  assert.equal(await openFeedbackMail(SUBJECT, 'a real report'), false)
})
