/**
 * Builds, inspects and removes the EQ Zera in-game UI skin. Electron-free: the app's IPC handler
 * and `npm run gen:eql-skin` both call these with explicit folders.
 *
 * LAYERS. The skin inherits `default_modern` (the base) over `default` (the fallback the client
 * itself uses). For every file name in either: a chrome atlas is redrawn, a window background is
 * repainted, an in-game XML gets its colours retuned, and any other file is copied only when the
 * base carries a version that differs from the fallback. Whatever the skin does not hold, the
 * client loads from `default`, which is exactly where it would have come from anyway.
 *
 * THE SOURCES ARE READ-ONLY. Every write goes through `writeOut`, which refuses a path outside the
 * output folder and any name that is not a source file name or the manifest. An output folder that
 * holds files but no manifest is not ours, and every operation here refuses it. File IO is async.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { parseAnimationFrames, type AnimFrame } from './animations'
import { drawAtlas, drawBackground, readImage } from './atlas'
import { DEFAULT_STYLE, type Look, type SkinStyle, lookFor } from './look'
import { MANIFEST_FILE, RULES_VERSION, isChromeAtlas, isWholeTexture, isXmlSource } from './rules'
import { rewriteXmlColors } from './xmlColors'

/** The two skins the build reads: the one it inherits and the one the client falls back to. */
export interface SkinSources {
  base: string
  fallback: string
}

export interface SourceStamp {
  size: number
  mtimeMs: number
}

export interface SkinManifest {
  generator: 'EQ Zera'
  rulesVersion: number
  /** the ornament step the skin was drawn at (look.ts) */
  style?: SkinStyle
  builtAt: string
  /** every source file the build read, keyed `base/<name>` or `fallback/<name>` */
  sources: Record<string, SourceStamp>
  /** every file the build wrote, manifest excluded */
  outputs: string[]
}

export interface BuildProgress {
  phase: 'reading' | 'writing' | 'done'
  done: number
  total: number
}

export interface BuildResult {
  drawn: number
  xml: number
  inherited: number
  outputs: string[]
}

export type SkinState = 'noSource' | 'missing' | 'foreign' | 'stale' | 'current'

export interface SkinStatus {
  state: SkinState
  builtAt?: string
  fileCount?: number
}

export class SkinBuildError extends Error {}

const yieldTurn = (): Promise<void> => new Promise((r) => setImmediate(r))

async function readManifest(outDir: string): Promise<SkinManifest | null> {
  try {
    const raw = JSON.parse(await readFile(join(outDir, MANIFEST_FILE), 'utf8')) as Partial<SkinManifest>
    if (raw.generator !== 'EQ Zera' || typeof raw.sources !== 'object' || !Array.isArray(raw.outputs)) return null
    return raw as SkinManifest
  } catch {
    return null
  }
}

async function listFiles(dir: string): Promise<string[] | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return null
  }
}

function inside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Refuses an output folder that is a source, sits inside one, or holds files that are not ours. */
async function checkOutDir(src: SkinSources, outDir: string): Promise<SkinManifest | null> {
  if (inside(src.base, outDir) || inside(src.fallback, outDir)) {
    throw new SkinBuildError('the output folder must not be a shipped skin or inside one')
  }
  const manifest = await readManifest(outDir)
  if (!manifest && ((await listFiles(outDir))?.length ?? 0) > 0) {
    throw new SkinBuildError(`${basename(outDir)} already holds files EQ Zera did not write`)
  }
  return manifest
}

/** One source file as the layered view sees it. */
interface Layered {
  name: string
  path: string
  /** the fallback's file of the same name, when the winning file is the base's */
  fallbackPath: string | null
  /** the winning file is the base skin's */
  fromBase: boolean
}

interface Plan {
  files: Layered[]
  /** lower-cased names the build may write */
  allowed: Set<string>
  stampNames: string[]
}

async function planSources(src: SkinSources): Promise<Plan | null> {
  const fallback = await listFiles(src.fallback)
  if (!fallback) return null
  const base = (await listFiles(src.base)) ?? []
  const byLower = new Map<string, Layered>()
  for (const n of fallback) byLower.set(n.toLowerCase(), { name: n, path: join(src.fallback, n), fallbackPath: null, fromBase: false })
  for (const n of base) {
    const under = byLower.get(n.toLowerCase())
    byLower.set(n.toLowerCase(), { name: n, path: join(src.base, n), fallbackPath: under?.path ?? null, fromBase: true })
  }
  const files = [...byLower.values()].sort((a, b) => a.name.localeCompare(b.name))
  return {
    files,
    allowed: new Set([...byLower.keys(), MANIFEST_FILE]),
    stampNames: [...base.map((n) => `base/${n}`), ...fallback.map((n) => `fallback/${n}`)]
  }
}

function writeOut(run: BuildRun, name: string, data: Uint8Array | string): Promise<void> {
  if (!run.plan.allowed.has(name.toLowerCase()) || basename(name) !== name) throw new SkinBuildError(`refusing to write ${name}`)
  const target = resolve(run.outDir, name)
  if (relative(resolve(run.outDir), target) !== name) throw new SkinBuildError(`refusing to write ${name}`)
  run.outputs.push(name)
  return typeof data === 'string' ? writeFile(target, data, 'latin1') : writeFile(target, data)
}

interface BuildRun {
  outDir: string
  plan: Plan
  frames: AnimFrame[]
  look: Look
  outputs: string[]
  counts: { drawn: number; xml: number; inherited: number }
}

async function sameBytes(a: string, b: string | null): Promise<boolean> {
  if (!b) return false
  const [sa, sb] = await Promise.all([stat(a), stat(b)])
  if (sa.size !== sb.size) return false
  const [ba, bb] = await Promise.all([readFile(a), readFile(b)])
  return ba.equals(bb)
}

