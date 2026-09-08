/**
 * paths.ts — where triage keeps its working files, and how it finds the repo to do it.
 *
 * Split out of store.ts when `attachments.ts` became a second consumer (JOS-296): both need
 * `TRIAGE_DIR`, and importing a VALUE from store.ts into a module store.ts re-exports would be a
 * runtime import cycle. A leaf module with no dependencies of its own cannot be in one.
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The repo root — where `.triage/` and `infra/schema.sql` live.
 *
 * This used to be `resolve(import.meta.dirname, '..')`, one fixed hop up from `scripts/`. That
 * stopped being a single rule the moment the triage store gained a second caller: under `tsx` it
 * sits at `src/main/triage/`, and inside the dev app it has been bundled into `out/main/`.
 * Walking UP for the marker file is the one rule true for both, and it also survives a CLI
 * invocation from a subdirectory (which the old form handled and a bare `process.cwd()` would
 * not).
 */
function findRepoRoot(): string {
  let dir = process.cwd()
  for (;;) {
    if (existsSync(join(dir, 'infra', 'schema.sql'))) return dir
    const up = dirname(dir)
    if (up === dir) return process.cwd()
    dir = up
  }
}

const ROOT = findRepoRoot()

/** The CLI's (and the app's) gitignored working directory: cached stack outputs + downloads. */
export const TRIAGE_DIR = join(ROOT, '.triage')
/** Where `terraform output -json` is shelled out from. */
export const INFRA_DIR = join(ROOT, 'infra')
export const SCHEMA_FILE = join(INFRA_DIR, 'schema.sql')
