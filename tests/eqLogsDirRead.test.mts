// READING A LOGS DIR IS A THREE-WAY ANSWER, NOT A COUNT (JOS-82).
//
// `countCharacterLogs` used to answer `0` for three different situations — the folder is not
// there, the folder is there and holds no character log, and the OS refused to list the folder
// (`catch { return 0 }`) — and the Settings card printed the SAME sentence for all three:
// "No character logs (eqlog_*.txt) found here. Make sure EverQuest logging is enabled (/log on)".
//
// For the third that is a silent wrong answer of exactly the kind JOS-53 was about: the user is
// looking at their logs in Explorer while the app tells them to go turn logging on. A 0.6.3
// reporter hit that shape — "I pointed it directly to the log folder and it said there were no
// character logs in that directory" — and a swallowed `readdir` throw is the only way the app can
// say that about a folder that demonstrably has logs in it.
//
// So `readLogsDir` reports its failure and the card gets to say something true. The discovery
// SWEEP still collapses a failed read to "no" (it must keep moving past a candidate it cannot
// read), and that collapse is pinned here too so the two behaviours cannot drift apart.
//
// Run: `npm test`.

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  countCharacterLogs,
  dirHasCharacterLogs,
  readLogsDir,
  rootHasLogs
} from '../src/main/log/discovery'

test('readLogsDir: a real Logs dir reports ok + the character-log count', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eq-read-ok-'))
  try {
    const logsDir = join(tmp, 'EverQuest Legends', 'Logs')
    mkdirSync(logsDir, { recursive: true })
    writeFileSync(join(logsDir, 'eqlog_Gnut_qeynos.txt'), '[Thu] hi\n')
    // A non-character file in the same folder must not inflate the count.
    writeFileSync(join(logsDir, 'dbg.txt'), 'not a character log\n')
    assert.deepEqual(readLogsDir(logsDir), { ok: true, count: 1 })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('readLogsDir: an EMPTY Logs dir is ok with count 0 — read fine, nothing in it', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eq-read-empty-'))
  try {
    const empty = join(tmp, 'Logs')
    mkdirSync(empty, { recursive: true })
    // This is the genuine `/log on` case, and it must stay distinguishable from the two
    // FAILURES below — it is the only one of the three where that advice is the right advice.
    assert.deepEqual(readLogsDir(empty), { ok: true, count: 0 })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('readLogsDir: a missing dir is "missing", and so is a FILE in a dir slot (ENOTDIR)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'eq-read-missing-'))
  try {
    assert.deepEqual(readLogsDir(join(tmp, 'nope')), { ok: false, reason: 'missing' })
    // A path that is a FILE where a directory was expected throws ENOTDIR, not ENOENT. It is
    // still "there is no such directory" and must never be reported as a permission problem.
    const file = join(tmp, 'eqclient.ini')
    writeFileSync(file, '[Defaults]\n')
    assert.deepEqual(readLogsDir(file), { ok: false, reason: 'missing' })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

/**
 * Deny this user READ_DATA on `dir` so `readdirSync` throws. Returns a restore fn that never
 * throws — a test must not leave an undeletable directory behind on anyone's machine or on CI.
 */
function denyListing(dir: string): () => void {
  const user = `${process.env.USERDOMAIN ?? ''}\\${process.env.USERNAME ?? ''}`
  execFileSync('icacls', [dir, '/deny', `${user}:(RD)`], { stdio: 'pipe' })
  return () => {
    try {
      execFileSync('icacls', [dir, '/remove:d', user], { stdio: 'pipe' })
      execFileSync('icacls', [dir, '/reset'], { stdio: 'pipe' })
    } catch {
      // Best effort — the rmSync that follows is itself guarded.
    }
  }
}

test(
  'readLogsDir: THE REPORTED SHAPE — an unreadable dir says so, it does not say "no logs"',
  { skip: process.platform !== 'win32' ? 'an ACL deny is a Windows shape' : false },
  (t: TestContext) => {
    // MEASURED on Windows 11 (10.0.22631): an ACL denying READ_DATA makes `readdirSync` throw
    // EPERM on a directory whose files Explorer still lists for the same user. That is the only
    // way the app can truthfully be told "there are files here" and answer "there are no
    // character logs here", which is the reporter's exact complaint.
    const tmp = mkdtempSync(join(tmpdir(), 'eq-read-perm-'))
    let restore: (() => void) | null = null
    try {
      const logsDir = join(tmp, 'Logs')
      mkdirSync(logsDir, { recursive: true })
      writeFileSync(join(logsDir, 'eqlog_Gnut_qeynos.txt'), '[Thu] hi\n')
      // Sanity: before the lock it reads fine, so a pass below cannot be a path typo.
      assert.deepEqual(readLogsDir(logsDir), { ok: true, count: 1 })

      restore = denyListing(logsDir)
      const read = readLogsDir(logsDir)
      if (read.ok) {
        // Some environments (a privileged account) can bypass a deny ACE. Say so rather than
        // pass silently — "structurally covered" is not "verified".
        t.skip('this environment can list a deny-listed directory; EPERM not reproducible here')
        return
      }
      assert.equal(read.reason, 'unreadable', 'a refused listing is not a missing folder')
      assert.ok(read.code.length > 0, `an errno is reported (got ${JSON.stringify(read.code)})`)

      // …and the collapse the discovery SWEEP needs is still a collapse: it must keep moving
      // past a candidate it cannot read rather than throw or stall.
      assert.equal(countCharacterLogs(logsDir), 0)
      assert.equal(rootHasLogs(tmp), false)
      assert.equal(dirHasCharacterLogs(logsDir), false)
    } finally {
      restore?.()
      try {
        rmSync(tmp, { recursive: true, force: true })
      } catch {
        // A locked temp dir must never fail the suite.
      }
    }
  }
)
