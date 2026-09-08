/**
 * The Gear tab's EFFECTIVE HP column (JOS-336) — the derived key, on the real corpus, through the
 * real render. A module rather than more of `gear.e2e.mts`, the `gearColumnSteps.mts` /
 * `gearFilterSteps.mts` precedent: everything this step needs is already standing in the host spec,
 * and that file sits at the repo's 400-code-line factoring ceiling.
 *
 * WHAT NEEDS A REAL APP HERE, given `tests/gearFilter.test.mts` owns the arithmetic without a DOM:
 *
 *   * THAT IT IS PICKABLE AT ALL. `EFF_HP` is not a field of `GearStats`, so every layer between
 *     the picker and the cell has to agree that a key with no vector entry is still a column: the
 *     picker's option list, the stored-choice sanitizer, the header that carries the sort control,
 *     and `GearTable`'s one `statText(sortValue(row, key), key)` cell path. A unit test can prove
 *     each of those in isolation; only the app proves they meet.
 *   * THAT THE SUM ON SCREEN IS THE SUM OF THE CELLS BESIDE IT. The step draws HP, STA and EFF HP
 *     together and asserts the identity ROW BY ROW over whatever the corpus put on screen — which
 *     is a far wider net than three hand-written fixtures, and it is stated as an IDENTITY rather
 *     than as numbers, because the corpus grows (AGENTS.md, "frozen numbers rot").
 *   * THAT THE SLIDER MOVES IT AND THE TABLE RE-RANKS. This is the claim the ticket is for. The
 *     derived value is computed off the SCALED vector, so moving the global plus-state must restate
 *     every cell AND re-order the rows on the restated numbers. The falsifiable half is the second
 *     one: if the ranking were still the base ranking, the column of scaled numbers would stop
 *     reading monotonically down the screen. Nothing but a live table can be asked that.
 *
 * PRECONDITIONS, and the state it hands back. It runs on an UNNARROWED corpus with the global
 * selector at base — in the host spec that is the seam right after the weapon-type step, which
 * clears both of its pickers and empties the search box. It returns the selector to base, the
 * columns to the derivation and the search box empty; the only thing it leaves moved is the SORT,
 * which the host spec's next steps set for themselves.
 */
import type { Page } from 'playwright-core'
import { check, countOf, note, settle } from './appHarness.mjs'
import { cellText, pickColumns, resetColumns } from './gearColumnSteps.mjs'

const ROW = '[data-testid="gear-row"]'
const COUNT = '[data-testid="gear-count"]'
const SEARCH = '[data-testid="gear-search"] input'
const SORT_EFF_HP = '[data-testid="gear-sort-EFF_HP"]'
const TIER_SLIDER = '[data-testid="gear-tier-slider"] input[type="range"]'
const FRACTION_SLIDER = '[data-testid="gear-fraction-slider"] input[type="range"]'

/**
 * WHAT THE PICKER IS ASKED FOR, and why HP is not in the list. The derived seed is the core four
 * (AC, HP, MP, Ratio) and `toggleColumn` TOGGLES — so naming HP here would take the column away and
 * leave the identity check reading a blank cell beside a sum that includes it. `STA` is not core,
 * `EFF_HP` is the subject, and HP is already on the table. Measured the same way JOS-297's own
 * upgrade step measured it, and stated for the same reason.
 */
const PICK: readonly string[] = ['STA', 'EFF_HP']

/** The fixture row that states NEITHER half — a weapon with WIS, DMG, DELAY and no hitpoints. */
const THELVORN_KEY = 'thelvorn, blade of light'

const until = (fn: () => Promise<boolean>, ms: number): Promise<boolean> => settle(fn, (ok) => ok, { timeoutMs: ms })

const textOf = (page: Page, sel: string): Promise<string> =>
  page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel)

async function shownCount(page: Page): Promise<number> {
  const text = await textOf(page, COUNT)
  return Number((/[\d,]+/.exec(text)?.[0] ?? '0').replace(/,/g, ''))
}

/** Type into the search box and let the DEFERRED filter land — the count settling IS the condition. */
async function typeAndSettle(page: Page, value: string): Promise<number> {
  await page.fill(SEARCH, value, { timeout: 15_000 })
  let last = -1
  await settle(
    async () => {
      const shown = await shownCount(page)
      const stable = shown === last
      last = shown
      return stable
    },
    (ok) => ok,
    { timeoutMs: 15_000 }
  )
  return last
}

/** One mounted row's three cells, as the screen states them (`''` is "states none", by design). */
interface Reading {
  key: string
  hp: string
  sta: string
  eff: string
}

/**
 * Every mounted row, in the order the table has them — the windowed screenful IS the ranking.
 *
 * THE THREE CELL READS ARE SPELLED OUT RATHER THAN FACTORED INTO A HELPER, and that is not a style
 * slip: a NAMED function declared inside a `page.evaluate` callback makes esbuild emit its
 * `keepNames` shim, and the browser has no `__name` to call — the whole step dies with a
 * `ReferenceError` from inside the page. Measured here, the first time this step ran.
 */
