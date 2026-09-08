// Pure unit tests for the RENDERER half of voice alerts (docs/plans/voice-alerts.md W2).
//
// No DOM, no Electron, no fixture — so this file never skips. It pins the three decisions that
// are invisible until they are wrong, every one of them a thing the user experiences as "the
// app said the wrong thing / said nothing / would not stop talking":
//
//   1. `speechPlan` — sound vs speech (the combined 'both' channel is retired, JOS-362), the ONE
//      way a firing goes quiet (the alerts master mute), and the fact that the def's own `audio`
//      is the entire switch: there is no global voice enable any more, so nothing outside the def
//      can turn a spoken alert back into its sound except having nothing truthful to say. A def
//      still STORING 'both' is read through `resolveAlertAudio` and resolves to one channel —
//      pinned below, because that read is what keeps an old store playable.
//   2. `coalesceAudio` — "three buffs fading at once is ONE audio alert" (owner direction), plus
//      the per-alert opt-out's exact contract: it bypasses the window AND does not occupy it —
//      and now the GLOBAL preference above it (JOS-222, `AlertPrefs.alwaysPlayAll`), whose whole
//      claim is that it is the SAME branch with a wider subject and STARTS OFF. Since JOS-347 the
//      window folds by what would be HEARD rather than by occupancy, so both halves of that rule
//      are pinned here: a repeated sound is still one audio alert, and a DIFFERENT voice line in
//      the same instant is not swallowed by it.
//   3. `pickVoice` — a stored voice id resolved against a per-machine voice list, bounded: exact
//      then case-insensitive, and NEVER "the first voice" (a stranger's voice is worse than the
//      engine's own default).
//
// The engine itself (`speak`) is deliberately not unit-tested: it is the seam onto
// speechSynthesis and IPC, and what it must do is asserted where it lives, by
// tests/e2e/voice-alerts.e2e.mts against the real app.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AlertDef } from '../src/shared/types'
import { DEFAULT_VOICE_PREFS } from '../src/shared/speechText'
import {
  noteSpeechEngineFault,
  onSpeechEngineFault,
  pickVoice,
  resetSpeechEngineFault,
  speechEngineFault,
  speechPlan,
  speechSetupGap,
  voiceIdOf,
  SPEECH_SETUP_NOTES,
  type SpeechEngineFault,
  type SpeechSetupGap
} from '../src/renderer/src/lib/speech'
import {
  AUDIO_COALESCE_MS,
  AUDIO_DISTINCT_CAP,
  audioIdentity,
  coalesceAudio,
  type AudioWindow
} from '../src/renderer/src/features/alerts/audioThrottle'

function def(over: Partial<AlertDef> = {}): AlertDef {
  return {
    id: 'charm-break',
    name: 'Charm break',
    enabled: true,
    trigger: { type: 'event', kind: 'uncharm' },
    sound: { packId: 'alan-rickman', soundId: 'attention' },
    ...over
  }
}

// ------------------------------------------------------------------ speechPlan

test('a def with no audio field plays its sound, exactly as it always did', () => {
  assert.deepEqual(speechPlan(def(), null, false), { sound: true, speak: null })
})

test("audio:'speech' speaks INSTEAD of the sound", () => {
  const plan = speechPlan(def({ audio: 'speech' }), null, false)
  assert.equal(plan.sound, false)
  assert.equal(plan.speak, 'Charm break', 'no speech block ⇒ the alert name (W1 fallback)')
})

test('JOS-362: a firing is ONE channel — a plan can never carry a sound and an utterance', () => {
  // The combined channel is gone ("also remove sound + spoken - too much garbage", owner
  // 2026-08-14) and with it the `after` field, so this is a claim about the SHAPE of every plan
  // rather than about one def: the player has one branch, and nothing can queue speech behind a
  // sound any more.
  for (const audio of ['sound', 'speech'] as const) {
    const plan = speechPlan(def({ audio, speech: { mode: 'custom', phrase: 'Charm break' } }), null, false)
    assert.equal('after' in plan, false, 'the sound-then-speech continuation is retired')
    assert.equal(
      plan.sound && plan.speak !== null,
      false,
      `audio:'${audio}' must resolve to a sound OR an utterance, never both`
    )
  }
})

