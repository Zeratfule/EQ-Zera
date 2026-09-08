// ============================================================================
// feedbackReport.ts — THE PLAIN-TEXT REPORT, for a build that cannot POST one.
// ============================================================================
//
// WHY THIS FILE EXISTS. `src/shared/feedback.ts` owns the JSON `SubmitRequest` — the shape an
// ingest endpoint validates. This fork compiles in NO endpoint (`COMPILED_FEEDBACK_API_URL = ''`,
// src/main/feedback/net.ts), so the dialog composes, validates and previews a report that has
// nowhere to go. The owner's direction was to route it to a mailbox instead, and a mailbox reads
// TEXT, not a wire envelope. So this is the second rendering of the same facts: the words the
// user typed, the build they typed them on, the perf timeline, and an honest statement of which
// attachments were prepared.
//
// LAWS THIS FILE OBEYS:
//   * PURE. Relative value imports only (the mobSearch.ts precedent, repo-wide) — it is imported
//     by the renderer dialog, by the main process's mail opener and by the node test runner, and
//     none of those three may drag in Electron or a bundler alias to read it.
//   * IT NEVER CLAIMS TO CARRY A FILE. A mailto: body cannot hold an attachment and a GitHub
//     issue body cannot either, so the attachments block STATES what was prepared and says the
//     log slice is a file the user attaches by hand. Saying "attached" would be a lie the user
//     only discovers after sending.
//   * TRUNCATION IS VISIBLE. `shortReport` cuts on a LINE boundary and says so in the text it
//     returns. The full text is always on the clipboard by then, and the note says that too.
//   * NO EM DASHES in anything a person reads (AGENTS.md UI conventions, pinned by
//     tests/copyNoEmDash.test.mts, which scans all of `src/shared`).

import { formatPerfBlock } from './feedbackPerf'
import type { AchievementsDumpMeta, InventoryDumpMeta } from './feedbackAttachments'
import type { FeedbackDraft, FeedbackEnv, LogSliceMeta } from './feedback'

/**
 * WHERE FEEDBACK GOES IN THIS FORK (owner direction, 2026-09-08). Compiled in, never
 * configurable and never supplied by the renderer: `openFeedbackMail` (src/main/feedback/mail.ts)
 * asserts the built URL starts with exactly this recipient, which is the entire trust story
 * behind opening a `mailto:` at all.
 */
export const FEEDBACK_MAIL_TO = 'Zeratfule@gmail.com'

/** The other way out: this fork's issue tracker. Inside the repo subtree `EXTERNAL_LINK_ALLOWLIST`
 *  (src/main/security.ts) scopes `github.com` to, so the link opens and nothing else on that host
 *  does. */
export const FEEDBACK_ISSUES_URL = 'https://github.com/Zeratfule/EQ-Zera/issues/new'

/**
 * How much report a `mailto:` body may carry.
 *
 * Not a spec number: the URL is handed to the OS, which hands it to whatever mail client is
 * registered, and the shortest ceiling in that chain (a Windows shell command line, historically
 * ~2,048 characters) applies to the WHOLE encoded URL. Percent-encoding a report full of newlines
 * roughly doubles it, so the pre-encoding budget is set well under half. Over-running it does not
 * error anywhere: it silently opens a truncated mail, which is why the full text goes on the
 * clipboard first.
 */
export const MAILTO_BODY_BUDGET = 1500

/** Ceiling for a whole issue URL, with headroom under `MAX_LINK_LEN` (2048) in security.ts —
 *  which refuses a longer URL SILENTLY, so the headroom is the difference between a link that
 *  opens and a button that does nothing. */
export const ISSUE_URL_BUDGET = 2000

/** What a cut report says about itself. One line, at the end, where the text stops. */
export const TRUNCATION_NOTE = '(truncated - the full report is on your clipboard)'

/** The one sentence that keeps the attachments block honest. */
export const ATTACH_BY_HAND =
  'Log slices are saved as files and attached by hand - nothing here carries a file.'

export interface ReportInput {
  draft: FeedbackDraft
  env: FeedbackEnv
  log?: LogSliceMeta | null
  inventory?: InventoryDumpMeta | null
  achievements?: AchievementsDumpMeta | null
  appName?: string
}

/** Counts as a person reads them (`1,234`), the same vocabulary the dialog's previews use. */
function count(n: number): string {
  return n.toLocaleString('en-US')
}

/** Compressed size in the previews' units. Bytes are what the metadata carries. */
function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/** Version, channel, platform, OS, arch: the five facts that turn "it broke" into a build. */
function installBlock(env: FeedbackEnv): string {
  return [
    'About this install',
    `  version: ${env.appVersion}`,
    `  channel: ${env.channel} (updates: ${env.updateChannel})`,
    `  platform: ${env.platform}`,
    `  os: ${env.osRelease}`,
    `  arch: ${env.arch}`
  ].join('\n')
}

