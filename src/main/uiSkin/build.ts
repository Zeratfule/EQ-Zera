/**
 * Builds, inspects and removes the EQ Zera in-game UI skin. Electron-free: the app's IPC handler
 * and `npm run gen:eql-skin` both call these with explicit directories.
 *
 * THE SOURCE IS READ-ONLY. Every write goes through `writeOut`, which refuses a path outside the
 * output folder and any file name `isAllowedOutput` does not list. An output folder that holds
 * files but no manifest is not ours (a shipped skin, or someone's own), and every operation here
 * refuses it. All file IO is async so a build never stalls the main process.
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, isAbsolute } from 'node:path'
import { parseAnimationFrames, paintRect, type AnimFrame } from './animations'
import { recolorRgba } from './recolor'
import {
  ART_PIECES,
  MANIFEST_FILE,
  REGION_TEXTURES,
  RULES_VERSION,
  WHOLE_TEXTURES,
  isAllowedOutput,
  isXmlSource
} from './rules'
import { TgaError, decodeTga, encodeTga } from './tga'
import { rewriteXmlColors } from './xmlColors'

export interface SourceStamp {
  size: number
  mtimeMs: number
}

export interface SkinManifest {
  generator: 'EQ Zera'
  rulesVersion: number
  builtAt: string
  /** every default-skin file the build read, by its on-disk name */
  sources: Record<string, SourceStamp>
  /** every file the build wrote, manifest excluded */
  outputs: string[]
}

export interface BuildProgress {
  phase: 'reading' | 'textures' | 'xml' | 'done'
  done: number
  total: number
}

export interface BuildResult {
  textures: number
  xml: number
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

async function listDir(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir)
  } catch {
    return null
  }
}

/** Refuses an output folder that is the source, sits inside it, or holds files that are not ours. */
async function checkOutDir(sourceDir: string, outDir: string): Promise<SkinManifest | null> {
  const src = resolve(sourceDir)
  const out = resolve(outDir)
  const rel = relative(src, out)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new SkinBuildError('the output folder must not be the default skin or inside it')
  }
  const manifest = await readManifest(out)
  const entries = await listDir(out)
  if (!manifest && (entries?.length ?? 0) > 0) {
    throw new SkinBuildError(`${basename(out)} already holds files EQ Zera did not write`)
  }
  return manifest
}

function writeOut(outDir: string, name: string, data: Uint8Array | string): Promise<void> {
  if (!isAllowedOutput(name) || basename(name) !== name) {
    throw new SkinBuildError(`refusing to write ${name}`)
  }
  const target = resolve(outDir, name)
  if (relative(resolve(outDir), target) !== name) throw new SkinBuildError(`refusing to write ${name}`)
  return typeof data === 'string' ? writeFile(target, data, 'latin1') : writeFile(target, data)
}

interface SourceSet {
  /** lower-cased name -> on-disk name */
  byLower: Map<string, string>
  xml: string[]
  textures: { name: string; mode: 'whole' | 'regions' }[]
}

function planSources(entries: string[]): SourceSet {
  const byLower = new Map(entries.map((e) => [e.toLowerCase(), e]))
  const textures: SourceSet['textures'] = []
  for (const t of WHOLE_TEXTURES) {
    const name = byLower.get(t.toLowerCase())
    if (name) textures.push({ name, mode: 'whole' })
  }
  for (const t of REGION_TEXTURES) {
    const name = byLower.get(t.toLowerCase())
    if (name) textures.push({ name, mode: 'regions' })
  }
  return { byLower, xml: entries.filter(isXmlSource).sort(), textures }
}

/** Chrome rectangles minus art rectangles, for one atlas. */
function regionMask(frames: readonly AnimFrame[], texture: string, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h)
  const mine = frames.filter((f) => f.texture === texture.toLowerCase())
  for (const f of mine) if (!ART_PIECES.test(f.name)) paintRect(mask, w, f, 1)
  for (const f of mine) if (ART_PIECES.test(f.name)) paintRect(mask, w, f, 0)
  return mask
}

/** The recoloured texture, or null when it is not a TGA this codec reads or nothing changed. */
export function recolorTexture(buf: Uint8Array, mode: 'whole' | 'regions', frames: readonly AnimFrame[], name: string): Uint8Array | null {
  let img
  try {
    img = decodeTga(buf)
  } catch (e) {
    if (e instanceof TgaError) return null
    throw e
  }
  const mask = mode === 'whole' ? null : regionMask(frames, name, img.width, img.height)
  const rgba = new Uint8Array(img.rgba)
  if (recolorRgba(rgba, mask) === 0) return null
  return encodeTga({ ...img, rgba })
}

async function stampAll(dir: string, names: readonly string[]): Promise<Record<string, SourceStamp>> {
  const out: Record<string, SourceStamp> = {}
  for (const n of names) {
    const s = await stat(join(dir, n))
    out[n] = { size: s.size, mtimeMs: Math.round(s.mtimeMs) }
  }
  return out
}

