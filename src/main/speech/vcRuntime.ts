// vcRuntime.ts — the Microsoft Visual C++ x64 runtime, fetched and deployed APP-LOCAL so that
// a voice that downloads is a voice that plays (JOS-274, owner ruling 2026-08-13).
//
// THE STATE JOS-247 LEFT. The Kokoro tier's native module links against VCRUNTIME140,
// VCRUNTIME140_1, MSVCP140 and MSVCP140_1; Electron ships none of them; a PC that has the 2015
// redistributable but not the 2019+ one therefore fails `process.dlopen` with
// ERR_DLOPEN_FAILED. JOS-247 taught the app to SAY that, in a sentence naming the runtime —
// which is a correct answer that leaves the user to go and do something. This closes the loop:
// the same click that downloads 115 MB of voice also lays down the 770 KB of runtime it needs.
//
// WHAT IS PINNED, AND THE LICENSING ARGUMENT, ARE IN pinned.ts. The short version: we ship a
// URL and a hash, never Microsoft's bytes, because redistributing those binaries is reserved to
// licensed Visual Studio users — and Microsoft's own deployment documentation lists installing
// the DLLs in "the application local folder" as a supported option. So this fetches from
// Microsoft, verifies against a digest Microsoft published, and deploys the way Microsoft
// documents. Nothing is executed and nothing elevates.
//
// ── WHERE THE FILES GO, AND WHY THERE ────────────────────────────────────────────────────
//
// They go BESIDE `onnxruntime_binding.node`, in the same directory that already carries
// `onnxruntime.dll` and `DirectML.dll`. That is not a guess about Windows' DLL search order; it
// was MEASURED in this Electron build (43.2.0, 2026-08-13) by loading the real binding under a
// real `app.whenReady` and reading `process.report.getReport().sharedObjects`, which names every
// loaded module by full path. Same machine, same binding, twice:
//
//   with nothing beside the binding   with the four placed beside it
//   ───────────────────────────────   ──────────────────────────────
//   C:\Windows\SYSTEM32\VCRUNTIME140.dll    …\nat\VCRUNTIME140.dll
//   C:\Windows\SYSTEM32\VCRUNTIME140_1.dll  …\nat\VCRUNTIME140_1.dll
//   C:\Windows\SYSTEM32\MSVCP140.dll        …\nat\MSVCP140.dll
//   C:\Windows\SYSTEM32\MSVCP140_1.dll      …\nat\MSVCP140_1.dll
//
// and the binding LOADED both times. So placement wins over the system copy, all four come from
// one release rather than a mixture, and Microsoft's 14.44 files really do run this engine.
// (The mechanism: Node loads a `.node` with `LOAD_WITH_ALTERED_SEARCH_PATH`, whose documented
// effect is that the loading module's own directory is searched FIRST for the modules it pulls
// in. That it works at all also proves the process has not had `SetDefaultDllDirectories`
// narrowed underneath it, which is the one thing that would turn that flag into a no-op.)
//
// TWO REJECTED ALTERNATIVES, both worse for the same reason:
//   * `%PATH%`. Prepending a directory of ours to PATH would also be found, but PATH is the LAST
//     stop in the search order — System32 is searched before it, as the table above shows. On
//     the machine this feature exists for, System32 holds a 2015-era VCRUNTIME140.dll and
//     MSVCP140.dll and no VCRUNTIME140_1.dll, so PATH deployment would MIX a 14.0 msvcp140.dll
//     with our 14.44 msvcp140_1.dll — a combination nobody ships and nobody tested. Beside the
//     binding, all four come from one release or none do.
//   * The elevating installer (`vc_redist.x64.exe /install`). Explicitly excluded by the owner
//     ruling, and it would put a UAC prompt in the middle of a voice download.
//
// THE INSTALL DIRECTORY IS WRITABLE, and that is a property of this app rather than of Windows:
// electron-builder.yml pins `nsis.perMachine: false`, so every install lives under
// `%LOCALAPPDATA%\Programs` and the app can write to its own folder without elevation. A build
// that ever goes per-machine breaks this placement — placement failure is reported, not
// swallowed, and the JOS-247 message is still there underneath.
//
// ── WHEN IT FETCHES ──────────────────────────────────────────────────────────────────────
//
// CONDITIONALLY: only when the machine cannot already satisfy the four imports. `vcRuntimeGap`
// asks whether each file is resolvable from the placement directory or from the system
// directory, and provisioning does nothing at all when the answer is "all of them". That is the
// overwhelmingly common case — the runtime ships with a great many things — so the default
// experience of this ticket is one `existsSync` per file and no request at all. The scraper-law
// case for conditional is direct: the politest request is the one not made. The case AGAINST
// unconditional is stronger still: fetching always would mean placing always, and placing an
// app-local copy on a machine whose system copy is FINE takes the servicing burden Microsoft
// warns about for no benefit whatsoever.
//
// And the gap is all-or-nothing on purpose: if ANY of the four is unresolvable we place ALL
// four, for the version-consistency reason in the PATH note above.
//
// ── ETIQUETTE ────────────────────────────────────────────────────────────────────────────
//
// The fetch runs through `provisionAssets` — the same one connection, sha256 gate, atomic
// rename, three attempts and 2s/4s backoff the model download uses — with no progress
// callback, which is what makes it silent. It is BEST-EFFORT throughout: every failure here
// returns a reason and provisioning carries on to the model, because a user who cannot reach
// Microsoft's CDN should still get the voice pack they asked for, and the JOS-247 sentence is
// still the honest thing to show them afterwards.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { VC_REDIST_PAYLOAD, VC_RUNTIME_FILES } from './pinned'
import { provisionAssets } from './provision'
import { readZipEntries, readZipEntryBytes } from './zipRead'
import type { PinnedAsset, VcRuntimeFile } from './pinned'

