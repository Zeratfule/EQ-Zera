// pinned.ts — WHAT THE VOICE TIER DOWNLOADS. Three URLs, three sha256s, and the voice roster.
//
// This is the whole "what do we download" decision, isolated in one data file so that
// changing the model version is a reviewable diff and nothing else in the tree has an
// opinion about upstream. It is the sound-pack precedent (AGENTS.md: the shipped default
// pack self-provisions "from its pinned registry tag"), applied to a 120 MB model — and,
// since JOS-274, to the 3 MB Microsoft Visual C++ runtime the model's engine links against
// (bottom of this file).
//
// WHY A PINNED TAG AND NOT A BRANCH/`main`. A GitHub *release asset* under an immutable tag
// is the only upstream shape whose bytes cannot change under us. `resolve/main/...` on a
// model hub is a moving target: the maintainer re-uploads a re-quantized model, our sha256
// stops matching, and every user's install silently fails — or, worse, we don't check and
// they get different weights than we tested. The tag + the hash together mean the ONLY two
// outcomes are "exactly the bytes this wave was verified against" or "refuse and say so".
//
// WHY int8 AND NOT fp32/fp16. The full model is 325 MB, fp16 is 177 MB, int8 is 92 MB. This
// is a background alert reader saying "Mesmerization", not a narration engine: the int8
// quantization is inaudible at one-to-three-word utterances, and the download is a stranger's
// bandwidth (decision D4). 92 + 28 MB is already the single largest thing this app fetches.
//
// WHY THE VOICES ARE A SEPARATE FILE. Kokoro's voice identity is a per-token STYLE VECTOR,
// not a second model: `voices-v1.0.bin` is a numpy `.npz` holding 54 arrays of
// (510, 1, 256) float32 — one 256-float style vector per possible token count, per voice.
// It is data the model consumes, so it downloads and verifies exactly like the model does.
//
// MEASURED, NOT COPIED. Every number below was produced by downloading these two assets and
// hashing them during this wave (sizes are the `content-length` GitHub served; the sha256s
// are of the bytes on disk afterwards). The npz layout — 54 STORED (uncompressed) zip
// entries, ZIP64 headers, uniform 522,368-byte payloads — was verified by walking the real
// file, which is what `voicePack.ts` is written against.

import type { SpeechVoice } from '../../shared/types'

/** One file the Kokoro tier needs on disk. */
export interface PinnedAsset {
  /** File name inside `<userData>/speech/kokoro/`. Also the temp-file stem. */
  readonly name: string
  /** Immutable upstream URL (a GitHub release asset under a tag). */
  readonly url: string
  /** sha256 of the complete file, lowercase hex. A mismatch is a HARD failure. */
  readonly sha256: string
  /** Exact byte length. Used for progress + as a cheap pre-hash reject. */
  readonly bytes: number
}

/** The upstream release these assets come from — quoted so a reviewer can find it. */
export const KOKORO_RELEASE_TAG = 'model-files-v1.0'

/**
 * Kokoro-82M v1.0, int8-quantized ONNX. Apache-2.0 (the model) / MIT (kokoro-onnx, the
 * project that publishes these artifacts).
 */
export const KOKORO_MODEL: PinnedAsset = {
  name: 'kokoro-v1.0.int8.onnx',
  url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx',
  sha256: '6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb',
  bytes: 92_361_271
}

/** The 54-voice style-vector pack (`.npz`, stored entries — see voicePack.ts). */
export const KOKORO_VOICES_PACK: PinnedAsset = {
  name: 'voices-v1.0.bin',
  url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
  sha256: 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d',
  bytes: 28_214_398
}

/** Everything the tier needs, in download order (model first — it is the long one). */
export const KOKORO_ASSETS: readonly PinnedAsset[] = [KOKORO_MODEL, KOKORO_VOICES_PACK]

/** Total download, for the prefs UI's "before you download this" line. */
export const KOKORO_TOTAL_BYTES = KOKORO_ASSETS.reduce((n, a) => n + a.bytes, 0)

