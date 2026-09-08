// fetch-item-models.mts — WHICH MODEL EACH ITEM IS (EQ Zera, 2026-09-06; character-model spike).
//
//   npx tsx scripts/fetch-item-models.mts        (npm run fetch:item-models)
//
// WHY. The wiki knows an item's name, stats and icon, but not what it LOOKS like in the game: the
// `idfile` (the `IT<n>` model in gequip*.s3d), the armour `material` (cloth / leather / chain /
// plate as the client draws it) and the dye `color`. Those are in the game's item table, which the
// EQItems project (items.sodeq.org, the collector fan sites and Magelo draw on) publishes as a
// nightly dump. The dump's ids are the game's own item ids - the ones `/outputfile inventory`
// writes - so the join is exact, never a name match.
//
// WHAT IS KEPT. Only rows whose name our wiki catalog (src/main/data/items.json) already carries,
// and only the five fields the model needs, so 144k rows become a few thousand small records
// committed as src/main/data/itemModels.json. The raw dump is cached under scripts/sources/cache
// (gitignored, 8 MB) and never fetched while the cache is present - the same etiquette as the
// other scrapers.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, 'scripts', 'sources', 'cache', 'sodeq-items.txt.gz')
const OUT = join(ROOT, 'src', 'main', 'data', 'itemModels.json')
const URL = 'https://items.sodeq.org/downloads/items.txt.gz'

export interface ItemModelRecord {
  name: string
  /** the model actor: `IT68` (from the dump's numeric `idfile`) */
  model: string
  /** the client's armour material code: 0 cloth, 1 leather, 2 chain, 3 plate, others special */
  material: number
  /** dye colour as the client stores it (ARGB), 0 for none */
  color: number
  itemtype: number
}

export interface ItemModelsFile {
  scrapedAt: string
  source: string
  byId: Record<string, ItemModelRecord>
}

async function dump(): Promise<string> {
  if (!existsSync(CACHE)) {
    console.log(`fetching ${URL} …`)
    const res = await fetch(URL, { headers: { 'User-Agent': 'eq-zera item-model fetch (one-time, cached)' } })
    if (!res.ok) throw new Error(`${URL}: ${String(res.status)}`)
    mkdirSync(dirname(CACHE), { recursive: true })
    writeFileSync(CACHE, new Uint8Array(await res.arrayBuffer()))
  }
  return gunzipSync(readFileSync(CACHE)).toString('utf8')
}

function catalogNames(): Set<string> {
  const items = (JSON.parse(readFileSync(join(ROOT, 'src', 'main', 'data', 'items.json'), 'utf8')) as { items: Record<string, { page: string; name?: string }> }).items
  const out = new Set<string>()
  for (const [key, it] of Object.entries(items)) {
    out.add(key)
    out.add(it.page.toLowerCase())
    if (it.name) out.add(it.name.toLowerCase())
  }
  return out
}

async function main(): Promise<void> {
  const text = await dump()
  const lines = text.split('\n')
  const header = lines[0].split('|')
  const col = (name: string): number => {
    const i = header.indexOf(name)
    if (i < 0) throw new Error(`dump has no '${name}' column`)
    return i
  }
  const ID = col('id')
  const NAME = col('name')
  const IDFILE = col('idfile')
  const MATERIAL = col('material')
  const COLOR = col('color')
  const TYPE = col('itemtype')
  const known = catalogNames()
  const byId: Record<string, ItemModelRecord> = {}
  let rows = 0
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split('|')
    if (f.length <= TYPE) continue
    rows++
    const name = f[NAME]
    if (!known.has(name.toLowerCase())) continue
    const idfile = Number(f[IDFILE])
    byId[f[ID]] = {
      name,
      model: Number.isFinite(idfile) && idfile > 0 ? `IT${String(idfile)}` : '',
      material: Number(f[MATERIAL]) || 0,
      color: Number(f[COLOR]) || 0,
      itemtype: Number(f[TYPE]) || 0
    }
  }
  const out: ItemModelsFile = { scrapedAt: new Date().toISOString(), source: URL, byId }
  writeFileSync(OUT, JSON.stringify(out) + '\n')
  console.log(`${String(rows)} dump rows → ${String(Object.keys(byId).length)} catalog items with models → ${OUT}`)
}

await main()
