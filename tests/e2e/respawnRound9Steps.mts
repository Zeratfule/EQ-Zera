// respawnRound9Steps — THE EDIT MODAL, AND THE STATE IT LEAVES BEHIND (JOS-194, round 9).
//
// Its own module for the reason `respawnRound7Steps.mts` and `respawnRound8Steps.mts` are: the spec
// that uses it (`respawn-timers.e2e.mts`) is at the repo's 400-code-line factoring ceiling.
//
// IT REPLACES ROUND 7'S `stepCustomOnTheMob`, because the owner replaced what that step drove. The
// bare seconds box on the clock row is deleted; the duration and the rung it came from are one
// bordered unit with a small edit affordance attached, and pressing it opens a modal holding the
// evidence and the decision at once.
//
// WHAT ONLY THE REAL APP CAN SHOW. The parser, the formatter, the overridden state and the
// calculated fall-back are all pure and pinned in tests/respawnOverride.test.mts. What no unit test
// can claim is that any of it is WIRED:
//
//   * that the icon opens a modal carrying the hover card's own content, the gaps this fold measured
//     and the wiki's words — the same fold, through the same components, in the running app;
//   * that the field opens PREFILLED with the duration currently in force, so the safest thing a
//     player can do (open it, change nothing, save) is genuinely safe;
//   * that junk is refused OUT LOUD, with Save unavailable, rather than silently clearing the number
//     the way the retired box did;
//   * that saving shorthand travels the whole path — IPC, normalize, persist, module revision, delta
//     — and comes back as a row that says the number is yours;
//   * that the clear control puts the calculated number back;
//   * and that the OVERRIDDEN state reaches the second renderer while none of the EDITING does. That
//     last one is a pair of claims about one fold and can only be made with two windows open.
//
// EVERY STEP PUTS THE APP BACK. Both mobs leave these steps numbered exactly as the steps around
// them expect (`a wan ghoul knight` by your kills, `a frenzied ghoul` by the wiki), because the
// spec's later assertions read those rungs.
//
// WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (wave E3): every read goes through `settle`.

import type { Page } from 'playwright-core'
import { check, countOf, settle, settleStable } from './appHarness.mjs'

const DIALOG = '[data-testid="respawn-edit-dialog"]'
const INPUT = `${DIALOG} [data-testid="respawn-edit-input"] input`
const SAVE = `${DIALOG} [data-testid="respawn-edit-save"]`

function rowSel(mob: string): string {
  return `[data-testid="respawn-row"][data-respawn-mob="${mob}"]`
}

/** One clock row's reading, narrowed to what these steps assert. */
interface RowRead {
  mob: string
  source: string
  /** The duration unit's own text — the duration and the rung, which are one object now. */
  unit: string
  /** That unit's state: has the player overruled this number? */
  overridden: string
  text: string
}

function rows(page: Page, testid: string, unitTestid: string): Promise<RowRead[]> {
  return page.evaluate(
    ({ id, unitId }) =>
      [...document.querySelectorAll(`[data-testid="${id}"]`)].map((e) => {
        const unit = e.querySelector(`[data-testid="${unitId}"]`)
        return {
          mob: e.getAttribute('data-respawn-mob') ?? '',
          source: e.getAttribute('data-respawn-source') ?? '',
          unit: (unit as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '',
          overridden:
            unit?.getAttribute('data-respawn-overridden') ?? e.getAttribute('data-respawn-overridden') ?? '',
          text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
        }
      }),
    { id: testid, unitId: unitTestid }
  )
}

const tabRows = (page: Page): Promise<RowRead[]> => rows(page, 'respawn-row', 'respawn-duration')
const gameRows = (page: Page): Promise<RowRead[]> => rows(page, 'respawn-overlay-row', 'respawn-overlay-rung')
const find = (list: RowRead[], mob: string): RowRead | undefined => list.find((r) => r.mob === mob)

/** Everything the open modal is saying, as one string. */
function dialogText(page: Page): Promise<string> {
  return page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    DIALOG
  )
}

/** Open a row's modal, putting the pointer back afterwards — every row here is a hover anchor. */
async function openEditor(page: Page, mob: string): Promise<number> {
  await page.click(`${rowSel(mob)} [data-testid="respawn-edit"]`, { timeout: 15_000 })
  await page.mouse.move(0, 0)
  return settle(() => countOf(page, DIALOG), (n) => n === 1, { timeoutMs: 20_000 })
}