/**
 * What was prepared, in counts, plus the sentence that says a file is a file. Empty string when
 * nothing was prepared: an attachments block listing no attachments is noise, and a feature
 * request never reads any of these three.
 */
function attachmentsBlock(input: ReportInput): string {
  const rows: string[] = []
  if (input.log) rows.push(`  Log slice: ${count(input.log.lines)} lines, ${size(input.log.bytes)} compressed.`)
  if (input.inventory) {
    rows.push(`  Inventory export: ${count(input.inventory.lines)} rows, ${size(input.inventory.bytes)} compressed.`)
  }
  if (input.achievements) {
    rows.push(
      `  Achievements export: ${count(input.achievements.lines)} rows, ${size(input.achievements.bytes)} compressed.`
    )
  }
  if (rows.length === 0) return ''
  return ['Attachments', ...rows, `  ${ATTACH_BY_HAND}`].join('\n')
}

/**
 * The report as one readable block of text.
 *
 * Order is the reader's, not the assembler's: the words first (that is the report), then the
 * build, then the timeline that says what the machine was doing, then what the reader has to go
 * and fetch. Absent parts render away entirely rather than as empty headings.
 */
export function formatReport(input: ReportInput): string {
  const app = input.appName ?? 'EQ Zera'
  const kind = input.draft.type === 'bug' ? 'bug' : 'feature'
  const blocks = [
    `${app} ${kind} report`,
    input.draft.description,
    installBlock(input.env),
    input.env.perf ? formatPerfBlock(input.env.perf) : '',
    attachmentsBlock(input)
  ]
  return blocks.filter((b) => b !== '').join('\n\n')
}

/**
 * `full`, cut to fit `budgetChars`, on a LINE boundary, saying so.
 *
 * A mid-word cut in a bug report reads as a corrupted message; a mid-LINE cut in the perf block
 * reads as a wrong number. So the cut lands between lines, and the last line is always the note —
 * which also tells the reader where the rest is, because every caller puts the full text on the
 * clipboard before it truncates anything. The returned text is never longer than the budget.
 */
export function shortReport(full: string, budgetChars: number): { text: string; truncated: boolean } {
  if (full.length <= budgetChars) return { text: full, truncated: false }
  const room = budgetChars - TRUNCATION_NOTE.length - 1
  const kept: string[] = []
  let used = 0
  for (const line of full.split('\n')) {
    const cost = kept.length === 0 ? line.length : line.length + 1
    if (used + cost > room) break
    kept.push(line)
    used += cost
  }
  // Not even one line fits: the note alone is the honest answer, clipped to the budget so this
  // function's one invariant (never longer than asked) holds at every size.
  if (kept.length === 0) return { text: TRUNCATION_NOTE.slice(0, Math.max(0, budgetChars)), truncated: true }
  return { text: `${kept.join('\n')}\n${TRUNCATION_NOTE}`, truncated: true }
}

/**
 * A "new issue" URL for this fork's tracker, prefilled, and SHORT ENOUGH TO OPEN.
 *
 * `allowedExternalUrl` (src/main/security.ts) refuses anything over `MAX_LINK_LEN` (2048)
 * SILENTLY — no error, no window, nothing on screen — so a long body does not produce a broken
 * issue, it produces a dead button. This shrinks the body through `shortReport` until the whole
 * encoded URL fits `ISSUE_URL_BUDGET`, which leaves headroom under that ceiling.
 *
 * The loop measures rather than guesses: percent-encoding expands a report full of newlines by an
 * unpredictable factor, so each pass scales the character budget by the expansion it actually
 * observed and always makes progress. Null only when the TITLE alone cannot fit, which is not a
 * state any caller in this app can reach.
 */
export function githubIssueUrl(title: string, body: string): string | null {
  const base = `${FEEDBACK_ISSUES_URL}?title=${encodeURIComponent(title)}&body=`
  if (base.length > ISSUE_URL_BUDGET) return null
  const room = ISSUE_URL_BUDGET - base.length
  let chars = Math.min(body.length, room)
  for (let pass = 0; pass < 24 && chars > 0; pass++) {
    const encoded = encodeURIComponent(shortReport(body, chars).text)
    if (encoded.length <= room) return base + encoded
    const scaled = Math.floor((chars * room) / encoded.length)
    chars = Math.max(0, Math.min(chars - 1, scaled))
  }
  // The title fits and the body does not: an issue with a title and an empty body is still a
  // filed issue, and the full report is on the clipboard to paste into it.
  return base
}
