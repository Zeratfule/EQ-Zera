// eqassets/luclin.ts - WHICH ACTORS HAVE A LUCLIN MODEL, AND WHO LENDS THE ONES THAT CANNOT MOVE
// (EQ Zera, 2026-11-15). Pure tables, no Electron, so tests/eqAssetsLuclin.test.mts can pin them
// against the real archives; ipc/eqModel.ts serves from them.
//
// Every classic race and the Iksar ship a Luclin-era actor beside the classic one, one archive per
// actor: `global<code>_chr.s3d` (HUM through IKF). A `_chr2` beside some of them holds extra
// ANIMATIONS only (no textures, and no idle this app needs). The races that ship ONE model (Kerra,
// the Half Dark Elf) have no Luclin twin.

import { RACE_CODES } from './wld'

/** The two-letter races with a Luclin archive per actor. */
export const LUCLIN_RACES: ReadonlySet<string> = new Set([...Object.keys(RACE_CODES), 'IK'])

/** The archive file an actor's Luclin model lives in. */
export function luclinFile(code: string): string {
  return `global${code.toLowerCase()}_chr.s3d`
}

/**
 * EIGHT LUCLIN ACTORS SHIP NO ANIMATION AT ALL (the client's own luclindefaults.txt lists their
 * `[ANIMATIONS]` as 0: ERM ERF HIM HIF DAM DAF HAM HAF), so each borrows another Luclin archive's
 * idle, rotations only. The lender is the one wldAnim.ts's donor ranking picks over all eighteen
 * animated Luclin rigs, and tests/eqAssetsLuclin.test.mts re-ranks it and fails if this table
 * drifts: the Erudite male on the human male (tied with BAM and GNM on every rung), every other
 * male on the wood elf male, every female on the wood elf female.
 */
export const LUCLIN_LENDER: Readonly<Record<string, string>> = {
  ERM: 'HUM',
  ERF: 'ELF',
  HIM: 'ELM',
  HIF: 'ELF',
  DAM: 'ELM',
  DAF: 'ELF',
  HAM: 'ELM',
  HAF: 'ELF'
}