test("JOS-362: a def still STORING 'both' resolves — the phrase decides which channel", () => {
  // The owner's constraint on removing the option was "don't screw up anyone's settings except
  // for the insane people who use that one option in the process", so a stored 'both' is read
  // rather than rewritten, and it resolves toward the most specific thing the def says: somebody
  // wrote those words for this alert, so the words win. With no phrase there is nothing specific
  // to honour and it keeps the channel it was always guaranteed to be audible on.
  const spoken = speechPlan(def({ audio: 'both', speech: { mode: 'custom', phrase: 'Charm broke' } }), null, false)
  assert.deepEqual(spoken, { sound: false, speak: 'Charm broke' }, 'a phrase ⇒ spoken')
  const played = speechPlan(def({ audio: 'both' }), null, false)
  assert.deepEqual(played, { sound: true, speak: null }, 'no phrase ⇒ the pack sound')
  // …and a mode without a phrase is not a phrase: 'both' + 'alertName' is still the sound.
  const named = speechPlan(def({ audio: 'both', speech: { mode: 'alertName' } }), null, false)
  assert.deepEqual(named, { sound: true, speak: null })
})

test('the alerts master MUTE silences speech too — mute is a promise about noise', () => {
  // 'both' is in this list because a STORE can still hold it, and silence is silence whatever the
  // stored channel resolves to.
  for (const audio of ['sound', 'speech', 'both'] as const) {
    assert.deepEqual(
      speechPlan(def({ audio }), null, true),
      { sound: false, speak: null },
      `audio:'${audio}' must be silent while muted`
    )
  }
})

test('THE DEF IS THE WHOLE SWITCH — no global preference can mute a spoken alert', () => {
  // The regression this file exists to prevent from coming back: a global `VoicePrefs.enabled`
  // used to sit inside `speechPlan` and turn every speaking def back into its pack sound while it
  // was off — which it was by default. `speechPlan` now takes no prefs AT ALL, so the only way to
  // re-introduce that gate is to change its signature, in front of this test.
  assert.equal(speechPlan.length, 3, 'speechPlan(def, firing, muted) — prefs are not an input')
  assert.equal(speechPlan(def({ audio: 'speech' }), null, false).speak, 'Charm break')
  // …and the prefs blob no longer even carries the flag.
  assert.equal('enabled' in DEFAULT_VOICE_PREFS, false)
})

test('the ONE remaining sound-fallback: nothing truthful to say', () => {
  // A nameless def on an empty custom phrase resolves to no text. It plays its SOUND rather than
  // uttering an empty string — degrading to noise, never to silence (world-model law 1).
  const d = def({ name: '  ', audio: 'speech', speech: { mode: 'custom', phrase: '' } })
  assert.deepEqual(speechPlan(d, null, false), { sound: true, speak: null })
})

test('the spell modes read the firing’s RANK-INTACT spell and strip the rank aloud', () => {
  const d = def({ audio: 'speech', speech: { mode: 'spellName' } })
  assert.equal(speechPlan(d, { spell: 'Mesmerization III' }, false).speak, 'Mesmerization')
  const first = def({ audio: 'speech', speech: { mode: 'spellFirstWord' } })
  assert.equal(speechPlan(first, { spell: 'Swift Like the Wind II' }, false).speak, 'Swift')
})

test('a spell mode on a firing with NO spell falls back to the alert name, never silence', () => {
  const d = def({ name: 'Mez broke', audio: 'speech', speech: { mode: 'spellName' } })
  assert.equal(speechPlan(d, { spell: undefined }, false).speak, 'Mez broke')
  assert.equal(speechPlan(d, null, false).speak, 'Mez broke')
})

test('a custom phrase is spoken verbatim', () => {
  const d = def({ audio: 'speech', speech: { mode: 'custom', phrase: 'run away' } })
  assert.equal(speechPlan(d, null, false).speak, 'run away')
})

// ------------------------------------------------------------------ coalesceAudio

/** What a sound-only firing of `d` would be heard as — the plan `speechPlan` gives the player. */
function heardAs(d: AlertDef, speak: string | null = null): string {
  return audioIdentity(d, { sound: true, speak })
}

test('three alerts firing in the same instant produce ONE audio alert', () => {
  // The owner's own case, and it still holds because it is three firings of the SAME audio: the
  // suggestion builder gives every alert of one template the same pack sound and no speech, so
  // three buffs fading is one 0.8-second sound played three times. Playing it twice more says
  // nothing the first playing did not.
  const now = 1_000_000
  let win: AudioWindow | null = null
  const played: boolean[] = []
  for (let i = 0; i < 3; i++) {
    const gate = coalesceAudio(def(), now + i, win, { heard: heardAs(def()) })
    win = gate.window
    played.push(gate.play)
  }
  assert.deepEqual(played, [true, false, false])
  assert.equal(win?.at, now, 'FIRST arrival owns the window; the suppressed pair never extend it')
  assert.equal(win?.heard.length, 1, 'and the window heard exactly one thing')
})

