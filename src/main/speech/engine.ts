// engine.ts — main's side of the Kokoro tier: the cache, the dedupe, and one warm worker.
//
// THE DIVISION OF LABOUR. `worker.ts` knows how to turn text into a wav. This file knows
// WHEN that is worth doing, and it is the only thing that ever asks:
//
//   speech:say {text, voiceId}
//        │
//        ├─ hash = sha256(voiceId \0 text)
//        ├─ <userData>/speech-cache/<hash>.wav on disk?  ──yes──►  eqspeech://<hash>   (0 ms)
//        ├─ tier not installed?                          ──yes──►  {ok:false}          (0 ms)
//        ├─ already being synthesized?                    ──yes──►  join that promise
//        └─ else: spawn-or-reuse the worker, queue the job, await, then serve the url
//
// EVERY BRANCH ABOVE EXISTS TO NOT RUN THE MODEL. The cache is permanent (D3), so the steady
// state of a long play session is branch one: a phrase said for the thousandth time costs a
// file read. The dedupe covers the case that actually happens in this app — three buffs
// fading at once, all resolving to the same word — which without it would be three concurrent
// model runs producing three identical files.
//
// THE WORKER IS LAZY AND THEN WARM. Nothing spawns at startup: a user who never enables voice
// alerts never pays for onnxruntime being on disk, let alone loaded. The first cache MISS
// spawns it, and it stays for the life of the app, holding the ~90 MB session and the 28 MB
// voice pack — which is why the second uncached phrase is ~0.9 s instead of ~1.6 s.
//
// A DEAD WORKER STAYS DEAD (politely) UNTIL THE MACHINE CHANGES. If the thread cannot start at
// all — the native module failed to load in a packaged build, say — that is a property of the
// installation, not of this request. It is recorded ONCE and every later call answers
// `{ok:false}` immediately rather than re-attempting a failing spawn per alert. `{ok:false}` is
// the fallback seam W2 already handles: the alert is spoken by the system voice, and the user
// hears their alert. The ONE thing that unlatches it is `retryAfterRepair()` (JOS-274), called
// after provisioning has actually laid the Visual C++ runtime down beside the binding — a
// change to the installation is precisely the premise the latch was resting on.
//
// …AND IT SAYS WHICH KIND OF DEAD (JOS-247). Every failure here used to answer
// `reason:'engine-not-installed'`, which for a user whose download had FINISHED was simply
// untrue — the reporter had 115 MB of verified model on disk and was told, in as much as
// anything told them at all, that it was not downloaded. The reason is now the state:
// 'engine-not-installed' only from the install check, 'engine-unloadable' when the thread died
// with ERR_DLOPEN_FAILED (the native module cannot be loaded on this machine at all), and
// 'engine-failed' for everything else. The renderer renders those as different sentences.
//
// MEASURED, for the ERR_DLOPEN_FAILED case (2026-08-12, PE import tables of the shipped
// binaries): `onnxruntime_binding.node` imports VCRUNTIME140.dll, VCRUNTIME140_1.dll and
// MSVCP140.dll, and `onnxruntime.dll` imports those plus MSVCP140_1.dll. Electron ships none
// of them (there is no vcruntime140*.dll anywhere in electron/dist), so the app is relying on
// the machine having the Microsoft Visual C++ x64 redistributable — and a machine that has the
// 2015 redist but not the 2019+ one has VCRUNTIME140.dll and NOT VCRUNTIME140_1.dll, which
// fails exactly this way. That is why the log line below names it: the code alone made the
// first report a guessing game.
//
// ELECTRON-FREE ON PURPOSE. `userData` and the worker path are injected, so this module can
// be constructed in a test (and so that ipc/speech.ts stays the only place that knows about
// `app`). The same rule imageCache.ts follows.

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { eqSpeechUrl, speechCacheDir, speechCacheKey, speechCachePath } from './cache'
import { isKokoroInstalled, kokoroDir } from './provision'
import { KOKORO_ASSETS, KOKORO_DEFAULT_VOICE, kokoroVoiceLang } from './pinned'
import type * as ort from 'onnxruntime-node'
import type { SpeechSayResult } from '../../shared/types'

// ---- the worker's message contract (shared with worker.ts) ------------------------------

/** `workerData` — the three paths the worker needs, resolved once by the parent. */
export interface SpeechWorkerInit {
  readonly modelPath: string
  readonly voicesPath: string
  readonly cacheDir: string
}

