// THE CRAFTING TAB — what you can make right now, what you are one thing away from, and for any
// recipe what you are missing.
//
// THREE READINGS OF ONE LIST, in the order a player wants them:
//
//   1. "What can I make with what is in my bags?"  Every recipe whose consumed ingredients the
//      newest `/outputfile inventory` dump accounts for.
//   2. "What am I nearly able to make?"  Exactly one ingredient KIND short - the useful surface,
//      because a fresh character holds almost nothing and the interesting answer is what to go and
//      pick up next.
//   3. "What does <thing> take?"  The whole corpus, searchable by product AND by ingredient,
//      because "what is this stack of gnome meat for" is the same question from the other end.
//
// WHAT IT NEVER CLAIMS. No recipe in the corpus states a SKILL requirement (only `trivial`), and
// this app knows no character's tradeskill values, so "You can make now" means YOU HOLD THE
// INGREDIENTS and the copy says nothing more (law 1). 357 recipes state no ingredient list at all;
// those read "ingredients not stated" and are never counted as makeable, because an empty
// requirement list is satisfied by an empty inventory and that would be a lie at the top of the tab.
//
// KEYED BY CHARACTER from App.tsx like the rest: the recipe corpus is character-independent, the
// ownership join is not, and the remount is how this app says whose bags.

import { type JSX, useCallback, useDeferredValue, useMemo, useState } from 'react'
import { Box, MenuItem, Paper, Select, Stack, TextField, Typography } from '@mui/material'
import { TRADESKILLS, craftIngredientCount, type CraftIndex, type CraftSkill } from '@shared/craft'
import CraftRow from './CraftRow'
import { craftPlan, type CraftVerdict, type HaveFn } from './craftPlan'
import { useCraftHoldings, useCraftIndex, useCraftSkill } from './useCraftIndex'

/** Past this the answer is a narrower search, not a longer scroll (the QuestsView cap, same rule). */
const ALL_CAP = 300

/** The rows are EXPANDABLE, so they are not uniform height - cap and search, never window. */
function Section({
  id,
  title,
  rows,
  empty,
  handlers
}: {
  id: string
  title: string
  rows: CraftVerdict[]
  empty: string
  handlers: {
    expanded: ReadonlySet<string>
    toggle: (id: string) => void
    have: HaveFn
    onOpenLoot: (item?: string) => void
  }
}): JSX.Element {
  const shown = rows.length > ALL_CAP ? rows.slice(0, ALL_CAP) : rows
  return (
    <Box data-testid={id} sx={{ mb: 1.5 }}>
      <Typography
        variant="caption"
        className="eq-display-label"
        data-testid={`${id}-count`}
        sx={{ display: 'block', color: 'text.secondary', mb: 0.5 }}
      >
        {title} · {rows.length}
      </Typography>
      {rows.length === 0 ? (
        <Typography variant="caption" color="text.disabled" sx={{ pl: 0.75, display: 'block' }} data-testid={`${id}-empty`}>
          {empty}
        </Typography>
      ) : (
        shown.map((v) => (
          <CraftRow
            key={v.recipe.id}
            verdict={v}
            expanded={handlers.expanded.has(v.recipe.id)}
            onToggle={handlers.toggle}
            have={handlers.have}
            onOpenLoot={handlers.onOpenLoot}
          />
        ))
      )}
      {rows.length > ALL_CAP && (
        <Typography variant="caption" color="text.disabled" sx={{ pl: 0.75, display: 'block' }}>
          Showing {ALL_CAP} of {rows.length} - search to narrow it
        </Typography>
      )}
    </Box>
  )
}