/** The file every candidate directory is identified by — the thing that does the importing. */
export const ONNX_BINDING_FILE = 'onnxruntime_binding.node'

/** Where the binding lives inside the package, for every shape the app is ever unpacked in. */
const ONNX_BINDING_SUBPATH = join(
  'node_modules',
  'onnxruntime-node',
  'bin',
  'napi-v3',
  'win32',
  'x64'
)

/** `<userData>/speech/vcruntime` — the verified CACHE, which survives app updates. */
export function vcRuntimeCacheDir(userData: string): string {
  return join(userData, 'speech', 'vcruntime')
}

/**
 * The pinned facts, gathered so a test can substitute kilobyte stand-ins.
 *
 * Overridden ONLY by tests/speechVcRuntime.test.mts, and for exactly the reason
 * `ProvisionOptions.assets` next door carries the same seam: no test can produce 3 MB of bytes
 * that hash to Microsoft's digest, so without this the sha256 gate and the extraction would go
 * untested forever and only the length check would ever run.
 */
export interface VcRuntimeSource {
  readonly payload: PinnedAsset
  readonly files: readonly VcRuntimeFile[]
}

export const VC_RUNTIME_SOURCE: VcRuntimeSource = {
  payload: VC_REDIST_PAYLOAD,
  files: VC_RUNTIME_FILES
}

// ---- finding the binding -----------------------------------------------------------------

/** The two path facts the roots are built from — `bundledImages.ts`'s inputs, same reason. */
export interface OnnxBindingRootInputs {
  /** `app.getAppPath()` — the project root in dev, the asar path in a packaged build. */
  readonly appPath: string
  /** `process.cwd()` — the project root under `npm run dev` and under the e2e harness, which
   *  launches Electron with a bare main-script argument and `cwd` set to the checkout. */
  readonly cwd: string
}

/**
 * Every place the onnxruntime binding could be, in probe order. Pure, so the ordering is
 * testable without a filesystem.
 *
 * THE `.unpacked` ROOT IS FIRST AND THAT IS NOT COSMETIC: a `.node` cannot be dlopen'd from
 * inside an asar, so electron-builder.yml unpacks `node_modules/onnxruntime-node/bin/**` —
 * keeping the path it had INSIDE the archive, with `.unpacked` spliced onto the archive's own
 * name. Resolving to the archived address instead would name a directory nothing can load
 * from, and we would place four DLLs where Windows will never look.
 *
 * `bundledImageRoots` next door additionally probes `process.resourcesPath`; this does not,
 * because for a path UNDER the asar that root is the same string — `<resources>/app.asar` +
 * '.unpacked' is `<resources>/app.asar.unpacked` — and a duplicate probe entry is a reader's
 * trap, not a belt.
 */
export function onnxBindingRoots({ appPath, cwd }: OnnxBindingRootInputs): string[] {
  return [
    join(`${appPath}.unpacked`, ONNX_BINDING_SUBPATH),
    join(appPath, ONNX_BINDING_SUBPATH),
    join(cwd, ONNX_BINDING_SUBPATH)
  ]
}

