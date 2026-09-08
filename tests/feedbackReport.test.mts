// ============================================================================
// feedbackReport.test.mts — the PLAIN-TEXT report, and the two ceilings it has to fit under.
// ============================================================================
//
// This fork compiles in no ingest endpoint, so the only ways a report leaves the app are a
// `mailto:` URL, a GitHub issue URL and the clipboard. Two of those three have a HARD, SILENT
// ceiling:
//
//   * an issue URL over `MAX_LINK_LEN` (2048) is refused by `allowedExternalUrl`
//     (src/main/security.ts) with no error and no window — a dead button, not a broken issue;
//   * a `mailto:` URL over the OS's command-line ceiling opens a truncated mail, or none.
//
// So the properties pinned here are not cosmetic: the URL builder must FIT whatever it is given
// (a 4,000-character description is a legal draft — `MAX_DESCRIPTION`), the cut must land on a
// line boundary, and the cut text must SAY it was cut, because the full text is on the clipboard
// by then and the reader has to know to look.
//
// Pure module, relative import, no Electron and no fixtures — this suite never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FeedbackDraft, FeedbackEnv } from '../src/shared/feedback'
import {
  ATTACH_BY_HAND,
  FEEDBACK_ISSUES_URL,
  FEEDBACK_MAIL_TO,
  ISSUE_URL_BUDGET,
  MAILTO_BODY_BUDGET,
  TRUNCATION_NOTE,
  formatReport,
  githubIssueUrl,
  shortReport
} from '../src/shared/feedbackReport'

const ENV: FeedbackEnv = {
  appVersion: '1.7.0',
  channel: 'prod',
  updateChannel: 'main',
  platform: 'win32',
  osRelease: '10.0.26200',
  arch: 'x64',
  electron: '31.0.0',
  chrome: '126.0.0',
  node: '20.14.0'
}

const DRAFT: FeedbackDraft = {
  type: 'bug',
  description: 'The overlay meter goes blank right after I zone into Plane of Sky.'
}

// ---- formatReport -----------------------------------------------------------------------

test('formatReport states the kind, the words, and the build', () => {
  const text = formatReport({ draft: DRAFT, env: ENV })
  assert.match(text, /^EQ Zera bug report\n/)
  assert.ok(text.includes(DRAFT.description))
  assert.ok(text.includes('About this install'))
  assert.ok(text.includes('version: 1.7.0'))
  assert.ok(text.includes('channel: prod'))
  assert.ok(text.includes('platform: win32'))
  assert.ok(text.includes('os: 10.0.26200'))
  assert.ok(text.includes('arch: x64'))
})

test('a feature request is titled as one', () => {
  const text = formatReport({
    draft: { type: 'feature', description: 'A per-character bank search would save me an hour.' },
    env: ENV
  })
  assert.match(text, /^EQ Zera feature report\n/)
})

test('the app name is a parameter, not a hardcoded word', () => {
  const text = formatReport({ draft: DRAFT, env: ENV, appName: 'EQ Legends Companion' })
  assert.match(text, /^EQ Legends Companion bug report\n/)
})

test('the perf block is present only when the session carried a timeline', () => {
  assert.ok(!formatReport({ draft: DRAFT, env: ENV }).includes('perf (last'))
  // The block's own renderer is `formatPerfBlock`; what is pinned here is that `env.perf` reaches
  // it, not how it formats — feedbackPerf.test.mts owns that.
  const perf: NonNullable<FeedbackEnv['perf']> = {
    intervalMs: 10_000,
    rows: [
      { t: 0, mainMaxLateMs: 120, workerMaxLateMs: 4, tailMaxMs: 8, tailReads: 3, tailReopens: 0 }
    ],
    summary: { p95MainMs: 110, maxMainMs: 120, over500: 0, coincident: 0 },
    state: {
      cpuCount: 8,
      totalMemGb: 32,
      freeMemMb: 9000,
      gpuVendor: 'nvidia',
      gpuCompositing: 'gpu',
      eqWindowMode: 'windowed',
      overlaysOpen: 2,
      overlaysLocked: 1,
      presenceOn: true,
      ringOn: false,
      workingSetMb: 240
    }
  }
  const text = formatReport({ draft: DRAFT, env: { ...ENV, perf } })
  assert.ok(text.includes('perf (last'))
  assert.ok(text.includes('machine:'))
})

test('the attachments block names what was prepared, with its counts, and says a file is a file', () => {
  const text = formatReport({
    draft: DRAFT,
    env: ENV,
    log: { bytes: 46_694, lines: 12_034, dropped: 812, fromMs: 1, toMs: 2, sha256: 'a'.repeat(64) },
    inventory: { bytes: 3_277, lines: 295, updatedAt: 3, sha256: 'b'.repeat(64) },
    achievements: { bytes: 5_120, lines: 1_012, updatedAt: 4, sha256: 'c'.repeat(64) }
  })
  assert.ok(text.includes('Attachments'))
  assert.match(text, /Log slice: 12,034 lines, 45\.6 KB compressed\./)
  assert.match(text, /Inventory export: 295 rows, 3\.2 KB compressed\./)
  assert.match(text, /Achievements export: 1,012 rows, 5\.0 KB compressed\./)
  // The honesty clause: neither a mail body nor an issue body can carry a file.
  assert.ok(text.includes(ATTACH_BY_HAND))
})

