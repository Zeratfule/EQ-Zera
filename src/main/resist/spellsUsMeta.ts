// spellsUsMeta.ts — the client file's layout measurements, kept beside the resist cache and keyed
// the same way (size + mtime + cache version), plus the one worker runner both the table load and
// the game-file health check use.
//
// WHY A SIDECAR. The health check runs every launch; the resist table is a 6 MB cache whose
// JSON.parse is ~35 ms of main-thread time and which would then stay resident all session for a
// question that needs none of it. The measurements are a few hundred bytes, so the check reads
// those, and only a launch after a patch pays for a worker pass over the 38 MB file.

import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { logError } from '../errorLog'
import type { RowLayout, SpellsUsSemantics } from '../../shared/gameFileDetect'
import type { ResistTableWorkerInit, ResistTableWorkerReply } from '../resistTableWorker'

export interface Stamp {
  size: number
  mtimeMs: number
}

export interface SpellsUsMeasured {
  layout: RowLayout
  semantics: SpellsUsSemantics
  /** Spells the parse produced from the same text. */
  entries?: number
}


function metaPath(): string {
  return join(app.getPath('userData'), 'spell-resist-cache.meta.json')
}

/**
 * `key` names the build that measured: the resist cache version, the parser's known widths and the
 * semantic checks' version (resist/spellTable.ts `META_KEY`). A sidecar written by a build that
 * parses differently is never trusted.
 */
export function readSpellsUsMeta(stamp: Stamp, key: string): SpellsUsMeasured | null {
  try {
    const m = JSON.parse(readFileSync(metaPath(), 'utf8')) as Partial<SpellsUsMeasured & Stamp & { key: string }>
    if (m.key !== key || m.size !== stamp.size || m.mtimeMs !== stamp.mtimeMs) return null
    if (!m.layout || !m.semantics) return null
    return m.entries === undefined ? { layout: m.layout, semantics: m.semantics } : { layout: m.layout, semantics: m.semantics, entries: m.entries }
  } catch {
    return null
  }
}

export function writeSpellsUsMeta(stamp: Stamp, key: string, m: SpellsUsMeasured): void {
  const path = metaPath()
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(`${path}.tmp`, JSON.stringify({ key, ...stamp, ...m }), 'utf8')
    renameSync(`${path}.tmp`, path)
  } catch (err) {
    // ONCE: the table cache carries the same measurements (resist/spellTable.ts), so a sidecar
    // that cannot be written costs a cache read per launch, not a re-parse, and is worth one line.
    if (!metaWriteFailed) logError('main:resistTable', { message: 'spells_us layout meta write failed', err })
    metaWriteFailed = true
  }
}

let metaWriteFailed = false

/** Run one job on `resistTableWorker.js`; null when the worker failed to start or died. */
export function runResistWorker(init: ResistTableWorkerInit): Promise<ResistTableWorkerReply | null> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(join(__dirname, 'resistTableWorker.js'), { workerData: init })
    } catch (err) {
      logError('main:resistTable', { message: 'resist table worker failed to start', err })
      resolve(null)
      return
    }
    let settled = false
    const finish = (reply: ResistTableWorkerReply | null): void => {
      if (settled) return
      settled = true
      resolve(reply)
      void worker.terminate()
    }
    worker.on('message', (reply: ResistTableWorkerReply) => {
      if (!reply.ok) logError('main:resistTable', { message: reply.error ?? 'worker job failed' })
      finish(reply)
    })
    worker.on('error', (err) => {
      logError('main:resistTable', { message: 'resist table worker error', err })
      finish(null)
    })
    worker.on('exit', () => {
      finish(null)
    })
  })
}
