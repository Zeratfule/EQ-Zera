// character/usePreviewLook - "can the model wear this, and what does it look like" (EQ Zera).
//
// TWO JOINS, IN ORDER, AND THE FIRST ONE IS THE GATE. Wearability is a fact the renderer already
// holds: the gear index (`useGearIndex`) has a row per equippable item in the corpus, keyed by
// `sourceItemKey(name)` - the same `itemKey` spelling the ownership, donor and loot joins use - and
// that row's `slots` are what `modelSlotForEquip` turns into the one model slot the item is tried
// in. NO ROW, OR A ROW WHOSE SLOTS THE MODEL HAS NO CELL FOR (ammo), IS NOT WEARABLE: the caller
// draws no button and the view says so in one line rather than looking broken.
//
// The second join is main's item table, by NAME (`window.eq.itemLook`), and it is deliberately
// ALLOWED TO FAIL. It answers the client's own model actor, armour material code and dye, which is
// what makes a previewed weapon its real model and a previewed breastplate its real plate texture;
// a name the table does not know - or, while the handler is being written, a channel that is not
// registered at all - simply yields a preview carrying the NAME and the SLOT, and the name-based
// material fallback in `slotLook` takes over from there. That degradation is the whole reason this
// hook never fabricates a look: an invented model actor draws the wrong sword confidently.

import { useEffect, useMemo, useState } from 'react'
import type { ItemLook } from '@shared/eqModel'
import type { GearRow } from '@shared/planner/gear'
// RELATIVE value imports (house law, the mobSearch.ts precedent) - these are node-tested pure
// modules and the `@shared` alias only exists inside the vite build.
import { modelSlotForEquip, type ModelSlotId, type PreviewLook } from '../../../../shared/characterModel'
import { sourceItemKey } from '../../lib/itemSources'
import { useGearIndex } from '../gear/gearData'

/**
 * WHERE THE PREVIEW IS, as one word.
 *
 * `unwearable` is a real ANSWER and not an error: a gem, a note, a bag. It is separated from
 * `loading` on purpose, because the two want opposite sentences on screen and a surface that
 * conflated them would say "not wearable" for the second before the index lands.
 */
export type PreviewState = 'none' | 'loading' | 'ready' | 'unwearable'

export interface PreviewLookState {
  preview: PreviewLook | null
  state: PreviewState
}

/** The item table's answer, tagged with the name it was asked for, so a stale one can be spotted. */
interface LookAnswer {
  item: string
  look: ItemLook | null
}

/** The look for a name, or null - a rejected invoke (no handler yet) reads the same as "unknown". */
async function fetchLook(name: string): Promise<ItemLook | null> {
  try {
    return await window.eq.itemLook(name)
  } catch {
    return null
  }
}

/** The corpus row for a display name, through the app's ONE item join key. */
function rowFor(rows: readonly GearRow[], item: string | null): GearRow | null {
  if (item === null) return null
  const key = sourceItemKey(item)
  return rows.find((r) => r.key === key) ?? null
}

/** Only the fields the tables actually stated - `model: ''` is "the table has none", not a model. */
function withLook(base: PreviewLook, look: ItemLook | null): PreviewLook {
  if (!look) return base
  const out: PreviewLook = { ...base, materialCode: look.material, color: look.color }
  if (look.model !== '') out.model = look.model
  if (look.looks > 1) out.looks = look.looks
  return out
}

function stateOf(item: string | null, ready: boolean, slot: ModelSlotId | undefined, preview: PreviewLook | null): PreviewState {
  if (item === null) return 'none'
  if (!ready) return 'loading'
  if (slot === undefined) return 'unwearable'
  return preview === null ? 'loading' : 'ready'
}

export function usePreviewLook(item: string | null): PreviewLookState {
  const { rows, ready } = useGearIndex()
  const row = useMemo(() => rowFor(rows, item), [rows, item])
  const slot = row === null ? undefined : modelSlotForEquip(row.slots)
  const [answer, setAnswer] = useState<LookAnswer | null>(null)

  useEffect(() => {
    if (item === null || slot === undefined) {
      setAnswer(null)
      return
    }
    let alive = true
    void fetchLook(item).then((look) => {
      if (alive) setAnswer({ item, look })
    })
    return () => {
      alive = false
    }
  }, [item, slot])

  const preview = useMemo(() => {
    if (item === null || row === null || slot === undefined) return null
    if (answer?.item !== item) return null
    const base: PreviewLook = { item, slot }
    if (row.skill !== undefined) base.skill = row.skill
    if (row.iconId !== undefined) base.iconId = row.iconId
    return withLook(base, answer.look)
  }, [item, row, slot, answer])

  return { preview, state: stateOf(item, ready, slot, preview) }
}