/** Kokoro emits 24 kHz mono. Not configurable — it is a property of the trained model. */
export const KOKORO_SAMPLE_RATE = 24_000

/**
 * The model's style table has 510 rows, indexed by TOKEN COUNT, so 509 phoneme tokens is the
 * hard ceiling. `MAX_SPEECH_CHARS` (120) makes that unreachable for real alert text — English
 * runs ~1.1 phonemes per character — but the tokenizer clamps anyway rather than trusting it.
 */
export const KOKORO_MAX_TOKENS = 509

// ---- the voice roster -----------------------------------------------------------------
//
// The pack holds 54 voices across 8 languages. We offer the 28 ENGLISH ones, and that is a
// deliberate limit, not an oversight: our phonemizer is espeak-ng (English rules), so a
// Japanese or Mandarin voice fed English-derived phonemes produces confident nonsense. The
// upstream project reaches those voices through language-specific G2P (misaki ja/zh) that we
// do not ship. World-model law 6 applied to a dependency: say what the pipeline can actually
// say. `listKokoroVoices` intersects THIS table with what the downloaded file really
// contains, so a future pack that drops a voice drops it from the picker too.
//
// `lang` decides which espeak dialect phonemizes the text for that voice — 'en-us' for the
// a-prefixed voices, 'en-gb' for the b-prefixed ones. Getting that pairing wrong is audible
// (an American style vector driving British phonemes slurs), so it lives with the voice.

interface KokoroVoiceRow {
  readonly id: string
  readonly label: string
  readonly lang: 'en-US' | 'en-GB'
}

const US = 'en-US'
const GB = 'en-GB'

/** The English voices, in the upstream's own quality order (best first within each group). */
export const KOKORO_VOICE_ROWS: readonly KokoroVoiceRow[] = [
  { id: 'af_heart', label: 'Heart (US, female)', lang: US },
  { id: 'af_bella', label: 'Bella (US, female)', lang: US },
  { id: 'af_nicole', label: 'Nicole (US, female)', lang: US },
  { id: 'af_aoede', label: 'Aoede (US, female)', lang: US },
  { id: 'af_kore', label: 'Kore (US, female)', lang: US },
  { id: 'af_sarah', label: 'Sarah (US, female)', lang: US },
  { id: 'af_nova', label: 'Nova (US, female)', lang: US },
  { id: 'af_sky', label: 'Sky (US, female)', lang: US },
  { id: 'af_alloy', label: 'Alloy (US, female)', lang: US },
  { id: 'af_jessica', label: 'Jessica (US, female)', lang: US },
  { id: 'af_river', label: 'River (US, female)', lang: US },
  { id: 'am_fenrir', label: 'Fenrir (US, male)', lang: US },
  { id: 'am_michael', label: 'Michael (US, male)', lang: US },
  { id: 'am_puck', label: 'Puck (US, male)', lang: US },
  { id: 'am_echo', label: 'Echo (US, male)', lang: US },
  { id: 'am_eric', label: 'Eric (US, male)', lang: US },
  { id: 'am_liam', label: 'Liam (US, male)', lang: US },
  { id: 'am_onyx', label: 'Onyx (US, male)', lang: US },
  { id: 'am_santa', label: 'Santa (US, male)', lang: US },
  { id: 'am_adam', label: 'Adam (US, male)', lang: US },
  { id: 'bf_emma', label: 'Emma (UK, female)', lang: GB },
  { id: 'bf_isabella', label: 'Isabella (UK, female)', lang: GB },
  { id: 'bf_alice', label: 'Alice (UK, female)', lang: GB },
  { id: 'bf_lily', label: 'Lily (UK, female)', lang: GB },
  { id: 'bm_fable', label: 'Fable (UK, male)', lang: GB },
  { id: 'bm_george', label: 'George (UK, male)', lang: GB },
  { id: 'bm_daniel', label: 'Daniel (UK, male)', lang: GB },
  { id: 'bm_lewis', label: 'Lewis (UK, male)', lang: GB }
]

