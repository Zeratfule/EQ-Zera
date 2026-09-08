// preload/characterApi.ts — THE CHARACTER TAB'S METHODS, as one spread into `api` (EQ Zera,
// 2026-09-06). Split out the way plannerApi.ts is: index.ts sits at its max-lines ceiling, and
// the tab now has two calls — the sheet read off the inventory dump, and the race model read
// out of the game's own archive (main/ipc/eqModel.ts).

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CharacterSheet } from '../shared/characterSheet'
import type { EqModelHands, EqModelPayload, EqModelWear, ItemLook } from '../shared/eqModel'

export const characterApi = {
  /** The character sheet read off the latest `/outputfile inventory` dump; null without a dump. */
  characterSheet: (): Promise<CharacterSheet | null> => ipcRenderer.invoke(IPC.characterSheet),
  /** A classic race model (`BAF`, `HUM`, …) read from the game's own global_chr.s3d, dressed as `wear` says; null without the game. */
  eqModel: (code: string, wear: EqModelWear, hands: EqModelHands): Promise<EqModelPayload | null> =>
    ipcRenderer.invoke(IPC.eqModel, code, wear, hands),
  /** The look of an item by NAME out of the committed item table, for previewing it on the model; null for a name it does not know. */
  itemLook: (name: string): Promise<ItemLook | null> => ipcRenderer.invoke(IPC.itemLook, name)
}
