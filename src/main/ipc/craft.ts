// IPC: the CRAFTING tab's one door.
//
// One read over committed bytes, and that is the whole surface. Nothing here touches the network,
// nothing takes an argument from the renderer, and nothing can reject: the corpus is compiled into
// this bundle and `craftIndex()` is a pure walk over it, memoized in its own module.
//
// THE CHANNEL STRING COMES FROM `shared/craft.ts`, not from `shared/ipc.ts` — see the constant's
// own comment there. Both ends of the wire import the same constant, so the two spellings cannot
// drift while the string waits to be folded into `IPC`.

import { ipcMain } from 'electron'
import { CRAFT_INDEX_CHANNEL } from '../../shared/craft'
import { craftIndex } from '../craftIndex'

export function registerCraftIpc(): void {
  ipcMain.handle(CRAFT_INDEX_CHANNEL, () => craftIndex())
}
