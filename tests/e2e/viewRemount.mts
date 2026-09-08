/**
 * viewRemount.mts — ASSERT AGAINST A VIEW THAT IS HOLDING STILL, and never against one a
 * character rebuild threw away mid-step.
 *
 * THE FACT THIS EXISTS FOR. `App` keys every feature view on `viewKey`
 * (`<character.logPath>#<rebuild>`), and main bumps that counter through
 * `pipeline.ts sendWorldRebuilt` every time it finishes rebuilding a character's world — at
 * startup, on a character switch, and at a live epoch boundary. React then DISCARDS the view's
 * whole subtree and builds a new one, which is exactly the intended behaviour: a view that
 * re-hydrates from fresh snapshots must not keep state derived from the old ones.
 *
 * WHY IT IS A HARNESS PROBLEM. Component state does not survive that — an expanded accordion, a
 * "defeated only" switch, a scrolled position — so a spec that opens something and then reads it
 * back is asking two questions at once: "did the interaction under test keep it?" and "did a
 * rebuild land in between?". The specs that launch against the machine's OWN growing log rather
 * than a staged fixture see the second one land regularly, and they see it MOST in the first
 * seconds of a launch, which is where their first steps run. `sky-filters.e2e` collected six
 * ledgered sightings of exactly this (AGENTS.md) before JOS-279 gave it this vocabulary;
 * `bosses-week.e2e` argues the same fact in its own header, and `planner.e2e` retries a click for
 * it by hand.
 *
 * HOW IT IS MADE VISIBLE. A remount is invisible in every reading a spec normally takes: the rows
 * come straight back, and anything stored is in localStorage or the store. So the DOM is asked
 * directly — plant an attribute React does not manage on a node INSIDE the keyed subtree. An
 * ordinary re-render (a click, a delta, a keystroke) reconciles that node in place and leaves the
 * attribute alone; a remount throws the node away and the mark with it.
 *
 * ORDER OF USE, which is the whole discipline: quiesce, mark, DO THE WORK AND TAKE EVERY READING,
 * verify the mark, and only then `check`. A `check` that has already run cannot be taken back, so
 * an attempt must not assert anything until it knows it was asking about one mount.
 */

import type { Page } from 'playwright-core'
import { check, note, settleStable } from './appHarness.mjs'

/** An attribute React does not own, so nothing but a remount can take it off the node. */
const MOUNT_MARK = 'data-e2e-mount'

/** How many attempts a step gets before three lost mounts become a failure. */
const ATTEMPTS = 3

/**
 * The mount guard for ONE page and ONE anchor selector.
 *
 * The anchor must be a node inside the keyed view that is mounted for the whole step — a tab
 * strip, a toolbar, a header. Not a row: a list legitimately unmounts rows while the view around
 * them stands, and a guard that read a row would call that a rebuild.
 */
export interface MountGuard {
  /** Plant the mark. Safe to call again; a fresh mount simply gets a fresh mark. */
  mark(): Promise<void>
  /** Is this still the mount the mark was planted on? */
  intact(): Promise<boolean>
  /** Wait until the view stops remounting; returns how many rebuilds went by while waiting. */
  settled(opts?: { timeoutMs?: number; stable?: number }): Promise<number>
  /** Quiesce, mark, run `attempt`, and retry it while it reports a lost mount. */
  run(what: string, attempt: () => Promise<boolean>): Promise<void>
}

export function mountGuard(page: Page, anchor: string): MountGuard {
  const mark = async (): Promise<void> => {
    await page.evaluate(
      (a) => {
        document.querySelector(a.sel)?.setAttribute(a.attr, '1')
      },
      { sel: anchor, attr: MOUNT_MARK }
    )
  }

  const intact = (): Promise<boolean> =>
    page.evaluate((a) => document.querySelector(`${a.sel}[${a.attr}]`) !== null, {
      sel: anchor,
      attr: MOUNT_MARK
    })

  /**
   * WAIT FOR THE CONDITION, NEVER FOR THE CLOCK (wave E3), applied to a remount.
   *
   * The reading is a GENERATION COUNTER: every poll that finds the mark gone re-plants it and
   * counts one rebuild, so `settleStable` — "poll until the reading stops changing" — is exactly
   * "no rebuild has landed for `stable` consecutive polls". A quiet view returns in three polls; a
   * view still being rebuilt keeps bumping the number until it settles or the deadline passes.
   */
  const settled = async (opts: { timeoutMs?: number; stable?: number } = {}): Promise<number> => {
    let generation = 0
    return settleStable(
      async () => {
        if (!(await intact())) {
          generation += 1
          await mark()
        }
        return generation
      },
      { timeoutMs: opts.timeoutMs ?? 30_000, stable: opts.stable ?? 8 }
    )
  }

  /**
   * `attempt` returns TRUE when it ran to the end on one mount (whatever its checks decided) and
   * FALSE when it found the mark gone and therefore asserted nothing. A false attempt is
   * DISCARDED — not a failure, because a character rebuild is not the subject — and the run says
   * so out loud before trying again from a freshly quiesced view.
   *
   * THREE ATTEMPTS, AND THE THIRD LOSS IS A FAILURE. A retry loop with no floor is how a real
   * regression turns into a slow green run, so a view that cannot be caught still is reported as
   * exactly that rather than shrugged at — which is also this repo's rule that "green on re-run"
   * is a report line and never a resolution.
   */
  const run = async (what: string, attempt: () => Promise<boolean>): Promise<void> => {
    for (let i = 1; i <= ATTEMPTS; i++) {
      const rebuilds = await settled()
      await mark()
      if (await attempt()) return
      note(
        `${what}: a character rebuild remounted the view mid-step — attempt ${String(i)} discarded (${String(rebuilds)} rebuilds seen while settling)`
      )
    }
    check(`${what}: the view held still long enough to be asked`, false, `${String(ATTEMPTS)} attempts, ${String(ATTEMPTS)} rebuilds`)
  }

  return { mark, intact, settled, run }
}
