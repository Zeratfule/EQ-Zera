// eqWindowMode.ts — ONE READER FOR `eqclient.ini` (JOS-364, JOS-368, JOS-375).
//
// WHY THIS FILE EXISTS AT ALL. The window-mode reading was built for the setup snapshot (JOS-364)
// and lived private inside `telemetry/setupSnapshot.ts`. A second consumer arrived — the perf
// block a feedback report carries (`feedback/perf.ts`) — and the wrong answer to that is a second
// parse of somebody else's settings file. So the reader moved HERE, and there is one place that
// knows where `eqclient.ini` is and what its two mode keys mean.
//
// THE ADVISORY IS GONE (JOS-375). JOS-368 hung a Preferences note off this file — "EverQuest is
// set to exclusive fullscreen; overlays draw best in Windowed mode" — on the belief that the
// game's Fullscreen setting was an EXCLUSIVE mode, where every z-order change over the game is a
// display-mode switch. On the live client it is not: `Fullscreen=1` is a BORDERLESS fullscreen
// WINDOW, which an always-on-top overlay shares perfectly well. The sentence could therefore never
// be true here, so it, its IPC pair and its dismissed-at-version memory were removed rather than
// reworded. Only the reading survives, because telemetry still wants to know.
//
// THE PARSE ITSELF IS NOT HERE. `eqWindowModeOf` (telemetry/setupFacts.ts) is pure, unit-tested,
// and reads exactly two keys; this file is the I/O around it. That split is the same one
// setupSnapshot/setupFacts already draws, and keeping it means every caller comes to the same
// conclusion about the same file.
//
// NOTHING HERE THROWS PAST `eqWindowMode`. An `eqclient.ini` an antivirus has locked, a machine
// with no EverQuest install — each answers `unknown`, which is an honest reading and never a
// guess.
//
// AND IT IS READ FRESH, NOT CACHED. The file changes when the player changes their video settings
// in game, and both callers are occasional (one per session, one per report), so a cached answer
// would buy nothing and could be stale by exactly the change worth noticing.

import { readFileSync } from 'fs'
import { join } from 'path'
import { effectiveEqRoot } from './log/config'
import { eqWindowModeOf } from './telemetry/setupFacts'
import type { TelemetryEqWindowMode } from '../shared/telemetry'

/**
 * EverQuest's own `eqclient.ini`, read whole, or `null` when there is nothing to read.
 *
 * The path comes from the install-dir discovery this app already owns (`effectiveEqRoot`) —
 * override, then auto-discovery, then the canonical default — so nothing new is searched for and a
 * machine with no install simply reads a file that is not there.
 *
 * THROWS on a locked or unreadable file, deliberately: both callers already have a defence
 * (`safely` in the snapshot, the try in `eqWindowMode` below) and a reader that swallowed its own
 * failures would make "no install" and "cannot read" the same answer at the wrong layer.
 */
export function readEqClientIni(): string | null {
  const root = effectiveEqRoot()
  if (root === '') return null
  return readFileSync(join(root, 'eqclient.ini'), 'utf8')
}

/** The game's display mode as this machine has it set, or 'unknown' if anything at all went wrong. */
export function eqWindowMode(): TelemetryEqWindowMode {
  try {
    return eqWindowModeOf(readEqClientIni())
  } catch {
    return 'unknown'
  }
}
