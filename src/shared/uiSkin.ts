/**
 * The in-game UI skin as the Preferences card sees it (src/main/uiSkin/, docs/plans/eql-ui-skin.md).
 * No path crosses IPC: the renderer is told a state and the command to type, never a folder.
 */

/** The skin folder under `uifiles` and the /loadskin argument. Mirrors src/main/uiSkin/rules.ts. */
export const UI_SKIN_NAME = 'EQZera'
export const UI_SKIN_COMMAND = `/loadskin ${UI_SKIN_NAME} 1`

/**
 * noSource - no `uifiles/default` under the EverQuest folder (wrong folder, or not installed)
 * missing  - not built
 * foreign  - an `EQZera` folder exists that EQ Zera did not write; the app will not touch it
 * stale    - built, but a game patch changed the default skin (or the rules) since
 * current  - built from the default skin as it is on disk now
 */
export type UiSkinState = 'noSource' | 'missing' | 'foreign' | 'stale' | 'current'

export interface UiSkinView {
  state: UiSkinState
  /** ISO time of the last build, when there is one */
  builtAt?: string
  fileCount?: number
  /** the player accepted the use-at-your-own-risk notice (once, remembered) */
  accepted: boolean
  /** a build is running right now */
  building: boolean
}

export interface UiSkinProgress {
  done: number
  total: number
}

export type UiSkinBuildResult = { ok: true; view: UiSkinView } | { ok: false; error: string; view: UiSkinView }