/** One synthesis request. `hash` is the cache identity, computed by the parent so that both
 *  sides agree on the file name without re-deriving it. */
export interface SpeechWorkerJob {
  readonly id: number
  readonly hash: string
  readonly text: string
  readonly voiceId: string
}

/** The worker's answer. `ok` means the wav is on disk under `hash`. */
export type SpeechWorkerReply =
  | { readonly id: number; readonly ok: true }
  | { readonly id: number; readonly ok: false; readonly error: string }

// ---- the inference session's shape (JOS-365) --------------------------------------------

/**
 * The onnxruntime session options the worker creates its session with — a PURE function so the
 * numbers below can be pinned by a unit instead of living inside a native call nobody can see.
 * It lives here, not in worker.ts, because worker.ts loads onnxruntime at import time and a test
 * that dlopens a 92 MB native runtime is not a unit test.
 *
 * WHY THESE NUMBERS — THE GAME IS ON THIS BOX. onnxruntime's default intra-op pool is sized to
 * the machine's PHYSICAL CORES and spin-waits between ops, so every uncached phrase was a
 * full-machine CPU burst for the ~1.4 s it takes to speak one — on the same box, in the same
 * second, that EverQuest's render thread needs a core. MEASURED here (24 physical cores,
 * 5 alert phrases, cold session per configuration, median of 5):
 *
 *     intra-op threads │ median wall │ median CPU burned
 *     ─────────────────┼─────────────┼──────────────────
 *     default (24)     │    1423 ms  │   20 984 ms  ← 15 cores' worth, per phrase
 *     4                │    1097 ms  │    1 703 ms
 *     2                │    1211 ms  │      687 ms
 *     1                │    1405 ms  │      500 ms
 *
 * The parallelism was buying nothing: the int8 model's default pool spent 42x the CPU to finish
 * no sooner than one thread does. So one thread it is — same latency the field already hears,
 * one core instead of the machine. (Rule applied: the smallest count within 1.5x of the default's
 * median; 1405 ms is 0.99x.) The audio is unaffected — the wav for a fixed phrase is BYTE-IDENTICAL
 * at 1, 2, 4 and default threads, so the cache cannot hear this change.
 *
 * `intraOpNumThreads: 1` also settles the spin-waiting: at one thread onnxruntime runs the op on
 * the calling thread and never creates the pool, so there is no spinning to disable. That matters
 * because it CANNOT be disabled from here — the `session.intra_op.allow_spinning` config entry is
 * only reachable through `SessionOptions.extra`, which onnxruntime-node 1.20.1 does not read
 * (its own typings say "WebAssembly backend" only; the string `extra` does not appear in
 * `onnxruntime_binding.node`, and passing it measurably changed nothing). Setting it would have
 * been a comment pretending to be code.
 *
 * Composes with the process priority work: this pool's threads live in the main process and
 * inherit its priority class, so a below-normal main process makes a bounded burst politer still.
 */
export function kokoroSessionOptions(): ort.InferenceSession.SessionOptions {
  return {
    intraOpNumThreads: 1,
    interOpNumThreads: 1,
    executionMode: 'sequential'
  }
}

// ---- the engine -------------------------------------------------------------------------

export interface SpeechEngineOptions {
  readonly userData: string
  /** Absolute path of the built worker bundle (out/main/speechWorker.js). */
  readonly workerPath: string
  readonly onError?: (message: string, err: unknown) => void
  readonly onInfo?: (message: string) => void
  /**
   * Is the tier's model on disk? Defaults to the real `isKokoroInstalled`, and is overridden
   * ONLY by tests/speechEngine.test.mts — the same test seam, for the same reason, as
   * `ProvisionOptions.assets` next door. The real check demands two files at their exact pinned
   * byte lengths (92 MB and 28 MB), which a unit test cannot produce; without this seam the two
   * reasons JOS-247 exists to tell apart could never be tested apart, because every test would
   * stop at the install check.
   */
  readonly isInstalled?: () => boolean
}

