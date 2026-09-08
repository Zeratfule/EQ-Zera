// The Visual C++ runtime that rides the natural-voice download (JOS-274).
//
// No Electron, no network, no onnxruntime, so this file never skips. What it pins is the chain
// between "a machine cannot load the speech engine" and "it can":
//
//   1. WHERE THE BINDING IS — the ordered root probe, which has to be right for a dev checkout,
//      a packaged asar and an unpacked-beside-the-asar build all at once.
//   2. THE DETECTION SEAM — which of the four DLLs this machine cannot resolve. Getting this
//      wrong in the permissive direction means a silent no-op on the exact machine the ticket
//      exists for; in the strict direction it means downloading 3 MB onto machines that were
//      always fine.
//   3. THE ARCHIVE READER — the vsix is a zip and four files have to come out of it byte-exact.
//   4. THE PROVISIONING STATE MACHINE — fetch once, digest-gate twice (payload, then each file),
//      place atomically, and be a no-op the second time.
//   5. THE PLACEMENT SURVIVING AN APP UPDATE — the cache is in userData and outlives the
//      install directory, so the repair is re-derivable without a byte of network.
//   6. THE RE-PROBE — a latched engine fault is cleared by a repair and by nothing else.
//
// The pinned source is substituted with kilobyte stand-ins throughout (the `source` seam on
// VcRuntimeProvisionOptions), for the same reason the model download's `assets` seam exists: no
// test can produce 3 MB of bytes that hash to Microsoft's published digest, so with the real pin
// in place every case below would die on the length check and the digest gates — the thing most
// worth testing — would never run.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { readZipEntries, readZipEntryBytes } from '../src/main/speech/zipRead'
import {
  ONNX_BINDING_FILE,
  ensureVcRuntimePlacement,
  findOnnxBindingDir,
  hasVcRuntimeFiles,
  onnxBindingRoots,
  provisionVcRuntime,
  systemDllDir,
  vcRuntimeCacheDir,
  vcRuntimeGap
} from '../src/main/speech/vcRuntime'
import { VC_REDIST_PAYLOAD, VC_RUNTIME_FILES } from '../src/main/speech/pinned'
import { createSpeechEngine } from '../src/main/speech/engine'
import type { VcRuntimeFile } from '../src/main/speech/pinned'
import type { VcRuntimeSource } from '../src/main/speech/vcRuntime'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'eqc-vcrt-'))
}

// ------------------------------------------------------------------ a zip, written by hand
//
// Small enough to be obviously correct, and it doubles as the reader's counterparty: if the two
// ever disagree about an offset, every extraction case below goes red at once. CRCs are written
// as zero on purpose — the reader verifies with sha256, which is strictly stronger, and a CRC
// this file computed would only be proving that this file can compute a CRC.

interface ZipInput {
  readonly name: string
  readonly body: Buffer
  /** 0 = stored, 8 = deflate, anything else to drive the reader's refusal. */
  readonly method?: number
}

