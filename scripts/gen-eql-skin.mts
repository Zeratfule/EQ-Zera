/**
 * npm run gen:eql-skin [-- --root <EQ install>] [--out <dir>] [--style <step>] [--preview] [--variants]
 *
 * Generates the EQ Zera in-game UI skin on THIS machine: `uifiles/default_modern` (over `default`)
 * is the base it inherits, and every chrome piece is drawn in the app's style at an ornament step
 * (src/main/uiSkin/look.ts: clean, subtle, ornamental, synthwave; ornamental by default). Default
 * output: `<EQ root>/uifiles/EQZera`, the folder the app's Preferences card writes.
 *   --out       write anywhere else
 *   --preview   also render the side-by-side mockup (base vs EQ Zera) into the system temp dir
 *   --variants  build NOTHING into the game; instead build subtle, ornamental and synthwave into
 *               temp folders and render one stacked mockup (default_modern + the three) at 2x and 1x
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EQ_ROOT } from '../src/main/log/discovery'
import { buildSkin, skinStatus, type SkinSources } from '../src/main/uiSkin/build'
import { DEFAULT_STYLE, isSkinStyle, type SkinStyle } from '../src/main/uiSkin/look'
import { BASE_SKIN, FALLBACK_SKIN, LOADSKIN_COMMAND, SKIN_NAME } from '../src/main/uiSkin/rules'
import { SkinView, writeBands, writeMockups } from './lib/skinMockup.mjs'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const uifiles = join(arg('--root') ?? EQ_ROOT, 'uifiles')
const src: SkinSources = { base: join(uifiles, BASE_SKIN), fallback: join(uifiles, FALLBACK_SKIN) }
const styleArg = arg('--style')
const style: SkinStyle = isSkinStyle(styleArg) ? styleArg : DEFAULT_STYLE

async function variants(): Promise<void> {
  const bands = [{ label: 'default_modern (reference)', view: await SkinView.open([src.base, src.fallback]) }]
  for (const s of ['subtle', 'ornamental', 'synthwave'] as const) {
    const out = join(tmpdir(), `eqzera-skin-${s}`)
    await buildSkin(src, out, { style: s })
    bands.push({ label: `EQ Zera - ${s}`, view: await SkinView.open([out, src.fallback]) })
  }
  for (const p of await writeBands(bands, join(tmpdir(), 'eqzera-skin-retrowave'))) console.log(`mockup: ${p}`)
}

async function single(): Promise<void> {
  const outDir = arg('--out') ?? join(uifiles, SKIN_NAME)
  const started = Date.now()
  const result = await buildSkin(src, outDir, { style })
  const status = await skinStatus(src, outDir, style)
  console.log(
    `EQ Zera skin (${style}): ${String(result.drawn)} textures drawn, ${String(result.xml)} XML retuned, ` +
      `${String(result.inherited)} base files inherited -> ${outDir}`
  )
  console.log(`status: ${status.state} (${String(Date.now() - started)} ms). In game: ${LOADSKIN_COMMAND}`)
  if (!process.argv.includes('--preview')) return
  const base = await SkinView.open([src.base, src.fallback])
  const ours = await SkinView.open([outDir, src.fallback])
  for (const p of await writeMockups(base, ours, join(tmpdir(), 'eqzera-skin-mockup'))) console.log(`mockup: ${p}`)
}

await (process.argv.includes('--variants') ? variants() : single())
