// ============================================================================
// updaterToasts.test.mts — SELF-UPDATE IS ON, AND THE CARD IS THE NOTIFICATION (EQ Zera, 2026-09-08).
// ============================================================================
//
// THE OWNER'S DIRECTION, which this suite exists to keep true: "We also need a way to push updates
// to people's apps so they can see when there's an available update, click on the notification when
// there is one, and it will just automatically download and update from there."
//
// TWO HALVES, AND THEY FAIL IN DIFFERENT WAYS.
//
//   1. THE SWITCHES. `AUTO_UPDATE_DISABLED` and `win.signtoolOptions.publisherName` are one
//      decision spelled in two files, and getting them out of step does not produce a warning —
//      it produces an updater that downloads a build and then refuses it every time, forever
//      (NsisUpdater.verifySignature rejects any update whose Authenticode publisher does not match
//      the name in app-update.yml, and SKIPS all checking when that name is null). The fork ships
//      unsigned on purpose, so the pair that must hold is: updater ON, publisher name ABSENT. Both
//      are read out of the source text, because the constant lives in a module that imports
//      Electron and the name lives in YAML.
//
//   2. THE CARDS. `shared/updateToast.ts` is pure precisely so the four payloads can be pinned
//      here: what each one SAYS, which of them carry an action and which do not, and the id rule
//      that makes available → downloading → downloaded ONE card that changes under the user rather
//      than three stacking over a download they already answered. A "Restart to install" button
//      carrying `updateDownload` is the kind of bug nobody sees until an actual release day.
//
// Pure — no Electron, no fixtures, never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOAST_KINDS, TOAST_MAX_DURATION_MS, TOAST_UPDATE_ACTIONS, isToastUpdateAction } from '../src/shared/toast'
import {
  UPDATE_TOAST_FAILED_ID,
  UPDATE_TOAST_MS,
  updateActionLabel,
  updateAvailableToast,
  updateDownloadedToast,
  updateDownloadingToast,
  updateFailedToast,
  updateToastId
} from '../src/shared/updateToast'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')

// ---- 1. the two switches ---------------------------------------------------------------

test('self-update is ON: the fork switch returns false', () => {
  const src = read('src/main/updater.ts')
  assert.match(
    src,
    /function autoUpdateDisabled\(\): boolean \{\s*return false\s*\}/,
    'AUTO_UPDATE_DISABLED must be false — the updater ships enabled (owner, 2026-09-08)'
  )
})

