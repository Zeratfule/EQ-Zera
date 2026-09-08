// gen-sounds.mts — synthesize EQ Zera's own notification pack, `eq-zera-console`, with ZERO
// dependencies: square / triangle / saw / noise voices, an ADSR, a tiny sequencer, 16-bit mono WAV
// at 22,050 Hz, written under resources/soundpacks/eq-zera-console/ beside a manifest in the
// app's own SoundPackManifest shape. Run:
//
//   npx tsx scripts/gen-sounds.mts        (npm run gen:sounds)
//
// WHY SYNTHESIZED. The shipped default used to be a third-party voice pack pulled from a registry
// at first launch (CC-BY, fair-use neighbours). This pack is ORIGINAL — every byte comes out of
// this file — so it ships in the installer, needs no network, no attribution and no tombstone,
// and it sounds like the app looks: a console. The WAVs are committed (about a megabyte) so a
// source checkout plays them in `npm run dev` without a build step; re-run to change a cue.
//
// THE IDS FOLLOW THE CESP SLUGS (`task-complete-…`, `input-required-…`) on purpose: the app's
// fallback resolution (shared/soundPacks.ts `soundCategorySlug`) keeps an alert's INTENT by that
// prefix when a referenced sound goes missing, and the group/seed tables name these ids directly.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const PACK_ID = 'eq-zera-console'
const OUT = join(ROOT, 'resources', 'soundpacks', PACK_ID)
const RATE = 22_050

// ---- voices ------------------------------------------------------------------------------------

type Wave = 'square' | 'pulse' | 'triangle' | 'saw' | 'sine' | 'noise'

/** One oscillator sample at phase 0..1. Noise ignores phase and uses a tiny LCG. */
let noiseState = 0x2f6e2b1
function osc(wave: Wave, phase: number): number {
  const p = phase - Math.floor(phase)
  switch (wave) {
    case 'square':
      return p < 0.5 ? 1 : -1
    case 'pulse':
      return p < 0.25 ? 1 : -1
    case 'triangle':
      return 4 * Math.abs(p - 0.5) - 1
    case 'saw':
      return 2 * p - 1
    case 'sine':
      return Math.sin(2 * Math.PI * p)
    case 'noise':
      noiseState = (noiseState * 1664525 + 1013904223) >>> 0
      return (noiseState / 0xffffffff) * 2 - 1
  }
}

interface Env {
  a: number
  d: number
  s: number
  r: number
}

/** ADSR level at time t (seconds) for a note held `hold` seconds. */
function envelope(t: number, hold: number, e: Env): number {
  if (t < e.a) return t / e.a
  if (t < e.a + e.d) return 1 - (1 - e.s) * ((t - e.a) / e.d)
  if (t < hold) return e.s
  const rel = (t - hold) / e.r
  return rel >= 1 ? 0 : e.s * (1 - rel)
}

interface Note {
  /** Hz, or a [from, to] slide */
  freq: number | [number, number]
  /** seconds the note is held (before release) */
  hold: number
  /** seconds from this note's start to the next note's start */
  step: number
  wave: Wave
  gain?: number
  env?: Env
  /** vibrato depth (Hz) and rate (Hz) */
  vib?: [number, number]
}

const PLUCK: Env = { a: 0.004, d: 0.08, s: 0.55, r: 0.12 }
const PAD: Env = { a: 0.01, d: 0.05, s: 0.8, r: 0.25 }
const TICK: Env = { a: 0.002, d: 0.03, s: 0.2, r: 0.04 }
const THUD: Env = { a: 0.003, d: 0.12, s: 0.15, r: 0.15 }

/** Render a sequence of notes into a float buffer. Notes may overlap through their releases. */
function render(notes: readonly Note[]): Float32Array {
  let total = 0
  let at = 0
  for (const n of notes) {
    const env = n.env ?? PLUCK
    total = Math.max(total, at + n.hold + env.r)
    at += n.step
  }
  const out = new Float32Array(Math.ceil(total * RATE) + RATE * 0.02)
  at = 0
  for (const n of notes) {
    const env = n.env ?? PLUCK
    const start = Math.floor(at * RATE)
    const len = Math.ceil((n.hold + env.r) * RATE)
    const gain = n.gain ?? 0.5
    let phase = 0
    for (let i = 0; i < len; i++) {
      const t = i / RATE
      const f0 = Array.isArray(n.freq) ? n.freq[0] + (n.freq[1] - n.freq[0]) * Math.min(1, t / n.hold) : n.freq
      const f = n.vib ? f0 + n.vib[0] * Math.sin(2 * Math.PI * n.vib[1] * t) : f0
      phase += f / RATE
      const s = osc(n.wave, phase) * envelope(t, n.hold, env) * gain
      const idx = start + i
      if (idx < out.length) out[idx] += s
    }
    at += n.step
  }
  return out
}