function buildZip(files: readonly ZipInput[]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const method = file.method ?? 8
    const payload = method === 0 ? file.body : deflateRawSync(file.body)
    const name = Buffer.from(file.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x0403_4b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(file.body.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, payload)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x0201_4b50, 0)
    dir.writeUInt16LE(method, 10)
    dir.writeUInt32LE(payload.length, 20)
    dir.writeUInt32LE(file.body.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)
    offset += 30 + name.length + payload.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x0605_4b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

// ------------------------------------------------------------------ the stand-in source

const DLL_BODIES: readonly (readonly [string, Buffer])[] = [
  ['vcruntime140.dll', Buffer.from('vcruntime140, in spirit'.repeat(9))],
  ['vcruntime140_1.dll', Buffer.from('vcruntime140_1, in spirit'.repeat(7))],
  ['msvcp140.dll', Buffer.from('msvcp140, in spirit'.repeat(11))],
  ['msvcp140_1.dll', Buffer.from('msvcp140_1, in spirit'.repeat(5))]
]

const ENTRY_DIR = 'Contents/VC/Redist/MSVC/1.2.3/x64/Microsoft.VC143.CRT/'

const FAKE_FILES: readonly VcRuntimeFile[] = DLL_BODIES.map(([name, body]) => ({
  name,
  path: `${ENTRY_DIR}${name}`,
  sha256: createHash('sha256').update(body).digest('hex'),
  bytes: body.length
}))

/** A payload shaped like the real vsix: the four files plus the noise the real one carries. */
const FAKE_PAYLOAD_BYTES = buildZip([
  { name: 'manifest.json', body: Buffer.from('{"pretend":true}') },
  ...DLL_BODIES.map(([name, body]) => ({ name: `${ENTRY_DIR}${name}`, body })),
  { name: `${ENTRY_DIR}concrt140.dll`, body: Buffer.from('not imported by anything we load') }
])

const FAKE_SOURCE: VcRuntimeSource = {
  payload: {
    name: 'CRT.Redist.X64.base.vsix',
    url: 'https://download.visualstudio.microsoft.com/download/pr/deadbeef/CRT.vsix',
    sha256: createHash('sha256').update(FAKE_PAYLOAD_BYTES).digest('hex'),
    bytes: FAKE_PAYLOAD_BYTES.length
  },
  files: FAKE_FILES
}

interface FetchCall {
  url: string
}

/** A fetch served from memory. `body` null makes every request a 404. */
function fakeFetch(body: Buffer | null, log: FetchCall[]) {
  return ((url: string): Promise<Response> => {
    log.push({ url })
    if (!body) return Promise.resolve(new Response(null, { status: 404 }))
    return Promise.resolve(new Response(new Uint8Array(body), { status: 200 }))
  }) as unknown as typeof fetch
}

/** A directory that looks like the unpacked onnxruntime-node bin dir. */
function bindingDirIn(root: string): string {
  const dir = join(root, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, ONNX_BINDING_FILE), 'pretend native module')
  return dir
}

/** A directory that looks like a machine's System32 for the four names given. */
function systemDirWith(root: string, names: readonly string[]): string {
  const dir = join(root, 'System32')
  mkdirSync(dir, { recursive: true })
  for (const name of names) writeFileSync(join(dir, name), 'the machine already had this')
  return dir
}

const NOWHERE = join(tmpdir(), 'eqc-vcrt-no-such-system-dir')

function runOptions(root: string, binding: string, system: string, log: FetchCall[]) {
  return {
    userData: root,
    bindingDir: binding,
    systemDir: system,
    source: FAKE_SOURCE,
    fetchImpl: fakeFetch(FAKE_PAYLOAD_BYTES, log),
    sleep: (): Promise<void> => Promise.resolve()
  }
}

// ---------------------------------------------------------------- 1. finding the binding

test('the binding roots cover dev, packaged and unpacked — unpacked FIRST', () => {
  const roots = onnxBindingRoots({
    appPath: join('C:', 'app', 'resources', 'app.asar'),
    cwd: join('C:', 'checkout')
  })
  const tail = join('node_modules', 'onnxruntime-node', 'bin', 'napi-v3', 'win32', 'x64')
  assert.deepEqual(roots, [
    join('C:', 'app', 'resources', 'app.asar.unpacked', tail),
    join('C:', 'app', 'resources', 'app.asar', tail),
    join('C:', 'checkout', tail)
  ])
  // A .node cannot be dlopen'd from inside an asar, so the unpacked address has to be tried
  // before the archived one or a packaged build would place four DLLs where nothing looks.
  assert.ok(roots[0].includes('app.asar.unpacked'))
  // …and no duplicates: `<resources>/app.asar` + '.unpacked' already IS the resources address.
  assert.equal(new Set(roots).size, roots.length)
})

test('a dev checkout resolves through the same list', () => {
  const roots = onnxBindingRoots({ appPath: join('C:', 'checkout'), cwd: join('C:', 'checkout') })
  assert.equal(roots.length, 3)
  assert.ok(roots.every((r) => !r.includes('undefined')))
})

test('findOnnxBindingDir picks the first root that really holds the binding', () => {
  const root = tempRoot()
  const real = bindingDirIn(root)
  const decoy = join(root, 'decoy')
  mkdirSync(decoy, { recursive: true })
  assert.equal(findOnnxBindingDir([decoy, real]), real)
  assert.equal(findOnnxBindingDir([decoy]), null)
})

