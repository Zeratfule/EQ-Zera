// updater.ts — TRANSPARENT auto-update via electron-updater
// (Task #27; UX rework #55; the invisible-update rework is Task #60).
//
// GOAL (user's words): "transparent upgrades where you can click a button to
// restart to automatically use the new version. silent background download and
// install, transparently cleanly … they don't put the installer in your face
// over and over." That is the Discord / VS Code / Claude Code model, and on
// Windows it is achievable ONLY because of the installer shape we already ship
// (per-user one-click NSIS). See the research block below for why.
//
// SHAPE OF THE FLOW — REWORKED FOR THIS FORK (EQ Zera, owner direction 2026-09-08):
// "We also need a way to push updates to people's apps so they can see when there's
// an available update, click on the notification when there is one, and it will just
// automatically download and update from there." So the flow is no longer invisible;
// it is a NOTIFICATION with a click on it, and nothing crosses the network until that
// click happens.
//   1. Check on a lazy cadence (shared/update.ts: ~45s after launch, then every
//      4h +/- 25% jitter, exponential backoff on failure). Never a modal.
//   2. On `update-available` we push a CARD at the celebration overlay ourselves —
//      no renderer request, no validator, main to window (shared/updateToast.ts
//      builds it). It says which build is ready and offers "Download and install".
//      NOTHING is downloaded yet: `autoDownload` is off and the click is the trigger.
//   3. The click comes back over `toast:action` as one of two names (main/toast.ts
//      validates it) and lands in `runToastAction` below. `updateDownload` starts the
//      download; the same card refreshes in place with a percentage as it runs.
//   4. On `update-downloaded` the build is STAGED, not installed. The left-nav chip
//      lights up gold and the same card comes back offering "Restart to install".
//   5. Either the user takes that (or the Preferences button, or the chip) ->
//      `update:install` -> quitAndInstall, or they never do and `autoInstallOnAppQuit`
//      applies it silently the next time they close the app. Both apply paths are UI-less.
//
// DEV GUARD: electron-updater throws ("app-update.yml not found") when the app
// is not packaged. We skip the machinery in that case (`npm run dev` stays
// quiet) but still answer the read/no-op IPCs so the UI renders identically.
//
// ===========================================================================
// RESEARCH (Task #60) — verified against the INSTALLED electron-updater@6.8.9
// and app-builder-lib sources in node_modules, not against the docs site. The
// published docs describe a newer API (`quitAndInstall(…, waitUntilNextLaunch)`,
// `autoInstallEvent`) that DOES NOT EXIST in 6.8.9
// (electron-updater/out/BaseUpdater.d.ts:9 declares only
// `quitAndInstall(isSilent?, isForceRunAfter?)`). Re-verify on upgrade.
//
// --- 1. Does an installer window EVER appear for us? -----------------------
// YES — but only on one code path, and we do not take it.
//
// electron-updater/out/NsisUpdater.js:101-149 builds the installer argv:
//     args = ["--updated"]
//     if (isSilent)        args.push("/S")
//     if (isForceRunAfter) args.push("--force-run")
//
// app-builder-lib/templates/nsis/installSection.nsh:14-33, inside `!ifdef
// ONE_CLICK` (which our `oneClick: true` defines — NsisTarget.js:380):
//     ${IfNot} ${Silent}
//       SpiderBanner::Show /MODERN /ICON …
//       SendMessage $0 ${WM_SETTEXT} 0 "STR:$(installing)"
//     ${endif}
// `${Silent}` is NSIS's own built-in, set by `/S`. So:
//
//   quitAndInstall()          -> `--updated --force-run`   VISIBLE installer
//                                (isSilent=false makes isForceRunAfter default
//                                to autoRunAppAfterInstall — BaseUpdater.js:13-27)
//   quitAndInstall(true,true) -> `--updated /S --force-run`  NO UI, relaunches
//   autoInstallOnAppQuit      -> `--updated /S`              NO UI, no relaunch
//                                (BaseUpdater.js:69-90, `this.install(true,false)`)
//
// => MITIGATION, and it is the whole ballgame: NEVER call bare quitAndInstall().
//    We call quitAndInstall(true, true). Both of our paths are UI-less.
//
// `--updated` is the second suppressor. allowOnlyOneInstallerInstance.nsh:50-79:
// if the app is still running, the installer shows a MessageBox — UNLESS
// ${isUpdated}, in which case it sleeps 1s and taskkills quietly. The process
// probe uses nsExec (windowless), so no console flash either.
// NOTE: the relaunched app receives `--updated` in process.argv
// (common.nsh:123-132) — our argv handling must tolerate it (it does; we read
// env, not flags).
//
// --- 2. Elevation: none, and structurally so ------------------------------
// `perMachine: false` means NsisTarget.js:412-419 never defines
// INSTALL_MODE_PER_ALL_USERS, so installer.nsi:19-21 compiles
// `RequestExecutionLevel user` — no UAC manifest exists in the exe at all.
// Separately NsisTarget.js:290-292 only writes `isAdminRightsRequired` into
// latest.yml `if (isPerMachine && …)`, so the flag is absent, DownloadedUpdate-
// Helper.js:61 records false, and NsisUpdater.js:126-130's elevate.exe branch is
// never taken. The ONLY residual elevation path is the spawn-failure fallback
// (NsisUpdater.js:131-147: UNKNOWN/EACCES -> elevate.exe -> UAC). This is why
// AGENTS.md says never flip perMachine — it would turn every update into a UAC
// prompt AND make oneClick installs elevate.
//
// --- 3. Staged vs installed ----------------------------------------------
// "Downloaded" means an exe is sitting in
// %LOCALAPPDATA%\<updaterCacheDirName>\pending\ next to update-info.json
// (AppUpdater.js:545-554 + AppAdapter.js:11-12; DownloadedUpdateHelper.js:30-65).
// The install dir is untouched until that exe is spawned. The staged file
// survives app restarts — which is what makes "ignore the chip forever" safe.
//
// --- 4. Differential/blockmap downloads ----------------------------------
// On by default; reuses blocks from %LOCALAPPDATA%\<cache>\installer.exe against
// the previous release's .blockmap (AppUpdater.js:643-712). Every failure mode
// (missing old release, size mismatch, blockmap version mismatch) is caught at
// AppUpdater.js:704-711 -> "fallback to full download". So a broken differential
// costs bandwidth, never correctness. GitHub forces one sequential Range request
// per op (GitHubProvider.js:14-17, "because GitHib uses S3").
//
// --- 5. GitHub feed cost + rate limiting ----------------------------------
// GitHubProvider deliberately AVOIDS api.github.com ("do not use API for GitHub
// to avoid limit" — GitHubProvider.js:158-175). One check = 3 plain github.com
// GETs: releases.atom, (only when allowPrerelease=false) releases/latest, and
// releases/download/<tag>/latest.yml. So the documented 60/hr unauthenticated
// API limit does not apply; undocumented abuse-detection limits do, which is
// exactly what the jittered multi-hour cadence is for. Asset downloads 302 to
// objects.githubusercontent.com and are CDN-cacheable (util.js:18-28 skips the
// no-cache query for GitHub).
//
// --- 6. The trap that bit the old code -----------------------------------
// (a) SETTING autoUpdater.channel SILENTLY FORCES allowDowngrade = true
//     (AppUpdater.js:44). We set `channel` on every launch, so downgrades were
//     enabled the whole time — a re-published/rolled-back release could have
//     walked an install BACKWARDS. `applyChannel` now resets it to false.
// (b) `update-downloaded` IS RE-EMITTED on every check that resolves to an
//     already-staged file (DownloadedUpdateHelper.js:33-52 -> BaseUpdater.js:
//     31-35 always calls dispatchUpdateDownloaded + addQuitHandler). Any UI that
//     fires on that event re-fires on every poll — that is precisely the
//     "installer in your face over and over" the user complained about. Ours is
//     state-driven, the toast dedupes per version, and we stop checking once
//     ready.
// (c) Re-validating a staged file RE-HASHES the whole installer (sha512,
//     DownloadedUpdateHelper.js:88-131) on every check. Another reason to stop
//     polling once ready, and to poll in hours not minutes.
// (d) checkForUpdatesAndNotify() pops a native OS toast (AppUpdater.js:286-313).
//     Never use it.
// (e) disableWebInstaller defaults to false and logs a nag on EVERY download
//     (NsisUpdater.js:44-46). We ship an NSIS target, so set it true.
// (f) A failed download retry calls removeFileIfAny -> emptyDir(pending)
//     (AppUpdater.js:609-616) — it DESTROYS a previously staged update. One more
//     reason the retry count is bounded rather than infinite.
//
// --- 7. What the "invisible" apps actually do ----------------------------
// Squirrel.Windows (Discord's lineage) makes the same two bets we do: per-user
// install under %LocalAppData% so there is no UAC, and apply-on-next-launch so
// the user never watches an installer. VS Code's cadence
// (abstractUpdateService.ts) is a first check 30s after startup then hourly;
// Chrome/Omaha wakes hourly and compares against a configured minimum period.
// Ours is deliberately lazier than all of them — see shared/update.ts.
// Failure modes they all share, and how we cover them: partial download (sha512
// + temp-file rename, then our bounded retry), version skew (our isStaleVersion
// guard + we never persist a 'ready' state across restarts), update loops (the
// bounded attempt counter; electron-updater's own quitAndInstallCalled latch is
// per-process and gives no cross-restart protection), rate limiting (jittered
// backoff).

