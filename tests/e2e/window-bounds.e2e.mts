/**
 * Headless Electron test for THE WINDOW REMEMBERING ITS SIZE (JOS-248).
 *
 * Report 01KZSYHKZDERT9P4YAFJN4N3QP (v0.22.0): can the app save its window size. The policy is
 * pure and pinned next door — tests/windowState.test.mts covers what is worth remembering (a
 * maximized window, a minimized one, a destroyed one, the debounce's coalescing) and
 * tests/displayFit.test.mts covers the geometry against monitor arrangements this machine does not
 * have. Three claims are left over, and every one of them is about a REAL WINDOW IN A REAL
 * PROCESS:
 *
 *   1. A fresh install comes up at TODAY'S DEFAULT SIZE, exactly. The requirement is a promise
 *      about the window a first-time user gets, and the only honest evidence is that window.
 *   2. A size and position chosen in one process is the size and position the NEXT process opens
 *      at. That is a claim about a file outliving the app that wrote it, so it is two launches
 *      over one userData dir — a reload would prove nothing.
 *   3. A rectangle on a monitor that no longer exists comes up ON SCREEN, and the store STILL
 *      REMEMBERS IT. Both halves matter: the clamp is what is SHOWN, never what is STORED, or a
 *      single launch with the cable out would silently destroy the layout the user chose (JOS-187's
 *      ruling for the overlays, which this window now shares).
 *
 * THE LOST MONITOR IS SUPPLIED HONESTLY, not simulated: a stored rectangle at x=9000, which is off
 * every display this machine has for the same reason the reporter's was off theirs. It is written
 * into the store BETWEEN launches, with no app running — electron-store rewrites the whole file
 * from its in-memory copy on any `set`, so an edit made underneath a live app would be a race with
 * every unrelated setting.
 *
 * EXACT ABOUT THE STORE, TOLERANT ABOUT THE GLASS, and the split is the whole point of this spec
 * on a display whose scale factor is not a whole number. `setBounds` and the BrowserWindow
 * constructor round a DIP rectangle through physical pixels, so the window that appears is a few
 * pixels bigger than the one that was asked for — up to +8 DIP on a quarter-step display (1.25,
 * 1.75, 2.25), never smaller and never moved; the measured table per scale factor is in
 * src/main/windowState.ts above `placementEnvelope`. (The old fixed four pixels came from a handful
 * of placements and was already too narrow: on Electron 43.8.12 this spec's own lost-monitor
 * placement comes back 1046x722 for 1040x720 on the owner's 2.25 display.)
 *
 * So: anywhere a SHOWN window is compared against a size somebody REQUESTED, the comparison
 * carries the PRODUCT's envelope for the display the window is on (`placementEnvelope`, one-sided,
 * sized by that display's scale factor). Anywhere the STORE is compared, the comparison is
 * byte-exact and always will be, because that is the claim: the file holds the rectangle the user
 * left the window at, unrounded and undrifted, however many times the app has re-placed the window
 * since. Widening a store comparison would hide exactly the defect this spec caught, which is that
 * each launch used to write down the rectangle the previous launch was granted.
 *
 * WHICH IS WHY THE CHOSEN RECTANGLE IS READ BACK, not assumed. The spec asks for `CHOSEN`, then
 * reads what the window actually became and holds THAT as the user's rectangle for every
 * store comparison that follows. What the user chose is where the window ended up, not the number
 * a test typed.
 *
 * WHAT THIS SPEC DELIBERATELY DOES NOT COVER: the maximize restore. `maximize()` is documented to
 * SHOW a window that is not being shown, and `EQ_E2E=1` exists precisely so that no window is ever
 * put over the user's game — so the restore lives inside that guard in windows.ts and this harness
 * must not reach around it. The two halves it would prove are pinned where they can be: that a
 * maximized window is remembered as its NORMAL bounds plus the flag (windowState.test.mts), and
 * that the flag is what `ready-to-show` acts on (source, one branch).
 *
 * Run: `npm run test:e2e -- window-bounds`
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from 'playwright-core'
import { buildIfStale, check, note, reportRun, settle } from './appHarness.mjs'
import { closeWindows, mainWindow, makeUserData, removeUserData } from './appWindow.mjs'
import { launchOnFixture, stageFixture } from './logFixture.mjs'
import {
  DEFAULT_MAIN_WINDOW_SIZE,
  placementEnvelope,
  withinPlacementEnvelope,
  type PlacementEnvelope
} from '../../src/main/windowState'

/** A window rectangle, as Electron hands it over. */
interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Where the main window is, and whether one display's work area holds all of it. */
interface Placement {
  bounds: Bounds | null
  onScreen: boolean
  /** The scale factor of the display the window is on — what sizes the rounding envelope. */
  scaleFactor: number | null
}