test('systemDllDir reads the environment rather than hardcoding a drive letter', () => {
  assert.equal(systemDllDir({ SystemRoot: 'D:\\Win' }), join('D:\\Win', 'System32'))
  assert.equal(systemDllDir({ windir: 'E:\\Windows' }), join('E:\\Windows', 'System32'))
  assert.equal(systemDllDir({}), join('C:\\Windows', 'System32'))
})

// ---------------------------------------------------------------- 2. the detection seam

test('a machine with the redistributable installed has no gap', () => {
  const root = tempRoot()
  const system = systemDirWith(root, FAKE_FILES.map((f) => f.name))
  assert.deepEqual(vcRuntimeGap({ placementDir: null, systemDir: system, files: FAKE_FILES }), [])
})

test('THE JOS-247 SIGNATURE: the 2015 redist without the 2019+ one is a gap', () => {
  // Exactly the reported machine — VCRUNTIME140 and MSVCP140 present, VCRUNTIME140_1 absent.
  // The gap is what triggers the fetch, so this case getting a green light is the whole bug.
  const root = tempRoot()
  const system = systemDirWith(root, ['vcruntime140.dll', 'msvcp140.dll'])
  const gap = vcRuntimeGap({ placementDir: null, systemDir: system, files: FAKE_FILES })
  assert.deepEqual(gap.map((f) => f.name), ['vcruntime140_1.dll', 'msvcp140_1.dll'])
})

test('files already placed beside the binding close the gap without a system copy', () => {
  const root = tempRoot()
  const binding = bindingDirIn(root)
  for (const file of FAKE_FILES) writeFileSync(join(binding, file.name), 'placed earlier')
  assert.deepEqual(
    vcRuntimeGap({ placementDir: binding, systemDir: NOWHERE, files: FAKE_FILES }),
    []
  )
})

test('a copy that is on neither path does NOT count as resolvable', () => {
  // The loader searches the binding's own directory and the system directory for our module.
  // A DLL sitting in some other app's folder is not on either, and calling it good would be a
  // silent ERR_DLOPEN_FAILED later.
  const root = tempRoot()
  const elsewhere = join(root, 'some-other-app')
  mkdirSync(elsewhere, { recursive: true })
  for (const file of FAKE_FILES) writeFileSync(join(elsewhere, file.name), 'not on our path')
  const gap = vcRuntimeGap({ placementDir: bindingDirIn(root), systemDir: NOWHERE, files: FAKE_FILES })
  assert.equal(gap.length, FAKE_FILES.length)
})

test('the real pin names exactly the measured import closure', () => {
  // Four files, no more: concrt140/vccorlib140/msvcp140_2 ride in the same payload and are
  // imported by nothing this app loads. Adding one here is a decision, not a tidy-up.
  assert.deepEqual(VC_RUNTIME_FILES.map((f) => f.name), [
    'vcruntime140.dll',
    'vcruntime140_1.dll',
    'msvcp140.dll',
    'msvcp140_1.dll'
  ])
  // The URL is content-addressed: the digest is a path segment, which is what makes it
  // immutable rather than merely stable. A re-pin that loses this property is a regression.
  assert.ok(VC_REDIST_PAYLOAD.url.includes(VC_REDIST_PAYLOAD.sha256))
  assert.ok(VC_REDIST_PAYLOAD.url.startsWith('https://download.visualstudio.microsoft.com/'))
})

// ---------------------------------------------------------------- 3. the archive reader

test('the reader gets stored and deflated entries out byte-exact', () => {
  const stored = Buffer.from('stored bytes, uncompressed')
  const zip = buildZip([
    { name: 'a/stored.bin', body: stored, method: 0 },
    { name: 'a/deflated.bin', body: Buffer.from('x'.repeat(5000)) }
  ])
  const entries = readZipEntries(zip)
  assert.ok(entries)
  assert.deepEqual(entries.map((e) => e.name), ['a/stored.bin', 'a/deflated.bin'])
  assert.deepEqual(readZipEntryBytes(zip, entries[0]), stored)
  assert.deepEqual(readZipEntryBytes(zip, entries[1]), Buffer.from('x'.repeat(5000)))
})