import { app, ipcMain, powerMonitor, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC } from '../shared/ipc'
import type { UpdateChannel, UpdateStatus } from '../shared/types'
import {
  MAX_DOWNLOAD_ATTEMPTS,
  SIGNATURE_BLOCKED_PAUSED_MESSAGE,
  describeUpdateFailure,
  isInterruptedFailure,
  isStaleVersion,
  nextCheckDelayMs,
  shouldRetryCheck
} from '../shared/update'
import { logError, logInfo, logWarn } from './errorLog'
import {
  UPDATER_LIBRARY_SOURCE,
  UPDATER_LOG_PREFIX,
  logUpdateFailure,
  routeUpdaterLibraryError,
  type UpdateLogSinks,
  type UpdateStep
} from './updateLog'
import {
  updateAvailableToast,
  updateDownloadedToast,
  updateDownloadingToast,
  updateFailedToast
} from '../shared/updateToast'
import { sendToToastOverlay, setToastUpdateActionHandler } from './toast'
import { getUpdateChannel, getUpdateLastCheckedAt, setUpdateLastCheckedAt } from './store'
import { classifyFailure, recordEvent } from './telemetry'
import type { ToastUpdateAction } from '../shared/toast'

const { autoUpdater } = electronUpdater

/**
 * THE TWO SINKS `updateLog.ts` ROUTES THROUGH (JOS-295). They are handed over rather than
 * imported there so the whole routing rule stays drivable from a node test with no Electron in
 * the process; this is the one place that knows they are `errorLog`'s.
 */
const LOG_SINKS: UpdateLogSinks = { error: logError, warn: logWarn }

/**
 * electron-updater's own narration, mapped onto our sinks (JOS-295). Its default logger is
 * `console` (AppUpdater.js:179), which in a packaged app prints full stacks to a stdout nobody
 * captures. `updateLog.ts` carries the whole argument for the mapping — including why `debug` is
 * deliberately absent and why the constructor's error ECHO is dropped rather than filed twice.
 */
