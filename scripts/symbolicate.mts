/**
 * symbolicate.mts — turn an error report's `out/…:line:col` frames back into source terms.
 *
 *   npx tsx scripts/symbolicate.mts --maps <dir> --frames <file.json>
 *   npx tsx scripts/symbolicate.mts --maps out --frames -        (frames JSON on stdin)
 *
 * An `errorReport` frame names a BUNDLE position: `out/renderer/assets/index-a1b2.js:1:48213`.
 * That is a fingerprint, not a diagnosis — the file is minified onto a handful of lines and the
 * column is the only real information in it. This resolves each frame through the `.map` beside
 * it and prints `src/renderer/src/features/combat/CombatView.tsx:214:9`, which is a place a
 * person can open.
 *
 * ---------------------------------------------------------------------------------------
 * NO NEW DEPENDENCY, and that is a decision rather than an accident.
 * ---------------------------------------------------------------------------------------
 * The `source-map` package would do this, and adding it would put a package into the tree whose
 * only job is a base64-VLQ loop that is ninety lines long and has not changed since 2011. This
 * repo runs `ignore-scripts=true` precisely because a dependency is a supply-chain decision;
 * paying that for an integer decoder would be the wrong trade. The format is specified
 * (Source Map v3) and `tests/symbolicate.test.mts` pins the decoder against a map this repo's
 * own build produced, so "we implemented it ourselves" is checkable rather than asserted.
 *
 * NEAREST-MAPPING-AT-OR-BEFORE is the resolution rule, which is what every sourcemap consumer
 * does: a generated position rarely falls exactly on a mapping, and the mapping that STARTS at
 * or before it is the segment it belongs to. A position before the first mapping on its line
 * resolves to nothing and is reported as unmapped rather than guessed at.
 *
 * IT IS ALSO A LIBRARY. `scripts/triage-feedback.mts errors` imports `symbolicateFrames` to
 * annotate an exemplar in place, so the CLI and this command can never disagree about what a
 * frame means.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

/** One frame as an `errorReport` carries it. */
export interface Frame {
  file: string
  line: number
  col: number
  func: string
}

/** …and what it resolves to. `source: null` means the map had no mapping for that position. */
export interface Resolved extends Frame {
  source: string | null
  sourceLine: number
  sourceCol: number
  /** The ORIGINAL function name, when the map carried one. Minifiers usually drop these. */
  name: string | null
}

interface RawMap {
  version?: number
  sources?: string[]
  names?: string[]
  mappings?: string
  sourceRoot?: string
}

/** One decoded segment of a generated line, in the order the format packs them. */
interface Segment {
  genCol: number
  srcIndex: number
  srcLine: number
  srcCol: number
  nameIndex: number
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Base64 VLQ, one value at a time. Six bits per character: the low bit of the decoded value is
 * the SIGN, and the continuation bit is 0x20. Returns the value and where the cursor ended.
 */
function decodeVlq(text: string, at: number): { value: number; next: number } {
  let result = 0
  let shift = 0
  let i = at
  for (;;) {
    const digit = B64.indexOf(text[i])
    if (digit < 0) throw new Error(`symbolicate: bad VLQ character at ${String(i)}`)
    i += 1
    result += (digit & 0x1f) << shift
    if ((digit & 0x20) === 0) break
    shift += 5
  }
  // The sign lives in bit 0, so a negative zero is representable and means 0.
  const negative = (result & 1) === 1
  const value = result >> 1
  return { value: negative ? -value : value, next: i }
}

/**
 * Decode a whole `mappings` string into per-generated-line segment lists.
 *
 * FOUR OF THE FIVE FIELDS ARE RELATIVE and only `genCol` resets per line — that asymmetry is the
 * format's one real trap, and getting it backwards produces plausible-looking wrong answers
 * rather than an error.
 */
export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = []
  let segments: Segment[] = []
  let srcIndex = 0
  let srcLine = 0
  let srcCol = 0
  let nameIndex = 0
  let genCol = 0
  let i = 0
  while (i < mappings.length) {
    const c = mappings[i]
    if (c === ';') {
      lines.push(segments)
      segments = []
      genCol = 0
      i += 1
      continue
    }
    if (c === ',') {
      i += 1
      continue
    }
    const fields: number[] = []
    while (i < mappings.length && mappings[i] !== ',' && mappings[i] !== ';') {
      const { value, next } = decodeVlq(mappings, i)
      fields.push(value)
      i = next
    }
    genCol += fields[0]
    if (fields.length >= 4) {
      srcIndex += fields[1]
      srcLine += fields[2]
      srcCol += fields[3]
      if (fields.length >= 5) nameIndex += fields[4]
      segments.push({
        genCol,
        srcIndex,
        srcLine,
        srcCol,
        nameIndex: fields.length >= 5 ? nameIndex : -1
      })
    } else {
      // A one-field segment marks generated code with NO original position. It is kept, with a
      // sentinel source, so a lookup landing on it answers "unmapped" instead of silently
      // attributing the position to whatever segment came before.
      segments.push({ genCol, srcIndex: -1, srcLine: 0, srcCol: 0, nameIndex: -1 })
    }
  }
  lines.push(segments)
  return lines
}

