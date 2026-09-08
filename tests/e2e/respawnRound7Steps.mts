// respawnRound7Steps — THE TAB-ONLY RULING OF JOS-194 ROUND 7 THAT IS STILL ROUND 7'S.
//
// Its own module for the reason `buffRestartSteps.mts` and `buffTimerSteps.mts` are: the spec that
// uses it (`respawn-timers.e2e.mts`) is at the repo's 400-code-line factoring ceiling, and this step
// is a narrative of its own — it needs no second renderer at all.
//
// WHAT IT IS FOR. The owner asked for Recently killed to become searchable. The pure half is pinned
// in tests/respawnWorking.test.mts; what only the real app can show is that TYPING IN THE SEARCH
// narrows the list the module published, and that a query matching nothing says so rather than
// reading as an empty log.
//
// ITS SIBLING IS GONE. This file also held `stepCustomOnTheMob`, which drove the bare seconds box
// round 7 put on the clock row. Round 9 SUPERSEDED that box with an edit icon and a modal, so the
// step went with it — to `respawnRound9Steps.mts`, where the same claim (rung 1 travels the whole
// path and comes back saying the number is yours) is made about the control that exists now. The
// absence of the box is still asserted, there and in the spec's fresh-install step: a deletion this
// round depends on is not proven by the new step passing.
//
// WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (wave E3): every read goes through `settle`.

import type { Page } from 'playwright-core'
import { check, countOf, settle } from './appHarness.mjs'

/** One candidate as the tab draws it — narrowed to what this step asserts. */
interface RowRead {
  mob: string
  source: string
  text: string
}

function rows(page: Page, testid: string): Promise<RowRead[]> {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll(`[data-testid="${id}"]`)].map((e) => ({
        mob: e.getAttribute('data-respawn-mob') ?? '',
        source: e.getAttribute('data-respawn-source') ?? '',
        text: (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()
      })),
    testid
  )
}

const find = (list: RowRead[], mob: string): RowRead | undefined => list.find((r) => r.mob === mob)

/** Type into the Recently-killed search. `fill` sets the value without moving the pointer. */
function search(page: Page, text: string): Promise<void> {
  return page.fill('[data-testid="respawn-search"] input', text, { timeout: 15_000 })
}

/**
 * RECENTLY KILLED IS SEARCHABLE (ruling 4).
 *
 * It leaves the box EMPTY, because the steps after it click Watch on candidates this one can hide.
 */
export async function stepSearchRecentlyKilled(page: Page, keep: string, drop: string): Promise<void> {
  const all = await settle(() => countOf(page, '[data-testid="respawn-candidate"]'), (n) => n >= 2, {
    timeoutMs: 20_000
  })

  await search(page, 'wan ghoul')
  const narrowed = await settle(() => rows(page, 'respawn-candidate'), (r) => r.length < all, { timeoutMs: 20_000 })
  check('typing narrows Recently killed', narrowed.length < all, JSON.stringify({ all, narrowed }))
  check('…to the mob that was typed', find(narrowed, keep) !== undefined, JSON.stringify(narrowed))
  check('…and the one that was not is gone', find(narrowed, drop) === undefined, JSON.stringify(narrowed))

  await search(page, 'zzzznothing')
  const empty = await settle(
    () => page.evaluate(() => document.querySelector('[data-testid="respawn-recent-empty"]')?.textContent ?? ''),
    (t) => t.length > 0,
    { timeoutMs: 20_000 }
  )
  check('a query that matches nothing says so, rather than reading as an empty log', empty.includes('No kills match'), empty)

  await search(page, '')
  const restored = await settle(() => countOf(page, '[data-testid="respawn-candidate"]'), (n) => n === all, {
    timeoutMs: 20_000
  })
  check('clearing the box brings every candidate back', restored === all)
}