test('the window expires — the next burst is heard', () => {
  const t0 = 5_000
  const first = coalesceAudio(def(), t0, null, { heard: heardAs(def()) })
  assert.equal(first.play, true)
  assert.equal(
    coalesceAudio(def(), t0 + AUDIO_COALESCE_MS - 1, first.window, { heard: heardAs(def()) }).play,
    false
  )
  const later = coalesceAudio(def(), t0 + AUDIO_COALESCE_MS, first.window, { heard: heardAs(def()) })
  assert.equal(later.play, true)
  assert.equal(later.window?.at, t0 + AUDIO_COALESCE_MS)
  assert.deepEqual(later.window?.heard, [heardAs(def())], 'a reopened window starts empty')
})

test('alwaysPlay BYPASSES the window and does NOT occupy it', () => {
  const t0 = 42
  const opened = coalesceAudio(def(), t0, null, { heard: heardAs(def()) })
  // Bypasses an open window…
  const critical = coalesceAudio(def({ alwaysPlay: true }), t0 + 10, opened.window)
  assert.equal(critical.play, true)
  assert.deepEqual(critical.window, opened.window, 'it left the window exactly as it found it')
  // …and two of them together both sound, which is the whole point of the opt-out.
  const a = coalesceAudio(def({ alwaysPlay: true }), 900, null)
  const b = coalesceAudio(def({ alwaysPlay: true }), 900, a.window)
  assert.equal(a.play && b.play, true)
  assert.equal(b.window, null, 'a critical alert never opens a window against the next one')
})

// ------------------------------------- the window folds by what is HEARD (JOS-347)

test('FOUR DIFFERENT VOICE LINES IN ONE INSTANT ARE FOUR THINGS TO HEAR', () => {
  // THE REPORT (01KZZD3DF8V9XNFGQKGVB5562J): a bard created a resist alert per Tuyen chant, each
  // with its own voice line, and "only the first alert is ever played". A bard's songs all
  // re-apply in the SAME six-second pulse, so their four resist lines arrive in one delta and are
  // played by one synchronous loop — under a timestamp-only window that is not a burst to
  // coalesce, it is a permanent mute for three of the four defs.
  const now = 3_000
  const lines = ['Flame resisted', 'Frost resisted', 'Disease resisted', 'Poison resisted']
  let win: AudioWindow | null = null
  const spoken: string[] = []
  for (const line of lines) {
    const d = def({ audio: 'speech', speech: { mode: 'custom', phrase: line } })
    const gate = coalesceAudio(d, now, win, { heard: heardAs(d, line) })
    win = gate.window
    if (gate.play) spoken.push(line)
  }
  assert.deepEqual(spoken, lines, 'every distinct line is heard, and each of them exactly once')
  assert.equal(win?.at, now, 'the distinct four rode the FIRST arrival’s clock, never extending it')
})

test('a distinct line is heard ONCE inside its window, not once per firing', () => {
  // The other half of the same rule: being distinct buys one hearing, not an exemption. Two
  // resists of the same song 200ms apart are one utterance, exactly as before.
  const d = def({ audio: 'speech', speech: { mode: 'custom', phrase: 'Frost resisted' } })
  const other = def({ audio: 'speech', speech: { mode: 'custom', phrase: 'Flame resisted' } })
  const first = coalesceAudio(d, 0, null, { heard: heardAs(d, 'Frost resisted') })
  const second = coalesceAudio(other, 100, first.window, { heard: heardAs(other, 'Flame resisted') })
  const repeat = coalesceAudio(d, 200, second.window, { heard: heardAs(d, 'Frost resisted') })
  assert.deepEqual([first.play, second.play, repeat.play], [true, true, false])
})

test('the identity is what is HEARD — not the alert id, and not an unspoken name', () => {
  // Two DIFFERENT alerts pointed at one sound with nothing to say are indistinguishable in the
  // room, and folding them is the owner's rule. Their names differ; nobody hears a name.
  const a = def({ id: 'a', name: 'Rune faded' })
  const b = def({ id: 'b', name: 'Clarity faded' })
  assert.equal(heardAs(a), heardAs(b))
  // A different pack sound IS a different thing to hear.
  const c = def({ id: 'c', sound: { packId: 'alan-rickman', soundId: 'task-error-task-error-01' } })
  assert.notEqual(heardAs(a), heardAs(c))
  // A spoken firing and a sound firing differ even on the same words: one of them plays a sound.
  assert.notEqual(audioIdentity(a, { sound: false, speak: 'go' }), heardAs(a, 'go'))
})