/** The store file this launch reads and writes — `STORE_NAME` in src/main/channel.ts, which cannot
 *  be imported here (it reaches Electron). A rename that forgot this line fails the spec loudly. */
const STORE_FILE = 'everquest-companion-progress.json'

/** The size a fresh install has always had, as the source states it. */
const DEFAULT_SIZE = DEFAULT_MAIN_WINDOW_SIZE

/** Where this spec puts the window, standing in for the user's own drag + resize. Comfortably
 *  inside any display this suite can run on, and clear of the 900x600 minimums. */
const CHOSEN: Bounds = { x: 120, y: 80, width: 1040, height: 720 }

/** A rectangle on no display this machine has — the reporter's second monitor, after the fact. */
const LOST_MONITOR: Bounds = { x: 9000, y: 9000, width: 1040, height: 720 }

const key = (b: Bounds | null): string => (b ? `${b.x},${b.y} ${b.width}x${b.height}` : '(none)')

/**
 * The MAIN window as main itself sees it, with `onScreen` answered where the question belongs:
 * only the main process can ask `screen` what displays exist. Identified by what it is NOT — the
 * overlays and the cursor ring load pages of their own — because this window's own URL differs
 * between a dev server and a built bundle.
 */
function mainPlacement(app: ElectronApplication): Promise<Placement> {
  return app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((win) => {
      const url = win.webContents.getURL()
      return !url.includes('overlay.html') && !url.includes('cursor.html')
    })
    if (!w) return { bounds: null, onScreen: false, scaleFactor: null }
    const b = w.getBounds()
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return (
        b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height
      )
    })
    return { bounds: b, onScreen, scaleFactor: screen.getDisplayMatching(b).scaleFactor }
  })
}

/** Move + resize the main window, standing in for the drag and the corner pull. */
async function placeMainWindow(app: ElectronApplication, target: Bounds): Promise<void> {
  await app.evaluate(({ BrowserWindow }, b) => {
    const w = BrowserWindow.getAllWindows().find((win) => {
      const url = win.webContents.getURL()
      return !url.includes('overlay.html') && !url.includes('cursor.html')
    })
    w?.setBounds(b)
  }, target)
}

/** What the STORE says, read from the file the app left behind. Never while an app is running. */
function storedBounds(userData: string): (Bounds & { maximized?: boolean }) | null {
  const raw = JSON.parse(readFileSync(join(userData, STORE_FILE), 'utf8')) as {
    windowBounds?: Bounds & { maximized?: boolean }
  }
  return raw.windowBounds ?? null
}

/** Write a remembered rectangle into the store, keeping every other setting — the state an
 *  unplugged monitor leaves behind, applied with nothing running. */
function writeStoredBounds(userData: string, bounds: Bounds): void {
  const path = join(userData, STORE_FILE)
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  raw.windowBounds = bounds
  writeFileSync(path, JSON.stringify(raw, null, 2), 'utf8')
}

/**
 * The DPI-rounding envelope: how far the window that APPEARS may be from the rectangle that was
 * asked for. It is the PRODUCT's own envelope (`placementEnvelope`, src/main/windowState.ts) for
 * the display the window is on — one-sided (the rounding only grows a window) and sized by that
 * display's scale factor — so this spec and the saver can never disagree about what is rounding.
 */
const envelopeOf = (shown: Placement): PlacementEnvelope => placementEnvelope(shown.scaleFactor)

/** Byte-exact. Every STORE comparison in this file goes through this one and no other. */
const same = (a: Bounds | null, b: Bounds): boolean =>
  a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** The shown rectangle, within the rounding envelope of the one that was requested. */
const near = (shown: Placement, requested: Bounds): boolean =>
  withinPlacementEnvelope(requested, shown.bounds, envelopeOf(shown))

/** The shown SIZE, within the same envelope. Position is not part of that question. */
const nearSize = (shown: Placement, requested: { width: number; height: number }): boolean =>
  shown.bounds !== null &&
  withinPlacementEnvelope(
    { ...shown.bounds, width: requested.width, height: requested.height },
    shown.bounds,
    envelopeOf(shown)
  )

