// THE GAME-ASSET READERS (EQ Zera, 2026-09-06; character-model spike): the PFS archive reader, the
// WLD character / item readers and the animation reader, driven over the REAL archives when an
// EverQuest Legends install is present, and skipped (saying so) when it is not - CI has no game.

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPfs } from '../src/main/eqassets/pfs'
import { RACE_CODES, readCharacter, readWld } from '../src/main/eqassets/wld'
import { readItem } from '../src/main/eqassets/wldItem'
import { ddsToBmp, isDds } from '../src/main/eqassets/dds'
import { boneShortName, readAnimation } from '../src/main/eqassets/wldAnim'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EQ = 'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends'
const ARCHIVE = join(EQ, 'global_chr.s3d')
const EQUIP = join(EQ, 'gequip.s3d')
const present = existsSync(ARCHIVE) && existsSync(EQUIP)
const SKIP = present ? false : 'no EverQuest Legends install on this machine - run where the game is'

function races(): { pfs: ReturnType<typeof readPfs>; wld: ReturnType<typeof readWld> } {
  const pfs = readPfs(readFileSync(ARCHIVE))
  return { pfs, wld: readWld(pfs.read('global_chr.wld')!) }
}

test('the archive lists its files and hands back the WLD and the bitmaps', { skip: SKIP }, () => {
  const pfs = readPfs(readFileSync(ARCHIVE))
  assert.ok(pfs.entries.length > 1000, 'global_chr.s3d carries every classic race texture')
  assert.ok(pfs.has('global_chr.wld'))
  const wldBytes = pfs.read('global_chr.wld')
  assert.ok(wldBytes && wldBytes.length > 1_000_000)
  const bmp = pfs.read('humch0001.bmp')
  assert.ok(bmp && bmp.subarray(0, 2).toString() === 'BM', 'a texture inflates to a BMP')
  assert.equal(pfs.read('nope.bmp'), undefined)
})

/** One mesh's claims: real geometry, finite posed vertices, in-range indices, textures on disk. */
function checkMesh(mesh: { name: string; positions: number[]; normals: number[]; uvs: number[]; indices: number[]; skinIndices: number[]; groups: { materialIndex: number }[]; materials: { texture: string | null }[] }, has: (name: string) => boolean): void {
  const n = mesh.positions.length / 3
  assert.ok(n > 50 && mesh.indices.length >= 3 && mesh.indices.length % 3 === 0, `${mesh.name}: geometry`)
  assert.equal(mesh.normals.length, mesh.positions.length)
  assert.equal(mesh.uvs.length, n * 2)
  assert.equal(mesh.skinIndices.length, n, `${mesh.name}: a bone per vertex`)
  assert.ok(mesh.positions.every((v) => Number.isFinite(v)), `${mesh.name}: finite, posed vertices`)
  assert.ok(mesh.indices.every((i) => i < n), `${mesh.name}: indices in range`)
  for (const g of mesh.groups) {
    const tex = mesh.materials[g.materialIndex]?.texture
    if (tex) assert.ok(has(tex), `${mesh.name}: ${tex} is in the archive`)
  }
}

test('every playable race, both genders, reads as a posed body plus a base head with its textures present', { skip: SKIP }, () => {
  const { pfs, wld } = races()
  assert.equal(wld.version, 0x15500, 'the old format this reader implements')
  const codes = Object.keys(RACE_CODES).flatMap((race) => [`${race}M`, `${race}F`])
  for (const code of codes) {
    const model = readCharacter(wld, code)
    assert.ok(model, `${code} resolves`)
    assert.equal(model.meshes.length, 2, `${code}: body + base head`)
    assert.ok(model.bones.length >= 20, `${code}: a skeleton`)
    assert.ok(model.bones.every((b) => b.name.endsWith('_DAG')), `${code}: bones are named`)
    assert.ok(model.bones.some((b) => b.name === `${code}R_POINT_DAG`), `${code}: the right-hand attachment point`)
    for (const mesh of model.meshes) checkMesh(mesh, pfs.has)
    // The game is Z-up: the figure's height is its z extent, about five units.
    const zs = model.meshes.flatMap((m) => m.positions.filter((_, i) => i % 3 === 2))
    assert.ok(Math.max(...zs) - Math.min(...zs) > 3, `${code}: the figure stands about five units tall`)
  }
})

