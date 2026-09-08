/**
 * THE CUSTOM FOLDER, WHEREVER THE USER POINTS IT (JOS-53) — driven through the real app.
 *
 * Two prod reports on 2026-08-06, from two different installs, did the same thing: they opened
 * Settings, pointed the picker at `…\EverQuest Legends\Logs` — the folder that literally contains
 * the file the app is hunting for — and were told "no logs detected". One of them filed a second
 * report apologizing for "total user error". The override was trusted VERBATIM as the install
 * ROOT, so the app read `…\Logs\Logs`, resolved with source 'manual' and characterCount 0, and
 * never showed the folder it had actually read.
 *
 * `tests/eqDiscovery.test.mts` pins the decision table as pure logic over temp dirs. This spec
 * pins the thing a unit test structurally cannot see: that the OVERRIDE the user actually saves
 * travels the whole path — electron-store → `resolveEqDir` → `applyEqDirChange` → re-list →
 * re-tail — and comes back as a character the app is really reading. It is the same three shapes,
 * saved through the same `eqconfig:set` channel the Settings card calls, against a staged install
 * this spec owns.
 *
 * WHY IT DRIVES IPC RATHER THAN THE FOLDER BUTTON: "Choose folder…" opens the OS picker, which is
 * native and unautomatable from here. `window.eq.setEqDir` is the exact call the picker's result
 * flows into (ipc/character.ts), so this is the whole flow minus the one dialog Electron owns —
 * and the Preferences card is then read on screen, so the verdict asserted is the sentence the
 * reporters were reading when they blamed themselves.
 *
 * Run: `npm run test:e2e -- eq-folder`
 */
import type { Page } from 'playwright-core'
import { join } from 'node:path'
import { buildIfStale, check, dumpArtifacts, failures, reportRun, settle } from './appHarness.mjs'
import { mainWindow } from './appWindow.mjs'
import { launchOnFixture } from './logFixture.mjs'

/** The Preferences → Game card, as main resolved it. */
interface EqConfig {
  root: string
  logsDir: string
  source: string
  characterCount: number
  overridden: boolean
  readable: 'ok' | 'missing' | 'unreadable'
  readError?: string
}

/** One separator style, no trailing slash, case-folded — the way `logIsUnderLogsDir` compares. */
const samePath = (a: string, b: string): boolean =>
  a.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase() ===
  b.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase()

/** Save an override through the very channel the folder picker's result flows into. */
function setEqDir(page: Page, dir: string | undefined): Promise<EqConfig> {
  return page.evaluate(
    (d) =>
      (
        window as unknown as { eq: { setEqDir: (x: string | undefined) => Promise<EqConfig> } }
      ).eq.setEqDir(d),
    dir
  )
}

/** How many character logs the app can list right now — "no logs detected", measured. */
function characterCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const eq = (window as unknown as { eq: { listCharacters: () => Promise<unknown[]> } }).eq
    return (await eq.listCharacters()).length
  })
}

/** The name of the character the app is actually TAILING (null when it is idle). */
function attachedCharacter(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const eq = (window as unknown as { eq: { getCharacter: () => Promise<{ name: string } | null> } }).eq
    return (await eq.getCharacter())?.name ?? null
  })
}

/**
 * ONE SHAPE, END TO END: save it, then assert the app resolved the same install, listed the log
 * and is tailing it. `root`/`logsDir` are asserted against the staged install, so a resolution
 * that merely "found something" cannot pass.
 */
async function checkShape(
  page: Page,
  label: string,
  picked: string,
  install: { root: string; logsDir: string }
): Promise<void> {
  const config = await setEqDir(page, picked)
  check(
    `${label}: the app reports the INSTALL as the effective folder`,
    samePath(config.root, install.root),
    `root=${config.root}`
  )
  check(
    `${label}: …and reads the real Logs dir, not one joined onto the pick`,
    samePath(config.logsDir, install.logsDir),
    `logsDir=${config.logsDir}`
  )
  check(
    `${label}: …it is still a MANUAL override (normalizing is not auto-detecting)`,
    config.source === 'manual' && config.overridden,
    `source=${config.source} overridden=${String(config.overridden)}`
  )
  check(
    `${label}: THE REPORTED SYMPTOM IS GONE — the character log is detected`,
    config.characterCount === 1,
    `characterCount=${String(config.characterCount)}`
  )
  check(
    `${label}: …and the read itself is reported as having SUCCEEDED (JOS-82)`,
    config.readable === 'ok',
    `readable=${config.readable}`
  )
  const listed = await settle(() => characterCount(page), (n) => n === 1)
  check(`${label}: …the character selector lists it`, listed === 1, `listed=${String(listed)}`)
  const tailing = await settle(() => attachedCharacter(page), (n) => n === 'Primitive')
  check(
    `${label}: …and the app is tailing it, not merely counting it`,
    tailing === 'Primitive',
    `attached=${tailing ?? 'none'}`
  )
}

/** Navigate to Preferences → Game and wait for the folder card to be on screen. */
async function openFolderCard(page: Page): Promise<void> {
  await page.click('[data-testid="nav-preferences"]', { timeout: 60_000 })
  await page.waitForSelector('[data-testid="prefs-rail-game"]', { timeout: 20_000 })
  await page.click('[data-testid="prefs-rail-game"]')
  await page.waitForSelector('[data-testid="eq-folder-check"]', { timeout: 20_000 })
}

