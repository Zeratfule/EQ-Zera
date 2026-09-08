// JOS-348 golden tests: A LOOT TRIGGER KEEPS THE REGEX YOU TYPED.
//
// THE REPORT (01KZZY5J4F82HA9E6909QB3BXX, with a log slice): *an alert with trigger type loot does
// not save the regex field parameter the user entered*. The slice's loot lines say what the user
// was after — `--You have looted a Mote of Major Potential from a ratman warrior's corpse.--`,
// `You looted an Essence of Rathe … and stored it in your tradeskill depot` — an item family, in a
// bag, worth a sound.
//
// IT IS NOT A PERSISTENCE DEFECT, and that was worth establishing before writing a line: the def
// crosses `alerts:save` (main/ipc/alerts.ts sanitizes `cooldownScope` and `earlyWarnSec` and
// nothing else), lands in electron-store through `saveAlert` (main/store.ts) with no JSON schema
// to strip it, and the share/import path rebuilds `where` field by field (shared/shareSchema.ts
// `sanitizeWhere`). Every one of those preserves a `where`. The value never reached them.
//
// IT IS THE PAIR OF BOXES. An 'event' condition is a kind plus ONE optional field matcher, edited
// as two text fields: `Field (optional)` and `Equals or /regex/`. `primitiveFromDraft` can only
// build a `where` when it has BOTH halves — a key of `''` is a field no event carries — so a user
// who read "optional", typed `/^Mote of /` into the value box alone and pressed Add saved an alert
// that fires on EVERY loot line, with the pattern discarded on the way out of the form. Silent, and
// invisible until the dialog is reopened and the box is empty.
//
// WHAT IS PINNED HERE:
//
//  1. THE ROUND TRIP THE USER WANTED. A completed loot condition survives draft → trigger → draft
//     byte for byte, regex and all. This is the assertion the ticket title is about.
//  2. THE LOSS IS REFUSED, NOT REPAIRED. A value with no field name is an INCOMPLETE condition and
//     `conditionFieldKeyErr` says so, which disables Save. The app does NOT infer `item` from
//     `kind: 'loot'`: world-model law 1 forbids the silent guess, and a loot line carries `item`,
//     `source`, `disposition` and `created` — there is no single right answer to guess at.
//  3. THE REFUSAL IS NARROW. A blank pair is still the legitimate "fire on every loot event", a
//     'raw' condition's regex is the whole trigger and can never go missing, and 'app' has no text
//     at all. None of the three may be blocked.
//  4. THE SAVE GATE ACTUALLY CONSULTS IT (source pin). `formCanSave` builds an `AlertForm` around a
//     React sub-form, so the check that it reads `conditionFieldKeyErr` is a source assertion here
//     and a driven one in tests/e2e/alert-loot-regex.e2e.mts.
//
// Run: `npm test`.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  blankCondition,
  conditionFieldKeyErr,
  conditionFieldValErr,
  conditionRawErr,
  draftFromPrimitive,
  primitiveFromDraft,
  triggerBadge,
  type ConditionDraft
} from '../src/renderer/src/features/alerts/conditionDraft'
import type { AlertTriggerPrimitive } from '../src/shared/types'

const src = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8')

/** The condition the report was trying to author: a mote, by item name, as a regex. */
function moteDraft(): ConditionDraft {
  return { ...blankCondition(), ttype: 'event', kind: 'loot', fieldKey: 'item', fieldVal: '/^Mote of /' }
}

// ── 1. the round trip ─────────────────────────────────────────────────────────────────

test('a completed loot condition keeps its regex through draft → trigger', () => {
  const t = primitiveFromDraft(moteDraft())
  assert.deepEqual(t, { type: 'event', kind: 'loot', where: { item: '/^Mote of /' } })
  // The same shape the shipped "Mote dropped" group def carries (shared/alertGroups.ts), which is
  // the proof that what the dialog now produces is authorable by hand at all.
  assert.equal(triggerBadge(t), 'event:loot {item=/^Mote of /}')
})

test('and back again — reopening the alert shows the pattern, not an empty box', () => {
  const back = draftFromPrimitive(primitiveFromDraft(moteDraft()))
  assert.equal(back.kind, 'loot')
  assert.equal(back.fieldKey, 'item')
  assert.equal(back.fieldVal, '/^Mote of /')
})

test('surrounding whitespace is trimmed off the pair, never out of the pattern', () => {
  const d = { ...moteDraft(), fieldKey: ' item ', fieldVal: '  /^Mote of /  ' }
  assert.deepEqual(primitiveFromDraft(d), {
    type: 'event',
    kind: 'loot',
    // The space BEFORE the closing slash is part of the regex and survives; the ones outside
    // the slashes are typing noise and do not.
    where: { item: '/^Mote of /' }
  })
})

