// spellsUsShape.mts — SYNTHETIC `spells_us.txt` rows with the real file's column SHAPE, for the
// game-file health tests. Daybreak's file never enters this repo; what is borrowed is only each
// column's commonest values and roughly their shares, as measured on the owner's install
// (2026-11-25, 74,024 rows) and tabled in src/main/resist/spellsUsSemantics.ts. Names and ids are
// invented. Deterministic: row i's values cycle through each column's list.

/** Column -> the values row i cycles through. Unlisted columns are '0'. */
const PROFILE: Record<number, readonly string[]> = {
  2: ['0'],
  4: ['200', '100', '300', '0', '500'],
  5: ['0', '0', '0', '0', '0', '100'],
  8: ['0', '0', '3000', '0', '1000', '500'],
  9: ['0', '1500', '0'],
  10: ['0', '1500', '6000', '0', '30000'],
  11: ['0', '3', '4', '5', '0', '3'],
  12: ['0', '1950', '10', '0', '20'],
  14: ['0', '0', '100', '0'],
  15: ['-1'],
  16: ['-1'],
  17: ['-1'],
  18: ['-1'],
  19: ['1'],
  20: ['1'],
  21: ['1'],
  22: ['1'],
  23: ['-1'],
  24: ['-1'],
  25: ['-1'],
  26: ['-1'],
  28: ['1', '0'],
  29: ['0', '1', '2', '3', '0', '5'],
  30: ['5', '6', '5', '6', '4'],
  31: ['0', '0', '25'],
  32: ['98', '5', '14'],
  52: ['43', '44', '32', '42'],
  53: ['0', '13', '0'],
  55: ['-1', '2', '25', '1', '-1'],
  75: ['100', '0', '100'],
  76: ['161', '51', '48', '99'],
  78: ['0', '-1000', '0', '-50'],
  85: ['200303', '11111', '12770'],
  86: ['125', '25', '20', '126', '0'],
  87: ['58', '84', '0'],
  142: ['-1'],
  143: ['0', '0', '4', '0', '8']
}

/** One row on the original 173-field map. */
export function shapedRow(i: number): string[] {
  const f = new Array<string>(173).fill('0')
  for (const [c, vals] of Object.entries(PROFILE)) f[Number(c)] = vals[i % vals.length]
  f[0] = String(1000 + i)
  f[1] = `Synthetic Spell ${String(i)}`
  f[3] = i % 18 === 0 ? 'synthetic text' : ''
  for (let c = 36; c <= 51; c++) f[c] = '255'
  if (i % 20 === 0) f[40] = '1'
  f[172] = i % 3 === 0 ? '1|0|-4|0|101|8' : '1|46|-10|0|101|23$2|50|-10|0|101|23'
  return f
}

/** The same row as the 2026-11-24 client writes it: 190 fields. */
export function shaped190(i: number): string[] {
  const f = shapedRow(i)
  f.splice(77, 0, '0')
  f.splice(f.length - 1, 0, ...new Array<string>(16).fill('0'))
  return f
}

export const joinRows = (rows: readonly (readonly string[])[]): string => rows.map((r) => r.join('^')).join('\r\n')

/** Insert a '0' column at p and remove what was column q (unshifted coordinates), on every row. */
export function moveColumns(rows: readonly (readonly string[])[], p: number, q: number): string[][] {
  return rows.map((row) => {
    const f = [...row]
    f.splice(p, 0, '0')
    f.splice(q >= p ? q + 1 : q, 1)
    return f
  })
}

/**
 * The cross-language parity set: synthetic files both readers judge, and the verdict each must
 * reach. Written to tests/fixtures/spellsUsShape/ (tests/spellsUsParity.test.mts keeps the files and
 * this function in step) and read again by engine/crates/fold/src/spells_us/layout.rs's tests, so
 * the app and the engine are held to the same answer on the same bytes.
 */
export function parityFixtures(): Record<string, { text: string; verdict: 'ok' | 'unrecognised' }> {
  const n = 30
  const base = Array.from({ length: n }, (_, i) => shaped190(i))
  const join = (rows: readonly (readonly string[])[]): string => `${rows.map((r) => r.join('^')).join('\n')}\n`
  const content = base.filter((_, i) => i % 10 !== 3)
  for (let i = 0; i < 4; i++) {
    const f = shaped190(i)
    f[0] = String(9000 + i)
    f[1] = `Synthetic Song ${String(i)}`
    for (let c = 36; c <= 51; c++) f[c] = '255'
    f[43] = String(10 + i)
    content.push(f)
  }
  return {
    'ok-190': { text: join(base), verdict: 'ok' },
    'content-patch': { text: join(content), verdict: 'ok' },
    'moved-20-61': { text: join(moveColumns(base, 20, 61)), verdict: 'unrecognised' },
    'moved-5-77': { text: join(moveColumns(base, 5, 77)), verdict: 'unrecognised' },
    'moved-40-180': { text: join(moveColumns(base, 40, 180)), verdict: 'unrecognised' },
    'width-200': { text: join(base.map((r) => [...r, ...new Array<string>(10).fill('0')])), verdict: 'unrecognised' },
    'dropped-172': { text: join(Array.from({ length: n }, (_, i) => shapedRow(i).slice(0, 172))), verdict: 'unrecognised' },
    'blank-names': { text: join(base.map((r) => r.map((v, c) => (c === 1 ? '' : v)))), verdict: 'unrecognised' }
  }
}

/** `n` rows at 190 fields, CRLF-separated, the way the client writes the file. */
export function shapedFile190(n: number): string {
  return joinRows(Array.from({ length: n }, (_, i) => shaped190(i)))
}