/** The first root that actually holds the binding, or null when none does. */
export function findOnnxBindingDir(
  roots: readonly string[],
  exists: (p: string) => boolean = existsSync
): string | null {
  return roots.find((dir) => exists(join(dir, ONNX_BINDING_FILE))) ?? null
}

// ---- detection ---------------------------------------------------------------------------

/** `%SystemRoot%\System32` — where a machine with the redistributable installed keeps it. */
export function systemDllDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32')
}

/** The two directories a needed DLL may already be resolvable from, plus the file roster. */
export interface VcRuntimeDirs {
  /** Beside the binding — where THIS app would put them. Null when the binding was not found. */
  readonly placementDir: string | null
  readonly systemDir: string
  readonly files?: readonly VcRuntimeFile[]
  readonly exists?: (p: string) => boolean
}

/**
 * Which of the four the machine cannot resolve today — the JOS-247 signature, generalized.
 *
 * A file counts as resolvable if it sits beside the binding (search order step one) or in the
 * system directory (where an installed redistributable puts it). Anything else — a copy on
 * %PATH%, a copy in another app's folder — deliberately does NOT count: those are not on the
 * loader's path for OUR module, and a false "you're fine" here is a silent failure later.
 */
export function vcRuntimeGap(dirs: VcRuntimeDirs): VcRuntimeFile[] {
  const exists = dirs.exists ?? existsSync
  const files = dirs.files ?? VC_RUNTIME_FILES
  return files.filter((file) => {
    if (dirs.placementDir !== null && exists(join(dirs.placementDir, file.name))) return false
    return !exists(join(dirs.systemDir, file.name))
  })
}

// ---- extraction + placement --------------------------------------------------------------

/** Write bytes under a temp name in the destination directory, then rename — never torn. */
async function writeAtomic(dir: string, name: string, bytes: Buffer): Promise<void> {
  const part = join(dir, `${name}.part`)
  try {
    await writeFile(part, bytes)
    await rename(part, join(dir, name))
  } catch (err) {
    await rm(part, { force: true }).catch(() => undefined)
    throw err
  }
}

/**
 * Take the pinned files out of the downloaded payload and land them in the cache directory,
 * each verified against its own sha256.
 *
 * THE PER-FILE DIGEST IS NOT REDUNDANT with the payload's. The payload gate proves the ARCHIVE
 * is Microsoft's; this proves the extractor pulled the entry it meant to and inflated it
 * correctly. They fail in different ways, and only one of them writes a DLL onto disk that the
 * app will later ask Windows to load.
 *
 * Returns null on success, else the message to report.
 */
export async function extractVcRuntime(
  payloadPath: string,
  cacheDir: string,
  files: readonly VcRuntimeFile[]
): Promise<string | null> {
  let archive: Buffer
  try {
    archive = await readFile(payloadPath)
  } catch (err) {
    return `could not read ${payloadPath}: ${String(err)}`
  }
  const entries = readZipEntries(archive)
  if (!entries) return `${payloadPath} is not a readable archive`
  for (const file of files) {
    const entry = entries.find((e) => e.name === file.path)
    if (!entry) return `${file.path} is not in the payload`
    const bytes = readZipEntryBytes(archive, entry)
    if (!bytes) return `${file.path} could not be read out of the payload`
    if (bytes.length !== file.bytes) {
      return `${file.name}: got ${bytes.length} bytes, expected ${file.bytes}`
    }
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== file.sha256) return `${file.name}: sha256 mismatch (got ${digest})`
    await writeAtomic(cacheDir, file.name, bytes)
  }
  return null
}

/** Is every pinned file sitting in this directory? Presence is enough: nothing lands here
 *  except through `extractVcRuntime`'s digest gate and an atomic rename. */
export function hasVcRuntimeFiles(
  dir: string,
  files: readonly VcRuntimeFile[] = VC_RUNTIME_FILES,
  exists: (p: string) => boolean = existsSync
): boolean {
  return files.every((file) => exists(join(dir, file.name)))
}

/**
 * Copy the cached runtime beside the binding. IDEMPOTENT: a file already there is left alone,
 * so a second call moves nothing and the return value is the honest count of what changed.
 *
 * Copies go through a `.part` + rename like everything else in this tier — a half-written DLL
 * next to a native module is the one artefact that would turn a working install into a broken
 * one, and rename is atomic within a directory.
 */