export interface SpeechEngine {
  /** Synthesize (or serve from cache) one utterance. Never rejects. */
  say(text: string, voiceId: string | null | undefined): Promise<SpeechSayResult>
  /**
   * Forget a latched fault so the NEXT `say()` tries the worker again (JOS-274).
   *
   * The latch exists because "a dlopen that failed once fails identically every time" — which
   * is true right up until something CHANGES THE MACHINE, and provisioning the Visual C++
   * runtime beside the binding is exactly that. This is the one legitimate caller: it is
   * invoked only after files were actually placed, never speculatively, so the no-retry-storm
   * property the latch buys is untouched. Returns whether there was a fault to clear.
   */
  retryAfterRepair(): boolean
  /** Tear the worker down (app quit). Safe to call when it never started. */
  dispose(): void
}

/**
 * Resolve the voice a request should actually use.
 *
 * A stored `voiceId` is engine-scoped, and the prefs blob holds ONE id across both tiers — so
 * a user who picked a Windows SAPI voice and then switched to Kokoro arrives here with an id
 * this tier has never heard of. Falling back to the tier's own default voice is the
 * never-silent answer (world-model law 1 applied to audio): the alert is spoken, in a voice
 * that exists, rather than refused because a preference from the other tier came along.
 */
export function resolveKokoroVoice(voiceId: string | null | undefined): string {
  return voiceId && kokoroVoiceLang(voiceId) ? voiceId : KOKORO_DEFAULT_VOICE
}

/**
 * Did this thread die because the native module could not be LOADED?
 *
 * `ERR_DLOPEN_FAILED` is Node's code for a failed `process.dlopen`, and it is the code the
 * first field report carried (0.20.0, 2026-08-11) alongside `node:internal/modules/cjs`
 * frames — i.e. the throw happened while the worker was still requiring its imports, before
 * a single job could be handled. Anything else (a bad voice pack, an unexpected throw mid-run)
 * is a plain failure and says so.
 */
function isUnloadable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ERR_DLOPEN_FAILED'
}

/**
 * What the error log says about a dead thread. The unloadable sentence NAMES THE RUNTIME on
 * purpose (JOS-247): the code alone made the first field report a guessing game, and since
 * JOS-274 provisioning can act on the same fact rather than only print it.
 */
function workerFailureMessage(unloadable: boolean): string {
  return unloadable
    ? 'speech: the synthesis engine could not be loaded on this PC (ERR_DLOPEN_FAILED - its ' +
        'binaries need the Microsoft Visual C++ x64 runtime, which Electron does not ship); ' +
        'using the system voice'
    : 'speech: the synthesis worker failed; using the system voice'
}

/** The three paths the worker needs, resolved from the one directory the model lives in. */
function workerInit(userData: string, cacheDir: string): SpeechWorkerInit {
  return {
    modelPath: join(kokoroDir(userData), KOKORO_ASSETS[0].name),
    voicesPath: join(kokoroDir(userData), KOKORO_ASSETS[1].name),
    cacheDir
  }
}

