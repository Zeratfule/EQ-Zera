// character/PreviewButton - "put this on my character", wherever an item is named (EQ Zera).
//
// ABSENT, NEVER DISABLED. The app's standing rule for a per-row action (GearTable.tsx's header
// argues it at length): a control that cannot mean anything is not drawn. Here that covers the
// large majority of item names in this app - a gem, a bag, a note, a quest turn-in - because the
// model can only wear what the gear index gives an equip slot to. There is no greyed button and no
// caption explaining why: the item page simply has one fewer control.
//
// TWO WAYS TO ANSWER THE SAME QUESTION, and the caller picks by what it already holds. A gear row
// knows its own `slots`, so the table hands them over and this costs one array scan per rendered
// row; an item page holds only a name, so it pays for the index lookup itself. Both go through
// `modelSlotForEquip`, so there is exactly one definition of "wearable" on either path.

import type { JSX } from 'react'
import { IconButton } from '@mui/material'
import CheckroomIcon from '@mui/icons-material/Checkroom'
import type { EquipSlot } from '@shared/planner/types'
import { modelSlotForEquip } from '../../../../shared/characterModel'
import { sourceItemKey } from '../../lib/itemSources'
import { useGearIndex } from '../gear/gearData'

/** One clause, naming the action - the tooltip diet's whole allowance for a control like this. */
const TITLE = 'Preview this item on your character'

export interface PreviewButtonProps {
  /** the item's display name, as the surface spelled it */
  item: string
  /** the Character tab's opener (`AppRouting.openCharacter`); absent ⇒ no control at all */
  onPreview?: (item: string) => void
  /** `gear-preview` on a search row, `loot-preview` on the item page */
  testId: string
  /** the caller's own equip slots, when it has them - saves this control the index lookup */
  slots?: readonly EquipSlot[]
}

export default function PreviewButton({ item, onPreview, testId, slots }: PreviewButtonProps): JSX.Element | null {
  // Hooks run unconditionally, so the index is asked for even when `slots` answered the question.
  // It costs nothing twice: `useGearIndex` is one cached fetch per window, shared by every mount.
  const { rows } = useGearIndex()
  const known = slots ?? rows.find((r) => r.key === sourceItemKey(item))?.slots
  if (onPreview === undefined || known === undefined) return null
  if (modelSlotForEquip(known) === undefined) return null
  return (
    // NATIVE `title`, NEVER A POPPER (JOS-143). One of the two hosts is the gear table's dense
    // scrolling row under a toolbar full of dropdowns, and that file's header holds the argument.
    <IconButton
      size="small"
      title={TITLE}
      data-testid={testId}
      data-item={item}
      aria-label="Preview on my character"
      onClick={(e) => {
        // The row underneath is a click target of its own (the Loot drill, the compare card).
        e.stopPropagation()
        onPreview(item)
      }}
    >
      <CheckroomIcon fontSize="small" />
    </IconButton>
  )
}
