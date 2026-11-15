/**
 * npm run gen:eql-skin [-- --root <EQ install>] [--out <dir>] [--preview]
 *
 * Generates the EQ Zera in-game UI skin on THIS machine: `uifiles/default_modern` (over `default`)
 * is the base it inherits, and every chrome piece is drawn in the app's style. Default output:
 * `<EQ root>/uifiles/EQZera`, the folder the app's Preferences card writes; `--out` writes anywhere
 * else. `--preview` also renders the side-by-side mockup (base vs EQ Zera, 1x and 2x) into the
 * system temp dir.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EQ_ROOT } from '../src/main/log/discovery'
import { buildSkin, skinStatus } from '../src/main/uiSkin/build'
import { BASE_SKIN, FALLBACK_SKIN, LOADSKIN_COMMAND, SKIN_NAME } from '../src/main/uiSkin/rules'
import { SkinView, writeMockups } from './lib/skinMockup.mjs'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const uifiles = join(arg('--root') ?? EQ_ROOT, 'uifiles')
const src = { base: join(uifiles, BASE_SKIN), fallback: join(uifiles, FALLBACK_SKIN) }
const outDir = arg('--out') ?? join(uifiles, SKIN_NAME)

const started = Date.now()
const result = await buildSkin(src, outDir)
const status = await skinStatus(src, outDir)
console.log(
  `EQ Zera skin: ${String(result.drawn)} textures drawn, ${String(result.xml)} XML retuned, ` +
    `${String(result.inherited)} base files inherited -> ${outDir}`
)
console.log(`status: ${status.state} (${String(Date.now() - started)} ms). In game: ${LOADSKIN_COMMAND}`)
if (process.argv.includes('--preview')) {
  const base = await SkinView.open([src.base, src.fallback])
  const ours = await SkinView.open([outDir, src.fallback])
  for (const p of await writeMockups(base, ours, join(tmpdir(), 'eqzera-skin-mockup'))) console.log(`mockup: ${p}`)
}
