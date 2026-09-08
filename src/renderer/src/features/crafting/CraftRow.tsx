// crafting/CraftRow.tsx — one recipe, and the ingredient list it opens into.
//
// CLICK THE ROW, NOT A CHEVRON. The whole row is the affordance (and answers the keyboard the way
// `QuestRow` does), because a recipe's ingredients are the only thing anyone opens a recipe for —
// putting that behind a 20px target with a tooltip explaining itself would be the tooltip diet's
// exact bad case. The product NAME is the one thing inside the row that does something else: it
// links out to the Loot drill-down through the app's router, so it stops the click from also
// toggling.
//
// WHAT AN INGREDIENT LINE SAYS, AND WHAT IT REFUSES TO SAY. `name x2 - you hold 0` is the whole
// sentence: what the combine wants and what the dump found, with no verdict word attached to the
// number. A line you are short of is coloured, and a line that comes BACK from the combine is
// tagged `not consumed` instead of being quietly dropped, because "the recipe lists four things and
// you can see three" is the sort of silence that reads as a bug.

import type { JSX } from 'react'
import { Box, Chip, Link, Stack, Typography } from '@mui/material'
import type { CraftIngredient } from '@shared/craft'
import type { CraftVerdict } from './craftPlan'
import type { HaveFn } from './craftPlan'

/** The facts the wiki stated about the combine itself, as one caption. Absent facts print nothing. */
function combineFacts(verdict: CraftVerdict): string {
  const bits: string[] = [verdict.recipe.skillLabel]
  const { trivial, container, yieldQty } = verdict.recipe
  if (trivial !== undefined) bits.push(`trivial ${String(trivial)}`)
  if (container !== undefined) bits.push(container)
  if (yieldQty !== undefined && yieldQty > 1) bits.push(`makes ${String(yieldQty)}`)
  return bits.join(' · ')
}

function IngredientLine({ row, have }: { row: CraftIngredient; have: number }): JSX.Element {
  const short = row.consumed && have < row.qty
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="baseline"
      data-testid="crafting-ingredient"
      data-ingredient={row.name}
      data-have={String(have)}
      data-need={String(row.qty)}
      sx={{ pl: 1.5, minWidth: 0 }}
    >
      <Typography variant="body2" sx={{ color: short ? 'warning.main' : 'text.primary', flexShrink: 0 }}>
        {row.name}
        {row.qty > 1 && (
          <Typography component="span" variant="caption" color="text.secondary">
            {' '}
            ×{row.qty}
          </Typography>
        )}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        you hold {have}
      </Typography>
      {!row.consumed && (
        <Chip size="small" variant="outlined" label="not consumed" data-testid="crafting-not-consumed" sx={{ height: 18 }} />
      )}
    </Stack>
  )
}

export interface CraftRowProps {
  verdict: CraftVerdict
  expanded: boolean
  onToggle: (id: string) => void
  have: HaveFn
  onOpenLoot: (item?: string) => void
}

export default function CraftRow({ verdict, expanded, onToggle, have, onOpenLoot }: CraftRowProps): JSX.Element {
  const { recipe } = verdict
  return (
    <Box data-testid="crafting-row" data-recipe={recipe.product} data-recipe-id={recipe.id} sx={{ minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="baseline"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => onToggle(recipe.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onToggle(recipe.id)
        }}
        sx={{ py: 0.4, px: 0.75, borderRadius: 1, cursor: 'pointer', minWidth: 0, '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Link
          component="button"
          type="button"
          underline="hover"
          variant="body2"
          sx={{ fontWeight: 600, flexShrink: 0, textAlign: 'left' }}
          data-testid="crafting-product"
          onClick={(e) => {
            e.stopPropagation()
            onOpenLoot(recipe.product)
          }}
        >
          {recipe.product}
        </Link>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
          {combineFacts(verdict)}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        {verdict.unstated ? (
          <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
            ingredients not stated
          </Typography>
        ) : verdict.makeable ? (
          <Typography variant="caption" sx={{ color: 'success.main', flexShrink: 0 }}>
            you hold it all
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {verdict.missing.length} to go
          </Typography>
        )}
      </Stack>
      {expanded && (
        <Stack spacing={0.25} sx={{ pb: 0.75 }} data-testid="crafting-ingredients">
          {verdict.unstated ? (
            <Typography variant="caption" color="text.disabled" sx={{ pl: 1.5 }} data-testid="crafting-unstated">
              Ingredients not stated on the wiki.
            </Typography>
          ) : (
            recipe.ingredients.map((row) => <IngredientLine key={row.key} row={row} have={have(row.key)} />)
          )}
        </Stack>
      )}
    </Box>
  )
}
