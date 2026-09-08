// ============================================================================
// outputs/discovery.ts — finding a `/outputfile` dump on disk.
// ============================================================================
//
// EQ writes dumps into the INSTALL ROOT (beside the client executable), not into `Logs\`, and
// names them `<Character>_<server>-<Kind>.txt` — measured: the dev machine's only dump is
// `Primitive_freeport-Inventory.txt`. The root is never hardcoded; it always resolves through
// `effectiveEqRoot()` so the Settings override and auto-discovery apply here exactly as they do
// to log tailing.
//
// THE NAMING RULES ARE NOT HERE (JOS-44). Which files belong to a kind, and which of several
// belongs to THIS character, are registry facts — `isOutputFileName` / `preferredOutputFile` in
// shared/outputs/kinds.ts, where they are pure and unit-testable. This module is only the part
// that needs a disk: list, stat, sort newest-first, hand the names to the rule.

import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import {
  isOutputFileName,
  outputKind,
  preferredOutputFile,
  type OutputKindId
} from '../../shared/outputs/kinds'
import { effectiveEqRoot } from '../log/config'

/** A candidate dump file with the mtime used to break ties. */
interface Candidate {
  file: string
  full: string
  mtime: number
}

function candidates(id: OutputKindId): Candidate[] {
  const def = outputKind(id)
  const eqRoot = effectiveEqRoot()
  if (!existsSync(eqRoot)) return []
  return readdirSync(eqRoot)
    .filter((f) => isOutputFileName(def, f))
    .map((f) => ({ file: f, full: join(eqRoot, f), mtime: statSync(join(eqRoot, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
}

/**
 * The newest dump of `id`, preferring the named character's own file. The preference rule (and
 * the reasoning behind its order) is `preferredOutputFile`.
 */
export function findOutputFile(
  id: OutputKindId,
  characterName?: string,
  server?: string
): string | null {
  const found = candidates(id)
  const pick = preferredOutputFile(
    found.map((c) => c.file),
    outputKind(id),
    characterName,
    server
  )
  if (pick === null) return null
  return found.find((c) => c.file === pick)?.full ?? null
}
