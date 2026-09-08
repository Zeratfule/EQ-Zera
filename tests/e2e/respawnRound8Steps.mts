// respawnRound8Steps — THE DEFECT THE OWNER FOUND BY COMING BACK LATER (JOS-194, round 8).
//
// Its own module for the reason `respawnRound7Steps.mts` is: the spec that uses it
// (`respawn-timers.e2e.mts`) is at the repo's 400-code-line factoring ceiling, and this step needs
// no second renderer at all.
//
// WHAT IT IS FOR. The owner returned to the app HOURS after his kills, clicked Watch on a
// Recently-killed entry, watched the button flip to Unwatch — and nothing appeared under Running.
// The write, the store, the module revision and the delta were all fine (round 2's law held); the
// fold swept the row on the way out, because a clock based on an hours-old death is born past the
// 30-minute linger. A successful click with no visible effect.
//
// AND THIS IS THE ONE PLACE THAT CAN SHOW THE FIX, because the deaths have to be genuinely old.
// Every other step in the spec plays lines onto the LIVE tail, where a kill is seconds old by
// construction. This one uses the committed fixture's OWN kills — `e2e-leveling.log` ends on
// Aug 5 2026, so by the time any machine runs this they are days behind, folded from history at
// launch exactly as the owner's evening was. They are also in zones the character has since walked
// out of (the log's last line is a zone into Nagafen's Lair), so the all-zones view is where they
// live — which is the same switch the owner would have reached for.
//
// THE MOB IS ONE THE FIXTURE CAMPED, which makes it the stronger half of the ruling: the fold has
// nine real same-stay gaps for it, so the row is genuinely NUMBERED and its estimate elapsed days
// ago. That is the case that used to produce a growing "due 141h 12m ago" if anything showed it at
// all — and the case the sweep hit hardest, because a numbered row goes past the linger fastest.
//
// IT LEAVES NOTHING BEHIND: the mob is unwatched again and the scope is put back, so the steps that
// follow see the fresh install they expect.
//
// WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (wave E3): every read goes through `settle`.

import type { Page } from 'playwright-core'
import { check, settle } from './appHarness.mjs'

/** One row as the tab draws it, narrowed to what this step asserts. */
interface RowRead {
  mob: string
  source: string
  stale: string
  text: string
}

function rows(page: Page, testid: string): Promise<RowRead[]> {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="${id}"]`)].map((e) => ({
        mob: e.getAttribute('data-respawn-mob') ?? '',
        source: e.getAttribute('data-respawn-source') ?? '',
        stale: e.getAttribute('data-respawn-stale') ?? '',
        text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
      })),
    testid
  )
}

const find = (list: RowRead[], mob: string): RowRead | undefined => list.find((r) => r.mob === mob)

/**
 * A click that puts the pointer back afterwards. Every control on this page carries a hover card
 * since round 7, and a click leaves the mouse standing on it — the hover step later in the spec
 * asserts that nothing is drawn until a row is pointed at.
 */
async function clickAway(page: Page, selector: string): Promise<void> {
  await page.click(selector, { timeout: 15_000 })
  await page.mouse.move(0, 0)
}

export async function stepAncientKillIsWatchable(page: Page, mob: string): Promise<void> {
  // The fixture's kills are days old AND in zones the character has left, so this is the view they
  // are in. (The scope switch is put back at the end.)
  await clickAway(page, '[data-testid="respawn-scope-all"]')

  const offered = await settle(() => rows(page, 'respawn-candidate'), (r) => find(r, mob) !== undefined, {
    timeoutMs: 30_000
  })
  if (!check('a kill from days ago is still offered by the discovery panel', find(offered, mob) !== undefined, JSON.stringify(offered))) {
    return
  }
  check('…and is clocked by nothing until it is asked for', find(await rows(page, 'respawn-row'), mob) === undefined)

  await clickAway(page, `[data-testid="respawn-candidate"][data-respawn-mob="${mob}"] [data-testid="respawn-watch"]`)

  // THE DEFECT ITSELF. Before round 8 this settle timed out: the store had the watch, the module had
  // bumped its revision and pushed, and the delta carried no row for the mob whose button had just
  // flipped to Unwatch.
  const clocked = await settle(() => rows(page, 'respawn-row'), (r) => find(r, mob) !== undefined, {
    timeoutMs: 30_000
  })
  const row = find(clocked, mob)
  if (!check('watching a kill from days ago produces a VISIBLE row', row !== undefined, JSON.stringify(clocked))) return

  // …AND IT READS HONESTLY. The fixture camped this mob, so the fold learned real gaps from it and
  // the row IS numbered — by an estimate that elapsed days ago. "due 141h 12m ago" is a number that
  // grows forever about a mob this app knows nothing about, so the row says the fact instead.
  check('…marked as the state it is in, not as a running clock', row.stale === 'true', JSON.stringify(row))
  check('…saying its estimate is long gone', row.text.includes('due long ago'), row.text)
  check('…rather than reciting arithmetic about it', !/due \d/.test(row.text), row.text)
  // AND IT IS STILL A WHOLE ROW: the rung, the estimate and the working it measured are all there,
  // because nothing about the mob stopped being known — only the countdown stopped being useful.
  check(
    '…while keeping its rung and the gaps behind it',
    row.source === 'observed' && row.text.includes('your kills') && row.text.includes('gaps:'),
    JSON.stringify(row)
  )

  // AND IT LEAVES THE APP AS IT FOUND IT — the row's own Unwatch, which a stale row still carries
  // because it is still a mob the user asked for.
  await clickAway(page, `[data-testid="respawn-row"][data-respawn-mob="${mob}"] [data-testid="respawn-row-unwatch"]`)
  const gone = await settle(() => rows(page, 'respawn-row'), (r) => find(r, mob) === undefined, { timeoutMs: 30_000 })
  check('…and a long-gone row can still be unwatched from the row itself', find(gone, mob) === undefined, JSON.stringify(gone))
  await clickAway(page, '[data-testid="respawn-scope-zone"]')
}
