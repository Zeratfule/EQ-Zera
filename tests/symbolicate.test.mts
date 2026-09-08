// ============================================================================
// SYMBOLICATION (JOS-100) — the VLQ decoder, pinned against a real build.
// ============================================================================
//
// `scripts/symbolicate.mts` implements Source Map v3's base64-VLQ decoding by hand rather than
// taking a dependency for it (that file's header says why). "We wrote it ourselves" is only an
// acceptable sentence if it is CHECKABLE, so this suite checks it two ways:
//
//   1. AGAINST HAND-WORKED VECTORS. The format's one real trap is that four of the five fields
//      are RELATIVE and only the generated column resets per line; getting that backwards
//      produces plausible-looking wrong answers rather than an error, so the deltas are
//      asserted explicitly.
//   2. AGAINST A MAP THIS REPO'S OWN BUILD PRODUCED — a ROUND TRIP: take a real generated
//      position out of `out/`, resolve it, and require the answer to name a file that exists in
//      this checkout. That is the assertion that would catch a decoder which is self-consistent
//      and wrong.
//
// THE SECOND HALF SKIPS WITHOUT A BUILD, and says so. `out/` is gitignored, so CI's `npm test`
// runs before `npm run build` in one job and after it in neither — a suite that failed there
// would be a suite nobody could keep green. The vectors above never skip.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decodeMappings,
  formatFrame,
  loadMap,
  lookup,
  symbolicateFrames,
  type Frame
} from '../scripts/symbolicate.mts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'out')

// =========================================================================================
// 1. the decoder, on worked vectors
// =========================================================================================

test('a single segment decodes to its five fields', () => {
  // `AAAAA` is five zeroes: generated column 0, source 0, line 0, column 0, name 0.
  assert.deepEqual(decodeMappings('AAAAA'), [
    [{ genCol: 0, srcIndex: 0, srcLine: 0, srcCol: 0, nameIndex: 0 }]
  ])
})

test('THE TRAP: only the generated column resets per line — the other four accumulate', () => {
  // Two lines, one segment each. `AACA` on line 2 is genCol +0, src +0, srcLine +1, srcCol +0.
  // If a decoder reset srcLine per line it would answer 0 here instead of 1, and every frame
  // past the first line of the bundle would resolve to the wrong place while looking fine.
  const lines = decodeMappings('AAAA;AACA')
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0][0], { genCol: 0, srcIndex: 0, srcLine: 0, srcCol: 0, nameIndex: -1 })
  assert.deepEqual(lines[1][0], { genCol: 0, srcIndex: 0, srcLine: 1, srcCol: 0, nameIndex: -1 })

  // …and the generated column DOES reset: `IAAA,IAAA` on one line is 4 then 8, but the same
  // text after a `;` starts from 4 again.
  const cols = decodeMappings('IAAA,IAAA;IAAA')
  assert.deepEqual(cols[0].map((s) => s.genCol), [4, 8])
  assert.deepEqual(cols[1].map((s) => s.genCol), [4])
})

test('the sign bit is bit 0, so negative deltas decode — and the FIELD ORDER is fixed', () => {
  // `D` is 3 → sign bit set, value 1 → -1. A backwards jump in source line is ordinary in
  // bundled output (a helper hoisted above its caller), and a decoder that could not express
  // one would drift further wrong with every segment.
  //
  // THE POSITION OF THE `D` IS THE OTHER HALF OF THIS TEST, and it caught the first draft of
  // this very assertion: the fields are [genCol, srcIndex, srcLine, srcCol, nameIndex], so
  // `ADAA` moves the SOURCE INDEX by -1 and `AADA` moves the LINE. Both decode; only one means
  // what a careless reader assumes.
  assert.equal(decodeMappings('AAAA;AADA')[1][0].srcLine, -1, 'third field is the source line')
  assert.equal(decodeMappings('AAAA;ADAA')[1][0].srcIndex, -1, 'second field is the source index')
  assert.equal(decodeMappings('AAAA;ADAA')[1][0].srcLine, 0, '…and it left the line alone')
})