test('the reader refuses what it does not do, rather than guessing', () => {
  assert.equal(readZipEntries(Buffer.from('not a zip at all')), null)
  const zip = buildZip([{ name: 'weird.bin', body: Buffer.from('hi'), method: 0 }])
  const entries = readZipEntries(zip)
  assert.ok(entries)
  // An unsupported compression method is null, never a plausible-looking wrong buffer.
  assert.equal(readZipEntryBytes(zip, { ...entries[0], method: 99 }), null)
  // A local-header offset that points at nothing is null too.
  assert.equal(readZipEntryBytes(zip, { ...entries[0], localHeaderOffset: 9999 }), null)
})

// ---------------------------------------------------------------- 4. provisioning

test('the happy path: one request, four DLLs beside the binding', async () => {
  const root = tempRoot()
  const binding = bindingDirIn(root)
  const log: FetchCall[] = []
  const result = await provisionVcRuntime(runOptions(root, binding, NOWHERE, log))
  assert.deepEqual(result, { skipped: false, placed: 4 })
  assert.equal(log.length, 1, 'ONE connection — the payload, once')
  for (const [name, body] of DLL_BODIES) {
    assert.deepEqual(readFileSync(join(binding, name)), body, name)
  }
  // The verified copy is kept in userData, which is what survives an app update.
  assert.ok(hasVcRuntimeFiles(vcRuntimeCacheDir(root), FAKE_FILES))
  // Nothing half-written survives a success.
  assert.ok(!existsSync(join(binding, `${FAKE_FILES[0].name}.part`)))
})

test('a machine that already has the runtime is a NO-OP with zero requests', async () => {
  const root = tempRoot()
  const binding = bindingDirIn(root)
  const system = systemDirWith(root, FAKE_FILES.map((f) => f.name))
  const log: FetchCall[] = []
  const result = await provisionVcRuntime(runOptions(root, binding, system, log))
  assert.deepEqual(result, { skipped: true, placed: 0 })
  assert.equal(log.length, 0, 'the politest request is the one not made')
  assert.ok(!existsSync(vcRuntimeCacheDir(root)), 'and nothing is written either')
})

test('provisioning is IDEMPOTENT: a second run fetches nothing and places nothing', async () => {
  const root = tempRoot()
  const binding = bindingDirIn(root)
  await provisionVcRuntime(runOptions(root, binding, NOWHERE, []))
  const log: FetchCall[] = []
  const again = await provisionVcRuntime(runOptions(root, binding, NOWHERE, log))
  assert.deepEqual(again, { skipped: true, placed: 0 })
  assert.equal(log.length, 0)
})

test('a PAYLOAD digest mismatch places nothing at all', async () => {
  const root = tempRoot()
  const binding = bindingDirIn(root)
  const log: FetchCall[] = []
  const wrong = Buffer.alloc(FAKE_PAYLOAD_BYTES.length, 7)
  const result = await provisionVcRuntime({
    ...runOptions(root, binding, NOWHERE, log),
    fetchImpl: fakeFetch(wrong, log)
  })
  assert.equal(result.placed, 0)
  assert.match(String(result.message), /sha256 mismatch/)
  assert.ok(!existsSync(join(binding, FAKE_FILES[0].name)))
})

test('a per-FILE digest mismatch places nothing, even from a valid archive', async () => {
  // The payload gate proves the archive is Microsoft's; this one proves the extractor pulled the
  // entry it meant to. They fail differently, and only one of them writes a DLL onto disk.
  const root = tempRoot()
  const binding = bindingDirIn(root)
  const tampered: VcRuntimeSource = {
    payload: FAKE_SOURCE.payload,
    files: FAKE_FILES.map((f, i) => (i === 2 ? { ...f, sha256: 'f'.repeat(64) } : f))
  }
  const result = await provisionVcRuntime({
    ...runOptions(root, binding, NOWHERE, []),
    source: tampered
  })
  assert.equal(result.placed, 0)
  assert.match(String(result.message), /msvcp140\.dll: sha256 mismatch/)
  assert.ok(!existsSync(join(binding, 'msvcp140.dll')))
})