test('the distinct-identity cap bounds one window', () => {
  // The backstop, not the policy: past AUDIO_DISTINCT_CAP simultaneous distinct utterances, more
  // audio carries less, which is the throttle's whole premise.
  let win: AudioWindow | null = null
  let played = 0
  for (let i = 0; i < AUDIO_DISTINCT_CAP + 3; i++) {
    const d = def({ audio: 'speech', speech: { mode: 'custom', phrase: `line ${i}` } })
    const gate = coalesceAudio(d, 10, win, { heard: heardAs(d, `line ${i}`) })
    win = gate.window
    if (gate.play) played += 1
  }
  assert.equal(played, AUDIO_DISTINCT_CAP)
})

// ---------------------------------------------------- the GLOBAL always-play preference (JOS-222)

test('the global preference STARTS OFF — an omitted options bag throttles exactly as before', () => {
  // The regression that would be invisible: a default of `true` (or a caller that forgets to pass
  // the flag through as a boolean) silently deletes the throttle for everyone. The owner's spec is
  // that it starts off, so the ABSENCE of the option must mean off. `heard` defaults the same way
  // and for the same reason (JOS-347): an omitted identity is one identity for everything, which
  // is the pre-JOS-347 window, never a bypass.
  const t0 = 7_000
  const first = coalesceAudio(def(), t0, null)
  assert.equal(first.play, true)
  assert.equal(coalesceAudio(def(), t0 + 10, first.window).play, false)
  // …and an empty bag is the same answer, not a different code path.
  assert.deepEqual(coalesceAudio(def(), t0 + 10, first.window, {}), {
    play: false,
    window: first.window
  })
})

test('the global preference plays EVERY alert in a burst, and opens no window doing it', () => {
  const now = 2_000_000
  let win: AudioWindow | null = null
  const played: boolean[] = []
  for (let i = 0; i < 3; i++) {
    const gate = coalesceAudio(def(), now + i, win, { allAlwaysPlay: true, heard: heardAs(def()) })
    win = gate.window
    played.push(gate.play)
  }
  assert.deepEqual(played, [true, true, true], 'three buffs fading at once is now three sounds')
  assert.equal(win, null, 'nothing occupied the channel, so nothing can be silenced by it later')
})

test('the global preference is the SAME branch as the per-alert opt-out, not a second one', () => {
  // It bypasses an already-open window and leaves it exactly as it found it — the property that
  // makes the per-alert opt-out safe, asserted for the global one so the two cannot drift.
  const opened = coalesceAudio(def(), 500, null, { heard: heardAs(def()) })
  const gate = coalesceAudio(def(), 510, opened.window, { allAlwaysPlay: true, heard: heardAs(def()) })
  assert.deepEqual(gate, { play: true, window: opened.window })
  // And it is a bypass laid OVER the defs, never a rewrite of them: a def that already opted out
  // reads identically with the preference on or off.
  assert.deepEqual(
    coalesceAudio(def({ alwaysPlay: true }), 510, opened.window, { allAlwaysPlay: true }),
    coalesceAudio(def({ alwaysPlay: true }), 510, opened.window, { allAlwaysPlay: false })
  )
})

test('a firing is ONE occupancy, whatever channel it came out on', () => {
  // The caller charges the window once per FIRING, whatever the plan contains; this pins that
  // the throttle has no per-channel notion at all. It was written for the retired 'both' channel
  // (whose sound+speech pair must not have been able to silence itself, JOS-362) and it outlives
  // it: the claim is about the throttle, not about which channels exist.
  const d = def({ audio: 'speech', speech: { mode: 'custom', phrase: 'Charm break' } })
  const gate = coalesceAudio(d, 100, null, { heard: heardAs(d, 'Charm break') })
  assert.deepEqual(gate, { play: true, window: { at: 100, heard: [heardAs(d, 'Charm break')] } })
})

// ------------------------------------------------------------------ pickVoice

const VOICES = [
  { name: 'Microsoft David Desktop', voiceURI: 'urn:sapi:David?en-US', lang: 'en-US' },
  { name: 'Microsoft Zira Desktop', voiceURI: 'urn:sapi:Zira?en-US', lang: 'en-US' },
  { name: 'Google UK English Male', lang: 'en-GB' }
]