/** A loaded map, decoded once. */
export interface LoadedMap {
  sources: string[]
  names: string[]
  lines: Segment[][]
}

export function loadMap(text: string): LoadedMap {
  const raw = JSON.parse(text) as RawMap
  const root = raw.sourceRoot ?? ''
  return {
    sources: (raw.sources ?? []).map((s) => (root === '' ? s : `${root}/${s}`)),
    names: raw.names ?? [],
    lines: decodeMappings(raw.mappings ?? '')
  }
}

/**
 * The mapping at or before `(line, col)`, 1-based line / 0-based column as a stack trace states
 * them. Binary search over a list the format guarantees is sorted by `genCol`.
 */
export function lookup(map: LoadedMap, line: number, col: number): Segment | null {
  const segments = map.lines[line - 1]
  if (segments === undefined || segments.length === 0) return null
  let lo = 0
  let hi = segments.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (segments[mid].genCol <= col) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (found < 0) return null
  return segments[found].srcIndex < 0 ? null : segments[found]
}

/** Cache: one exemplar's ten frames usually name two files, so this is two reads, not ten. */
const cache = new Map<string, LoadedMap | null>()

function mapFor(mapsDir: string, file: string): LoadedMap | null {
  const held = cache.get(file)
  if (held !== undefined) return held
  // `file` is `out/renderer/assets/index-a1b2.js`; the maps directory is the one that CONTAINS
  // `out`, or `out` itself. Both spellings are accepted because both are what a person types.
  const candidates = [
    join(mapsDir, `${file}.map`),
    join(mapsDir, `${file.replace(/^out\//, '')}.map`)
  ]
  const path = candidates.find((p) => existsSync(p))
  const loaded = path === undefined ? null : loadMap(readFileSync(path, 'utf8'))
  cache.set(file, loaded)
  return loaded
}

/**
 * Resolve every frame it can. A frame whose map is missing, or whose position has no mapping,
 * comes back with `source: null` — REPORTED, never dropped: "this build's maps are not here" is
 * a thing the reader needs to know, and a silently shorter list would not say it.
 */
export function symbolicateFrames(frames: readonly Frame[], mapsDir: string): Resolved[] {
  return frames.map((f) => {
    const map = mapFor(mapsDir, f.file)
    const seg = map === null ? null : lookup(map, f.line, f.col)
    if (map === null || seg === null) {
      return { ...f, source: null, sourceLine: 0, sourceCol: 0, name: null }
    }
    return {
      ...f,
      source: map.sources[seg.srcIndex] ?? null,
      // Sourcemap lines are 0-based; every editor and every stack trace is 1-based.
      sourceLine: seg.srcLine + 1,
      sourceCol: seg.srcCol,
      name: seg.nameIndex >= 0 ? (map.names[seg.nameIndex] ?? null) : null
    }
  })
}

/** `src/main/pipeline.ts:120:15 (foldEvent)`, or the bundle position when it could not resolve. */
export function formatFrame(r: Resolved): string {
  if (r.source === null) {
    return `    at ${r.func} (${r.file}:${String(r.line)}:${String(r.col)})  [no mapping]`
  }
  const name = r.name ?? r.func
  const where = `${cleanSource(r.source)}:${String(r.sourceLine)}:${String(r.sourceCol)}`
  return `    at ${name} (${where})`
}

/** `../../src/main/pipeline.ts` → `src/main/pipeline.ts`. Vite writes maps relative to the
 *  chunk, which puts a run of `../` in front of every repo-relative path. */
function cleanSource(source: string): string {
  return source.replace(/^(?:\.\.\/)+/, '').replace(/^\.\//, '')
}

// ---------------------------------------------------------------- the command

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function readFrames(source: string): Frame[] {
  const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8')
  const parsed: unknown = JSON.parse(text)
  // Accept either a bare frame array or a whole exemplar — the CLI prints exemplars, and
  // pasting one straight in is what a person will do.
  const frames = Array.isArray(parsed) ? parsed : (parsed as { frames?: unknown }).frames
  if (!Array.isArray(frames)) throw new Error('symbolicate: no frames array in the input')
  return frames as Frame[]
}

function main(): void {
  const maps = arg('maps')
  const framesArg = arg('frames')
  if (maps === undefined || framesArg === undefined) {
    console.error('usage: npx tsx scripts/symbolicate.mts --maps <dir> --frames <file.json|->')
    process.exitCode = 1
    return
  }
  const dir = resolve(maps)
  const resolved = symbolicateFrames(readFrames(framesArg), dir)
  for (const r of resolved) console.log(formatFrame(r))
  const unmapped = resolved.filter((r) => r.source === null).length
  if (unmapped > 0) {
    console.error(
      `\n${String(unmapped)}/${String(resolved.length)} frame(s) had no mapping under ${dir} — ` +
        'is this the sourcemap artifact for that exact version?'
    )
  }
}

// Only when RUN, never when imported by the triage CLI or the test suite.
if ((process.argv[1] ?? '').endsWith('symbolicate.mts')) main()
