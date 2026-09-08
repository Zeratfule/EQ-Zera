// The loot history joined to the quest catalog, memoised per loot snapshot (EQ Zera, 2026-09-06).

import { useMemo } from 'react'
import { joinLootToQuests, type LootedQuestItem } from '../../../../shared/questIndex'
import { useLootHistory } from '../loot/useLootHistory'
import { questsByItem } from './questSearch'

export interface QuestItems {
  /** every quest item this character has looted, newest first */
  items: LootedQuestItem[]
  /** quest page → the looted items it needs or gives */
  byQuest: Map<string, LootedQuestItem[]>
}

export function useQuestItems(): QuestItems {
  const loot = useLootHistory()
  return useMemo(() => joinLootToQuests(loot, questsByItem()), [loot])
}