function readRows(page: Page): Promise<Reading[]> {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((row) => ({
        key: row.getAttribute('data-item-key') ?? '',
        hp: (row.querySelector('[data-testid="gear-cell-HP"]') as HTMLElement | null)?.innerText.trim() ?? '',
        sta: (row.querySelector('[data-testid="gear-cell-STA"]') as HTMLElement | null)?.innerText.trim() ?? '',
        eff: (row.querySelector('[data-testid="gear-cell-EFF_HP"]') as HTMLElement | null)?.innerText.trim() ?? ''
      })),
    ROW
  )
}

/** Is this column of readings ranked highest-first, with every "states none" row after every number? */
function monotoneDesc(rows: readonly Reading[]): { ranked: boolean; absentLast: boolean } {
  const values = rows.map((r) => r.eff)
  const numbers = values.filter((t) => t !== '').map(Number)
  const firstBlank = values.indexOf('')
  return {
    ranked: numbers.every((n, i) => i === 0 || (numbers[i - 1] ?? 0) >= n),
    absentLast: firstBlank === -1 || values.slice(firstBlank).every((t) => t === '')
  }
}

/**
 * THE DERIVATION, ROW BY ROW: `EFF HP` is HP plus STA, a stated one counts and a silent one is not a
 * zero. Returns the rows that disagree plus a census of which arm each row exercised, so the check
 * below can refuse to pass vacuously on a screenful that happened to state nothing.
 */
function auditSum(rows: readonly Reading[]): { bad: Reading[]; both: number; one: number; neither: number } {
  const bad: Reading[] = []
  let both = 0
  let one = 0
  let neither = 0
  for (const r of rows) {
    const hasHp = r.hp !== ''
    const hasSta = r.sta !== ''
    if (!hasHp && !hasSta) {
      neither++
      if (r.eff !== '') bad.push(r)
      continue
    }
    if (hasHp && hasSta) both++
    else one++
    if (Number(r.eff) !== (hasHp ? Number(r.hp) : 0) + (hasSta ? Number(r.sta) : 0)) bad.push(r)
  }
  return { bad, both, one, neither }
}

/**
 * THE THREE WAYS A READING IS TURNED INTO WORDS. Small on purpose: every `?.` and `??` counts
 * against `complexity 12`, and a step whose whole job is three assertions should not spend its
 * budget on message formatting.
 */
const topEff = (rows: readonly Reading[]): string => rows[0]?.eff ?? '(none)'
const firstFew = (rows: readonly Reading[]): string => rows.slice(0, 6).map((r) => r.eff).join(' ')
function describeAudit(audit: ReturnType<typeof auditSum>, where: string): string {
  const worst = audit.bad[0]
  if (worst === undefined) return `${String(audit.both)} rows state both halves ${where}, ${String(audit.one)} state one`
  return `${String(audit.bad.length)} disagree, first: ${worst.key} ${worst.hp}+${worst.sta}=${worst.eff}`
}

/** Focus a slider and drive it with the keyboard — the same path the control gives a user. */
async function driveSlider(page: Page, sel: string, keys: readonly string[]): Promise<void> {
  await page.focus(sel, { timeout: 15_000 })
  for (const key of keys) await page.press(sel, key, { timeout: 15_000 })
}

// =================================================================================

/** 1. THE KEY IS PICKABLE, AND PICKING IT PUTS A SORTABLE HEADER ON THE TABLE. */
async function stepPickable(page: Page): Promise<boolean> {
  await typeAndSettle(page, '')
  await pickColumns(page, PICK)
  const drawn = await until(async () => (await countOf(page, SORT_EFF_HP)) === 1, 15_000)
  if (!check('EFFECTIVE HP is in the columns picker, and picking it draws a SORTABLE header', drawn)) return false

  const label = (await textOf(page, SORT_EFF_HP)).replace(/\s+/g, ' ').trim()
  check(
    '…under a label short enough for the 8% column ceiling - the underscore rule`s own spelling',
    label.includes('EFF HP'),
    `the header reads "${label}"`
  )
  return true
}

/**
 * 2. IT SORTS, AND WHAT IT SORTS BY IS THE SUM OF THE TWO CELLS BESIDE IT.
 *
 * Returns the ranking as the screen has it, for the slider step to compare against.
 */
