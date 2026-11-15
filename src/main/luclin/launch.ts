// launch.ts - the ONE place the Play button starts a process (tests/noChildProcess.test.mts names
// this module in SPAWNERS, with its argument). It starts exactly two named binaries from the EQ
// folder, `eqgame.exe patchme` and `LaunchPad.exe`, because the player pressed Play: explicit
// args, no shell, cwd = EQ root, detached so the game outlives this app. Never a command line,
// never a path from the renderer or the wire.

import { spawn } from 'child_process'
import { join } from 'path'
import { logError } from '../errorLog'
import { GAME_EXE, LAUNCHER_EXE } from './files'

export type LaunchTarget = 'game' | 'launcher'

const TARGETS: Record<LaunchTarget, { exe: string; args: string[] }> = {
  game: { exe: GAME_EXE, args: ['patchme'] },
  launcher: { exe: LAUNCHER_EXE, args: [] }
}

/** Start one of the two binaries, detached, and resolve once Windows has started it. */
export function launchFromEqRoot(root: string, target: LaunchTarget): Promise<boolean> {
  const { exe, args } = TARGETS[target]
  return new Promise((resolve) => {
    try {
      const child = spawn(join(root, exe), args, {
        cwd: root,
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false
      })
      child.once('error', (err) => {
        logError('main:luclin', err)
        resolve(false)
      })
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch (err) {
      logError('main:luclin', err)
      resolve(false)
    }
  })
}