test('a one-field segment is generated code with NO original position', () => {
  const lines = decodeMappings('AAAA,C')
  assert.equal(lines[0][1].srcIndex, -1, 'kept, but marked unmapped')
  // …and a lookup landing on it answers null rather than attributing the position to the
  // segment before it, which is the difference between "no mapping" and a wrong answer.
  const map = { sources: ['a.ts'], names: [], lines }
  assert.equal(lookup(map, 1, 0)?.srcIndex, 0)
  assert.equal(lookup(map, 1, 1), null)
})

test('lookup is NEAREST-AT-OR-BEFORE, and refuses to guess before the first mapping', () => {
  const map = loadMap(
    JSON.stringify({ version: 3, sources: ['a.ts'], names: [], mappings: 'IAAA,IAAA' })
  )
  // segments at generated columns 4 and 8
  assert.equal(lookup(map, 1, 3), null, 'before the first mapping is unmapped, never segment 0')
  assert.equal(lookup(map, 1, 4)?.genCol, 4)
  assert.equal(lookup(map, 1, 7)?.genCol, 4, 'a position inside a segment belongs to it')
  assert.equal(lookup(map, 1, 9)?.genCol, 8)
  assert.equal(lookup(map, 2, 0), null, 'a line the map does not cover is unmapped')
})

test('a frame whose map is missing is REPORTED, never dropped', () => {
  const frames: Frame[] = [{ file: 'out/main/nope.js', line: 1, col: 0, func: 'f' }]
  const [r] = symbolicateFrames(frames, OUT)
  assert.equal(r.source, null)
  assert.match(formatFrame(r), /\[no mapping\]/)
  assert.match(formatFrame(r), /out\/main\/nope\.js:1:0/, 'the bundle position is still printed')
})

// =========================================================================================
// 2. THE ROUND TRIP, against a map this repo's own build produced
// =========================================================================================

/**
 * The main bundle's map, or null when this checkout has not been built.
 *
 * "Built" means `npm run build` — all three bundles. A checkout that has only ever run
 * `npm run dev` has an `out/main` and `out/preload` (the watcher emits those, maps included) but
 * NO `out/renderer/assets`, because the renderer is served from Vite's dev server and never
 * written to disk. That is the skip case, not a missing-map regression, and `npm test` beside a
 * running dev session is the normal way this suite gets run.
 */
function builtMain(): { file: string; mapPath: string } | null {
  const mapPath = join(OUT, 'main', 'index.js.map')
  const rendererBuilt = existsSync(join(OUT, 'renderer', 'assets'))
  return existsSync(mapPath) && rendererBuilt ? { file: 'out/main/index.js', mapPath } : null
}

test('ROUND TRIP: a real generated position resolves to a file that exists in this checkout', (t) => {
  const built = builtMain()
  if (built === null) {
    t.skip('no build present (out/ is gitignored) — run `npm run build` to exercise this')
    return
  }
  const map = loadMap(readFileSync(built.mapPath, 'utf8'))
  assert.ok(map.sources.length > 0, 'the map names its sources')
  assert.ok(map.lines.length > 0, 'the map has mappings')

  // Walk the real map for the first line/column that HAS a mapping, and resolve it. Reading a
  // position out of the map itself rather than inventing one is what makes this a round trip:
  // the input is a position the build really emitted.
  let probe: { line: number; col: number } | null = null
  for (let i = 0; i < map.lines.length && probe === null; i++) {
    const seg = map.lines[i].find((s) => s.srcIndex >= 0)
    if (seg !== undefined) probe = { line: i + 1, col: seg.genCol }
  }
  assert.ok(probe !== null, 'the map has at least one mapped position')

  const [r] = symbolicateFrames(
    [{ file: built.file, line: probe.line, col: probe.col, func: 'probe' }],
    OUT
  )
  assert.ok(r.source !== null, `a mapped position must resolve: ${JSON.stringify(r)}`)
  assert.ok(r.sourceLine >= 1, 'source lines are 1-based for humans, 0-based in the format')

  // THE ASSERTION THAT CATCHES A SELF-CONSISTENT-BUT-WRONG DECODER: the file it names is a file
  // that is actually here.
  const rel = (r.source ?? '').replace(/^(?:\.\.\/)+/, '')
  assert.ok(
    existsSync(join(ROOT, rel)) || rel.includes('node_modules'),
    `symbolicated to a path that does not exist: ${String(r.source)}`
  )
  assert.match(formatFrame(r), /:\d+:\d+\)$/)
})