// ── 2. the loss is refused, not repaired ──────────────────────────────────────────────

test('a typed value with no field name is an ERROR, so the form cannot swallow it', () => {
  const d = { ...moteDraft(), fieldKey: '' }
  const err = conditionFieldKeyErr(d)
  assert.ok(err, 'the exact combination the report hit must not be silently saveable')
  assert.match(err, /item/, 'the message names the field a loot alert wants, so it is actionable')
  // The proof that the refusal is load-bearing: without it, THIS is what would have been stored.
  assert.deepEqual(primitiveFromDraft(d), { type: 'event', kind: 'loot', where: undefined })
})

test('a whitespace-only field name is a blank one — it names nothing an event carries', () => {
  assert.ok(conditionFieldKeyErr({ ...moteDraft(), fieldKey: '   ' }))
})

test('the app does NOT guess the field from the kind', () => {
  // If a later change ever infers `item` from `kind: 'loot'`, this fails and the inference has to
  // be argued for. A loot event carries item, source, disposition, count and created; picking one
  // for the user is the silent guess world-model law 1 refuses.
  const inferred = primitiveFromDraft({ ...moteDraft(), fieldKey: '' })
  assert.equal(inferred.type === 'event' ? inferred.where : 'not-an-event', undefined)
})

// ── 3. the refusal is narrow ──────────────────────────────────────────────────────────

test('both boxes blank is still "fire on every loot event", and stays saveable', () => {
  const d = { ...moteDraft(), fieldKey: '', fieldVal: '' }
  assert.equal(conditionFieldKeyErr(d), null)
  assert.deepEqual(primitiveFromDraft(d), { type: 'event', kind: 'loot', where: undefined })
})

test('a field name with no value yet is not an error — the user is mid-typing', () => {
  assert.equal(conditionFieldKeyErr({ ...moteDraft(), fieldVal: '' }), null)
})

test('a raw condition is untouched: its regex IS the trigger and cannot go missing', () => {
  const d: ConditionDraft = { ...blankCondition(), ttype: 'raw', regex: 'Mote of ', fieldVal: '' }
  assert.equal(conditionFieldKeyErr(d), null)
  assert.deepEqual(primitiveFromDraft(d), { type: 'raw', regex: 'Mote of ' })
  // Even with a stale value left behind in the draft's event half, which the union permits.
  assert.equal(conditionFieldKeyErr({ ...d, fieldVal: '/^Mote of /' }), null)
})

test('an app condition has no text at all, so it is never blocked', () => {
  const d: ConditionDraft = { ...blankCondition(), ttype: 'app', fieldVal: '/^Mote of /' }
  assert.equal(conditionFieldKeyErr(d), null)
  assert.deepEqual(primitiveFromDraft(d), { type: 'app', signal: 'bossDefeat' })
})

test('the three condition errors stay independent — this one is not a regex check', () => {
  // A value that will not compile is `conditionFieldValErr`'s business, and it reports separately.
  const bad = { ...moteDraft(), fieldVal: '/^Mote of (/' }
  assert.equal(conditionFieldKeyErr(bad), null, 'the field IS named; the pattern is the problem')
  assert.ok(conditionFieldValErr(bad))
  assert.equal(conditionRawErr(bad), null, 'not a raw condition')
})

// ── 4. SOURCE PINS: the save gate and the label ───────────────────────────────────────

test('formCanSave consults the field-name check, so the Add button really does disable', () => {
  const form = src('renderer/src/features/alerts/alertForm.ts')
  assert.match(form, /conditionFieldKeyErr\(c\) == null/)
})

test('the editor shows the error on the Field box and stops calling it optional', () => {
  const editor = src('renderer/src/features/alerts/ConditionEditor.tsx')
  assert.match(editor, /conditionFieldKeyErr\(draft\)/)
  assert.match(editor, /label=\{fieldKeyErr \? 'Field' : 'Field \(optional\)'\}/)
  // The help text names the field a loot author needs, which is the other half of the report:
  // nothing in the dialog used to mention `item` at all.
  assert.match(editor, /<code>item<\/code>/)
})

// One primitive shape per union member has been round-tripped above; this is the compile-time
// reminder that a NEW member needs a line here rather than silent coverage.
const COVERED: AlertTriggerPrimitive['type'][] = ['event', 'raw', 'app']
test('every primitive trigger type is covered by the cases above', () => {
  assert.deepEqual(COVERED, ['event', 'raw', 'app'])
})