function FilterRow({
  query,
  setQuery,
  skill,
  setSkill
}: {
  query: string
  setQuery: (q: string) => void
  skill: CraftSkill | ''
  setSkill: (s: CraftSkill | '') => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
      <TextField
        size="small"
        placeholder="Search recipes and ingredients"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        sx={{ minWidth: 280, flexGrow: 1 }}
        slotProps={{ htmlInput: { 'data-testid': 'crafting-search' } }}
      />
      <Select
        size="small"
        displayEmpty
        value={skill}
        onChange={(e) => setSkill(e.target.value as CraftSkill | '')}
        sx={{ minWidth: 200 }}
        data-testid="crafting-skill"
      >
        <MenuItem value="">Any tradeskill</MenuItem>
        {TRADESKILLS.map((s) => (
          <MenuItem key={s} value={s}>
            {s}
          </MenuItem>
        ))}
        <MenuItem value="Other">Other</MenuItem>
      </Select>
    </Stack>
  )
}

/** The corpus's own size and date. One line, and it says WHEN the wiki data is from. */
function footerText(index: CraftIndex, ingredients: number): string {
  const line = `${index.recipes.length} recipes · ${ingredients} ingredients known`
  return index.scrapedAt === '' ? line : `${line} · wiki data as of ${index.scrapedAt.slice(0, 10)}`
}

export default function CraftingView({ onOpenLoot }: { onOpenLoot: (item?: string) => void }): JSX.Element {
  const { index, ready } = useCraftIndex()
  const { have, hasDump } = useCraftHoldings()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const [skill, setSkill] = useCraftSkill()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>())

  const plan = useMemo(
    () => (index === null ? null : craftPlan(index, have, { skill, query: deferred })),
    [index, have, skill, deferred]
  )
  const ingredients = useMemo(() => (index === null ? 0 : craftIngredientCount(index)), [index])

  // ONE OBJECT, MEMOIZED — a fresh literal per render would defeat every row's own memo across a
  // screenful of them on each keystroke (the `GearTable.tsx` bargain, same reasoning).
  const toggle = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])
  const handlers = useMemo(() => ({ expanded, toggle, have, onOpenLoot }), [expanded, toggle, have, onOpenLoot])

  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }} data-testid="crafting-view">
      <FilterRow query={query} setQuery={setQuery} skill={skill} setSkill={setSkill} />
      {/* THE FIXED-HEIGHT LAW: the panel that must survive gets `flexGrow` + `minHeight: 0` and
          owns its own scrollbar, so three growing lists cannot squeeze the footer to nothing. */}
      <Paper variant="outlined" sx={{ p: 1, flexGrow: 1, minHeight: 0, overflow: 'auto' }} data-testid="crafting-list">
        {plan === null ? (
          <Typography variant="caption" color="text.disabled" sx={{ p: 1, display: 'block' }}>
            {ready ? 'The recipe list could not be read.' : 'Reading recipes…'}
          </Typography>
        ) : (
          <>
            {!hasDump && (
              <Typography variant="caption" color="text.secondary" sx={{ p: 0.75, display: 'block' }} data-testid="crafting-no-dump">
                Load an inventory dump (/outputfile inventory) to see what you can make.
              </Typography>
            )}
            <Section
              id="crafting-makeable"
              title="You can make now"
              rows={plan.makeable}
              empty="Nothing you hold completes a recipe."
              handlers={handlers}
            />
            <Section
              id="crafting-one-away"
              title="One ingredient away"
              rows={plan.oneAway}
              empty="Nothing is one ingredient away."
              handlers={handlers}
            />
            <Section
              id="crafting-all"
              title="All recipes"
              rows={plan.all}
              empty="No recipe matches that."
              handlers={handlers}
            />
          </>
        )}
      </Paper>
      <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }} data-testid="crafting-footer">
        {index === null ? '' : footerText(index, ingredients)}
      </Typography>
    </Stack>
  )
}

/**
 * The App.tsx mount, a sibling of `QuestsBranch` and for the same reason its header states: the
 * `PlainView` switch sits at the measured complexity ceiling, and one more `view ===` branch in it
 * would cost a point this repo does not have.
 */
export function CraftingBranch({
  view,
  viewKey,
  onOpenLoot
}: {
  view: string
  viewKey: string
  onOpenLoot: (item?: string) => void
}): JSX.Element | null {
  return view === 'crafting' ? <CraftingView key={viewKey} onOpenLoot={onOpenLoot} /> : null
}