export async function placeVcRuntime(
  cacheDir: string,
  bindingDir: string,
  files: readonly VcRuntimeFile[] = VC_RUNTIME_FILES
): Promise<number> {
  let placed = 0
  for (const file of files) {
    const target = join(bindingDir, file.name)
    if (existsSync(target)) continue
    const part = `${target}.part`
    try {
      await copyFile(join(cacheDir, file.name), part)
      await rename(part, target)
      placed++
    } catch (err) {
      await rm(part, { force: true }).catch(() => undefined)
      throw err
    }
  }
  return placed
}

/**
 * The no-network half, safe to call on any path that is about to load the engine.
 *
 * IT IS WHAT MAKES THE FIX SURVIVE AN APP UPDATE. The placement lives inside the install
 * directory and an update replaces that directory wholesale; the cache lives in `userData` and
 * does not. So the placement is re-derived from the cache rather than re-downloaded, and a user
 * who fixed their machine in March does not have to click download again in April. When the
 * cache is empty — which is every machine that never needed this — it is four `existsSync` and
 * a return.
 */
export async function ensureVcRuntimePlacement(
  userData: string,
  bindingDir: string | null,
  files: readonly VcRuntimeFile[] = VC_RUNTIME_FILES
): Promise<number> {
  const cacheDir = vcRuntimeCacheDir(userData)
  if (bindingDir === null || !hasVcRuntimeFiles(cacheDir, files)) return 0
  return placeVcRuntime(cacheDir, bindingDir, files)
}

// ---- the provisioning step ---------------------------------------------------------------

export interface VcRuntimeProvisionOptions {
  readonly userData: string
  /** Beside `onnxruntime_binding.node`. Null (binding not found) makes this a no-op. */
  readonly bindingDir: string | null
  readonly systemDir?: string
  readonly fetchImpl?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly source?: VcRuntimeSource
}

/** What a provisioning run did, so the caller can decide whether to re-probe the engine. */
export interface VcRuntimeResult {
  /** True when the machine needed nothing — the common case, and not a failure. */
  readonly skipped: boolean
  /** How many DLLs this run put beside the binding. >0 means the engine may now load. */
  readonly placed: number
  /** Why it could not finish, when it could not. Best-effort: the caller logs and moves on. */
  readonly message?: string
}

/**
 * Detect, fetch (once, if needed), extract, place. Never throws.
 *
 * Ordered so the cheapest thing that can end the run comes first: the gap check costs four
 * `existsSync`; the placement-from-cache costs a copy; only a machine with a real gap and no
 * cache reaches the network.
 */
export async function provisionVcRuntime(
  opts: VcRuntimeProvisionOptions
): Promise<VcRuntimeResult> {
  const source = opts.source ?? VC_RUNTIME_SOURCE
  const gap = vcRuntimeGap({
    placementDir: opts.bindingDir,
    systemDir: opts.systemDir ?? systemDllDir(),
    files: source.files
  })
  if (gap.length === 0) return { skipped: true, placed: 0 }
  if (opts.bindingDir === null) {
    return { skipped: false, placed: 0, message: 'the onnxruntime binding directory was not found' }
  }
  const cacheDir = vcRuntimeCacheDir(opts.userData)
  try {
    await mkdir(cacheDir, { recursive: true })
  } catch (err) {
    return { skipped: false, placed: 0, message: `could not create ${cacheDir}: ${String(err)}` }
  }
  if (!hasVcRuntimeFiles(cacheDir, source.files)) {
    const fetched = await fetchAndExtract(opts, source, cacheDir)
    if (fetched !== null) return { skipped: false, placed: 0, message: fetched }
  }
  try {
    return { skipped: false, placed: await placeVcRuntime(cacheDir, opts.bindingDir, source.files) }
  } catch (err) {
    return { skipped: false, placed: 0, message: `could not place the runtime: ${String(err)}` }
  }
}

/** Download the payload through the shared fetcher, then unpack it. Null on success. */
async function fetchAndExtract(
  opts: VcRuntimeProvisionOptions,
  source: VcRuntimeSource,
  cacheDir: string
): Promise<string | null> {
  const result = await provisionAssets({
    userData: opts.userData,
    dir: cacheDir,
    assets: [source.payload],
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep
    // No `onProgress`: this run is silent by construction (see the header).
  })
  if (!result.ok) return result.message ?? 'the runtime payload could not be downloaded'
  return extractVcRuntime(join(cacheDir, source.payload.name), cacheDir, source.files)
}