async function stepSortAndSum(page: Page): Promise<Reading[]> {
  await page.click(SORT_EFF_HP, { timeout: 15_000 })
  const ready = await until(async () => (await readRows(page)).filter((r) => r.eff !== '').length > 1, 15_000)
  if (!check('sorting by effective HP leaves rows on screen with sums to compare', ready)) return []

  const rows = await readRows(page)
  const { ranked, absentLast } = monotoneDesc(rows)
  check('an effective-HP sort ranks the visible rows highest first', ranked, firstFew(rows))
  check(
    '…and a row stating neither HP nor STA never outranks one that states either - absent is not zero',
    absentLast,
    rows.map((r) => (r.eff === '' ? '_' : r.eff)).slice(0, 10).join(' ')
  )

  const audit = auditSum(rows)
  check(
    'every row on screen states HP + STA - a stated value counts, a silent one adds nothing',
    audit.bad.length === 0 && audit.both > 0,
    describeAudit(audit, 'at base')
  )
  return rows
}

/** 3. BLANK WHEN THE ITEM STATES NEITHER — asserted on the one row this whole suite is pinned to. */
async function stepBlank(page: Page): Promise<void> {
  await typeAndSettle(page, 'thelvorn')
  const eff = await cellText(page, THELVORN_KEY, 'EFF_HP')
  const hp = await cellText(page, THELVORN_KEY, 'HP')
  const sta = await cellText(page, THELVORN_KEY, 'STA')
  check(
    'an item stating neither HP nor STA has a BLANK effective HP - never a 0 the wiki never printed',
    eff === '' && hp === '' && sta === '',
    `HP "${hp}" STA "${sta}" EFF HP "${eff}"`
  )
  await typeAndSettle(page, '')
}

/**
 * 4. THE SLIDER MOVES IT, AND THE TABLE RE-RANKS ON THE MOVED NUMBERS.
 *
 * Two halves, and the second is the one no unit test can reach. Every cell must be RESTATED at the
 * new plus-state (the sum of the two scaled halves, which the identity re-check proves), and the
 * rows must be re-ordered on those new numbers — which is exactly what a column of scaled values
 * still reading monotonically down the screen means. A table that had kept its base ranking would
 * show the restated numbers out of order the moment any pair of items swapped, and `scalePrimary`
 * makes pairs swap: a stat at or below 10 gains a flat `+full` per stated line while a larger one
 * gains a proportion, so two modest lines can overtake one bigger one.
 */
async function stepSlider(page: Page, before: readonly Reading[]): Promise<void> {
  await driveSlider(page, TIER_SLIDER, ['Home', 'ArrowRight', 'ArrowRight'])
  if (await until(async () => (await countOf(page, FRACTION_SLIDER)) > 0, 10_000)) {
    await driveSlider(page, FRACTION_SLIDER, ['End'])
  }

  const topWas = topEff(before)
  const moved = await until(async () => {
    const now = await readRows(page)
    return now.length > 0 && topEff(now) !== topWas
  }, 15_000)
  const after = await readRows(page)
  check(
    'moving the global plus-state RESTATES the effective HP column',
    moved,
    `top row read ${topWas} at base and ${topEff(after)} at tier 2 + 3/4`
  )

  const { ranked, absentLast } = monotoneDesc(after)
  check(
    'THE TABLE RE-RANKS ON THE NEW NUMBERS - the restated column still reads highest-first, top to bottom',
    ranked && absentLast,
    firstFew(after)
  )

  const audit = auditSum(after)
  check(
    '…and the sum is still of the two cells beside it, now scaled - the sum of the halves, not a scaled sum',
    audit.bad.length === 0 && audit.both > 0,
    describeAudit(audit, 'at the checkpoint')
  )

  // WHETHER ANY PAIR ACTUALLY SWAPPED is a fact about today's corpus, so it is REPORTED rather than
  // asserted (AGENTS.md, "frozen numbers rot"). The assertion above is the anchor-independent form
  // of the same claim: whatever the corpus holds, the order on screen matches the numbers on screen.
  const wasOrder = before.map((r) => r.key).join('|')
  const nowOrder = after.map((r) => r.key).join('|')
  note(
    wasOrder === nowOrder
      ? 'the slider restated every effective HP without any visible pair changing places'
      : 'the slider restated every effective HP and the visible ranking changed places'
  )
}

/**
 * THE WHOLE JOS-336 PASS. Run on an unnarrowed corpus with the selector at base; hands the tab back
 * with the selector at base, the columns derived and the search box empty.
 */
export async function stepGearEffectiveHp(page: Page): Promise<void> {
  if (!(await stepPickable(page))) return
  const atBase = await stepSortAndSum(page)
  await stepBlank(page)
  if (atBase.length > 0) await stepSlider(page, atBase)

  // HAND EVERYTHING BACK. The selector returns to base because the host spec's upgrade step reads
  // the corpus's own numbers there first, and the columns return to the derivation because
  // `pickColumns` TOGGLES against whatever it is handed (gearColumnSteps.mts states that pairing).
  await driveSlider(page, TIER_SLIDER, ['Home'])
  await resetColumns(page)
  await typeAndSettle(page, '')
  check(
    'the step hands the tab back at base, with the columns following the sort again',
    (await countOf(page, '[data-testid="gear-sort-STA"]')) === 0,
    'a picked column left behind would silently un-pick itself in the next step'
  )
}