/** The default voice when the user has expressed no preference — upstream's top-graded one. */
export const KOKORO_DEFAULT_VOICE = 'af_heart'

const ROWS_BY_ID = new Map(KOKORO_VOICE_ROWS.map((r) => [r.id, r]))

/** The espeak dialect a voice id wants, or null when the id is not one we offer. */
export function kokoroVoiceLang(id: string): 'en-US' | 'en-GB' | null {
  return ROWS_BY_ID.get(id)?.lang ?? null
}

/**
 * Turn the ids a downloaded pack actually contains into the picker's rows. Order follows the
 * curated table (quality order), not the pack's alphabetical layout, and anything the table
 * doesn't know is dropped — see the roster note above.
 */
export function kokoroVoicesFor(availableIds: ReadonlySet<string>): SpeechVoice[] {
  return KOKORO_VOICE_ROWS.filter((r) => availableIds.has(r.id)).map((r) => ({
    id: r.id,
    label: r.label,
    engine: 'kokoro' as const,
    lang: r.lang
  }))
}

// ---- the Microsoft Visual C++ x64 runtime (JOS-274) --------------------------------------
//
// WHY THE VOICE DOWNLOAD CARRIES A C RUNTIME AT ALL. Owner ruling 2026-08-13: a voice that
// downloads is a voice that plays. JOS-247 established (PE import tables, and the field report
// behind it) that `onnxruntime_binding.node` and `onnxruntime.dll` link against the MSVC
// runtime, that Electron ships none of it, and that a PC with the 2015 redist but not the
// 2019+ one fails to load the engine with ERR_DLOPEN_FAILED. JOS-247 could only SAY so. This
// pin is how provisioning fixes it.
//
// THE EXACT FILE SET WAS MEASURED, NOT ASSUMED (2026-08-13, PE import tables of the shipped
// binaries plus the transitive closure of the DLLs below):
//
//   onnxruntime_binding.node → onnxruntime.dll, MSVCP140, VCRUNTIME140, VCRUNTIME140_1
//   onnxruntime.dll          → MSVCP140, MSVCP140_1, VCRUNTIME140, VCRUNTIME140_1, DirectML…
//   msvcp140.dll             → VCRUNTIME140, VCRUNTIME140_1
//   msvcp140_1.dll           → MSVCP140, VCRUNTIME140
//   vcruntime140_1.dll       → VCRUNTIME140
//
// The closure is these FOUR and nothing else (everything further out is `api-ms-win-crt-*`,
// i.e. the Universal CRT, which has been part of Windows since Windows 10). The same vsix
// carries concrt140, vccorlib140, msvcp140_2, msvcp140_atomic_wait and vcruntime140_threads;
// none of them is imported by anything this app loads, so none of them is fetched.
//
// WHERE THE BYTES COME FROM, AND WHY IT IS THIS AND NOT SOMETHING EASIER.
//
//   * NOT `https://aka.ms/vs/17/release/vc_redist.x64.exe`. That is the link JOS-247's message
//     effectively points a user at, and it is the one thing a hash-pinned fetcher cannot use:
//     it is a MOVING alias that re-points at every servicing update, so a pinned digest would
//     go stale on Microsoft's schedule and every install would start failing verification.
//     It is also an elevating installer, which the owner ruling excludes.
//   * NOT A COPY WE HOST. Microsoft's own words (learn.microsoft.com "Redistribute Visual C++
//     Files"): "Distribution of the Visual C++ Runtime Redistributable package, merge modules,
//     and individual binaries is limited to licensed Visual Studio users and is subject to
//     Microsoft Software License Terms." Putting these four DLLs in a GitHub release asset of
//     this PUBLIC repo — the Kokoro precedent above — would be exactly that distribution, and
//     this project has no Visual Studio licence to do it under. So we ship a URL and a hash,
//     never the bytes: the user's machine gets the runtime FROM MICROSOFT, which is what the
//     JOS-247 message asks them to do by hand.
//   * THE PAYLOAD IS A `.vsix`, WHICH IS A ZIP. Microsoft's Visual Studio release channel
//     (`https://aka.ms/vs/17/release/channel` → the VisualStudio.vsman manifest) publishes the
//     CRT redistributable as an ordinary PKZIP archive at a CONTENT-ADDRESSED url — the sha256
//     is literally a path segment — with the same digest stated in the manifest. That makes it
//     immutable by construction: the URL cannot serve different bytes without ceasing to be
//     that URL. `zipRead.ts` takes the four files out; nothing is executed, nothing elevates,
//     and no installer runs. (The alternative Microsoft artifact, vc_redist.x64.exe, is a WiX
//     burn bundle whose payloads are LZX cabinets behind a PE container — not extractable in
//     pure Node, and reachable only by RUNNING a downloaded executable.)
//
// DEPLOYMENT IS APP-LOCAL, which is Microsoft's own documented third option on that same page:
// "It's also possible to directly install the Redistributable DLLs in the application local
// folder." Their caveat — that local deployment makes the app responsible for servicing the
// runtime — is priced and accepted here: this is a fallback for a machine that HAS no runtime
// to service, the system copy still wins wherever one exists (vcRuntime.ts's search-order
// note), and re-pinning is a one-line diff in this file.
//
// EVERY NUMBER BELOW WAS MEASURED BY FETCHING IT (2026-08-13). Note that the VS manifest's own
// `size` field for this payload says 3,236,248 and the file is 3,224,191 bytes (the served
// `Content-Length`, and the length on disk, and what the pinned sha256 is a digest OF). The
// manifest's number is not the payload length; do not copy it in.

