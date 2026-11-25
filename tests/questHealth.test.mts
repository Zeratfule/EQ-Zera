// THE QUEST DATA HEALTH GATE: scripts/questHealth.mts (the judging), scripts/sources/questPageAudit.ts
// (the page checks) and scripts/check-quest-health.mts (the runner refresh:data calls).
//
// Three kinds of pin. SYNTHETIC before/after catalogs drive every comparison rule, the absolute
// rules, the floors and the allowlist (including a stale entry failing). A REPLAY: the parser as it
// stood on 2026-11-23 — headings `==` and deeper only, no "Summary", no "Starts In" — handed to the
// page checks over the REAL cached Nektropos pages, which must fail; that is the incident this gate
// exists for. And the LAW: today's catalog, rebuilt offline from the committed cache, passes the gate
// against the committed quests.json, so a parser change that thins the data goes red here first.
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import type { QuestEntry } from '../src/shared/questTypes'
import {
  FLOORS,
  absoluteFindings,
  applyAllowlist,
  compareCatalogs,
  formatHealth,
  judgeQuestHealth,
  type Floor
} from '../scripts/questHealth.mjs'
import { auditQuestPage, PARSER, type ParserView } from '../scripts/sources/questPageAudit'
import { parseQuestPage } from '../scripts/sources/questPage'
import { buildQuestCatalog } from '../scripts/sources/questEntry'
import { cachedItemFilter, cachedQuestPages, checkQuestHealth, loadAllowlist } from '../scripts/check-quest-health.mjs'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import type { QuestData } from '../src/shared/types'

const q = (page: string, extra: Partial<QuestEntry> = {}): QuestEntry => ({ name: page, page, steps: ['a', 'b', 'c', 'd'], ...extra })
const rules = (fs: readonly { rule: string; page: string }[]): string[] => fs.map((f) => `${f.rule}:${f.page}`).sort()

test('COMPARE: each regression is its own named finding, and an unchanged catalog has none', () => {
  const full = (page: string): QuestEntry =>
    q(page, { startZone: 'Qeynos', giver: 'Guard', rewards: [{ name: 'Ring' }], requiredItems: ['Rat Ear'], groundSpawns: [{ item: 'Key', ns: 1, ew: 2 }] })
  const prev = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].map(full)
  assert.deepEqual(compareCatalogs(prev, prev), [])
  const next = [
    { ...full('A'), steps: undefined }, // lost every step
    { ...full('B'), steps: ['a'] }, // 4 -> 1: more than half gone
    { ...full('C'), steps: ['a', 'b'] }, // 4 -> 2: exactly half is not "more than half"
    { ...full('D'), startZone: undefined },
    { ...full('E'), giver: undefined },
    { ...full('F'), rewards: undefined },
    { ...full('G'), requiredItems: [] },
    { ...full('H'), groundSpawns: undefined }
    // I disappeared
  ]
  assert.deepEqual(rules(compareCatalogs(prev, next)), [
    'lost-giver:E',
    'lost-ground-spawns:H',
    'lost-required-items:G',
    'lost-rewards:F',
    'lost-start-zone:D',
    'lost-steps:A',
    'quest-removed:I',
    'steps-halved:B'
  ])
  // Gaining is never a finding.
  assert.deepEqual(compareCatalogs([q('A', { steps: ['a'] })], [full('A')]), [])
})

test('ABSOLUTE: a quest with no steps is a finding; a floor names its measured share', () => {
  const floors: Floor[] = [
    { name: 'with steps', has: (x) => (x.steps?.length ?? 0) > 0, min: 0.9 },
    { name: 'quests', has: () => true, minCount: 3 }
  ]
  const cat = [q('A'), q('B', { steps: [] })]
  const found = absoluteFindings(cat, floors)
  assert.deepEqual(rules(found), ['floor:(catalog)', 'floor:(catalog)', 'no-steps:B'])
  assert.ok(found.some((f) => f.detail === 'with steps: 1/2 (50.0%), floor 90%'), JSON.stringify(found))
  assert.ok(found.some((f) => f.detail === 'quests: 2, floor 3'))
})

test('ALLOWLIST: an entry with a reason covers its page + rule only; a stale absolute entry FAILS, a stale comparison one is a note', () => {
  const findings = [
    { page: 'A', rule: 'no-steps' as const, detail: '' },
    { page: 'B', rule: 'no-steps' as const, detail: '' }
  ]
  const r = applyAllowlist(findings, [{ page: 'A', rule: 'no-steps', reason: 'an item page' }])
  assert.equal(r.ok, false)
  assert.deepEqual(rules(r.failures), ['no-steps:B'])
  assert.deepEqual(r.allowed.map((a) => a.reason), ['an item page'])
  // The same page under another rule is NOT covered, and a blank reason covers nothing.
  assert.equal(applyAllowlist([{ page: 'A', rule: 'lost-giver', detail: '' }], [{ page: 'A', rule: 'no-steps', reason: 'x' }]).failures.length, 1)
  assert.equal(applyAllowlist([{ page: 'A', rule: 'no-steps', detail: '' }], [{ page: 'A', rule: 'no-steps', reason: ' ' }]).ok, false)
  // Stale entries.
  const staleAbsolute = applyAllowlist([], [{ page: 'Z', rule: 'unknown-label', reason: 'fixed since' }])
  assert.equal(staleAbsolute.ok, false)
  const staleCompare = applyAllowlist([], [{ page: 'Z', rule: 'lost-steps', reason: 'a wiki rewrite, reviewed' }])
  assert.equal(staleCompare.ok, true)
  assert.equal(staleCompare.stale.length, 1)
})

