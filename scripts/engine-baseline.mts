// engine-baseline.mts — WHAT THE Z ENGINE COSTS ON THIS MACHINE, MEASURED (EQ Zera, 2026-09-06).
//
//   npx tsx scripts/engine-baseline.mts [--label <name>] [--log <path>] [--bin <path>] [--state-dir <dir>]
//   (npm run engine:baseline)
//
// `--state-dir` hands the engine a state directory the way the app does, which is what turns the
// fold checkpoint on: the first run over a log writes one at its landing, the next run restores it
// and scans only what was appended since. Measure a WARM start by running twice with the same dir.
//
// Spawns the release engine exactly the way the app does (token on stdin, announce line on
// stdout, hello over loopback TCP), attaches the real log, and polls `perf.snapshot` until the
// fold goes live - sampling the process's working set on the way. It prints one JSON record and
// writes it under docs/zengine/ so every later change to the engine has a before and an after.
//
// This is the measurement the Z Engine program is judged against. Nothing here is a benchmark
// harness with synthetic input: it is the user's own log, the shipped binary, the real protocol.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { createEngineClient } from '../src/shared/dataServer/client'
import { createNdjsonTransport } from '../src/shared/dataServer/ndjson'
import type { ClientMessage, EngineMessage, PerfSnapshotResult } from '../src/shared/dataServer/protocol.generated'
import { ENGINE_BIN_NAME, parseAnnounce } from '../src/main/dataServer/engineProtocol'
import { connectToEngine } from '../src/main/dataServer/socketChannel'
import { mintToken } from '../src/main/dataServer/token'
import { hostClockHint } from '../src/main/dataServer/hostClock'
import { systemProcessReader, type ProcessReading } from '../src/main/processSample'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BIN = join(ROOT, 'engine', 'target', 'release', ENGINE_BIN_NAME)
const DEFAULT_LOG_DIR = 'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends/Logs'
const POLL_MS = 250
const GIVE_UP_MS = 10 * 60 * 1000

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** The largest `eqlog_*.txt` in the game's Logs folder - the one a player actually plays on. */
function defaultLog(): string {
  let best: { path: string; size: number } | null = null
  for (const name of readdirSync(DEFAULT_LOG_DIR)) {
    if (!/^eqlog_.*\.txt$/i.test(name)) continue
    const path = join(DEFAULT_LOG_DIR, name)
    const size = statSync(path).size
    if (!best || size > best.size) best = { path, size }
  }
  if (!best) throw new Error(`no eqlog_*.txt under ${DEFAULT_LOG_DIR}; pass --log`)
  return best.path
}

interface Baseline {
  label: string
  at: string
  binary: string
  binaryBytes: number
  log: string
  logBytes: number
  spellDbMs: number | null
  scanMs: number | null
  scanBytes: number | null
  events: number | null
  scanMBps: number | null
  eventsPerSec: number | null
  /** wall time from the attach request to the first `live` snapshot, as the app would feel it */
  attachToLiveMs: number
  peakWorkingSetMb: number | null
  liveWorkingSetMb: number | null
  cpuMs: number | null
}

async function announce(child: ReturnType<typeof spawn>): Promise<number> {
  if (!child.stdout) throw new Error('the engine was spawned without a stdout pipe')
  const rl = createInterface({ input: child.stdout })
  for await (const line of rl) {
    const a = parseAnnounce(line)
    if (a) {
      rl.close()
      return a.port
    }
  }
  throw new Error('the engine exited without announcing a port')
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Spawn the engine the way the app does and hand back a hello'd client plus the child. */
async function launch(bin: string): Promise<{ child: ReturnType<typeof spawn>; client: ReturnType<typeof createEngineClient> }> {
  const token = mintToken()
  const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
  child.stdin?.write(`${token}\n`)
  const port = await announce(child)
  const client = createEngineClient({ token })
  client.attach(createNdjsonTransport<ClientMessage, EngineMessage>(await connectToEngine(port, 5000)))
  return { child, client }
}

interface Watched {
  last: PerfSnapshotResult
  attachToLiveMs: number
  peakWorkingSet: number | null
}

/** Attach the log and poll until the fold is live, sampling the working set on the way. */
async function foldToLive(client: ReturnType<typeof createEngineClient>, pid: number | undefined, log: string): Promise<Watched> {
  const read = systemProcessReader()
  const clock = hostClockHint(new Date(), () => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const stateDir = arg('state-dir')
  const t0 = Date.now()
  await client.request('session.attach', stateDir === undefined ? { logPath: log, clock } : { logPath: log, stateDir, clock })
  let peakWorkingSet: number | null = null
  let last: PerfSnapshotResult | null = null
  while (Date.now() - t0 < GIVE_UP_MS) {
    const ws = pid === undefined ? null : (read(pid)?.workingSetBytes ?? null)
    if (ws !== null) peakWorkingSet = Math.max(peakWorkingSet ?? 0, ws)
    last = await client.request('perf.snapshot', {})
    if (last.status === 'live') return { last, attachToLiveMs: Date.now() - t0, peakWorkingSet }
    await sleep(POLL_MS)
  }
  throw new Error(`the fold never went live (last status ${last?.status ?? 'none'})`)
}

const mb = (b: number | null): number | null => (b === null ? null : Math.round((b / 1048576) * 10) / 10)
const rate = (n: number | null, ms: number | null): number | null => (n && ms ? n / (ms / 1000) : null)

function record(args: { label: string; bin: string; log: string; watched: Watched; reading: ProcessReading | null }): Baseline {
  const { last, attachToLiveMs, peakWorkingSet } = args.watched
  const scanMs = last.ingest.scanMs ?? null
  const scanBytes = last.ingest.scanBytes ?? null
  const events = last.events ?? null
  const mbps = rate(scanBytes, scanMs)
  const eps = rate(events, scanMs)
  return {
    label: args.label,
    at: new Date().toISOString(),
    binary: args.bin,
    binaryBytes: statSync(args.bin).size,
    log: args.log,
    logBytes: statSync(args.log).size,
    spellDbMs: last.ingest.spellDbMs ?? null,
    scanMs,
    scanBytes,
    events,
    scanMBps: mbps === null ? null : Math.round((mbps / 1048576) * 10) / 10,
    eventsPerSec: eps === null ? null : Math.round(eps),
    attachToLiveMs,
    peakWorkingSetMb: mb(peakWorkingSet),
    liveWorkingSetMb: mb(args.reading?.workingSetBytes ?? null),
    cpuMs: args.reading?.cpuMs ?? null
  }
}

async function main(): Promise<void> {
  const label = arg('label') ?? 'baseline'
  const bin = arg('bin') ?? DEFAULT_BIN
  const log = arg('log') ?? defaultLog()
  if (!existsSync(bin)) throw new Error(`no engine at ${bin}; run cargo build --release first`)
  const { child, client } = await launch(bin)
  const watched = await foldToLive(client, child.pid, log)
  const reading = child.pid === undefined ? null : systemProcessReader()(child.pid)
  child.kill()
  const out = record({ label, bin, log, watched, reading })
  const dir = join(ROOT, 'docs', 'zengine')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${label}.json`)
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
  console.log(JSON.stringify(out, null, 2))
  console.log(`→ ${file}`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