test('THE MAPS ARE EMITTED, AND THE MAPS DO NOT SHIP — both halves, read off the configs', () => {
  // Never skips: it reads committed files, not a build. These two settings are a PAIR, and the
  // failure mode if they drift apart is silent in opposite directions — sourcemaps off means
  // every stack is unreadable, and the exclusion gone means ~6 MB of source in every installer.
  const vite = readFileSync(join(ROOT, 'electron.vite.config.ts'), 'utf8')
  assert.equal(
    (vite.match(/sourcemap: true/g) ?? []).length,
    3,
    'main, preload and renderer must all emit maps — a missing one is half a stack nobody can read'
  )
  const builder = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
  assert.match(
    builder,
    /'!\*\*\/\*\.\{o,obj,map,ts,tsx\}'/,
    'electron-builder must keep excluding *.map — it is what keeps the maps out of the installer'
  )
  // …and CI keeps them, privately, keyed by version. A release asset would publish them.
  const ci = readFileSync(join(ROOT, '.github', 'workflows-upstream-disabled', 'build.yml'), 'utf8')
  assert.equal(
    (ci.match(/name: sourcemaps-/g) ?? []).length,
    2,
    'both jobs upload a sourcemap artifact'
  )
  assert.match(ci, /name: sourcemaps-\$\{\{ github\.ref_name \}\}/, 'the release one is keyed by TAG')
  assert.equal(
    /gh release upload[^\n]*\.map/.test(ci),
    false,
    'sourcemaps must never become a public release asset'
  )
})

test('ROUND TRIP: every emitted bundle has a map beside it', (t) => {
  if (builtMain() === null) {
    t.skip('no build present — run `npm run build`')
    return
  }
  // The three bundles the config turns `sourcemap` on for. A missing one means the flag was
  // dropped from that environment, which would silently make that half of every stack
  // unreadable — the exact failure this feature exists to prevent.
  for (const [dir, name] of [
    ['main', 'index.js'],
    ['preload', 'index.js']
  ] as const) {
    assert.ok(existsSync(join(OUT, dir, `${name}.map`)), `out/${dir}/${name}.map is missing`)
  }
  const assets = join(OUT, 'renderer', 'assets')
  const js = readdirSync(assets).filter((f) => f.endsWith('.js'))
  assert.ok(js.length > 0)
  // `out/` on a dev machine is a MIX: fresh bundles beside stale chunks from older builds (the
  // dev server rewrites main/preload but not every renderer asset), so bare existence cannot
  // distinguish "the sourcemap flag was dropped" from "this chunk predates the flag". Mtime can:
  // a mapless bundle NEWER than the newest map is the regression this test hunts; an OLDER one
  // is a leftover and proves nothing.
  const mapMtimes = js
    .filter((f) => existsSync(join(assets, `${f}.map`)))
    .map((f) => statSync(join(assets, `${f}.map`)).mtimeMs)
  if (mapMtimes.length === 0) {
    t.skip('renderer assets carry no maps at all — stale pre-sourcemap build; run `npm run build`')
    return
  }
  const newestMap = Math.max(...mapMtimes)
  for (const f of js) {
    if (existsSync(join(assets, `${f}.map`))) continue
    assert.ok(
      statSync(join(assets, f)).mtimeMs < newestMap,
      `out/renderer/assets/${f}.map is missing and the bundle is newer than the newest map — the sourcemap flag was dropped`
    )
  }
})
