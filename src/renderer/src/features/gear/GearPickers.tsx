// gear/GearPickers.tsx — the two chips that say what the Gear tab shows (JOS-297).
//
// ONE CONTROL SHAPE, TWICE. "Which columns" and "which filter controls" are the same gesture over
// two closed vocabularies, so they are one component opened from two chips. The chips live on the
// COUNT LINE rather than in the filter bar (they shared it with the Sets toggle until JOS-325
// retired that surface): both toolbar rows are `nowrap` and full, and neither of these narrows the
// corpus — they change what the surface LOOKS like, which is a different question from what it
// shows.
//
// A MENU, NOT AN INLINE MULTI-SELECT. `ChipMultiSelect` is the house control for picking several
// from a closed list, and it is the wrong one here: it renders the selection as chips INSIDE the
// field, and thirty-three chosen columns would be a field taller than the table it configures. A
// menu costs one click and stays the same height at 0 picks or 33.
//
// AND IT STAYS OPEN WHILE YOU PICK. Choosing columns is a burst — you add four attributes and two
// saves in one go — so a menu that closed on every click would cost six round trips. Escape or a
// click outside closes it, which is the platform's own answer.
//
// RESET IS THE AFFORDANCE THAT MAKES THE MODEL LEGIBLE. `null` (no stored choice) is a real state
// with visible behaviour — the columns follow the filters again — and without one item that
// returns to it the state would be reachable only by clearing storage by hand.

import { type JSX, useState } from 'react'
import { Checkbox, Chip, Divider, Menu, MenuItem, Typography } from '@mui/material'

export interface GearPickerProps<T extends string> {
  /** the chip's word — `Columns`, `Filters` */
  label: string
  /** what the chip's `title` explains, in one clause (the tooltip diet) */
  hint: string
  /** the closed vocabulary, in the order the surface itself uses */
  options: readonly T[]
  optionLabel: (key: T) => string
  /** the stored choice, or `null` while the app's own default is answering */
  chosen: readonly T[] | null
  /** what the checkboxes show while nothing is chosen — the default, made visible */
  fallback: readonly T[]
  /** what "back to the default" says, so each picker can name its own default behaviour */
  resetLabel: string
  /**
   * `gearPrefs.toggleColumn` / `toggleControl` — INJECTED rather than reimplemented here. Adding
   * and removing a key while keeping vocabulary order is the model's rule and it is node-tested;
   * a second copy inside a component is the kind of quiet divergence this repo has paid for before.
   */
  toggle: (base: readonly T[], key: T) => T[]
  onChange: (next: T[] | null) => void
  /** `gear-columns` / `gear-filters` — the toggle, the reset and every option hang off it */
  testId: string
}

/**
 * ONE PICKER. `chosen ?? fallback` is what the checkboxes read, so the first click PROMOTES the
 * default into an explicit list containing exactly what was already on screen — nothing appears or
 * disappears except the thing that was clicked.
 */
export default function GearPicker<T extends string>({
  label,
  hint,
  options,
  optionLabel,
  chosen,
  fallback,
  resetLabel,
  toggle,
  onChange,
  testId
}: GearPickerProps<T>): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const current = chosen ?? fallback
  const on = new Set<string>(current)

  return (
    <>
      <Chip
        size="small"
        label={`${label} · ${String(current.length)}`}
        data-testid={`${testId}-toggle`}
        color={chosen === null ? 'default' : 'primary'}
        variant={chosen === null ? 'outlined' : 'filled'}
        title={hint}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ flexShrink: 0 }}
      />
      <Menu
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { maxHeight: 420 } }, list: { dense: true } }}
      >
        <MenuItem
          data-testid={`${testId}-reset`}
          disabled={chosen === null}
          onClick={() => onChange(null)}
        >
          <Typography variant="body2" color="text.secondary">
            {resetLabel}
          </Typography>
        </MenuItem>
        <Divider />
        {options.map((option) => (
          <MenuItem
            key={option}
            data-testid={`${testId}-option-${option}`}
            onClick={() => onChange(toggle(current, option))}
          >
            <Checkbox size="small" checked={on.has(option)} tabIndex={-1} disableRipple sx={{ p: 0.25, mr: 1 }} />
            <Typography variant="body2">{optionLabel(option)}</Typography>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