test('JUDGE + FORMAT: a failing run says FAIL, names each finding, and says where the fix goes', () => {
  const prev = [q('A', { giver: 'Guard' })]
  const r = judgeQuestHealth({ prev, next: [q('A')], pageFindings: [], allow: [], floors: [] })
  assert.equal(r.ok, false)
  const text = formatHealth(r).join('\n')
  assert.match(text, /^quest data health: FAIL/)
  assert.match(text, /FAIL lost-giver: A - present before, absent now/)
  assert.match(text, /questPage\.ts/)
  // No previous catalog (a first scrape): no comparisons, only the absolutes.
  assert.equal(judgeQuestHealth({ prev: null, next: [q('A')], pageFindings: [], allow: [], floors: [] }).ok, true)
})

test('PAGE CHECKS, INLINE: an unseen heading, an unread step heading, an unread list, an unknown label', () => {
  const top = "{| class=\"questTopTable\"\n! ''' Start Zone: '''\n| [[Qeynos]]\n|-\n! ''' Quest Giver: '''\n| Guard\n|-\n! ''' Item Location: '''\n| (1, 2)\n|}\n"
  const wt = `${top}== Walkthrough ==\nHail the guard.\n== Checklist =={{CheckboxList}}\n* Kill a rat\n== Quick Steps ==\n* Kill a rat\n`
  const found = auditQuestPage('P', wt, parseQuestPage('P', wt).steps.length)
  assert.deepEqual(rules(found), ['unknown-label:P', 'unparsed-heading:P', 'unread-step-heading:P', 'unread-step-heading:P'])
  // A page whose only content is a list the parser never read.
  const listOnly = `${top}== Getting Started ==\n'''Part one'''\n{{CheckboxList}}\n* one\n* two\n`
  assert.ok(rules(auditQuestPage('L', listOnly, 0)).includes('unread-list:L'))
  // A page with no recognised step heading reads every section (the fallback): nothing is unread.
  const fallback = `${top}== The War ==\n* one\n== Checklists ==\n* two\n`
  assert.deepEqual(rules(auditQuestPage('F', fallback, parseQuestPage('F', fallback).steps.length)), ['unknown-label:F'])
})

/** The parser as it stood on 2026-11-23, before cba516d: `==`+ headings, no Summary, no Starts In. */
const PARSER_2026_11_23: ParserView = {
  heading: /^\s*(={2,6})\s*([^=\s][^=]*?)\s*={2,6}\s*$/,
  stepHeadings: PARSER.stepHeadings.filter((re) => re.source !== '^summary$'),
  labels: PARSER.labels.filter((l) => l !== 'starts in')
}

test('REPLAY: the 2026-11-23 parser over the REAL cached Nektropos pages fails the gate, page by page', () => {
  const pages = cachedQuestPages().filter((p) => p.wikitext !== null && /^=[^=].*[^=]=\s*$/m.test(p.wikitext))
  assert.ok(pages.length >= 15, `the level-1 heading pages are cached (${String(pages.length)})`)
  const old = pages.flatMap((p) => auditQuestPage(p.title, p.wikitext ?? '', 1, PARSER_2026_11_23))
  const flagged = new Set(old.filter((f) => f.rule === 'unparsed-heading').map((f) => f.page))
  assert.equal(flagged.size, pages.length, 'every level-1 heading page is named')
  assert.ok(old.some((f) => f.rule === 'unknown-label' && f.detail === 'starts in'), 'the Starts In label is named')
  assert.ok(old.some((f) => f.page === 'The Tragic Tale of House Everling' && f.rule === 'unknown-label'))
  // Today's parser reads them all: none of these pages has a finding.
  const now = pages.flatMap((p) => auditQuestPage(p.title, p.wikitext ?? '', 1))
  assert.deepEqual(now, [])
})

test('LAW: today’s catalog, rebuilt offline from the committed cache, passes the gate against the committed quests.json', () => {
  const committed = (questsJson as unknown as QuestData).quests
  const rebuilt = buildQuestCatalog(cachedQuestPages(), cachedItemFilter()).quests
  const r = checkQuestHealth(committed, rebuilt)
  assert.ok(r.ok, formatHealth(r).join('\n'))
  // …and the committed file IS that rebuild: nobody hand-edited it or forgot to refresh it.
  assert.equal(JSON.stringify(rebuilt), JSON.stringify(committed))
  // Every floor holds with room, and every allowlist entry is used (none stale).
  assert.equal(r.stale.length, 0)
  assert.ok(FLOORS.length >= 8)
  for (const e of loadAllowlist()) assert.ok(e.reason.length >= 20, `a reviewed reason for ${e.page}`)
})
