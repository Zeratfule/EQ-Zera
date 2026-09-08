// ============================================================================
// agentsDoc.test.mts — AGENTS.md stays distilled (JOS-252's self-limiting
// tripwire).
// ============================================================================
//
// WHY. AGENTS.md is context every agent pays for before writing a line. At
// ~29,000 words it cost ~40k tokens per worker, so JOS-252 distilled it to
// essential learnings (~18k words) and moved every long-form war story
// VERBATIM to docs/agents-archive.md with pointers back. This suite is the
// trigger for the NEXT distillation: the file is allowed to grow as new
// learnings land, and when it crosses the ceiling the failure message states
// the protocol for cutting it back down.
//
// THE PROTOCOL (owner-agreed, JOS-252 — quoted by the failure message):
// distillation is done carefully by the integrator, never delegated to a
// worker, never mechanical truncation, archive before cutting.
//
// Concretely: every RULE survives VERBATIM; a rule's war story compresses to
// one line + the Linear ticket id (Linear holds the full history); nothing is
// deleted — long-form histories MOVE to docs/agents-archive.md with pointers
// back, so a cut that proves load-bearing is reversible in one paste.
//
// The word count is `split(/\s+/)` over the whole file — the same measure the
// JOS-252 ticket used to state the ~16-17k target and the 20k ceiling.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const AGENTS_MD = join(ROOT, 'AGENTS.md')
const ARCHIVE_MD = join(ROOT, 'docs', 'agents-archive.md')

/** The hard ceiling (words). The JOS-252 distillation landed ~18k against a
 * ~16-17k target, so there is real headroom for new learnings before this
 * fires — when it does, distill; do not nibble words to sneak under. */
const CEILING_WORDS = 20_000

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length

test('AGENTS.md stays under the 20,000-word ceiling', () => {
  const words = wordCount(readFileSync(AGENTS_MD, 'utf8'))
  assert.ok(
    words <= CEILING_WORDS,
    `AGENTS.md is ${words} words — over the ${CEILING_WORDS}-word ceiling. ` +
      `Time for another distillation pass (see JOS-252). The protocol: ` +
      `distillation is done carefully by the integrator, never delegated to a worker, ` +
      `never mechanical truncation, archive before cutting. ` +
      `Every rule survives verbatim; war stories compress to one line + the Linear ` +
      `ticket id; long-form histories MOVE verbatim to docs/agents-archive.md with ` +
      `pointers back, so any cut is reversible in one paste.`
  )
})

test('the archive that distillation moves history into exists beside it', () => {
  // The protocol is "archive before cutting" — a distilled AGENTS.md whose
  // archive has gone missing would make the next cut a deletion instead of a
  // move, so the archive's existence is part of the tripwire.
  assert.ok(
    existsSync(ARCHIVE_MD),
    'docs/agents-archive.md is missing. AGENTS.md is distilled (JOS-252) and its ' +
      'long-form histories live in that archive; restore it — distillation moves ' +
      'content, it never deletes it.'
  )
})