test('an entry the payload does not carry is a clean failure, not a crash', async () => {
  const root = tempRoot()
  const binding = bindingDirIn(root)
  const missing: VcRuntimeSource = {
    payload: FAKE_SOURCE.payload,
    files: [{ ...FAKE_FILES[0], path: `${ENTRY_DIR}not-in-there.dll` }]
  }
  const result = await provisionVcRuntime({
    ...runOptions(root, binding, NOWHERE, []),
    source: missing
  })
  assert.equal(result.placed, 0)
  assert.match(String(result.message), /is not in the payload/)
})

test('an unreachable host gives up after the shared retry budget and says so', async () => {
  const root = tempRoot()
  const binding = bindingDirIn(root)
  const log: FetchCall[] = []
  const waits: number[] = []
  const result = await provisionVcRuntime({
    ...runOptions(root, binding, NOWHERE, log),
    fetchImpl: fakeFetch(null, log),
    sleep: (ms: number): Promise<void> => {
      waits.push(ms)
      return Promise.resolve()
    }
  })
  assert.equal(result.placed, 0)
  assert.ok(result.message)
  assert.equal(log.length, 3, 'three attempts, then stop — no storm')
  assert.deepEqual(waits, [2000, 4000])
  // BEST EFFORT: a failure here is a message, never a throw, because the model download that
  // follows it must not be cancelled by it.
})

test('no binding directory is reported, never silently treated as success', async () => {
  const root = tempRoot()
  const result = await provisionVcRuntime({
    userData: root,
    bindingDir: null,
    systemDir: NOWHERE,
    source: FAKE_SOURCE,
    fetchImpl: fakeFetch(FAKE_PAYLOAD_BYTES, [])
  })
  assert.equal(result.placed, 0)
  assert.match(String(result.message), /binding directory was not found/)
})

// ---------------------------------------------------------------- 5. surviving an update

test('an app update wipes the placement and the CACHE puts it back, offline', async () => {
  const root = tempRoot()
  const binding = bindingDirIn(root)
  await provisionVcRuntime(runOptions(root, binding, NOWHERE, []))
  // An update replaces the install directory wholesale. userData is untouched.
  rmSync(binding, { recursive: true, force: true })
  const fresh = bindingDirIn(root)
  assert.equal(await ensureVcRuntimePlacement(root, fresh, FAKE_FILES), 4)
  assert.deepEqual(readFileSync(join(fresh, 'msvcp140.dll')), DLL_BODIES[2][1])
  // …and it is a no-op the next time, and on a machine that never provisioned anything.
  assert.equal(await ensureVcRuntimePlacement(root, fresh, FAKE_FILES), 0)
  assert.equal(await ensureVcRuntimePlacement(tempRoot(), fresh, FAKE_FILES), 0)
  assert.equal(await ensureVcRuntimePlacement(root, null, FAKE_FILES), 0)
})

// ---------------------------------------------------------------- 6. the re-probe

test('a repair unlatches the engine fault; nothing else does', async () => {
  const root = tempRoot()
  const worker = join(root, 'dying-worker.cjs')
  writeFileSync(worker, "const e = new Error('dlopen failed'); e.code = 'ERR_DLOPEN_FAILED'; throw e\n")
  const engine = createSpeechEngine({
    userData: root,
    workerPath: worker,
    isInstalled: () => true
  })
  assert.deepEqual(await engine.say('charm break', 'af_heart'), {
    ok: false,
    reason: 'engine-unloadable'
  })
  // The latch is real: a second utterance answers from the fault without spawning anything.
  assert.deepEqual(await engine.say('mesmerization', 'af_heart'), {
    ok: false,
    reason: 'engine-unloadable'
  })
  // A repair clears it — once. A second call has nothing to clear, which is how the caller
  // knows not to announce a fix twice.
  assert.equal(engine.retryAfterRepair(), true)
  assert.equal(engine.retryAfterRepair(), false)
  // And the next utterance really does try again: the same worker dies the same way, which is
  // the honest outcome for a repair that did not take.
  assert.deepEqual(await engine.say('root', 'af_heart'), {
    ok: false,
    reason: 'engine-unloadable'
  })
  engine.dispose()
})