test('wear swaps a part to its armour texture when the archive has it, and picks the helm mesh', { skip: SKIP }, () => {
  const { pfs, wld } = races()
  const bare = readCharacter(wld, 'BAF')!
  const plate = readCharacter(wld, 'BAF', { wear: { ch: 3, lg: 3, helm: 3 }, has: pfs.has })!
  const chestOf = (m: typeof bare): string[] =>
    m.meshes.flatMap((mesh) => mesh.groups.map((g) => mesh.materials[g.materialIndex]?.texture ?? '')).filter((t) => /^bafch/.test(t))
  assert.ok(chestOf(bare).every((t) => /^bafch00/.test(t)), 'bare chest textures are the 00 variant')
  assert.ok(chestOf(plate).length > 0 && chestOf(plate).every((t) => /^bafch03/.test(t)), 'plate chest textures are the 03 variant')
  assert.ok(plate.meshes.some((m) => m.name === 'BAFHE03_DMSPRITEDEF'), 'the plate helm mesh replaces the bare head')
  assert.ok(bare.meshes.some((m) => m.name === 'BAFHE00_DMSPRITEDEF'))
  const noSuch = readCharacter(wld, 'BAF', { wear: { ch: 3 }, has: () => false })!
  assert.ok(chestOf(noSuch).every((t) => /^bafch00/.test(t)), 'a variant the archive lacks leaves the texture alone')
})

test('the idle clip: humans carry their own, other races borrow it bone-for-bone and say so', { skip: SKIP }, () => {
  const { wld } = races()
  assert.equal(boneShortName('BAFBI_L_DAG', 'BAF'), 'BI_L')
  assert.equal(boneShortName('BAF_DAG', 'BAF'), '', 'the root: its track is P01BAF_TRACKDEF')
  const human = readCharacter(wld, 'HUM')!
  const idle = readAnimation(wld, 'HUM', human.skeleton, 'P01')
  assert.ok(idle, 'humans have P01')
  assert.equal(idle.name, 'P01')
  assert.ok(idle.frames > 1, `an idle has more than one frame (${String(idle.frames)})`)
  assert.ok(idle.frameMs > 0 && idle.frameMs < 1000)
  const animated = Object.keys(idle.tracks).length
  assert.ok(animated >= human.bones.length / 2, `most bones move (${String(animated)} of ${String(human.bones.length)})`)
  for (const track of Object.values(idle.tracks)) {
    assert.equal(track.q.length / 4, track.t.length / 3)
    assert.ok(track.q.every((v) => Number.isFinite(v)))
  }
  const barbarian = readCharacter(wld, 'BAF')!
  const borrowed = readAnimation(wld, 'BAF', barbarian.skeleton, 'P01')
  assert.ok(borrowed, 'barbarians borrow the human idle')
  assert.equal(borrowed.name, 'P01*', 'and the clip says it is borrowed')
  assert.equal(readAnimation(wld, 'BAF', barbarian.skeleton, 'Z99'), null, 'an animation nobody has is null')
})

test('weapon models read as rigid meshes out of gequip.s3d', { skip: SKIP }, () => {
  const pfs = readPfs(readFileSync(EQUIP))
  const wld = readWld(pfs.read('gequip.wld')!)
  for (const code of ['IT1', 'IT5', 'IT7', 'IT22', 'IT24', 'IT68']) {
    const mesh = readItem(wld, code)
    assert.ok(mesh, `${code} resolves`)
    assert.ok(mesh.positions.length >= 9 && mesh.indices.length >= 3, `${code}: geometry`)
    assert.equal(mesh.skinIndices.length, 0, `${code}: rigid`)
    for (const g of mesh.groups) {
      const tex = mesh.materials[g.materialIndex]?.texture
      if (tex) assert.ok(pfs.has(tex), `${code}: ${tex} is in the archive`)
    }
  }
  assert.equal(readItem(wld, 'IT999999'), null)
  // A weapon is held by its grip: the mesh's centre puts the grip at the origin and the blade out along +x.
  const sword = readItem(wld, 'IT1')!
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i < sword.positions.length; i += 3) {
    minX = Math.min(minX, sword.positions[i])
    maxX = Math.max(maxX, sword.positions[i])
  }
  assert.ok(minX > -0.7 && minX < 0, `the grip sits just behind the hand (min x ${minX.toFixed(2)})`)
  assert.ok(maxX > 2, `the blade reaches out in front (max x ${maxX.toFixed(2)})`)
})

test('the fist weapon IT68 is a four-frame additive glow, every frame in the archive', { skip: SKIP }, () => {
  const pfs = readPfs(readFileSync(EQUIP))
  const wld = readWld(pfs.read('gequip.wld')!)
  const fist = readItem(wld, 'IT68')
  assert.ok(fist?.materials.some((m) => /^fist/i.test(m.texture ?? '')), 'IT68 is the fist weapon, by its texture')
  const glow = fist?.materials.find((m) => m.frames !== undefined)
  assert.deepEqual(glow?.frames, ['fisttrans1.bmp', 'fisttrans2.bmp', 'fisttrans3.bmp', 'fisttrans4.bmp'], 'the glow is a four-frame pulse')
  assert.equal(glow?.frameMs, 100)
  assert.equal(glow?.type, 0x0b, 'drawn additively, so its black is invisible')
  for (const f of glow?.frames ?? []) assert.ok(pfs.has(f), `${f} is in the archive`)
})

