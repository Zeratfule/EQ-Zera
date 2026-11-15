/**
 * npm run gen:eql-skin [-- --root <EQ install>] [--out <dir>] [--preview]
 *
 * Generates the EQ Zera in-game UI skin from THIS machine's `uifiles/default` (nothing of
 * Daybreak's is in the repo). Default output: `<EQ root>/uifiles/EQZera`, the same folder the
 * app's Preferences card writes. `--out` writes anywhere else (a temp dir for a dry run).
 * `--preview` also renders a before/after PNG of a few recoloured pieces into the system temp dir.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EQ_ROOT } from '../src/main/log/discovery'
import { buildSkin, skinStatus } from '../src/main/uiSkin/build'
import { LOADSKIN_COMMAND, SKIN_NAME } from '../src/main/uiSkin/rules'
import { renderSkinPreview } from './lib/skinPreview.mjs'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const root = arg('--root') ?? EQ_ROOT
const sourceDir = join(root, 'uifiles', 'default')
const outDir = arg('--out') ?? join(root, 'uifiles', SKIN_NAME)

const started = Date.now()
const result = await buildSkin(sourceDir, outDir)
const status = await skinStatus(sourceDir, outDir)
console.log(`EQ Zera skin: ${String(result.textures)} textures + ${String(result.xml)} XML files -> ${outDir}`)
console.log(`status: ${status.state} (${String(Date.now() - started)} ms). In game: ${LOADSKIN_COMMAND}`)
if (process.argv.includes('--preview')) {
  const png = await renderSkinPreview(sourceDir, outDir, join(tmpdir(), 'eqzera-skin-preview.png'))
  console.log(`preview: ${png}`)
}