const LIBRARY_LOGGER = {
  info: (message?: unknown): void => {
    logInfo(UPDATER_LOG_PREFIX, message)
  },
  warn: (message?: unknown): void => {
    logWarn(UPDATER_LOG_PREFIX, message)
  },
  error: (message?: unknown): void => {
    switch (routeUpdaterLibraryError(message)) {
      case 'drop':
        return
      case 'warn':
        logWarn(UPDATER_LOG_PREFIX, message)
        return
      default:
        logError(UPDATER_LIBRARY_SOURCE, message)
    }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null

/** The last status pushed — the single source of truth behind `update:getStatus`. */
let lastStatus: UpdateStatus = { state: 'idle' }
/** Epoch millis of the last COMPLETED check (available / not-available / error). */
let lastCheckedAt: number | undefined
/** Checks that ended in an error since the last successful one — drives the backoff. */
let consecutiveFailures = 0
/** Automatic download attempts per version — the anti-loop guard (see below). */
const downloadAttempts = new Map<string, number>()
/** The version we asked electron-updater to download, while it is in flight. */
let downloading: string | null = null
/**
 * The five-percent step the toast card last printed (-1 = nothing printed yet). The card refreshes
 * on a step change rather than on every `download-progress` event; `refreshDownloadCard` owns why.
 */
let progressStep = -1
/**
 * Set once this session's downloads have been failing on THIS PC'S POWERSHELL (JOS-421) — the
 * code-signature check that answers nothing (shared/update.ts's block reads the source).
 *
 * It exists to change ONE sentence: when the bounded automatic retries are spent, the paused
 * message otherwise says `Download of v1.5.0 failed 3 times - paused`, which is true and tells a
 * user with an over-eager antivirus nothing they can act on. Sticky rather than per-failure,
 * because the state it describes is "this session's downloads keep dying that way"; cleared by a
 * download that actually lands and by a manual check.
 */
let downloadBlocked = false
/**
 * Set when we start a check, cleared by `checkDone` (the verdict) — it both stops
 * two checks overlapping and tells the `catch` in `runCheck` whether the 'error'
 * event already accounted for this failure, so one failure counts exactly once.
 */
let checkInFlight = false
/**
 * Attempts the CURRENT check has already burned (JOS-211). A malformed/empty feed
 * body buys exactly one more — `shouldRetryCheck` owns that policy.
 */
let checkAttempts = 0
/**
 * Set when a failure has been classified as retryable and swallowed: no verdict was
 * pushed, no failure was counted, and `runCheck`'s loop is expected to go round again.
 * It is the handshake between the 'error' EVENT and the `checkForUpdates()` REJECTION,
 * which both fire for the same failure — exactly like `checkInFlight`.
 */
let retryPending = false

/**
 * Map our channel choice onto electron-updater's settings — which since the tags-only
 * release rework (2026-08-03) means: STABLE RESOLUTION, ALWAYS, for both stored values.
 *
 * WHY 'main' can no longer be a custom electron-updater channel: GitHubProvider's
 * allowPrerelease branch (out/providers/GitHubProvider.js getLatestVersion) resolves the
 * tag by SHAPE, not by channel file. With a custom channel set, `shouldFetchVersion`
 * (`!currentChannel || ['alpha','beta'].includes(currentChannel)`) is false, so the ONLY
 * acceptable feed entries are tags whose semver prerelease component equals the channel —
 * i.e. `vX.Y.Z-main.N`. The moment the per-push `-main.N` prereleases were purged and
 * releases became stable `vX.Y.Z` tags, every 'main'-channel install threw "No published
 * versions on GitHub": stable tags have NO prerelease component and can never match. The
 * main.yml bridge never helped — the channel FILE is fetched only after a tag resolves.
 * (Builds 0.1.1–0.1.4 shipped that dead loop; the v0.1.5-main.1 rescue prerelease is the
 *  one tag their filter accepts, and it carries this fix.)
 *
 * So: `channel` stays UNSET (default 'latest' → latest.yml) and allowPrerelease stays
 * false, giving the provider its simplest, atomic-under-our-CI path: releases/latest →
 * latest.yml. The stored 'main'/'stable' pref is retained but both now mean stable; if
 * real prerelease channels ever return, re-read the provider source FIRST (Trap 6a).
 */
function applyChannel(_channel: UpdateChannel): void {
  autoUpdater.allowPrerelease = false
  // MUST come AFTER any channel assignment: `set channel()` silently forces
  // allowDowngrade = true (electron-updater/out/AppUpdater.js:44). We no longer set a
  // channel at all, but the guard stays — a future edit that reintroduces one must not
  // quietly re-enable downgrades (a rolled-back release would walk installs BACKWARDS,
  // invisibly, via apply-on-quit).
  autoUpdater.allowDowngrade = false
}

/**
 * The dev-mode `update:install` handler. Nothing is ever staged when the app is not
 * packaged, so there is nothing to install — but the IPC still has to answer, because the
 * whole point of registering it in dev is that the renderer never special-cases dev.
 */
const noInstallInDev = (): void => {
  /* nothing staged in dev — deliberately does nothing */
}

/**
 * THE `updateOutcome` PRODUCER (JOS-39). The schema has carried check/download/apply plus a
 * coarse failure class since it was written and nothing ever emitted one, so the Analytics tab's
 * update section was three rows of zeros — which reads as "no install has ever updated" and meant
 * "we never measured it".
 *
 * WHAT EACH STEP MEANS HERE, because the honest answer is narrower than the word suggests:
 *   * `check`    — a check reached a verdict (available / not available) or failed.
 *   * `download` — a staged build appeared, or the download failed.
 *   * `apply`    — the user CLICKED the chip and we handed the installer over. The silent
 *     apply-on-quit path (`autoInstallOnAppQuit`) is invisible from inside this process by
 *     construction: it happens as the app dies. The fleet-wide answer to "did installs actually
 *     move" is the SERVER-side `upgrades` counter (src/shared/telemetryRollup.ts), which sees the
 *     version change on the next batch however the update was applied.
 *
 * Never a message: `classifyFailure` reduces an error to one of five words before it can reach an
 * event, and the event type has no field a message could go in.
 */
function noteUpdate(step: 'check' | 'download' | 'apply', err?: unknown): void {
  if (err === undefined) {
    recordEvent({ t: 'updateOutcome', step, ok: true })
    return
  }
  recordEvent({ t: 'updateOutcome', step, ok: false, failureClass: classifyFailure(err) })
}

/** The status sinks the electron-updater event handlers write through. */
interface StatusSinks {
  /** Record + broadcast a status. */
  push: (status: UpdateStatus) => void
  /** A check finished (whatever the verdict) — stamp + PERSIST the time, then push. */
  checkDone: (status: UpdateStatus) => void
  /**
   * A check DID NOT finish because the machine suspended (JOS-307) — re-anchor the cadence to a
   * short post-wake delay. Deliberately NOT `checkDone`: stamping `lastCheckedAt` here would make
   * the chip claim a check that never completed, which is the exact dishonesty this ticket is
   * about at the other end of the same wire.
   */
  retryOnResume: () => void
}

/**
 * AN INTERRUPTED REQUEST IS NOT A FAILED CHECK (JOS-307, owner ruling 2026-08-14).
 *
 * Chromium tears down network IO when the host suspends or its interface changes, and whatever was
 * in flight rejects; treating that as a verdict was costing three separate lies at once — a fleet
 * error report about a laptop's lid, a `consecutiveFailures` tick that walked the backoff out to
 * four hours, and a `checkedAt` stamp for a check that never completed.
 *
 * FOUR THINGS HAPPEN, AND THE ONES THAT DO NOT ARE THE POINT:
 *   * `logUpdateFailure` routes it — warn once per code per session, NEVER the error store;
 *   * `noteUpdate` still counts ONE bounded telemetry outcome, because the law that one logical
 *     check produces exactly one of those is not this ticket's to bend;
 *   * the resting status is re-pushed so the chip leaves 'checking' — carrying the OLD `checkedAt`,
 *     which keeps ageing and is the honest thing for it to say;
 *   * `retryOnResume` re-anchors the cadence.
 *   * `consecutiveFailures` is NOT touched, and `checkDone` is NOT called.
 *
 * Clearing `checkInFlight` is what marks the failure ACCOUNTED, so `runCheck`'s catch leaves it
 * alone — the same handshake `checkDone` performs on every other path. ONE function for both call
 * sites (the event and the rejection), because they are one ruling.
 */
function noteInterrupted(step: UpdateStep, err: unknown, sinks: StatusSinks): void {
  logUpdateFailure(step, 'final', err, LOG_SINKS)
  noteUpdate(step, err)
  checkInFlight = false
  sinks.push({ state: 'idle' })
  sinks.retryOnResume()
}

/**
 * ROUTE A `checkForUpdates()` REJECTION THAT THE 'error' EVENT DID NOT ALREADY ACCOUNT FOR.
 *
 * Both paths fire for the same failure, so only an UNACCOUNTED one may be routed here — the caller
 * owns that test. Everything below mirrors the event handler's three verdicts in the same order,
 * and the RAW-FIRST rule (JOS-295) holds on every one of them: `describeUpdateFailure` is a one-way
 * door and nothing durable may be taken after it opens.
 */
function routeCheckRejection(err: unknown, sinks: StatusSinks): void {
  if (isInterruptedFailure(err)) {
    noteInterrupted('check', err, sinks)
    return
  }
  if (shouldRetryCheck(err, checkAttempts)) {
    logUpdateFailure('check', 'retrying', err, LOG_SINKS)
    retryPending = true
    return
  }
  logUpdateFailure('check', 'final', err, LOG_SINKS)
  consecutiveFailures++
  sinks.checkDone({ state: 'error', message: describeUpdateFailure(err) })
}

/**
 * HAND THE PROCESS TO THE INSTALLER. Lifted out of `initUpdater` for size only.
 *
 * quitAndInstall(isSilent=TRUE, isForceRunAfter=TRUE) is NOT optional styling: `/S` is the only
 * thing standing between the user and a visible NSIS SpiderBanner + INSTFILES window (research §1),
 * and `--force-run` is what relaunches us into the new build. Bare quitAndInstall() shows the
 * installer. The single-instance lock in index.ts makes the relaunch focus cleanly.
 *
 * THE STORE SETTLES FIRST, AND THE ORDER IS THE POINT (JOS-272). `quitAndInstall(true, true)` does
 * not merely quit: it SPAWNS the installer and then quits, and the installer — because we pass
 * `--updated` — sleeps about a second and taskkills whatever is still running (research §1,
 * allowOnlyOneInstallerInstance.nsh:50-79). Everything this process still owes the settings file
 * therefore used to be written INSIDE that window, from `before-quit`, racing a kill. A store write
 * torn by that kill is unparseable on the next boot, which is a quarantine-and-defaults launch:
 * every alert, preference and character gone, in the one launch a user most associates with the app
 * having changed something. Doing the writes here makes the race unnecessary rather than
 * survivable; `before-quit` still runs them a moment later, idempotently.
 *
 * A FAILING SETTLE MAY NOT VETO THE UPDATE. Each step inside `flushStore` already has its own
 * try/catch (index.ts `teardownStep`); this one is for anything the list itself could throw.
 */
function applyStagedUpdate(flushStore: () => void): void {
  try {
    flushStore()
  } catch (err) {
    logError('main:updateSettle', err)
  }
  try {
    autoUpdater.quitAndInstall(true, true)
    // RECORDED AFTER THE CALL AND BEFORE THE PROCESS DIES, which works because the ring is written
    // synchronously (telemetry/ring.ts) and `quitAndInstall` only *initiates* the quit. The event
    // therefore survives on disk and is sent by the NEW build's first flush — which is the only
    // process that could ever report it.
    noteUpdate('apply')
  } catch (err) {
    noteUpdate('apply', err)
    throw err
  }
}

/**
 * THE OFFER (EQ Zera, 2026-09-08). A newer build exists; say so ONCE, on the overlay the user is
 * already looking at, and pull nothing until they answer.
 *
 * NOTHING IS DOWNLOADED HERE, and that is the change this ticket is. The old shape called
 * `downloadUpdate()` from this point, which is the invisible model the upstream app wanted; the
 * owner asked for a notification you click instead, so the network work now belongs to
 * `startDownload` and the only thing that reaches it is a press on the card this function draws.
 *
 * TWO SILENCES, both of them the honest answer rather than an oversight:
 *   * a version whose download has already failed `MAX_DOWNLOAD_ATTEMPTS` times gets the paused
 *     STATUS and no card. Re-offering a button that has failed three times is not an offer.
 *   * a download already in flight gets no second card: the one on screen is the one about it.
 */
function offerUpdate(version: string | undefined, push: (status: UpdateStatus) => void): void {
  const key = version ?? 'unknown'
  const attempts = downloadAttempts.get(key) ?? 0
  if (attempts >= MAX_DOWNLOAD_ATTEMPTS) {
    // ANTI-LOOP: a corrupt asset / a proxy that truncates would otherwise make us re-pull the same
    // file every cycle forever. Say so quietly (the chip renders errors as the muted resting line;
    // the text lives in Preferences). A MANUAL check resets this.
    push({
      state: 'error',
      version,
      // JOS-421: when the reason is this PC's PowerShell, say THAT — the attempt count is the
      // symptom and the security software is the thing the user can do something about.
      message: downloadBlocked
        ? SIGNATURE_BLOCKED_PAUSED_MESSAGE
        : `Download of v${key} failed ${String(attempts)} times - paused. Use "Check for updates" to retry.`
    })
    return
  }
  if (downloading !== null) return
  sendToToastOverlay(updateAvailableToast(version))
}

/**
 * THE CLICK. Start the download the offer card promised — from the card, from the Preferences
 * button, and from nowhere else.
 *
 * Every guard here is one the old automatic path had: the bounded attempt counter (a hostile
 * environment must not re-pull the same installer forever), the in-flight latch (`downloading` is
 * also what tells the shared 'error' event which STEP failed), and the requirement that a check
 * actually said 'available' — a click on a stale card must not start a download for a build the
 * feed has since replaced.
 */
function startDownload(): void {
  if (downloading !== null || lastStatus.state !== 'available') return
  const version = lastStatus.version
  const key = version ?? 'unknown'
  const attempts = downloadAttempts.get(key) ?? 0
  if (attempts >= MAX_DOWNLOAD_ATTEMPTS) return
  downloadAttempts.set(key, attempts + 1)
  downloading = key
  progressStep = -1
  sendToToastOverlay(updateDownloadingToast(version, 0))
  // Rejections also surface as an 'error' event, which does the accounting — swallow here so
  // nothing becomes an unhandled rejection.
  void autoUpdater.downloadUpdate().catch(() => undefined)
}

/**
 * REFRESH THE CARD IN PLACE, IN STEPS OF FIVE PERCENT.
 *
 * electron-updater emits `download-progress` per chunk — hundreds of events for one installer —
 * and every one of them would otherwise be an IPC message into an always-on-top window that
 * re-renders and re-reads its own layout. The STATUS push keeps every event (Preferences draws a
 * real progress bar from it); the CARD, which prints an integer, is refreshed only when that
 * integer's five-percent step changes. Same id every time, so the queue refreshes the card the
 * user is already looking at instead of stacking twenty of them (shared/updateToast.ts's header).
 */
function refreshDownloadCard(version: string | undefined, percent: number): void {
  const step = Math.floor(Math.max(0, Math.min(100, percent)) / 5)
  if (step === progressStep) return
  progressStep = step
  sendToToastOverlay(updateDownloadingToast(version, percent))
}

/**
 * Wire up the electron-updater events. Lifted out of `initUpdater` for size only — every
 * handler below is unchanged, and they all read/write the module-level counters.
 */
function registerUpdaterEvents(
  currentVersion: string,
  { push, checkDone, retryOnResume }: StatusSinks
): void {
  autoUpdater.on('checking-for-update', () => push({ state: 'checking' }))

  autoUpdater.on('update-available', (info) => {
    const version: string | undefined = info?.version
    consecutiveFailures = 0 // the CHECK succeeded, whatever happens to the download
    noteUpdate('check')
    // UPDATED-AWAY: the feed names a build we already are. Nothing to offer.
    if (isStaleVersion(version, currentVersion)) {
      checkDone({ state: 'idle' })
      return
    }
    checkDone({ state: 'available', version })
    offerUpdate(version, push)
  })

  autoUpdater.on('update-not-available', () => {
    consecutiveFailures = 0
    downloading = null
    noteUpdate('check')
    checkDone({ state: 'idle' })
  })

  autoUpdater.on('download-progress', (p) => {
    // Carry the known version forward so the progress row can name the build.
    const percent = Math.round(p?.percent ?? 0)
    const version = downloading ?? lastStatus.version
    push({ state: 'downloading', percent, version })
    refreshDownloadCard(version, percent)
  })

  autoUpdater.on('update-downloaded', (info) => {
    const version: string | undefined = info?.version
    // COUNTED ONLY WHEN THIS PROCESS ACTUALLY DOWNLOADED IT. Research §6b: this event is
    // RE-EMITTED on every check that re-resolves an already-staged file, so counting the event
    // itself would report one download per poll for the rest of the session — the same trap that
    // made other apps' "restart to update" prompts into a nag, arriving as a fake metric.
    // `downloading` is set only where we call `downloadUpdate()`, which makes it the exact latch.
    if (downloading !== null) noteUpdate('download')
    downloading = null
    // A build that landed proves the verification step ran, so the blocked sentence is no longer
    // the true one (JOS-421).
    downloadBlocked = false
    if (version) downloadAttempts.delete(version)
    // Belt and braces: a staged build that isn't newer than us is not an offer.
    if (isStaleVersion(version, currentVersion)) {
      push({ state: 'idle' })
      return
    }
    // TERMINAL state. We stop checking from here (see `runCheck`): the download
    // is staged, apply-on-quit will use it, a further check would re-hash the
    // whole installer for nothing, and this very event would be RE-EMITTED
    // (research §6b) — which is how "restart to update" prompts turn into a nag
    // in other apps. Pushing an idempotent state instead of firing an event is
    // what makes re-emission harmless here.
    push({ state: 'ready', version })
    // …AND THE CARD SAYS THE SECOND HALF (EQ Zera, 2026-09-08): the same id as the offer and the
    // progress line, so what the user sees is the card they already answered finishing its
    // sentence. Re-emission is harmless here for the same reason the status push is idempotent —
    // one id is one card — and `runCheck` stops checking from 'ready' anyway.
    sendToToastOverlay(updateDownloadedToast(version))
  })

  autoUpdater.on('error', (err) => {
    // Every failure mode lands here: no network (ENOTFOUND/ETIMEDOUT), GitHub
    // 403 rate-limit or 5xx, a truncated/corrupt download, a checksum mismatch.
    // NONE of them are shown loudly — the chip keeps rendering "checked …" and
    // only Preferences carries the text. The backoff below stops us from
    // hammering a feed that is refusing us.
    //
    // WHICH STEP FAILED is `downloading`: electron-updater funnels a failed download through the
    // same 'error' event as a failed check, and the only thing that tells them apart is whether
    // we had a download in flight. Getting it wrong would put CDN failures in the check row.
    const step = downloading !== null ? 'download' : 'check'
    downloading = null
    if (isInterruptedFailure(err)) {
      noteInterrupted(step, err, { push, checkDone, retryOnResume })
      return
    }
    // JOS-211: an unreadable feed body is swallowed ONCE — no verdict, no telemetry, no
    // backoff tick, because one logical check must produce exactly one of each. `runCheck`
    // reads `retryPending` and goes round again; the second failure takes the path below.
    // Downloads are untouched: they have their own bounded retry (MAX_DOWNLOAD_ATTEMPTS).
    // `checkInFlight` is what makes the swallow safe: only a failure `runCheck` is
    // waiting on may be withheld, so a stray 'error' can never leave a verdict unpushed.
    if (step === 'check' && checkInFlight && !retryPending && shouldRetryCheck(err, checkAttempts)) {
      // THE SWALLOWED ATTEMPT IS LOGGED ANYWAY (JOS-295), and it is logged as `retrying`. No
      // verdict, no telemetry and no backoff tick belong to it — but the RAW error does, or the
      // store would describe a single-shot check and could never answer whether the retry helps.
      logUpdateFailure(step, 'retrying', err, LOG_SINKS)
      retryPending = true
      return
    }
    // RAW FIRST, SANITIZED SECOND, AND THE ORDER IS THE TICKET (JOS-295). `describeUpdateFailure`
    // below is a one-way door: it replaces the parse-masked failure with a sentence for the chip
    // and throws away the status, the URL and the stack. Everything durable has to be taken from
    // `err` before it is called. `logUpdateFailure` decides where it goes — an answer from GitHub
    // is always filed, an unreachable network is bounded to one console line per code per session
    // (updateLog.ts's header argues both).
    const kind = logUpdateFailure(step, 'final', err, LOG_SINKS)
    // A BLOCKED POWERSHELL IS NOT A REASON TO BACK OFF THE FEED (JOS-421). The check itself
    // succeeded — GitHub answered, the installer downloaded, and the failure happened afterwards in
    // a child process on this PC. Walking `consecutiveFailures` out to four hours over it would
    // punish the feed for the antivirus, and would slow the very re-check that is this failure's
    // only automatic remedy. The download side stays bounded by `MAX_DOWNLOAD_ATTEMPTS`, which is
    // what stops a hostile environment re-pulling the same installer forever; the sentence the user
    // reads when that bound is reached names the cause (see `downloadBlocked` above).
    if (kind === 'blocked') downloadBlocked = true
    else consecutiveFailures++
    noteUpdate(step, err ?? 'unknown error')
    const message = describeUpdateFailure(err)
    checkDone({ state: 'error', message })
    // THE FAILURE CARD IS THE DOWNLOAD'S, NEVER THE CHECK'S (EQ Zera, 2026-09-08). A card over the
    // game is the loudest surface this app has, and the product rule it must not break is older
    // than this feature: the ONLY loud state is 'ready', and a failed CHECK is not the user's
    // problem (shared/update.ts, JOS-307). A failed DOWNLOAD is different in exactly the way that
    // matters here — the user pressed "Download and install" thirty seconds ago and is waiting for
    // it — so that one, and only that one, gets an answer where the question was asked. Everything
    // else stays in the chip's muted line and in Preferences, unchanged.
    if (step === 'download') sendToToastOverlay(updateFailedToast(message))
  })
}

/**
 * FORK SWITCH (EQ Zera). ON since 2026-09-08, and UNSIGNED — which is the owner's explicit call
 * for a personal fork, not an oversight, so it is written down here in the file that acts on it.
 *
 * WHAT SELF-UPDATE MEANS IN THIS FORK, exactly:
 *   * THE FEED AND THE INSTALLER COME OVER HTTPS from `github.com/Zeratfule/EQ-Zera`. The address
 *     is compiled in (`electron-builder.yml`'s `publish:` block, written into `app-update.yml` at
 *     package time); nothing in the settings store, the renderer or any file on disk can point it
 *     somewhere else. `.github/workflows/release.yml` puts the installer, its `.blockmap`,
 *     `latest.yml` and the `main.yml` bridge copy on every `v*` tag's release.
 *   * INTEGRITY IS SHA-512, and it is real: the feed carries the installer's digest, and
 *     electron-updater streams the download through a digest transform, aborting with
 *     `ERR_CHECKSUM_MISMATCH` on any mismatch — including for differential (block-map) downloads
 *     and for an already-staged file re-validated before it runs. A TAMPERED DOWNLOAD FAILS.
 *   * AUTHENTICODE VERIFICATION IS OFF, because there is no certificate yet.
 *     `win.signtoolOptions.publisherName` is commented out in `electron-builder.yml`, so no
 *     publisher name reaches `app-update.yml`, and `NsisUpdater.verifySignature` returns null
 *     immediately (`NsisUpdater.js:84-99`) — it SKIPS all checking rather than failing it. WHO
 *     built the release is therefore unverified: the GitHub account is the trust root, and anyone
 *     who could publish a release there could ship a silent, per-user, no-UAC update to every
 *     install. That is a weaker guarantee than the upstream app's signed updates, and it is
 *     stated to users in SECURITY.md rather than left to be discovered.
 *
 * THE DAY A CERTIFICATE EXISTS, ONE LINE COMES BACK. Restore `publisherName` under
 * `signtoolOptions` (matching the certificate's subject CN character for character) and turn
 * signing on; nothing in this file changes. SETUP.md, "Releasing", carries both halves.
 *
 * The constant stays, rather than the branch being deleted, because the DEV guard below shares it:
 * `npm run dev` is never packaged, so the machinery is skipped there either way.
 */
function autoUpdateDisabled(): boolean {
  return false
}
const AUTO_UPDATE_DISABLED = autoUpdateDisabled()

/**
 * Initialize the auto-updater. `getMainWindow` is called lazily on each status
 * push so we always target the current window (it can be recreated). The update
 * machinery is skipped (and logged) when the app isn't packaged; the IPC surface
 * stays registered so the renderer never has to special-case dev.
 *
 * `flushStore` IS THE LAST STORE WRITE, HANDED IN (JOS-272). The composition root owns the list of
 * things this process still owes the settings file (the tail mark, the window's geometry) and runs
 * it from `before-quit`; this module needs to run the SAME list one step earlier — see the install
 * handler. It arrives as a callback rather than an import because index.ts imports this file, and a
 * `updater → index` edge would close that circle around the composition root.
 */
export function initUpdater(
  getMainWindow: () => BrowserWindow | null,
  flushStore: () => void
): void {
  // PERSISTED "last checked" (Task #60): read before anything else so the very
  // first status the renderer pulls already carries a truthful age. An
  // in-memory-only stamp read "never" for the first minute of every launch —
  // and forever for a user who quits before the first check.
  lastCheckedAt = getUpdateLastCheckedAt()
  lastStatus = lastCheckedAt ? { state: 'idle', checkedAt: lastCheckedAt } : { state: 'idle' }

  // Registered in dev too: Preferences shows the version + a (benign) status there.
  ipcMain.handle(IPC.getAppVersion, () => app.getVersion())
  ipcMain.handle(IPC.getUpdateStatus, () => lastStatus)

  if (AUTO_UPDATE_DISABLED || !app.isPackaged) {
    // Say so in the status itself: without the flag the chip renders "not checked yet"
    // forever (dev never checks), which reads as a broken updater rather than an absent one.
    // No checkedAt — a stamp inherited from the store would claim a check this process
    // never made.
    lastStatus = { state: 'idle', disabled: true }
    ipcMain.handle(IPC.installUpdate, noInstallInDev)
    ipcMain.handle(IPC.checkForUpdates, () => lastStatus)
    // No toast action handler is registered on this path, so the `toast:action` channel is UNARMED
    // for the whole life of an unpackaged process: nothing here can build an update card, and a
    // message naming one is dropped by main/toast.ts with no handler to reach.
    logInfo('[eq-zera] Auto-update skipped (unpackaged build).')
    return
  }

  const currentVersion = app.getVersion()

  /** Record + broadcast a status. `checkedAt` rides along on every push once known. */
  const push = (status: UpdateStatus): void => {
    lastStatus = lastCheckedAt ? { ...status, checkedAt: lastCheckedAt } : status
    const win = getMainWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.onUpdateStatus, lastStatus)
  }

  /** A check finished (whatever the verdict) — stamp + PERSIST the time, then push. */
  const checkDone = (status: UpdateStatus): void => {
    lastCheckedAt = Date.now()
    checkInFlight = false
    try {
      setUpdateLastCheckedAt(lastCheckedAt)
    } catch {
      // A store write must never break the update flow; the in-memory stamp stands.
    }
    push(status)
  }

  // --- electron-updater configuration -------------------------------------
  //
  // WHY autoDownload IS OFF (it was on before Task #60): with autoDownload the
  // download starts inside checkForUpdates(), BEFORE our `update-available`
  // handler can veto it. We need that veto for two cases:
  //   (a) the anti-loop guard — a version whose download has already failed
  //       MAX_DOWNLOAD_ATTEMPTS times must stop being re-pulled every cycle;
  //   (b) the updated-away guard — never pull a build we already run.
  // AND SINCE 2026-09-08 IT IS ALSO THE FEATURE. The owner asked for a notification the user
  // CLICKS, so the veto is no longer a veto at all: nothing is pulled until `startDownload` runs,
  // and the only things that call it are the card's button and the Preferences button. A person on
  // a metered connection who never answers the card never spends a byte on an installer.
  // WHERE THE LIBRARY'S OWN DIAGNOSTICS GO (JOS-295). Set before anything else can make it talk:
  // until now electron-updater logged its whole life — including a full stack for every error
  // event — to its default logger, which is `console`, which in a packaged app is a stdout nobody
  // reads. Assigned HERE rather than above the dev guard because that guard is what keeps the
  // machinery off in dev: nothing runs to narrate.
  autoUpdater.logger = LIBRARY_LOGGER
  autoUpdater.autoDownload = false
  // THE load-bearing flag for "transparent": a staged update is applied when the
  // app quits, with no window, no prompt and no UAC (it spawns `--updated /S`).
  // Ignoring the chip forever still gets you updated.
  //
  // Caveat that shapes the flow below: the quit handler is registered from
  // executeDownload's `done` callback (BaseUpdater.js:28-37, :69-90), so it only
  // exists once a download RESOLVES IN THIS PROCESS. A build staged during a
  // previous session therefore needs this session's first check to re-resolve it
  // (which costs no network — it validates the cached file) before apply-on-quit
  // is armed. That is why we never persist a 'ready' state across restarts: the
  // startup check must be allowed to run and re-arm it. Also why a non-zero exit
  // code skips the install — a crash never installs anything.
  autoUpdater.autoInstallOnAppQuit = true
  // We ship an NSIS target, never the web installer. Left at its default (false)
  // electron-updater logs a deprecation nag on EVERY download
  // (NsisUpdater.js:44-46).
  autoUpdater.disableWebInstaller = true
  applyChannel(getUpdateChannel())

  // THE SINKS, BUILT ONCE. Both the event handlers and `runCheck`'s rejection path route through
  // the same three, which is what makes "one failure counts exactly once" checkable rather than
  // remembered. `schedule` is a `const` further down and is only ever REACHED from a timer, an IPC
  // call or an updater event — all of them after this function has finished running — so the arrow
  // closing over it can never observe the temporal dead zone.
  const sinks: StatusSinks = { push, checkDone, retryOnResume: () => schedule('resume') }
  registerUpdaterEvents(currentVersion, sinks)

  /**
   * ONE STEP FORWARD, WHATEVER PRESSED IT (EQ Zera, 2026-09-08).
   *
   * The toast card's two buttons and the Preferences panel's one button are the same two steps of
   * one flow, so they run the same two functions. `startDownload` is guarded on 'available' and
   * `applyStagedUpdate` on 'ready', which is what makes a press on a stale surface a no-op rather
   * than a wrong action: BaseUpdater latches `quitAndInstallCalled` on the first call and ignores
   * every later one, so we get exactly one install shot and must not spend it on a stale click.
   */
  const advanceUpdate = (): void => {
    if (lastStatus.state === 'available') {
      startDownload()
      return
    }
    if (lastStatus.state !== 'ready') return
    applyStagedUpdate(flushStore)
  }

  /**
   * ARM THE CARD (EQ Zera, 2026-09-08). `main/toast.ts` validated the name against the two-member
   * union before this ran; this is the only place that decides what either member DOES, and it is
   * a closed switch over that union rather than a lookup — the widest thing a click on an overlay
   * card can reach is these two calls.
   */
  const runToastAction = (action: ToastUpdateAction): void => {
    if (action === 'updateInstall') {
      if (lastStatus.state === 'ready') applyStagedUpdate(flushStore)
      return
    }
    startDownload()
  }
  setToastUpdateActionHandler(runToastAction)

  // renderer -> main: take the next step on the update. Historically install-only, and the channel
  // still carries that name (shared/ipc.ts); since the notification rework it also starts the
  // DOWNLOAD when one is merely available, so that a user with the celebration overlay switched
  // off still has a way to say yes. Both halves are the guarded functions above.
  ipcMain.handle(IPC.installUpdate, advanceUpdate)

  /**
   * Run one check. `manual` = the user pressed the button in Preferences: it
   * bypasses the "already ready" short-circuit's silence by returning the ready
   * status, and it RESETS the failure/attempt counters so an explicit retry
   * genuinely retries.
   */
  const runCheck = async (manual: boolean): Promise<UpdateStatus> => {
    if (manual) {
      consecutiveFailures = 0
      downloadAttempts.clear()
      // The user may have just allowed PowerShell and come back to press the button — an explicit
      // retry re-asks the environment rather than repeating this session's verdict about it.
      downloadBlocked = false
    }
    // A staged update is terminal — re-checking cannot improve on it, and the
    // cached download emits no fresh 'update-downloaded', so a check would only
    // reset the chip to "checking" and then to idle. Leave it be.
    if (lastStatus.state === 'ready') return lastStatus
    if (checkInFlight) return lastStatus
    // ONE logical check, up to two attempts (JOS-211). The loop is bounded by
    // `shouldRetryCheck`, which only ever says yes on the FIRST attempt.
    checkAttempts = 0
    for (;;) {
      retryPending = false
      checkInFlight = true
      try {
        await autoUpdater.checkForUpdates()
      } catch (err) {
        // checkForUpdates rejects AND emits 'error'. `checkDone` clears the flag,
        // so a still-set flag here means the event handler did NOT run and this
        // failure is uncounted — that way one failure counts exactly once.
        // `retryPending` is the same idea for the case where it DID run and
        // deliberately withheld the verdict. An ACCOUNTED failure was already routed by the
        // 'error' handler, from the same error, so routing here too would file it twice.
        const unaccounted = checkInFlight && !retryPending
        if (unaccounted) routeCheckRejection(err, sinks)
      }
      checkInFlight = false
      checkAttempts++
      if (!retryPending) break
    }
    retryPending = false
    return lastStatus
  }

  /** Self-rescheduling poll loop — a setInterval can't carry jitter or backoff. */
  const schedule = (phase: 'startup' | 'periodic' | 'resume'): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void runCheck(false).finally(() => schedule('periodic'))
    }, nextCheckDelayMs({ phase, consecutiveFailures }))
  }

  // renderer -> main: explicit "Check for updates".
  ipcMain.handle(IPC.checkForUpdates, async (): Promise<UpdateStatus> => {
    const res = await runCheck(true)
    // Re-anchor the background cadence off the manual check so we don't poll
    // again three seconds later.
    schedule('periodic')
    return res
  })

  schedule('startup')

  // THE OTHER HALF OF "RETRY ON RESUME" (JOS-307), and it is the half that covers the common case.
  //
  // The error handler above only learns about a suspend when a request happened to be IN FLIGHT as
  // the machine went down — which is a few seconds out of every four hours, so most sleeps produce
  // no error at all. What they DO produce is a frozen `setTimeout`: a machine that sleeps at the
  // 3h55m mark wakes with five minutes left on paper, but Windows does not credit the sleep, so the
  // remaining wait is the whole of what is left of a four-hour timer measured in a clock that
  // stopped. A laptop that is closed every night therefore checks far less often than the cadence
  // says it does, and the chip's "checked Nh ago" is the only place that shows it.
  //
  // Waking RE-ANCHORS the poll: ~20s (jittered) and then the ordinary cadence resumes from there.
  // It is one extra feed request per wake — three plain github.com GETs, on a machine whose user
  // has just sat down — against a poll that could otherwise sleep through a whole release.
  // Registered here rather than in the composition root because it belongs to the cadence, and it
  // is inside the packaged-only path for the same reason everything else here is.
  powerMonitor.on('resume', () => schedule('resume'))

  app.on('will-quit', () => {
    if (timer) clearTimeout(timer)
    timer = null
  })
}