async function closeEditor(page: Page, via: 'cancel' | 'save' | 'clear'): Promise<number> {
  await page.click(`${DIALOG} [data-testid="respawn-edit-${via}"]`, { timeout: 15_000 })
  await page.mouse.move(0, 0)
  return settle(() => countOf(page, DIALOG), (n) => n === 0, { timeoutMs: 20_000 })
}

/**
 * THE DURATION IS ONE THING WITH ITS SOURCE, AND THE MODAL IS BEHIND IT (rulings 2, 3 and 4).
 *
 * Driven on the mob this spec numbered from its OWN kills, because that is the row with real
 * evidence to show: a measured gap, a rung that is not the wiki's, and a calculated number to fall
 * back to when the override is cleared.
 */
export async function stepEditTheNumber(
  page: Page,
  mob: string,
  readWatches: (p: Page) => Promise<{ watches: { key: string; customSec?: number }[] }>
): Promise<void> {
  const before = await settle(() => tabRows(page), (r) => find(r, mob) !== undefined, { timeoutMs: 30_000 })
  const row = find(before, mob)
  if (!check('the clock row is there to be edited', row !== undefined, JSON.stringify(before))) return

  // RULING 2: the duration and the rung that produced it are ONE object, not two ends of a line.
  check('the duration and its source are one unit', row.unit.includes('3m 00s') && row.unit.includes('your kills'), row.unit)
  check('…and it is not marked as overruled, because nobody has', row.overridden === 'false', JSON.stringify(row))
  // ROUND 7'S BOX IS GONE, not hidden. A build that kept it would still pass everything below.
  check('the bare seconds box is deleted', (await countOf(page, '[data-testid="respawn-custom"]')) === 0)
  check('…and no modal is standing open until one is asked for', (await countOf(page, DIALOG)) === 0)

  const opened = await openEditor(page, mob)
  if (!check('the edit icon on the duration opens the modal', opened === 1)) return

  // RULING 3: it carries what the decision needs. The card's own note (the round-5 provenance
  // sentence), every gap this fold measured, and the number clearing would go back to.
  const body = await dialogText(page)
  check('…carrying the hover card’s own account of the timer', body.includes('A gap is an upper bound'), body)
  check('…and the gaps themselves, not only the minimum they became', body.includes('gaps: 3m 00s'), body)
  check('…and what clearing would return to', body.includes('Calculated:'), body)

  // RULING 4: prefilled with the duration in force, written the way the field accepts it.
  const prefill = await page.inputValue(INPUT)
  check('the field opens on the duration already in force', prefill.startsWith('3m'), prefill)

  // JUNK IS REFUSED OUT LOUD. The retired box silently cleared the number on anything it could not
  // read, which is the behaviour this replaces.
  await page.fill(INPUT, 'banana')
  const refused = await settle(
    () => page.evaluate(() => document.querySelector('[data-testid="respawn-edit-error"]')?.textContent ?? ''),
    (t) => t.length > 0,
    { timeoutMs: 20_000 }
  )
  check('typing junk says so rather than silently clearing', refused.includes('Not a duration'), refused)
  const disabled = await page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLButtonElement | null)?.disabled ?? false,
    SAVE
  )
  check('…and there is nothing to save while it is unreadable', disabled, String(disabled))

  // THE SHORTHAND THE RULING ASKED FOR, saved down the real path.
  await page.fill(INPUT, '44m 30s')
  const closed = await closeEditor(page, 'save')
  check('saving closes the modal', closed === 0)
  const saved = await settle(() => tabRows(page), (r) => find(r, mob)?.source === 'custom', { timeoutMs: 30_000 })
  const after = find(saved, mob)
  if (!check('saving shorthand re-numbers the clock', after?.source === 'custom', JSON.stringify(saved))) return
  check('…for the duration the shorthand means', after.unit.includes('44m 30s'), after.unit)
  check('…saying the number is yours', after.unit.includes('your number'), after.unit)
  // RULING 5: the row is in a STATE, which is a thing a surface can paint rather than a word to read.
  check('…and the row is marked OVERRIDDEN', after.overridden === 'true', JSON.stringify(after))
  const prefs = await readWatches(page)
  check(
    '…and it was PERSISTED, through the same door the retired box used',
    prefs.watches.some((w) => w.key === mob && w.customSec === 2670),
    JSON.stringify(prefs)
  )

  // RULING 6: the way back, which exists only where there is something to go back from.
  await openEditor(page, mob)
  check('an overruled row offers the way back', (await countOf(page, `${DIALOG} [data-testid="respawn-edit-clear"]`)) === 1)
  await closeEditor(page, 'clear')
  const reverted = await settle(() => tabRows(page), (r) => find(r, mob)?.source === 'observed', { timeoutMs: 30_000 })
  const back = find(reverted, mob)
  check('clearing returns the row to the calculated value', back?.source === 'observed', JSON.stringify(reverted))
  check('…which is the gap this fold measured', back?.unit.includes('3m 00s') === true, JSON.stringify(back))
  check('…and it is no longer marked overruled', back?.overridden === 'false', JSON.stringify(back))

  // A ROW NOBODY OVERRULED HAS NOTHING TO CLEAR, so the control is absent rather than a no-op.
  await openEditor(page, mob)
  check(
    'a row nobody overruled offers no clear control at all',
    (await countOf(page, `${DIALOG} [data-testid="respawn-edit-clear"]`)) === 0
  )
  await closeEditor(page, 'cancel')
}

