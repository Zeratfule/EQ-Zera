// IPC: the in-game UI skin (src/main/uiSkin/, docs/plans/eql-ui-skin.md).
//
// NO PATH CROSSES THIS BOUNDARY in either direction. Every handler resolves the folders itself
// from `effectiveEqRoot()` - `<root>/uifiles/default_modern` over `default` is read and
// `<root>/uifiles/EQZera` is the only folder written or removed - so a renderer can ask for a
// build, a status or a removal and nothing else. A build is refused until the player has accepted the notice, and only one runs at a time.
// Writing a separate skin folder is safe while the game runs; the client reads it on /loadskin.

import { ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '../../shared/ipc'
import type { UiSkinBuildResult, UiSkinView } from '../../shared/uiSkin'
import { effectiveEqRoot } from '../log/config'
import { getUiSkinAccepted, setUiSkinAccepted } from '../storeUiSkin'
import { buildSkin, removeSkin, skinStatus, type SkinSources } from '../uiSkin/build'
import { BASE_SKIN, FALLBACK_SKIN, SKIN_NAME } from '../uiSkin/rules'

let building = false

function dirs(): { src: SkinSources; out: string } {
  const uifiles = join(effectiveEqRoot(), 'uifiles')
  return { src: { base: join(uifiles, BASE_SKIN), fallback: join(uifiles, FALLBACK_SKIN) }, out: join(uifiles, SKIN_NAME) }
}

async function view(): Promise<UiSkinView> {
  const { src, out } = dirs()
  const status = await skinStatus(src, out)
  return { ...status, accepted: getUiSkinAccepted(), building }
}

async function build(sender: Electron.WebContents): Promise<UiSkinBuildResult> {
  if (!getUiSkinAccepted()) return { ok: false, error: 'not accepted', view: await view() }
  if (building) return { ok: false, error: 'a build is already running', view: await view() }
  building = true
  try {
    const { src, out } = dirs()
    await buildSkin(src, out, (p) => {
      if (!sender.isDestroyed()) sender.send(IPC.onUiSkinProgress, { done: p.done, total: p.total })
    })
    building = false
    return { ok: true, view: await view() }
  } catch (e) {
    building = false
    return { ok: false, error: e instanceof Error ? e.message : String(e), view: await view() }
  }
}

export function registerUiSkinIpc(): void {
  ipcMain.handle(IPC.uiSkinStatus, () => view())
  ipcMain.handle(IPC.uiSkinAccept, () => {
    setUiSkinAccepted()
    return view()
  })
  ipcMain.handle(IPC.uiSkinBuild, (e) => build(e.sender))
  ipcMain.handle(IPC.uiSkinRemove, async () => {
    if (!building) await removeSkin(dirs().out)
    return view()
  })
}
