// QuestSteps.tsx — the walkthrough as a CHECKLIST (EQ Zera), lifted out of QuestPage.
//
// TWO AUTHORS, AND THE UI SAYS WHICH IS WHICH. A step the LOG satisfied is drawn checked, disabled,
// and tagged "from the log": it is not the player's statement to take back, and offering a control
// that silently does nothing would be worse than offering none. Every other step is an ordinary
// checkbox the player owns, written into their tracker (`shared/questPins.ts`).
//
// TICKING NEEDS A PIN. The tracker is where a hand tick lives, so a quest nobody is tracking has no
// place to put one — the boxes are read-only there and the page's own Track button is the way in.
// Saying that in one line under the list beats a checkbox that swallows a click.
//
// THE LIT STYLE IS UNCHANGED. A step naming an item this character has looted keeps the green rule
// and wash QuestPage has always drawn: the two signals are different questions ("you hold what this
// asks for" vs "this is done"), and a step can be lit without being ticked all the way up to the
// moment you hand it over.

import { type JSX } from 'react'
import { Box, Checkbox, Stack, Typography } from '@mui/material'
import type { QuestProgress } from '../../../../shared/questProgress'
import { FONTS, PALETTE, withAlpha } from '../../../../shared/palette'

export interface QuestStepsProps {
  steps: readonly string[]
  progress: QuestProgress | undefined
  /** hand ticks for this quest, from the tracker */
  ticks: readonly number[]
  /** null when the quest is not tracked — the boxes are read-only and the page says why */
  onTick: ((step: number, on: boolean) => void) | null
}

/** One row: its box, its state, and where that state came from. */
function StepRow({
  step,
  index,
  auto,
  lit,
  checked,
  onTick
}: {
  step: string
  index: number
  auto: boolean
  lit: boolean
  checked: boolean
  onTick: ((step: number, on: boolean) => void) | null
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="flex-start"
      data-testid="quest-step"
      data-step={index}
      data-auto={auto ? 'true' : 'false'}
      data-checked={checked ? 'true' : 'false'}
      sx={{
        pl: 0.5,
        borderLeft: `2px solid ${lit ? PALETTE.green : 'transparent'}`,
        bgcolor: lit ? withAlpha(PALETTE.green, 0.08) : 'transparent'
      }}
    >
      {/* The testid sits on the MUI root, the `posky-hide-completed` precedent: an e2e clicks the
          wrapper and reads `.querySelector('input').checked` for the state. */}
      <Checkbox
        size="small"
        data-testid="quest-step-check"
        data-step={index}
        checked={checked}
        disabled={auto || onTick === null}
        onChange={(e) => onTick?.(index, e.target.checked)}
        sx={{ p: 0.25, mt: -0.25 }}
      />
      <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography component="span" variant="caption" sx={{ color: 'text.disabled', fontFamily: FONTS.mono, mr: 0.75 }}>
          {index + 1}
        </Typography>
        {step}
        {auto && (
          <Typography component="span" variant="caption" sx={{ color: 'success.main', ml: 0.75 }} data-testid="quest-step-auto">
            from the log
          </Typography>
        )}
      </Typography>
    </Stack>
  )
}

/** The checklist. Nothing at all when the wiki page carried no walkthrough. */
export function QuestSteps({ steps, progress, ticks, onTick }: QuestStepsProps): JSX.Element {
  if (steps.length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        The wiki page has no walkthrough for this quest.
      </Typography>
    )
  }
  const hand = new Set(ticks)
  return (
    <Box sx={{ display: 'grid', gap: 0.5 }} data-testid="quest-steps">
      {steps.map((step, i) => {
        const auto = progress?.auto.has(i) ?? false
        return (
          <StepRow
            key={i}
            step={step}
            index={i}
            auto={auto}
            lit={progress?.lit.has(i) ?? false}
            checked={auto || hand.has(i)}
            onTick={onTick}
          />
        )
      })}
      {onTick === null && (
        <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5 }} data-testid="quest-steps-untracked">
          Track this quest to tick steps off by hand.
        </Typography>
      )}
    </Box>
  )
}
