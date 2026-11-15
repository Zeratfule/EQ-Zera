// eqAssetsNewRaces.test.mts - the two EQ Legends races read out of the user's own game files
// (Kerra, July 2026; Half Dark Elf, October 2026). Like eqAssets.test.mts: runs where the game is
// installed and patched, and is skipped (saying so) where it is not - CI has no game.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPfs } from '../src/main/eqassets/pfs'
import { facesFor, readCharacter, readWld, type CharacterModel, type WldFile } from '../src/main/eqassets/wld'
import { readAnimation, readAnimationOrLent } from '../src/main/eqassets/wldAnim'

const EQ = 'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends'

function drawnTextures(m: CharacterModel): string[] {
  return [...new Set(m.meshes.flatMap((mesh) => mesh.groups.map((g) => mesh.materials[g.materialIndex]?.texture ?? '').filter((t) => t !== '')))]
}

// ---- the two EQ Legends races (2026-11-15): one archive PER SEX, one actor apiece -------------

const perSex = (file: string): { pfs: ReturnType<typeof readPfs>; wld: WldFile } | null => {
  const path = join(EQ, file)
  if (!existsSync(path)) return null
  const pfs = readPfs(readFileSync(path))
  const name = pfs.entries.find((e) => e.name.endsWith('.wld'))?.name
  return name ? { pfs, wld: readWld(pfs.read(name)!) } : null
}
const SKIP_NEW = ['globalkem_chr.s3d', 'globalkef_chr.s3d', 'globalhdm_chr.s3d', 'globalhdf_chr.s3d'].every((f) => existsSync(join(EQ, f)))
  ? false
  : 'no Kerra / Half Dark Elf archives on this machine - run where the game is patched'


test('the Kerra read on the skin scheme: ten skin picks that re-skin the whole body, and armour over them', { skip: SKIP_NEW }, () => {
  for (const code of ['KEM', 'KEF']) {
    const { pfs, wld } = perSex(`global${code.toLowerCase()}_chr.s3d`)!
    const bare = readCharacter(wld, code, { wear: {}, has: pfs.has })!
    assert.ok(bare.bones.length > 40, `${code}: a skeleton of its own`)
    assert.deepEqual(facesFor(code, pfs.has), [0, 1, 2, 3, 4, 10, 11, 12, 13, 14], `${code}: the skin picks the archive ships`)
    assert.equal(bare.defaultFace, 0, `${code}: the bare head binds skin 0`)
    const skin = readCharacter(wld, code, { wear: { face: 14 }, has: pfs.has })!
    const skinned = drawnTextures(skin).filter((t) => /sk\d+\.dds$/.test(t))
    assert.ok(skinned.length > 5 && skinned.every((t) => /sk14\d\.dds$/.test(t)), `${code}: skin 14 reaches every bare part, head and body`)
    const plate = readCharacter(wld, code, { wear: { ch: 3, lg: 3, face: 14 }, has: pfs.has })!
    const chest = drawnTextures(plate).filter((t) => t.startsWith(`${code.toLowerCase()}ch`))
    assert.ok(chest.length > 0 && chest.every((t) => /ch030\d\.dds$/.test(t)), `${code}: plate covers the chest, the skin pick does not override it`)
    assert.ok(drawnTextures(plate).some((t) => /hesk14\d\.dds$/.test(t)), `${code}: and the head keeps the skin pick`)
    assert.ok(readAnimation(wld, code, bare.skeleton, 'P01'), `${code}: carries its own idle`)
  }
})

test('the Half Dark Elf read on the classic face naming, and the female borrows the male idle across archives', { skip: SKIP_NEW }, () => {
  const male = perSex('globalhdm_chr.s3d')!
  const female = perSex('globalhdf_chr.s3d')!
  for (const [code, a] of [['HDM', male], ['HDF', female]] as const) {
    const bare = readCharacter(a.wld, code, { wear: {}, has: a.pfs.has })!
    assert.deepEqual(facesFor(code, a.pfs.has), [0, 1, 2, 3, 4, 5, 6, 7], `${code}: eight faces`)
    for (const t of drawnTextures(readCharacter(a.wld, code, { wear: { face: 7, ch: 3 }, has: a.pfs.has })!)) {
      assert.ok(a.pfs.has(t), `${code}: ${t} is in the archive`)
    }
    assert.ok(bare.bones.length > 20, `${code}: a classic-sized rig`)
  }
  const hdf = readCharacter(female.wld, 'HDF')!
  assert.equal(readAnimation(female.wld, 'HDF', hdf.skeleton, 'P01'), null, 'globalhdf_chr.s3d ships no idle of its own')
  const lent = readAnimationOrLent({ wld: female.wld, code: 'HDF', skeleton: hdf.skeleton }, 'P01', { wld: male.wld, code: 'HDM' })
  assert.ok(lent && lent.name === 'P01*' && Object.keys(lent.tracks).length > 10, 'the male lends his, rotations only, marked borrowed')
})