export function createSpeechEngine(opts: SpeechEngineOptions): SpeechEngine {
  const cacheDir = speechCacheDir(opts.userData)
  const onError = opts.onError ?? ((): void => undefined)
  const onInfo = opts.onInfo ?? ((): void => undefined)

  const installed = opts.isInstalled ?? ((): boolean => isKokoroInstalled(opts.userData))

  let worker: Worker | null = null
  /**
   * Set once when the thread proves it cannot run here — see the header. It is the FAULT, not a
   * boolean, because it is also the answer `speech:say` gives from then on: this machine will
   * keep failing the same way until something about the machine changes.
   */
  let fault: 'engine-failed' | 'engine-unloadable' | null = null
  let nextJobId = 1
  const pending = new Map<number, (reply: SpeechWorkerReply) => void>()
  /** hash → the in-flight synthesis for it. */
  const inFlight = new Map<string, Promise<SpeechSayResult>>()

  /** Fail every outstanding job with one reason (the thread died under them). */
  function failAllPending(error: string): void {
    for (const [id, resolve] of pending) resolve({ id, ok: false, error })
    pending.clear()
  }

  function ensureWorker(): Worker | null {
    if (fault) return null
    if (worker) return worker
    let started: Worker
    try {
      mkdirSync(cacheDir, { recursive: true })
      started = new Worker(opts.workerPath, { workerData: workerInit(opts.userData, cacheDir) })
    } catch (err) {
      fault = 'engine-failed'
      onError('speech: the synthesis worker could not be started; using the system voice', err)
      return null
    }
    worker = started
    /**
     * A DEAD WORKER'S EVENTS MUST NOT SPEAK FOR A LIVE ONE (JOS-274). A thread that throws at
     * module load emits `error` AND, some ticks later, `exit` — and before `retryAfterRepair`
     * existed nothing could ever spawn a second worker, so the corpse's late `exit` had nothing
     * to land on. Now it does: it would fail the NEW worker's outstanding job with a generic
     * 'worker exited' before that worker had said anything about itself, turning an
     * 'engine-unloadable' answer into 'engine-failed' — i.e. losing exactly the distinction
     * JOS-247 exists for. Every handler below therefore answers only for the worker it belongs
     * to. (Caught by tests/speechVcRuntime.test.mts's repair case, which is the first code in
     * this repo ever to spawn twice.)
     */
    const isCurrent = (): boolean => worker === started
    started.on('message', (reply: SpeechWorkerReply) => {
      if (!isCurrent()) return
      pending.get(reply.id)?.(reply)
      pending.delete(reply.id)
    })
    started.on('error', (err) => {
      // A thread-level error (module load failure, an uncaught throw) kills the thread. Do
      // not respawn in a loop: record it and let every later call answer immediately. A retry
      // would be worse than useless for the case that actually happens — a dlopen that failed
      // once fails identically every time, and retrying would file the same report per alert.
      // (`retryAfterRepair` is the one exception, and it is driven by the machine changing.)
      if (!isCurrent()) return
      const unloadable = isUnloadable(err)
      fault = unloadable ? 'engine-unloadable' : 'engine-failed'
      worker = null
      onError(workerFailureMessage(unloadable), err)
      failAllPending('worker error')
    })
    started.on('exit', () => {
      if (!isCurrent()) return
      worker = null
      failAllPending('worker exited')
    })
    // `unref` so a warm worker never holds the process open at quit — the model is a
    // convenience, not a reason for the app to linger.
    started.unref()
    onInfo('[everquest-companion] Speech: Kokoro worker started')
    return started
  }

  /** Post one job and wait for its reply. Resolves false on any failure. */
  function runJob(hash: string, text: string, voiceId: string): Promise<boolean> {
    const w = ensureWorker()
    if (!w) return Promise.resolve(false)
    const id = nextJobId++
    return new Promise<boolean>((resolve) => {
      pending.set(id, (reply) => {
        if (!reply.ok) onError(`speech: synthesis failed - ${reply.error}`, null)
        resolve(reply.ok)
      })
      w.postMessage({ id, hash, text, voiceId } satisfies SpeechWorkerJob)
    })
  }

  async function synthesize(hash: string, text: string, voiceId: string): Promise<SpeechSayResult> {
    const ok = await runJob(hash, text, voiceId)
    // Trust the FILE, not the reply: the url we hand back is a promise that the protocol
    // handler will find bytes there, and only the filesystem can keep that promise.
    if (!ok || !existsSync(speechCachePath(opts.userData, hash))) {
      // The model IS installed (say() checked before we got here), so this is never
      // 'engine-not-installed'. `fault` when the thread told us what kind of dead it is.
      return { ok: false, reason: fault ?? 'engine-failed' }
    }
    return { ok: true, url: eqSpeechUrl(hash) }
  }

  return {
    async say(text, voiceId) {
      const voice = resolveKokoroVoice(voiceId)
      const hash = speechCacheKey(voice, text)
      // 1. The steady state: already synthesized, some session long ago. No worker, no model.
      if (existsSync(speechCachePath(opts.userData, hash))) {
        return { ok: true, url: eqSpeechUrl(hash) }
      }
      // 2. Nothing to synthesize WITH. Checked after the cache so that an already-spoken
      //    phrase keeps working even if the user deleted the model behind our back.
      if (!installed()) return { ok: false, reason: 'engine-not-installed' }
      // 3. Someone is already synthesizing exactly this. Join them.
      const existing = inFlight.get(hash)
      if (existing) return existing
      const run = synthesize(hash, text, voice).finally(() => inFlight.delete(hash))
      inFlight.set(hash, run)
      return run
    },
    retryAfterRepair() {
      if (fault === null) return false
      fault = null
      onInfo('[everquest-companion] Speech: the engine will be retried after a runtime repair')
      return true
    },
    dispose() {
      const w = worker
      worker = null
      failAllPending('shutting down')
      void w?.terminate()
    }
  }
}