/** The channel manifest this payload was read out of, quoted so a reviewer can re-derive it. */
export const VC_REDIST_MANIFEST = 'https://aka.ms/vs/17/release/channel'

/** The VS package id + version the payload is, for the same reason. */
export const VC_REDIST_PACKAGE = 'Microsoft.VC.14.44.17.14.CRT.Redist.X64.base 14.44.35211'

/** One DLL to lift out of the payload. `path` is the entry's EXACT name inside the archive. */
export interface VcRuntimeFile {
  readonly name: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

/** Where the redist files sit inside the vsix (the toolset version, not the package version). */
const VC_ENTRY_DIR = 'Contents/VC/Redist/MSVC/14.44.35112/x64/Microsoft.VC143.CRT/'

const vcFile = (name: string, sha256: string, bytes: number): VcRuntimeFile => ({
  name,
  path: `${VC_ENTRY_DIR}${name}`,
  sha256,
  bytes
})

/** The measured import closure, in dependency order (each imports only the ones before it). */
export const VC_RUNTIME_FILES: readonly VcRuntimeFile[] = [
  vcFile('vcruntime140.dll', 'd5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066', 124_544),
  vcFile('vcruntime140_1.dll', '1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f', 49_792),
  vcFile('msvcp140.dll', '0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9', 557_728),
  vcFile('msvcp140_1.dll', 'bfad5aef4c63a669e3c140655cdfdf395b6c979b400a447bd5dcb65ed8826c3d', 35_952)
]

/** The archive those four come out of — downloaded by the same pinned machinery as the model. */
export const VC_REDIST_PAYLOAD: PinnedAsset = {
  name: 'Microsoft.VC.14.44.17.14.CRT.Redist.X64.base.vsix',
  url:
    'https://download.visualstudio.microsoft.com/download/pr/45d3b8dd-bced-4b37-9974-142f748d710c/' +
    '4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5/' +
    'Microsoft.VC.14.44.17.14.CRT.Redist.X64.base.vsix',
  sha256: '4aaf54db0bfc9435f7c3660e1a00237a4b556042bfeea64bde44c2e0194e6ee5',
  bytes: 3_224_191
}