test('a stored voice id matches by URI, then by name, then case-insensitively', () => {
  assert.equal(pickVoice(VOICES, 'urn:sapi:Zira?en-US')?.name, 'Microsoft Zira Desktop')
  assert.equal(pickVoice(VOICES, 'Microsoft David Desktop')?.name, 'Microsoft David Desktop')
  assert.equal(pickVoice(VOICES, 'MICROSOFT ZIRA DESKTOP')?.name, 'Microsoft Zira Desktop')
  assert.equal(pickVoice(VOICES, 'urn:SAPI:david?EN-US')?.name, 'Microsoft David Desktop')
})

test('an unknown / absent voice id resolves to the ENGINE default, never to voices[0]', () => {
  assert.equal(pickVoice(VOICES, 'Microsoft Hazel'), null, 'a machine without that voice')
  assert.equal(pickVoice(VOICES, 'David'), null, 'never substring-matches (law 12)')
  assert.equal(pickVoice(VOICES, null), null)
  assert.equal(pickVoice(VOICES, ''), null)
  assert.equal(pickVoice([], 'urn:sapi:Zira?en-US'), null)
})

test('a voice with no URI is identified by its name', () => {
  assert.equal(voiceIdOf(VOICES[2]), 'Google UK English Male')
  assert.equal(voiceIdOf(VOICES[0]), 'urn:sapi:David?en-US')
  assert.equal(pickVoice(VOICES, 'Google UK English Male')?.lang, 'en-GB')
})

// ------------------------------------------------------ 4. the engine fault latch (JOS-247)
//
// The reported failure was SILENT, and this is the mechanism that ends that. A downloaded
// natural voice whose worker will not start enumerates all 54 of its voices perfectly — the
// picker reads the FILE — so nothing derived from the inventory can ever notice. Only a failed
// utterance knows, and before this it told a `console.warn` in a window with no console.

test('the fault latches from a failed utterance, and tells its listeners once', () => {
  resetSpeechEngineFault()
  const seen: SpeechEngineFault[] = []
  const off = onSpeechEngineFault((f) => seen.push(f))
  assert.equal(speechEngineFault(), null, 'nothing has failed yet')
  noteSpeechEngineFault('engine-unloadable')
  noteSpeechEngineFault('engine-unloadable')
  assert.equal(speechEngineFault(), 'engine-unloadable')
  assert.deepEqual(seen, ['engine-unloadable'], 'a fault is a STATE, not an event per alert')
  off()
  resetSpeechEngineFault()
})

test('a setup state is NOT a fault — "not downloaded" is already said everywhere else', () => {
  // Latching this one would double the note the picker and every speaking row already carry,
  // and would keep saying it after the download finished.
  resetSpeechEngineFault()
  noteSpeechEngineFault('engine-not-installed')
  noteSpeechEngineFault('invalid-request')
  noteSpeechEngineFault('not-implemented')
  assert.equal(speechEngineFault(), null)
})

test('every gap the UI can render has a note, and the unloadable one names its remedy', () => {
  const gaps: SpeechSetupGap[] = ['engine-not-installed', 'no-voices', 'engine-failed', 'engine-unloadable']
  for (const gap of gaps) assert.ok(SPEECH_SETUP_NOTES[gap].length > 0, gap)
  // The two engine faults must never send a user off to re-download a model they already have —
  // which is precisely what the old 'engine-not-installed' answer did say to them.
  for (const gap of ['engine-failed', 'engine-unloadable'] as const) {
    assert.match(SPEECH_SETUP_NOTES[gap], /is downloaded/, gap)
    assert.ok(!SPEECH_SETUP_NOTES[gap].includes(SPEECH_SETUP_NOTES['engine-not-installed']), gap)
  }
  // …and the one whose remedy was MEASURED (the PE import tables of the shipped binaries) says it.
  assert.match(SPEECH_SETUP_NOTES['engine-unloadable'], /Visual C\+\+/)
  // House copy law (JOS-106): no em dashes in user-facing strings.
  for (const gap of gaps) assert.ok(!SPEECH_SETUP_NOTES[gap].includes('—'), gap)
})

test('the inventory gap is unchanged — it still answers only what asking can answer', () => {
  assert.equal(speechSetupGap('kokoro', []), 'engine-not-installed')
  assert.equal(speechSetupGap('system', []), 'no-voices')
  // THE REPORTER'S OWN STATE: a downloaded pack lists its voices, so nothing is missing and the
  // inventory has nothing to say. That is why the fault has to come from having TRIED.
  assert.equal(speechSetupGap('kokoro', [{ id: 'af_heart' }]), null)
})
