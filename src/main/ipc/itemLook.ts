// ipc/itemLook.ts - WHAT WOULD THIS ITEM LOOK LIKE ON ME? (EQ Zera, "preview this item on my
// character").
//
// One channel, `eqassets:itemLook`: the renderer hands over an item NAME - all an item page has -
// and gets back the model actor (`IT68`), the client's armour material code and the dye the
// committed game item table holds for it, plus how many DISTINCT looks that table holds under the
// name. The Character tab drops those three facts into one slot of the sheet it already draws
// (`shared/characterModel.ts applyPreview`) and the model resolvers below it never know the
// difference.
//
// THE TABLE IS KEYED BY ITEM ID, THIS IS KEYED BY NAME, and the re-keying is where all the
// judgement lives: the fold, the rename overlay, and the rule for a name several item ids answer
// to. All of it, with the counts, is in `./itemLookIndex.ts` - which is deliberately electron-free
// so `tests/itemLook.test.mts` can run the real committed table through it. This file is the door
// and nothing else.
//
// NOTHING LEAVES THE MACHINE and nothing is written: a committed JSON read in this process,
// answering the user's own window. A name the table does not know is `null`, which is the UI
// saying "no preview for this one", never an error.

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ItemLook } from '../../shared/eqModel'
import { lookupItemLook } from './itemLookIndex'

export { lookupItemLook }

export function registerItemLookIpc(): void {
  ipcMain.handle(IPC.itemLook, (_e, name: unknown): ItemLook | null => lookupItemLook(name))
}
