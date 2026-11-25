// resistTableWorker.ts — read and parse the client's `spells_us.txt` OFF the main thread
// (JOS-382). Keep it this small.
//
// WHY A WHOLE THREAD. The file is 38 MB and 73,963 rows; reading and splitting it is a few
// hundred milliseconds of pure CPU with no await inside it, and the thread that would otherwise
// spend them is the one tailing the log (JOS-371: no synchronous multi-MB reads on main). It runs
// ONCE per app launch, and only when the cache says the file changed — see `resist/spellTable.ts`
// for the size+mtime key, which is JOS-208's rule applied to somebody else's file: only redo work
// when the source moved.
//
// It speaks exactly once and exits. `latin1` rather than `utf8` because the file is a fixed-width
// legacy dump with high bytes in a handful of names; latin1 never throws and never replaces a
// byte, and every field this parser reads is ASCII.
//
// THREE JOBS, ONE THREAD ENTRY (the game-file health check, EQ Zera 2026-11-25). `table` is the
// resist table plus the file's layout measurements; `measure` is the measurements alone (the health
// check needs no table resident); `dbstr` judges `dbstr_us.txt`. A second worker entry would be a
// build-config change; a job field is not.

import { readFileSync } from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import { parseSpellsUs } from './resist/spellsUsParse'
import { spellsUsSemantics } from './resist/spellsUsSemantics'
import { caretLayout, dbstrHealth, type RowLayout, type SpellsUsSemantics } from '../shared/gameFileDetect'
import type { GameFileReport } from '../shared/gameFileHealth'
import type { SpellResistTable } from '../shared/resistTypes'

export interface ResistTableWorkerInit {
  path: string
  /** Absent means `table`, the original and only job before the health check. */
  job?: 'table' | 'measure' | 'dbstr'
  /** The file version a `dbstr` verdict is stamped with. */
  version?: string
}

export interface ResistTableWorkerReply {
  ok: boolean
  table?: SpellResistTable
  /** The file's row widths, measured on the same text, for the game-file health check. */
  layout?: RowLayout
  /** Whether the fields the parser reads look like themselves (resist/spellsUsSemantics.ts). */
  semantics?: SpellsUsSemantics
  /** The `dbstr` job's verdict. */
  report?: GameFileReport
  error?: string
}

const init = workerData as ResistTableWorkerInit
const port = parentPort

function run(): ResistTableWorkerReply {
  const text = readFileSync(init.path, 'latin1')
  if (init.job === 'dbstr') return { ok: true, report: dbstrHealth(text, init.version ?? '') }
  const measured = { layout: caretLayout(text), semantics: spellsUsSemantics(text) }
  return init.job === 'measure' ? { ok: true, ...measured } : { ok: true, table: parseSpellsUs(text), ...measured }
}

let reply: ResistTableWorkerReply
try {
  reply = run()
} catch (err) {
  reply = { ok: false, error: err instanceof Error ? err.message : String(err) }
}
port?.postMessage(reply)