test('the item table maps the game item id to its model: a monk fist weapon is IT68, not a mace', () => {
  const table = JSON.parse(readFileSync(join(ROOT, 'src', 'main', 'data', 'itemModels.json'), 'utf8')) as { byId: Record<string, { model: string; material: number }> }
  assert.equal(table.byId['27715']?.model, 'IT68', "Wu's Fist of Mastery")
  assert.ok(Object.keys(table.byId).length > 5000, 'the catalog is covered')
})

test('an item rigged on its own skeleton (the orb IT10512 in gequip5) reads as one posed rigid mesh', { skip: SKIP || !existsSync(join(EQ, 'gequip5.s3d')) }, () => {
  const pfs = readPfs(readFileSync(join(EQ, 'gequip5.s3d')))
  const wld = readWld(pfs.read('gequip5.wld')!)
  const orb = readItem(wld, 'IT10512')
  assert.ok(orb, 'IT10512 resolves through its skeleton')
  assert.ok(orb.positions.length >= 9 && orb.indices.length >= 3, 'geometry')
  assert.equal(orb.skinIndices.length, 0, 'flattened rigid')
  assert.equal(orb.rigged, true, 'and marked as the kind the client turns in the hand')
  assert.equal(readItem(readWld(readPfs(readFileSync(EQUIP)).read('gequip.wld')!), 'IT68')?.rigged, undefined, 'a plain mesh is not')
  assert.ok(orb.groups.every((g) => g.materialIndex < orb.materials.length), 'every group names a merged material')
  assert.ok(orb.indices.every((i) => i * 3 < orb.positions.length), 'every index is re-based into the merged vertices')
  // Its texture is a DDS, which the renderer cannot show: it decodes to a BMP of the same size with real pixels.
  const tex = orb.materials[0]?.texture
  assert.ok(tex?.endsWith('.dds'), 'the later archives carry DDS textures')
  const dds = Buffer.from(pfs.read(tex)!)
  assert.ok(isDds(dds))
  const bmp = ddsToBmp(dds)
  assert.ok(bmp, 'decodes')
  assert.equal(bmp.toString('latin1', 0, 2), 'BM')
  assert.equal(bmp.readInt32LE(18), dds.readUInt32LE(16), 'width')
  assert.equal(bmp.readInt32LE(22), dds.readUInt32LE(12), 'height')
  assert.equal(bmp.length, 54 + bmp.readInt32LE(18) * bmp.readInt32LE(22) * 4)
  let lit = 0
  for (let i = 54; i < bmp.length; i += 4) if (bmp[i] + bmp[i + 1] + bmp[i + 2] > 60) lit++
  assert.ok(lit > 0, 'the glow has lit pixels')
})

test('the DDS decoder: a hand-made DXT1 block decodes to its two colours, and non-DDS bytes are null', () => {
  // One 4x4 DXT1 block: c0 = pure red (0xF800), c1 = pure blue (0x001F), every pixel index 0 (red) except
  // the last row, index 1 (blue).
  const b = Buffer.alloc(128 + 8)
  b.writeUInt32LE(0x20534444, 0)
  b.writeUInt32LE(124, 4)
  b.writeUInt32LE(4, 12)
  b.writeUInt32LE(4, 16)
  b.write('DXT1', 84, 'latin1')
  b.writeUInt16LE(0xf800, 128)
  b.writeUInt16LE(0x001f, 130)
  b.writeUInt32LE(0x55000000, 132)
  const bmp = ddsToBmp(b)
  assert.ok(bmp)
  assert.equal(bmp.readInt32LE(18), 4)
  // BMP rows are stored bottom-up, so the DDS's first row lands last in the file: the flip is deliberate.
  const px = (i: number): number[] => [bmp[54 + i * 4 + 2], bmp[54 + i * 4 + 1], bmp[54 + i * 4]]
  assert.deepEqual(px(0), [255, 0, 0], 'DDS row 0 is red')
  assert.deepEqual(px(12), [0, 0, 255], 'DDS row 3 is blue')
  assert.equal(ddsToBmp(Buffer.from('BM not a dds')), null)
  assert.equal(isDds(Buffer.from('BM')), false)
})

test('an actor the WLD does not have is null, not a throw', { skip: SKIP }, () => {
  const { wld } = races()
  assert.equal(readCharacter(wld, 'ZZZ'), null)
})

test('bytes that are not a PFS or a WLD are refused with a plain error', () => {
  assert.throws(() => readPfs(new Uint8Array(64)), /not a PFS/)
  assert.throws(() => readWld(new Uint8Array(64)), /not a WLD/)
})