/** The envelope a check was judged against, for its detail line. */
const envelopeNote = (shown: Placement): string =>
  `scale ${String(shown.scaleFactor)}, up to +${String(envelopeOf(shown).grow)}`

async function main(): Promise<void> {
  buildIfStale()

  // ONE dir across three launches, because every assertion here is that it OUTLIVES a process.
  // ONE staged log, so the launches are comparable in everything except the window.
  const userData = makeUserData()
  const log = stageFixture('e2e-telemetry.log')
  // The rectangle the window REALLY ended up at when this spec stood in for the user's drag. Read
  // back rather than assumed (see the header), and byte-exact from here on.
  let chosen: Bounds | null = null

  console.log('launch 1: fresh userData — the default size, then a move and a resize…')
  const first = await launchOnFixture(log, { userData })
  try {
    await mainWindow(first.app)
    const fresh = await mainPlacement(first.app)
    check(
      `a fresh install opens at today's default size (${String(DEFAULT_SIZE.width)}x${String(DEFAULT_SIZE.height)}, within the rounding the display adds)`,
      nearSize(fresh, DEFAULT_SIZE),
      `${key(fresh.bounds)} · ${envelopeNote(fresh)}`
    )
    await placeMainWindow(first.app, CHOSEN)
    const moved = await settle(() => mainPlacement(first.app), (p) => near(p, CHOSEN), {
      timeoutMs: 10_000
    })
    check('the window can be put somewhere else', near(moved, CHOSEN), `${key(moved.bounds)} · ${envelopeNote(moved)}`)
    chosen = moved.bounds
    // The user's own exit: closing the window is what flushes the debounced save (and `app.quit()`
    // — the path Playwright's own close takes — is covered by the `before-quit` flush beside it).
    await closeWindows(first.app)
  } finally {
    await first.close()
  }

  const written = storedBounds(userData)
  check(
    'closing the window writes down where it was left, byte for byte',
    chosen !== null && same(written, chosen),
    `stored ${key(written)} vs the window itself ${key(chosen)}`
  )
  check(
    '…and an ordinary window is remembered without a maximized flag',
    written?.maximized === undefined,
    String(written?.maximized)
  )

  console.log('launch 2: same userData — does the window come back where it was…')
  const second = await launchOnFixture(log, { userData })
  try {
    await mainWindow(second.app)
    const arrived = await mainPlacement(second.app)
    check(
      'a relaunch opens at the remembered size AND position (nothing in this spec has moved it)',
      chosen !== null && near(arrived, chosen),
      `${key(arrived.bounds)} vs the remembered ${key(chosen)} · ${envelopeNote(arrived)}`
    )
    await closeWindows(second.app)
  } finally {
    await second.close()
  }
  // THE COMPOUNDING CHECK. A launch re-places the window at the remembered rectangle and the
  // display rounds that placement outward, so a saver that cannot tell its own placement from a
  // user's gesture writes the rounded one down and the store grows a few pixels every single
  // launch. Byte-exact, forever, for exactly that reason.
  check(
    'a launch that never touched the window leaves the remembered rectangle alone, byte for byte',
    chosen !== null && same(storedBounds(userData), chosen),
    `stored ${key(storedBounds(userData))} vs the remembered ${key(chosen)}`
  )

  // ── the lost monitor ───────────────────────────────────────────────────────────────────────
  writeStoredBounds(userData, LOST_MONITOR)
  console.log('launch 3: the remembered monitor is gone — does the window still come up…')
  const third = await launchOnFixture(log, { userData })
  try {
    await mainWindow(third.app)
    const rescued = await mainPlacement(third.app)
    check(
      'a window remembered on a monitor that no longer exists comes up ON a display that does',
      rescued.onScreen,
      key(rescued.bounds)
    )
    check(
      '…at the size the user chose (only the position had to be overruled)',
      nearSize(rescued, LOST_MONITOR),
      `${key(rescued.bounds)} · ${envelopeNote(rescued)}`
    )
    await closeWindows(third.app)
  } finally {
    await third.close()
  }
  const kept = storedBounds(userData)
  check(
    'the clamp is what is SHOWN, never what is STORED — plugging the monitor back in restores it',
    same(kept, LOST_MONITOR),
    key(kept)
  )

  await removeUserData(userData)
  await log.dispose()
  note('three real launches over one userData dir — the persistence claims are restarts, not reloads')
  reportRun()
}

main().catch((err: unknown) => {
  console.error('e2e: harness error —', err)
  process.exitCode = 1
})