/** Layer several renders (a square lead over a triangle bass, a noise tap under a thud). */
function mix(...layers: Float32Array[]): Float32Array {
  const len = Math.max(...layers.map((l) => l.length))
  const out = new Float32Array(len)
  for (const l of layers) for (let i = 0; i < l.length; i++) out[i] += l[i]
  return out
}

/** Soft-clip, normalise to -1 dBFS, and encode 16-bit mono PCM. */
function wav(samples: Float32Array): Buffer {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(Math.tanh(s)))
  const norm = peak > 0 ? 0.89 / peak : 1
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, Math.tanh(samples[i]) * norm))
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

// ---- the cues ----------------------------------------------------------------------------------

/** Equal-tempered pitch from a MIDI number. */
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

interface Timing {
  hold: number
  step: number
  env?: Env
  gain?: number
}
const seq = (wave: Wave, midis: readonly number[], t: Timing): Note[] =>
  midis.map((m) => ({ freq: hz(m), hold: t.hold, step: t.step, wave, env: t.env ?? PLUCK, gain: t.gain ?? 0.5 }))

interface Cue {
  id: string
  label: string
  make: () => Float32Array
}

/** Every cue in the pack. Category slug first in the id; three takes per category. */
const CUES: Cue[] = [
  // session-start: a power-on arpeggio rising to a held top note.
  { id: 'session-start-power-01', label: 'Start · Power on', make: () => mix(render(seq('square', [60, 64, 67, 72], { hold: 0.09, step: 0.09 })), render([{ freq: hz(72), hold: 0.35, step: 0, wave: 'triangle', env: PAD, gain: 0.35 }])) },
  { id: 'session-start-power-02', label: 'Start · Boot', make: () => render(seq('pulse', [57, 64, 69, 76], { hold: 0.08, step: 0.1 })) },
  { id: 'session-start-power-03', label: 'Start · Wake', make: () => mix(render(seq('square', [55, 62, 67, 74], { hold: 0.1, step: 0.12 })), render(seq('triangle', [43, 50, 55, 62], { hold: 0.1, step: 0.12, env: PLUCK, gain: 0.35 }))) },
  // session-end: the same shape falling.
  { id: 'session-end-power-01', label: 'End · Power down', make: () => render(seq('square', [72, 67, 64, 60], { hold: 0.09, step: 0.1 })) },
  { id: 'session-end-power-02', label: 'End · Shutdown', make: () => render([{ freq: [hz(69), hz(45)], hold: 0.45, step: 0, wave: 'triangle', env: PAD, gain: 0.5 }]) },
  { id: 'session-end-power-03', label: 'End · Fade', make: () => render(seq('pulse', [76, 69, 64, 57], { hold: 0.08, step: 0.11 })) },
  // task-acknowledge: a two-tone blip. Loot, a debuff landing.
  { id: 'task-acknowledge-blip-01', label: 'Acknowledge · Blip', make: () => render(seq('square', [76, 81], { hold: 0.05, step: 0.06 })) },
  { id: 'task-acknowledge-blip-02', label: 'Acknowledge · Ping', make: () => render(seq('pulse', [79, 86], { hold: 0.05, step: 0.06 })) },
  { id: 'task-acknowledge-blip-03', label: 'Acknowledge · Pop', make: () => render(seq('triangle', [72, 79], { hold: 0.06, step: 0.07, env: PLUCK, gain: 0.6 })) },
  // task-progress: a soft tick.
  { id: 'task-progress-tick-01', label: 'Progress · Tick', make: () => render([{ freq: hz(84), hold: 0.03, step: 0, wave: 'triangle', env: TICK, gain: 0.5 }]) },
  { id: 'task-progress-tick-02', label: 'Progress · Tap', make: () => render([{ freq: hz(79), hold: 0.03, step: 0, wave: 'square', env: TICK, gain: 0.35 }]) },
  { id: 'task-progress-tick-03', label: 'Progress · Step', make: () => render(seq('triangle', [79, 84], { hold: 0.025, step: 0.035, env: TICK, gain: 0.5 })) },
  // task-complete: the fanfare. Boss down, quest done.
  { id: 'task-complete-fanfare-01', label: 'Complete · Fanfare', make: () => mix(render([...seq('square', [67, 67, 67], { hold: 0.07, step: 0.09 }), { freq: hz(72), hold: 0.45, step: 0, wave: 'square', env: PAD, gain: 0.5 }]), render([...seq('triangle', [55, 55, 55], { hold: 0.07, step: 0.09, env: PLUCK, gain: 0.35 }), { freq: hz(60), hold: 0.45, step: 0, wave: 'triangle', env: PAD, gain: 0.3 }])) },
  { id: 'task-complete-fanfare-02', label: 'Complete · Victory', make: () => mix(render([...seq('square', [60, 64, 67, 72], { hold: 0.07, step: 0.08 }), { freq: hz(76), hold: 0.5, step: 0, wave: 'square', env: PAD, gain: 0.5, vib: [4, 6] }]), render([...seq('triangle', [48, 52, 55, 60], { hold: 0.07, step: 0.08, env: PLUCK, gain: 0.35 }), { freq: hz(64), hold: 0.5, step: 0, wave: 'triangle', env: PAD, gain: 0.3 }])) },
  { id: 'task-complete-fanfare-03', label: 'Complete · Cleared', make: () => mix(render([...seq('pulse', [64, 69, 72, 76, 81], { hold: 0.06, step: 0.07 }), { freq: hz(84), hold: 0.4, step: 0, wave: 'pulse', env: PAD, gain: 0.45 }]), render([{ freq: hz(45), hold: 0.75, step: 0, wave: 'triangle', env: PAD, gain: 0.35 }])) },
  // task-error: a descending buzz. An illusion fading, a failure.
  { id: 'task-error-buzz-01', label: 'Error · Buzz', make: () => render([{ freq: [hz(52), hz(40)], hold: 0.3, step: 0, wave: 'saw', env: PAD, gain: 0.5 }]) },
  { id: 'task-error-buzz-02', label: 'Error · Wrong', make: () => render(seq('saw', [50, 44], { hold: 0.14, step: 0.16, env: PAD, gain: 0.45 })) },
  { id: 'task-error-buzz-03', label: 'Error · Slip', make: () => render([{ freq: [hz(64), hz(36)], hold: 0.4, step: 0, wave: 'square', env: PAD, gain: 0.4 }]) },
  // input-required: an alternating alarm. A charm break, a buff about to drop.
  { id: 'input-required-alarm-01', label: 'Input · Alarm', make: () => render(seq('square', [81, 76, 81, 76, 81, 76], { hold: 0.06, step: 0.07 })) },
  { id: 'input-required-alarm-02', label: 'Input · Siren', make: () => render([{ freq: [hz(76), hz(83)], hold: 0.18, step: 0.2, wave: 'pulse', env: PAD, gain: 0.45 }, { freq: [hz(76), hz(83)], hold: 0.18, step: 0, wave: 'pulse', env: PAD, gain: 0.45 }]) },
  { id: 'input-required-alarm-03', label: 'Input · Warning', make: () => render(seq('pulse', [79, 79, 79], { hold: 0.08, step: 0.13, env: PLUCK, gain: 0.5 })) },
  // resource-limit: a low double thud. A buff falling off.
  { id: 'resource-limit-thud-01', label: 'Limit · Thud', make: () => mix(render(seq('sine', [38, 38], { hold: 0.12, step: 0.16, env: THUD, gain: 0.9 })), render(seq('noise', [0, 0], { hold: 0.02, step: 0.16, env: TICK, gain: 0.25 }))) },
  { id: 'resource-limit-thud-02', label: 'Limit · Drop', make: () => mix(render([{ freq: [hz(50), hz(31)], hold: 0.25, step: 0, wave: 'sine', env: THUD, gain: 0.9 }]), render([{ freq: 0, hold: 0.03, step: 0, wave: 'noise', env: TICK, gain: 0.25 }])) },
  { id: 'resource-limit-thud-03', label: 'Limit · Low', make: () => render(seq('triangle', [43, 36], { hold: 0.15, step: 0.18, env: THUD, gain: 0.8 })) },
  // user-spam: a muted click.
  { id: 'user-spam-click-01', label: 'Spam · Click', make: () => render([{ freq: 0, hold: 0.015, step: 0, wave: 'noise', env: TICK, gain: 0.35 }]) },
  { id: 'user-spam-click-02', label: 'Spam · Tock', make: () => render([{ freq: hz(60), hold: 0.02, step: 0, wave: 'triangle', env: TICK, gain: 0.4 }]) },
  { id: 'user-spam-click-03', label: 'Spam · Tap', make: () => render([{ freq: hz(67), hold: 0.02, step: 0, wave: 'square', env: TICK, gain: 0.3 }]) }
]

// ---- write -------------------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true })
const sounds: Record<string, { file: string; label: string }> = {}
let bytes = 0
for (const cue of CUES) {
  const file = `${cue.id}.wav`
  const buf = wav(cue.make())
  writeFileSync(join(OUT, file), buf)
  bytes += buf.length
  sounds[cue.id] = { file, label: cue.label }
}
const manifest = {
  id: PACK_ID,
  name: 'EQ Zera Console',
  license: 'CC0-1.0 (original, synthesized by scripts/gen-sounds.mts)',
  sounds
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`wrote ${String(CUES.length)} cues (${String(Math.round(bytes / 1024))} KB) + manifest to resources/soundpacks/${PACK_ID}`)