/** Draws, repaints or retunes one file; returns false when the file is not one the skin redraws. */
async function transform(run: BuildRun, f: Layered): Promise<boolean> {
  if (isChromeAtlas(f.name) || isWholeTexture(f.name)) {
    const img = readImage(f.name, await readFile(f.path))
    if (!img) return false
    const rgba = isWholeTexture(f.name) ? drawBackground(img) : drawAtlas(img, run.frames, f.name, run.look).rgba
    await writeOut(run, f.name, img.encode(rgba))
    run.counts.drawn++
    return true
  }
  if (isXmlSource(f.name)) {
    const { text, changed } = rewriteXmlColors(await readFile(f.path, 'latin1'))
    if (changed === 0) return false
    await writeOut(run, f.name, text)
    run.counts.xml++
    return true
  }
  return false
}

async function processFile(run: BuildRun, f: Layered): Promise<void> {
  if (await transform(run, f)) return
  // Inherit the base skin's own version of a file the client would otherwise take from default.
  if (!f.fromBase || (await sameBytes(f.path, f.fallbackPath))) return
  await writeOut(run, f.name, await readFile(f.path))
  run.counts.inherited++
}

async function readFrames(plan: Plan): Promise<AnimFrame[]> {
  const frames: AnimFrame[] = []
  for (const f of plan.files) if (/^EQUI.*\.xml$/i.test(f.name)) frames.push(...parseAnimationFrames(await readFile(f.path, 'latin1')))
  return frames
}

async function stampAll(src: SkinSources, names: readonly string[]): Promise<Record<string, SourceStamp>> {
  const out: Record<string, SourceStamp> = {}
  for (const key of names) {
    const [layer, ...rest] = key.split('/')
    const s = await stat(join(layer === 'base' ? src.base : src.fallback, rest.join('/')))
    out[key] = { size: s.size, mtimeMs: Math.round(s.mtimeMs) }
  }
  return out
}

/** A file the previous build wrote and this one did not (a rule changed) must not linger. */
async function prune(run: BuildRun, previous: SkinManifest | null): Promise<void> {
  const now = new Set(run.outputs.map((o) => o.toLowerCase()))
  for (const old of previous?.outputs ?? []) {
    if (!now.has(old.toLowerCase()) && run.plan.allowed.has(old.toLowerCase()) && basename(old) === old) {
      await rm(join(run.outDir, old), { force: true })
    }
  }
}

export interface BuildOptions {
  onProgress?: (p: BuildProgress) => void
  /** the ornament step (look.ts); DEFAULT_STYLE when absent */
  style?: SkinStyle
}

export async function buildSkin(src: SkinSources, outDir: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const { onProgress } = opts
  const style = opts.style ?? DEFAULT_STYLE
  const plan = await planSources(src)
  if (!plan) throw new SkinBuildError('the default skin folder was not found')
  const previous = await checkOutDir(src, outDir)
  const total = plan.files.length
  onProgress?.({ phase: 'reading', done: 0, total })
  const counts = { drawn: 0, xml: 0, inherited: 0 }
  const run: BuildRun = { outDir, plan, frames: await readFrames(plan), look: lookFor(style), outputs: [], counts }
  await mkdir(outDir, { recursive: true })
  for (let i = 0; i < plan.files.length; i++) {
    await processFile(run, plan.files[i])
    if (i % 16 === 15) {
      onProgress?.({ phase: 'writing', done: i + 1, total })
      await yieldTurn()
    }
  }
  await prune(run, previous)
  const outputs = [...run.outputs]
  const manifest: SkinManifest = {
    generator: 'EQ Zera',
    rulesVersion: RULES_VERSION,
    style,
    builtAt: new Date().toISOString(),
    sources: await stampAll(src, plan.stampNames),
    outputs
  }
  await writeOut(run, MANIFEST_FILE, JSON.stringify(manifest, null, 2))
  onProgress?.({ phase: 'done', done: total, total })
  return { ...counts, outputs }
}

/** Every file the build read is still there with the same size and mtime, and no new one appeared. */
async function sourcesUnchanged(src: SkinSources, plan: Plan, manifest: SkinManifest): Promise<boolean> {
  if (plan.stampNames.length !== Object.keys(manifest.sources).length) return false
  for (const key of plan.stampNames) {
    const was = manifest.sources[key]
    const [layer, ...rest] = key.split('/')
    const s = await stat(join(layer === 'base' ? src.base : src.fallback, rest.join('/'))).catch(() => null)
    if (!was || s?.size !== was.size || Math.round(s.mtimeMs) !== was.mtimeMs) return false
  }
  return true
}

/** Is the skin there, ours, and built from the skins as they are on disk right now? */
export async function skinStatus(src: SkinSources, outDir: string, style: SkinStyle = DEFAULT_STYLE): Promise<SkinStatus> {
  const plan = await planSources(src)
  if (!plan) return { state: 'noSource' }
  const manifest = await readManifest(outDir)
  if (!manifest) return { state: ((await listFiles(outDir))?.length ?? 0) > 0 ? 'foreign' : 'missing' }
  const base = { builtAt: manifest.builtAt, fileCount: manifest.outputs.length }
  const fresh =
    manifest.rulesVersion === RULES_VERSION && manifest.style === style && (await sourcesUnchanged(src, plan, manifest))
  return { state: fresh ? 'current' : 'stale', ...base }
}

/** Deletes the skin folder, and only a folder carrying EQ Zera's manifest. */
export async function removeSkin(outDir: string): Promise<boolean> {
  if (!(await readManifest(outDir))) return false
  await rm(outDir, { recursive: true, force: true })
  return true
}
