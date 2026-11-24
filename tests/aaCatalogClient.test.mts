// aaCatalogClient.test.mts — the committed AA catalog's NAMES against the game client's own string
// table. `dbstr_us.txt` lines `id^1^Name^0^` are AA names (`26000^1^Class Reincarnation:
// Warrior^0^`); the log prints those names, so a catalog name the client does not have is a name
// the planner can never match to a purchase line. Like eqAssetsLuclin.test.mts: runs where the game
// is installed and is skipped (saying so) where it is not - CI has no game.

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AaCatalogData } from '../src/shared/aaCatalog'

const EQ = 'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends'
const DBSTR = join(EQ, 'dbstr_us.txt')
const SKIP = existsSync(DBSTR) ? false : 'no EverQuest Legends client on this machine - run where the game is'
const ROOT = join(import.meta.dirname, '..')
const CATALOG = JSON.parse(readFileSync(join(ROOT, 'src/renderer/src/data/eqlegends/aaCatalog.json'), 'utf8')) as AaCatalogData

function clientAaNames(): Set<string> {
  const names = new Set<string>()
  for (const line of readFileSync(DBSTR, 'latin1').split(/\r?\n/)) {
    const parts = line.split('^')
    if (parts[1] === '1' && parts[2]) names.add(parts[2].toLowerCase())
  }
  return names
}

test('every AA in the catalog is a name the client has', { skip: SKIP }, () => {
  const client = clientAaNames()
  const absent = CATALOG.entries.filter((e) => !client.has(e.name.toLowerCase())).map((e) => `${e.section}: ${e.name}`)
  if (absent.length > 0) console.log(`catalog names absent from dbstr_us.txt:\n  ${absent.join('\n  ')}`)
  assert.deepEqual(absent, [], 'add a measured rename to scripts/sources/aaCatalog.ts WIKI_RENAMES')
})

test('every wiki spelling the catalog renamed is NOT a client name (the rename is still needed)', { skip: SKIP }, () => {
  const client = clientAaNames()
  const stale = CATALOG.entries.filter((e) => e.wikiName !== undefined && client.has(e.wikiName.toLowerCase())).map((e) => e.wikiName)
  assert.deepEqual(stale, [])
})