test('…and the block is ABSENT entirely when nothing was prepared', () => {
  const text = formatReport({ draft: DRAFT, env: ENV, log: null, inventory: null })
  assert.ok(!text.includes('Attachments'))
  assert.ok(!text.includes(ATTACH_BY_HAND))
})

test('one attachment lists one row, not three', () => {
  const text = formatReport({
    draft: DRAFT,
    env: ENV,
    inventory: { bytes: 3_277, lines: 295, updatedAt: 3, sha256: 'b'.repeat(64) }
  })
  assert.ok(text.includes('Inventory export:'))
  assert.ok(!text.includes('Log slice:'))
  assert.ok(!text.includes('Achievements export:'))
})

// ---- shortReport ------------------------------------------------------------------------

test('a report under the budget is returned untouched and says so', () => {
  const full = 'one\ntwo\nthree'
  assert.deepEqual(shortReport(full, 100), { text: full, truncated: false })
})

test('a cut lands on a LINE boundary, fits the budget, and marks itself', () => {
  const full = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30), 'd'.repeat(30)].join('\n')
  const cut = shortReport(full, 90)
  assert.equal(cut.truncated, true)
  assert.ok(cut.text.length <= 90, `${String(cut.text.length)} chars`)
  const lines = cut.text.split('\n')
  assert.equal(lines[lines.length - 1], TRUNCATION_NOTE)
  // Every kept line is a WHOLE line of the original — no half-lines, ever.
  for (const line of lines.slice(0, -1)) assert.ok(full.split('\n').includes(line), line)
})

test('the note names the clipboard, because that is where the rest actually is', () => {
  assert.ok(TRUNCATION_NOTE.includes('clipboard'))
  // AGENTS.md UI law: no em dashes in copy. (tests/copyNoEmDash.test.mts scans src/**; this is
  // the one string here whose whole job is to be read mid-sentence.)
  assert.ok(!/[–—]/.test(TRUNCATION_NOTE))
})

test('a budget too small for even one line still returns something that fits', () => {
  const cut = shortReport('a very long single line that fits nothing', 12)
  assert.equal(cut.truncated, true)
  assert.ok(cut.text.length <= 12)
})

test('the mail budget is well under a Windows command line, with room for encoding', () => {
  // Percent-encoding a report full of newlines roughly doubles it; the whole URL has to survive
  // the OS's ~2,048-character ceiling.
  assert.ok(MAILTO_BODY_BUDGET < 2048 / 1.3)
})

// ---- githubIssueUrl ---------------------------------------------------------------------

/** A legal maximum-length draft: `MAX_DESCRIPTION` is 4,000 characters. */
function hugeReport(): string {
  const description = Array.from({ length: 200 }, (_, i) => `line ${String(i)} of a long report`).join('\n')
  return formatReport({
    draft: { type: 'bug', description },
    env: ENV,
    log: { bytes: 46_694, lines: 12_034, dropped: 812, fromMs: 1, toMs: 2, sha256: 'a'.repeat(64) }
  })
}

test('an issue URL points at THIS fork and fits the budget for a 4,000-character report', () => {
  const body = hugeReport()
  assert.ok(body.length > 4_000, `${String(body.length)} chars of report`)
  const url = githubIssueUrl('EQ Zera bug report - v1.7.0', body)
  assert.ok(url !== null)
  assert.ok(url.startsWith(`${FEEDBACK_ISSUES_URL}?title=`))
  assert.ok(url.length <= ISSUE_URL_BUDGET, `${String(url.length)} chars`)
  // …which is what keeps it under `MAX_LINK_LEN`, where a longer URL is refused SILENTLY.
  assert.ok(url.length <= 2048)
})

test('a short report is carried WHOLE, not cut to a fixed size', () => {
  const body = formatReport({ draft: DRAFT, env: ENV })
  const url = githubIssueUrl('EQ Zera bug report - v1.7.0', body)
  assert.ok(url !== null)
  assert.ok(url.includes(encodeURIComponent(DRAFT.description)))
  assert.ok(!url.includes(encodeURIComponent(TRUNCATION_NOTE)))
})

test('a body that has to be cut still produces a URL under the ceiling, marked as cut', () => {
  const body = hugeReport()
  const url = githubIssueUrl('EQ Zera bug report - v1.7.0', body)
  assert.ok(url !== null)
  assert.ok(url.length <= ISSUE_URL_BUDGET)
  assert.ok(url.includes(encodeURIComponent(TRUNCATION_NOTE)))
})

test('it is never null for a sane title, however hostile the body', () => {
  const nasty = ' \n\t& ? # % = + '.repeat(400)
  const url = githubIssueUrl('EQ Zera bug report - v1.7.0', nasty)
  assert.ok(url !== null)
  assert.ok(url.length <= ISSUE_URL_BUDGET)
})

test('…and null only when the TITLE alone cannot fit', () => {
  assert.equal(githubIssueUrl('t'.repeat(ISSUE_URL_BUDGET), 'body'), null)
})

test('the mail recipient is the compiled address the owner asked for', () => {
  assert.equal(FEEDBACK_MAIL_TO, 'Zeratfule@gmail.com')
})