/**
 * The Preferences → Game card, as the reporters read it: the install folder, the folder logs
 * are actually READ from (JOS-82 — its absence is what made a normalized pick look refused),
 * the verdict sentence, and whether the log-FILE picker is offered at all.
 */
async function readFolderCard(
  page: Page
): Promise<{ path: string; logsPath: string; verdict: string; hasFilePicker: boolean }> {
  // No local function declarations inside `evaluate`: tsx compiles the spec with esbuild, which
  // injects a `__name` helper around named arrows — and that helper does not exist in the page.
  return page.evaluate(() => ({
    path: document.querySelector('[data-testid="eq-folder-path"]')?.textContent?.trim() ?? '',
    logsPath:
      document.querySelector('[data-testid="eq-folder-logs-path"]')?.textContent?.trim() ?? '',
    verdict: document.querySelector('[data-testid="eq-folder-check"]')?.textContent?.trim() ?? '',
    hasFilePicker: document.querySelector('[data-testid="eq-folder-pick-file"]') !== null
  }))
}

async function main(): Promise<void> {
  buildIfStale()

  const launched = await launchOnFixture('e2e-overview.log')
  const install = { root: launched.log.installDir, logsDir: join(launched.log.installDir, 'Logs') }
  let page: Page | null = null
  try {
    page = await mainWindow(launched.app)
    await page.waitForSelector('[data-testid="nav-overview"]', { timeout: 60_000 })

    // 1. The shape that always worked, saved explicitly — the control for everything below.
    await checkShape(page, 'the install ROOT', install.root, install)

    // 2. THE REPORTED SHAPE. `…\Logs`, which used to resolve to `…\Logs\Logs`.
    await checkShape(page, 'the LOGS folder', install.logsDir, install)

    // 3. The log FILE itself — the other thing a person reasonably picks.
    await checkShape(page, 'the LOG FILE', launched.log.logPath, install)

    // 4. A trailing separator is not a different folder (a path pasted, not picked).
    await checkShape(page, 'the LOGS folder + a trailing slash', `${install.logsDir}\\`, install)

    // 5. …and the Settings card says so on screen, which is where the reporters were reading.
    await openFolderCard(page)
    const card = await readFolderCard(page)
    check(
      'the Game card stops saying "no logs" and states the find',
      /Found 1 character log/.test(card.verdict),
      `verdict=${card.verdict}`
    )
    check(
      '…and shows the folder it actually resolved, not the raw pick',
      samePath(card.path, install.root),
      `shown=${card.path}`
    )
    // JOS-82. The card used to print the install ROOT alone. Pick `…\Logs` and normalization
    // correctly answers with its PARENT — so the one path on screen was not the path the user
    // picked, and nothing said why. "Wont let me change the Everquest Legends folder" is what
    // that looks like from the outside. Naming the folder logs are READ from makes the pick
    // visible, and it is the line that actually matters.
    check(
      'THE CARD NAMES THE FOLDER IT READS, not just the install root (JOS-82)',
      samePath(card.logsPath, install.logsDir),
      `logsShown=${card.logsPath} want=${install.logsDir}`
    )
    // The affordance whose absence is the other half of the report: Windows' folder dialog
    // lists ONLY folders, and a real Logs dir has no subfolders — so the user hunting for the
    // `eqlog_*.txt` the card names is shown an empty pane. There must be a dialog that can
    // show files. (The native dialog itself is unautomatable; that it is OFFERED is not.)
    check(
      'a log-FILE picker is offered, not only a folder picker (JOS-82)',
      card.hasFilePicker,
      `eq-folder-pick-file present=${String(card.hasFilePicker)}`
    )

    // 6. HONEST FAILURE SURVIVES. Normalizing must not turn a wrong path into a hopeful guess:
    //    a folder that is not an install still reports zero, exactly as it always did.
    const bogus = await setEqDir(page, join(install.root, 'nowhere-at-all'))
    check(
      'a folder with no install still honestly reports zero',
      bogus.characterCount === 0 && bogus.source === 'manual',
      `count=${String(bogus.characterCount)} source=${bogus.source}`
    )
    // …and it says WHICH kind of nothing. `characterCount === 0` used to be the whole story,
    // so the card told a user whose folder could not be read to go turn `/log on` — advice
    // that cannot work. A path that is not there reads 'missing', never 'ok'.
    check(
      'a nonexistent folder is reported as MISSING, not as an empty one (JOS-82)',
      bogus.readable === 'missing',
      `readable=${bogus.readable}`
    )
    // The card is push-updated (`eqconfig:changed`), so wait for the verdict to arrive rather
    // than race it.
    const bogusVerdict = await settle(
      async () => (await readFolderCard(page)).verdict,
      (v) => /doesn.t exist/i.test(v)
    )
    check(
      '…and the card stops telling that user to enable logging',
      /doesn.t exist/i.test(bogusVerdict) && !/log on/.test(bogusVerdict),
      `verdict=${bogusVerdict}`
    )

    // 7. Back to a good install, so the run ends on the state the app should be in.
    await setEqDir(page, install.root)

    if (failures.length) await dumpArtifacts(page, 'eq-folder-FAIL')
  } finally {
    await launched.close()
  }

  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
