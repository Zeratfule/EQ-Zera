// preload/characterApi.ts — THE CHARACTER TAB'S METHODS, as one spread into `api` (EQ Zera,
// 2026-09-06). Split out the way plannerApi.ts is: index.ts sits at its max-lines ceiling, and
// the tab now has the sheet read off the inventory dump, the race model read out of the game's
// own archive (main/ipc/eqModel.ts), and — since the profile-sharing ticket — the three doors of
// the share card: encode a profile, read a pasted one back, photograph the card.
//
// THE CODEC IS IN MAIN ON PURPOSE, and these two methods are why the renderer never grew its own:
// `EQC1-` is deflate, deflate is `node:zlib`, and a second encoder would be a second wire format
// (src/main/characterShare.ts's header carries the long version).

import { ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { CharacterSheet } from '../shared/characterSheet'
import type { CharacterProfileShare } from '../shared/characterShare'
import type { EqModelHands, EqModelPayload, EqModelWear, ItemLook } from '../shared/eqModel'

/** What `character:readShare` answers: a profile to draw, or prose saying why not. */
export type CharacterShareRead =
  | { ok: true; profile: CharacterProfileShare; appVersion: string; createdAt: string }
  | { ok: false; error: string }

/** What `character:shareImage` answers. `canceled` is the save dialog being dismissed. */
export interface CharacterShareImageResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

/** The card's DOM rectangle, in CSS pixels. Main scales it by the window's zoom and clamps it. */
export interface ShareCardRect {
  x: number
  y: number
  width: number
  height: number
}

export const characterApi = {
  /** The character sheet read off the latest `/outputfile inventory` dump; null without a dump. */
  characterSheet: (): Promise<CharacterSheet | null> => ipcRenderer.invoke(IPC.characterSheet),
  /** A classic race model (`BAF`, `HUM`, …) read from the game's own global_chr.s3d, dressed as `wear` says; null without the game. */
  eqModel: (code: string, wear: EqModelWear, hands: EqModelHands): Promise<EqModelPayload | null> =>
    ipcRenderer.invoke(IPC.eqModel, code, wear, hands),
  /** The look of an item by NAME out of the committed item table, for previewing it on the model; null for a name it does not know. */
  itemLook: (name: string): Promise<ItemLook | null> => ipcRenderer.invoke(IPC.itemLook, name),
  /** Encode a character profile as an `EQC1-` share string; null for a profile with nothing in it. */
  shareCharacterString: (profile: CharacterProfileShare): Promise<string | null> =>
    ipcRenderer.invoke(IPC.characterShareString, profile),
  /** Read a pasted share string back into a profile. Writes nothing: a character body is read-only. */
  readCharacterShare: (text: string): Promise<CharacterShareRead> =>
    ipcRenderer.invoke(IPC.characterShareRead, text),
  /** Photograph the share card at `rect` and either copy it or save it. `name` seeds the file name. */
  shareCharacterImage: (
    rect: ShareCardRect,
    op: 'copy' | 'save',
    name?: string
  ): Promise<CharacterShareImageResult> =>
    ipcRenderer.invoke(IPC.characterShareImage, { rect, op, name })
}
