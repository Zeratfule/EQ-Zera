// build/BuildItemName.tsx — every item NAME on the Build tab, with the item window behind it.
//
// OWNER, 2026-09-08: *"'Upgrades for DPS' box should bring up item tool-tip on mouse over for the
// item also."* The panel already said what an item is WORTH (`+N`, the cell, where it drops); what
// it could not say is what the item IS. So the names on this tab now anchor the app's item hover
// card — `lib/KnownItemTooltip`, the EQ-style item window (icon, stats, effects) plus the quests
// and recipes that use it — which is the tooltip-diet's sanctioned exception: it is the item
// window, not a caveat about one.
//
// ONE DOOR, ONE MODE, and the mode is the whole reason this file exists rather than three call
// sites spelling the same props. Every card here opens in CLICK-THROUGH mode (JOS-181), because
// every row on this tab carries something a card must not sit on: an upgrade option has a "Swap
// in" button, a set row has its undo icon, the name itself is the link into the Loot drill-down,
// and the toolbar above both panels holds two switches. Click-through is the shape that answers
// exactly that — the card opens DOWNWARD and can never flip up onto the toolbar, it holds no
// pointer events, and it is gone on the first pointerdown anywhere. Hover explains; every click
// still lands where it always did.
//
// THE ANCHOR IS THE CALLER'S OWN ELEMENT, never a wrapper this file introduces: MUI's Tooltip
// clones a ref and a className onto its child, so a caller passes something that takes both — a
// `Typography` (which forwards both) or a plain `<span>` around a function component that does
// not. That is `EffectRows`' precedent, and it keeps the compact rows laying out unchanged.

import { cloneElement, type JSX, type ReactElement } from 'react'
import { KnownItemTooltip } from '../../lib/KnownItemTooltip'

/**
 * The testid every hoverable item name on this tab carries. It rides the anchor from HERE rather
 * than from the three call sites, so "a name with a card behind it" and "a name a spec can point
 * at" cannot drift apart: the clone below is the only way either arrives.
 */
export const BUILD_ITEM_NAME_TESTID = 'build-item-name'

/** An item name on the Build tab: hover for the item window, click for whatever the caller wired. */
export function BuildItemName({ name, children }: { name: string; children: ReactElement }): JSX.Element {
  // The same clone `lib/Tooltip` makes for its cursor class, for the same reason: no wrapper
  // element, so nothing about the row's layout moves.
  const anchor = cloneElement(children, { 'data-testid': BUILD_ITEM_NAME_TESTID } as Partial<unknown>)
  return (
    <KnownItemTooltip name={name} clickThrough>
      {anchor}
    </KnownItemTooltip>
  )
}