/**
 * THE STATE TRAVELS TO THE SECOND RENDERER; THE EDITING DOES NOT (ruling 5, and the round-7 law).
 *
 * Driven on the mob numbered from the WIKI, for two reasons: the committed floor holds a page title
 * for it (so the modal's link is real, offline, and needs no network), and overruling a wiki default
 * is the case the owner actually described.
 *
 * It puts the mob back on the wiki's number, which is what the unwatch step after it asserts.
 */
export async function stepOverriddenOverTheGame(page: Page, overlay: Page, mob: string): Promise<void> {
  const opened = await openEditor(page, mob)
  if (!check('the wiki-numbered row opens its modal too', opened === 1)) return

  // THE LINK, which is the half of provenance this feature was missing: the wiki's words were always
  // quoted and the page they came from was never reachable. The title is the committed floor's own.
  const href = await page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLAnchorElement | null)?.getAttribute('href') ?? '',
    `${DIALOG} [data-testid="respawn-edit-wiki-link"]`
  )
  check('the modal links to the wiki page it is quoting', href === 'https://eqlwiki.com/A_frenzied_ghoul', href)
  // …and it opens in the SYSTEM browser, never in an app window: `target="_blank"` is what main's
  // `setWindowOpenHandler` turns into `shell.openExternal` against the allowlist (security.ts).
  const target = await page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLAnchorElement | null)?.target ?? '',
    `${DIALOG} [data-testid="respawn-edit-wiki-link"]`
  )
  check('…and hands it to the OS rather than opening a window', target === '_blank', target)
  const quoted = await dialogText(page)
  check('…beside what that page actually said', quoted.includes('9.5 min'), quoted)

  await page.fill(INPUT, '12m')
  await closeEditor(page, 'save')
  const tab = await settle(() => tabRows(page), (r) => find(r, mob)?.source === 'custom', { timeoutMs: 30_000 })
  check('the tab marks the row overruled', find(tab, mob)?.overridden === 'true', JSON.stringify(tab))

  const game = await settle(() => gameRows(overlay), (r) => find(r, mob)?.source === 'custom', { timeoutMs: 30_000 })
  const over = find(game, mob)
  if (!check('…and so does the floating window, off the one fold', over !== undefined, JSON.stringify(game))) return
  check('the overridden state reaches the window over the game', over.overridden === 'true', JSON.stringify(over))
  check('…which states the number and whose it is', over.unit.includes('12m') && over.unit.includes('your number'), over.unit)
  // AND NONE OF THE EDITING FOLLOWED IT. The round-7 ruling that took the hover card off this window
  // applies one size up: there is no icon here and there is no modal here.
  const noIcon = await settleStable(() => countOf(overlay, '[data-testid="respawn-edit"]'))
  check('the floating window carries NO edit affordance', noIcon === 0, String(noIcon))
  check('…and no modal of its own', (await countOf(overlay, DIALOG)) === 0)

  // BACK TO THE WIKI'S NUMBER, which is what the steps after this one read.
  await openEditor(page, mob)
  await closeEditor(page, 'clear')
  const restored = await settle(() => tabRows(page), (r) => find(r, mob)?.source === 'wiki', { timeoutMs: 30_000 })
  check('clearing hands the row back to the wiki default', find(restored, mob)?.source === 'wiki', JSON.stringify(restored))
}