/** One build's running state: where it reads and writes, what it wrote, how far it got. */
interface BuildRun {
  sourceDir: string
  outDir: string
  outputs: string[]
  done: number
  tick: (phase: BuildProgress['phase']) => void
}

async function readXml(run: BuildRun, plan: SourceSet): Promise<{ texts: Map<string, string>; frames: AnimFrame[] }> {
  const texts = new Map<string, string>()
  const frames: AnimFrame[] = []
  for (const x of plan.xml) {
    const text = await readFile(join(run.sourceDir, x), 'latin1')
    texts.set(x, text)
    frames.push(...parseAnimationFrames(text))
  }
  return { texts, frames }
}

async function writeTextures(run: BuildRun, plan: SourceSet, frames: readonly AnimFrame[]): Promise<void> {
  for (const t of plan.textures) {
    const recoloured = recolorTexture(await readFile(join(run.sourceDir, t.name)), t.mode, frames, t.name)
    if (recoloured) {
      await writeOut(run.outDir, t.name, recoloured)
      run.outputs.push(t.name)
    }
    run.done++
    run.tick('textures')
    await yieldTurn()
  }
}

async function writeXml(run: BuildRun, texts: ReadonlyMap<string, string>): Promise<void> {
  for (const [x, text] of texts) {
    const { text: next, changed } = rewriteXmlColors(text)
    if (changed > 0) {
      await writeOut(run.outDir, x, next)
      run.outputs.push(x)
    }
    run.done++
    run.tick('xml')
    if (run.done % 16 === 0) await yieldTurn()
  }
}

/** A file the previous build wrote and this one did not (a rule changed) must not linger. */
async function prune(run: BuildRun, previous: SkinManifest | null): Promise<void> {
  for (const old of previous?.outputs ?? []) {
    if (!run.outputs.includes(old) && isAllowedOutput(old) && basename(old) === old) {
      await rm(join(run.outDir, old), { force: true })
    }
  }
}

export async function buildSkin(
  sourceDir: string,
  outDir: string,
  onProgress?: (p: BuildProgress) => void
): Promise<BuildResult> {
  const entries = await listDir(sourceDir)
  if (!entries) throw new SkinBuildError('the default skin folder was not found')
  const previous = await checkOutDir(sourceDir, outDir)
  const plan = planSources(entries)
  const total = plan.xml.length + plan.textures.length
  const run: BuildRun = { sourceDir, outDir, outputs: [], done: 0, tick: () => undefined }
  run.tick = (phase) => onProgress?.({ phase, done: run.done, total })
  run.tick('reading')

  const { texts, frames } = await readXml(run, plan)
  await mkdir(outDir, { recursive: true })
  await writeTextures(run, plan, frames)
  const textureCount = run.outputs.length
  await writeXml(run, texts)
  await prune(run, previous)
  const manifest: SkinManifest = {
    generator: 'EQ Zera',
    rulesVersion: RULES_VERSION,
    builtAt: new Date().toISOString(),
    sources: await stampAll(sourceDir, [...plan.xml, ...plan.textures.map((t) => t.name)]),
    outputs: run.outputs
  }
  await writeOut(outDir, MANIFEST_FILE, JSON.stringify(manifest, null, 2))
  run.tick('done')
  return { textures: textureCount, xml: run.outputs.length - textureCount, outputs: run.outputs }
}

/** Is the skin there, ours, and built from the default skin as it is on disk right now? */
export async function skinStatus(sourceDir: string, outDir: string): Promise<SkinStatus> {
  const entries = await listDir(sourceDir)
  if (!entries) return { state: 'noSource' }
  const manifest = await readManifest(outDir)
  if (!manifest) {
    const out = await listDir(outDir)
    return { state: (out?.length ?? 0) > 0 ? 'foreign' : 'missing' }
  }
  const base = { builtAt: manifest.builtAt, fileCount: manifest.outputs.length }
  const fresh = manifest.rulesVersion === RULES_VERSION && (await sourcesUnchanged(sourceDir, entries, manifest))
  return { state: fresh ? 'current' : 'stale', ...base }
}

/** Every file the build read is still there with the same size and mtime, and no new one appeared. */
async function sourcesUnchanged(sourceDir: string, entries: string[], manifest: SkinManifest): Promise<boolean> {
  const plan = planSources(entries)
  const names = [...plan.xml, ...plan.textures.map((t) => t.name)]
  if (names.length !== Object.keys(manifest.sources).length) return false
  for (const n of names) {
    const was = manifest.sources[n]
    const s = await stat(join(sourceDir, n)).catch(() => null)
    if (!was || s?.size !== was.size || Math.round(s.mtimeMs) !== was.mtimeMs) return false
  }
  return true
}

/** Deletes the skin folder, and only a folder carrying EQ Zera's manifest. */
export async function removeSkin(outDir: string): Promise<boolean> {
  if (!(await readManifest(outDir))) return false
  await rm(outDir, { recursive: true, force: true })
  return true
}