test('…and the Authenticode publisher name is ABSENT, which is what makes that safe to ship', () => {
  const yml = read('electron-builder.yml')
  // An ACTIVE key is one at the start of a line (any indent) with no `#` before it. The commented
  // restore line below is deliberately left in the file and must not count.
  const active = yml.split(/\r?\n/).filter((l) => /^\s*publisherName:/.test(l))
  assert.deepEqual(
    active,
    [],
    'publisherName must stay commented out while releases are unsigned: with it set, every update ' +
      'is downloaded and then rejected (ERR_UPDATER_INVALID_SIGNATURE)'
  )
  // …and the way back is written down rather than remembered.
  assert.match(yml, /#\s*publisherName: EQ Zera/, 'the restore line must stay, commented, in place')
})

test('the feed is compiled in, and it is this fork’s repository over HTTPS', () => {
  const yml = read('electron-builder.yml')
  assert.match(yml, /publish:\s*\n\s*provider: github\s*\n\s*owner: Zeratfule\s*\n\s*repo: EQ-Zera/)
})

test('the download is never automatic: autoDownload stays off, and the install stays silent', () => {
  const src = read('src/main/updater.ts')
  // The CLICK downloads (owner's direction). autoDownload would start the pull inside
  // checkForUpdates(), before anybody had been asked.
  assert.match(src, /autoUpdater\.autoDownload = false/)
  // Research §1: a bare quitAndInstall() shows a full NSIS installer window. Ours never does.
  assert.match(src, /autoUpdater\.quitAndInstall\(true, true\)/)
})

// ---- 2. the four cards -----------------------------------------------------------------

test('the available card offers the DOWNLOAD, in the words the button prints', () => {
  const card = updateAvailableToast('1.4.0')
  assert.equal(card.kind, 'update')
  assert.equal(card.id, 'update:1.4.0')
  assert.equal(card.title, 'EQ Zera 1.4.0 is ready')
  assert.equal(card.subtitle, 'Click to download and install')
  assert.equal(card.action, 'updateDownload')
  assert.equal(updateActionLabel('updateDownload'), 'Download and install')
})

test('the downloaded card offers the INSTALL, and never the download again', () => {
  const card = updateDownloadedToast('1.4.0')
  assert.equal(card.title, 'EQ Zera 1.4.0 downloaded')
  assert.equal(card.subtitle, 'Click to restart and install')
  assert.equal(card.action, 'updateInstall')
  assert.equal(updateActionLabel('updateInstall'), 'Restart to install')
})

test('the progress card carries NO action — the click has already been made', () => {
  const card = updateDownloadingToast('1.4.0', 41.6)
  assert.equal(card.subtitle, 'Downloading… 42%')
  assert.equal(card.action, undefined)
})

test('a percentage is clamped and rounded, whatever the library reports', () => {
  assert.equal(updateDownloadingToast('1.4.0', -5).subtitle, 'Downloading… 0%')
  assert.equal(updateDownloadingToast('1.4.0', 1000).subtitle, 'Downloading… 100%')
  assert.equal(updateDownloadingToast('1.4.0', Number.NaN).subtitle, 'Downloading… 0%')
})

test('ONE ID FOR ONE UPDATE: the three states refresh the same card instead of stacking', () => {
  // The queue refreshes a card in place on a repeated id (overlay/cardQueue.ts). Without this the
  // strip would grow twenty cards over a single download, which is the "installer in your face over
  // and over" the whole updater is shaped to avoid.
  const id = updateToastId('1.4.0')
  assert.equal(updateAvailableToast('1.4.0').id, id)
  assert.equal(updateDownloadingToast('1.4.0', 10).id, id)
  assert.equal(updateDownloadedToast('1.4.0').id, id)
})

test('a version the feed did not name still gets an honest card, never a blank one', () => {
  const card = updateAvailableToast(undefined)
  assert.equal(card.id, 'update:pending')
  assert.equal(card.title, 'The EQ Zera update is ready')
  assert.equal(updateAvailableToast('   ').title, 'The EQ Zera update is ready')
})

test('the failure card says what failed, offers nothing, and is its OWN card', () => {
  const card = updateFailedToast('GitHub is unreachable right now.')
  assert.equal(card.id, UPDATE_TOAST_FAILED_ID)
  assert.notEqual(card.id, updateToastId(undefined), 'a failure is not a later state of the offer')
  assert.equal(card.title, 'Update failed')
  assert.equal(card.subtitle, 'GitHub is unreachable right now.')
  assert.equal(card.action, undefined, 'a button that re-runs a failing download fails twice')
  // A failure with no sentence still says something rather than drawing an empty line.
  assert.match(updateFailedToast(undefined).subtitle ?? '', /could not be downloaded/)
})

test('every card holds for the MAXIMUM a card may ever hold, and no longer', () => {
  assert.equal(UPDATE_TOAST_MS, TOAST_MAX_DURATION_MS)
  for (const card of [
    updateAvailableToast('1.4.0'),
    updateDownloadingToast('1.4.0', 50),
    updateDownloadedToast('1.4.0'),
    updateFailedToast('nope')
  ]) {
    assert.equal(card.durationMs, TOAST_MAX_DURATION_MS)
  }
})

// ---- 3. the action union is closed, and the kind never crosses the wire ------------------

test('the action union has exactly two members, and nothing else is honoured', () => {
  assert.deepEqual(TOAST_UPDATE_ACTIONS, ['updateDownload', 'updateInstall'])
  assert.equal(isToastUpdateAction('updateDownload'), true)
  assert.equal(isToastUpdateAction('updateInstall'), true)
  for (const bogus of ['quitAndInstall', 'update', '', null, 42, {}, ['updateInstall']]) {
    assert.equal(isToastUpdateAction(bogus), false, `${JSON.stringify(bogus)} must not be honoured`)
  }
})

test('`update` is a kind the CHANNEL does not accept — main builds these cards, renderers do not', () => {
  assert.equal(TOAST_KINDS.includes('update'), false)
})

test('the update card is pushed by MAIN, straight at the window, with no request behind it', () => {
  const src = read('src/main/updater.ts')
  // The four call sites, one per event. Read from the source because the module cannot be imported
  // without Electron — and because "the wiring exists" is exactly what a pure card test cannot say.
  assert.match(src, /sendToToastOverlay\(updateAvailableToast\(/)
  assert.match(src, /sendToToastOverlay\(updateDownloadingToast\(/)
  assert.match(src, /sendToToastOverlay\(updateDownloadedToast\(/)
  assert.match(src, /sendToToastOverlay\(updateFailedToast\(/)
  // …and the handler that turns a press back into one of the two calls.
  assert.match(src, /setToastUpdateActionHandler\(/)
})
