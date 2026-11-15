// eqAssetsLuclinArmour.test.mts - THE LUCLIN ARMOUR PIECES (helms, plate, robes, hair) against the
// real lgequip*.s3d archives. Runs where EverQuest Legends is installed; skipped (saying so) on CI.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPfs, type PfsArchive } from '../src/main/eqassets/pfs'
import { bindPose, readCharacter, readWld, skeletonOf, type WldFile } from '../src/main/eqassets/wld'
import { readItem, readWornPiece } from '../src/main/eqassets/wldItem'
import { LUCLIN_RACES, luclinFile } from '../src/main/eqassets/luclin'
import { ROBE_RACES, luclinDress, luclinOffset, type LuclinPiece } from '../src/main/eqassets/luclinArmour'
import type { EqModelWear } from '../src/shared/eqModel'

const EQ = 'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends'
const ARMOUR = ['lgequip_amr.s3d', 'lgequip_amr2.s3d', 'lgequip.s3d', 'lgequip2.s3d']
const ACTORS = [...LUCLIN_RACES].flatMap((r) => [`${r}M`, `${r}F`])
const SKIP = [...ARMOUR, ...ACTORS.map(luclinFile)].every((f) => existsSync(join(EQ, f))) ? false : 'no Luclin archives on this machine - run where the game is'

function load(file: string, scaled = false): { pfs: PfsArchive; wld: WldFile } {
  const pfs = readPfs(readFileSync(join(EQ, file)))
  return { pfs, wld: readWld(pfs.read(pfs.entries.find((e) => e.name.endsWith('.wld'))!.name)!, { scaledTracks: scaled }) }
}
let items: WldFile[] | null = null
function armour(): WldFile[] {
  items ??= ARMOUR.map((f) => load(f).wld)
  return items
}
const hasIt = (it: string): boolean => armour().some((w) => w.byName.has(`${it}_ACTORDEF`))
const meshOf = (it: string): boolean => armour().some((w) => w.byName.has(`${it}_ACTORDEF`) && readItem(w, it) !== null)
const at = (pieces: readonly LuclinPiece[], attach: string): LuclinPiece[] => pieces.filter((p) => p.attach === attach)
const robeTex = (code: string) => (robe: number): boolean => load(luclinFile(code)).pfs.has(`${code.toLowerCase()}ch${String(robe)}01.dds`)

test('the race/sex offsets: male blocks of 60, the female 30 on', () => {
  assert.equal(luclinOffset('GNM'), 0)
  assert.equal(luclinOffset('HUM'), 360)
  assert.equal(luclinOffset('HUF'), 390)
  assert.equal(luclinOffset('BAF'), 570)
  assert.equal(luclinOffset('HOF'), 810)
  assert.equal(luclinOffset('KEM'), null, 'Kerra has no Luclin twin')
})

test('every Luclin actor wears a real helm item for leather, chain and plate, on HEAD_POINT, and loses its hair under it', { skip: SKIP }, () => {
  for (const code of ACTORS) {
    for (const helm of [1, 2, 3] as const) {
      const { pieces } = luclinDress(code, { helm, tint: { helm: [1, 0, 0] } }, hasIt, () => false)
      const head = at(pieces, 'HEAD_POINT')
      assert.equal(head.length, 1, `${code}: helm ${String(helm)} resolves to an existing actor`)
      assert.ok(meshOf(head[0].it), `${code}: ${head[0].it} reads as a mesh`)
      assert.deepEqual(head[0].tint, [1, 0, 0], `${code}: the helm takes the head slot's dye`)
      assert.equal(at(pieces, 'HAIR_POINT').length, 0, `${code}: no hair under a helm`)
    }
  }
  // The plate ids that differ from +28: measured as the actors that exist.
  assert.equal(at(luclinDress('IKM', { helm: 3 }, hasIt, () => false).pieces, 'HEAD_POINT')[0].it, 'IT5423')
  assert.equal(at(luclinDress('BAM', { helm: 3 }, hasIt, () => false).pieces, 'HEAD_POINT')[0].it, 'IT5569')
  assert.equal(at(luclinDress('HUM', { helm: 3 }, hasIt, () => false).pieces, 'HEAD_POINT')[0].it, 'IT5388')
})

test('Show helmet off: no helm, and the hair is back where the race has one', { skip: SKIP }, () => {
  for (const code of ACTORS) {
    const { pieces } = luclinDress(code, {}, hasIt, () => false)
    assert.equal(at(pieces, 'HEAD_POINT').length, 0, `${code}: no helm without a helm wear`)
    const bald = ['IKM', 'IKF', 'ERM', 'ERF', 'TRM', 'OGM'].includes(code)
    assert.equal(at(pieces, 'HAIR_POINT').length, bald ? 0 : 1, `${code}: hair style 0 ${bald ? 'does not exist' : 'is drawn'}`)
  }
})

test('plate: a breastplate, shoulders, wrists and boots for every Luclin actor, and the chest texture stays its base look', { skip: SKIP }, () => {
  const wear: EqModelWear = { ch: 3, ua: 3, fa: 3, ft: 3, lg: 3, tint: { ch: [0, 1, 0], ua: [0, 0, 1] } }
  for (const code of ACTORS) {
    const dress = luclinDress(code, wear, hasIt, () => false)
    const off = luclinOffset(code)!
    assert.deepEqual(at(dress.pieces, 'CHEST_POINT').map((p) => p.it), [`IT${String(6000 + off)}`], `${code}: breastplate`)
    assert.deepEqual(at(dress.pieces, 'CHEST_POINT')[0].tint, [0, 1, 0], `${code}: in the chest's dye`)
    for (const [right, left, base] of [['SHOULDR_POINT', 'SHOULDL_POINT', 7000], ['GAUNTR_POINT', 'GAUNTL_POINT', 8000], ['LEGR_POINT', 'LEGL_POINT', 9000]] as const) {
      assert.deepEqual([...at(dress.pieces, right), ...at(dress.pieces, left)].map((p) => p.it), [`IT${String(base + off + 6)}`, `IT${String(base + off + 7)}`], `${code}: ${right}/${left}`)
    }
    for (const p of dress.pieces) assert.ok(meshOf(p.it), `${code}: ${p.it} reads as a mesh`)
    assert.equal(dress.wear.ch, undefined, `${code}: the chest texture is not plate-swapped under the breastplate`)
    assert.equal(dress.wear.tint?.ch, undefined, `${code}: and the bare chest under it is not dyed`)
    const { pfs, wld } = load(luclinFile(code), true)
    const model = readCharacter(wld, code, { wear: dress.wear, has: pfs.has })!
    const chest = model.meshes.flatMap((m) => m.groups.map((g) => m.materials[g.materialIndex]?.texture ?? '')).filter((t) => t.startsWith(`${code.toLowerCase()}ch`))
    assert.ok(chest.every((t) => /chsk\d+\.dds$/.test(t)), `${code}: the chest under the breastplate is the base look (${chest.join(' ')})`)
  }
})

test('the breastplate, robe skirts, flaps, belts and hair are SKINNED onto the wearer by bone name; helms and pads hang rigid', { skip: SKIP }, () => {
  const wear: EqModelWear = { ch: 3, ua: 3, fa: 3, ft: 3, lg: 3 }
  for (const code of ACTORS) {
    const { wld } = load(luclinFile(code), true)
    const skeleton = skeletonOf(wld, code)!
    const wearer = { skeleton, code, world: bindPose(skeleton) }
    const pieces = [...luclinDress(code, wear, hasIt, () => false).pieces, ...luclinDress(code, {}, hasIt, () => false).pieces]
    for (const p of pieces) {
      const src = armour().find((w) => w.byName.has(`${p.it}_ACTORDEF`))!
      const worn = readWornPiece(src, p.it, wearer)
      const skinnedKind = ['CHEST_POINT', 'TUNIC_POINT', 'PELVIS_POINT', 'HAIR_POINT'].includes(p.attach)
      assert.equal(worn !== null, skinnedKind, `${code}: ${p.it} on ${p.attach} is ${skinnedKind ? 'skinned' : 'hung'}`)
      if (!worn) continue
      assert.equal(worn.skinIndices.length, worn.positions.length / 3, `${code}: ${p.it} has a wearer bone per vertex`)
      assert.ok(worn.skinIndices.every((b) => b >= 0 && b < skeleton.bones.length), `${code}: ${p.it} binds the wearer's own bones`)
      const far = worn.positions.reduce((a, v) => Math.max(a, Math.abs(v)), 0)
      assert.ok(far < 5, `${code}: ${p.it} sits on the body (furthest ${far.toFixed(2)})`)
    }
  }
})

test('leather and chain have no shoulder/wrist/boot pieces (only the plate pair exists), and nothing missing is ever named', { skip: SKIP }, () => {
  for (const code of ACTORS) {
    for (const m of [1, 2] as const) {
      const { pieces } = luclinDress(code, { ch: m, ua: m, fa: m, ft: m, lg: m }, hasIt, () => false)
      assert.equal(pieces.filter((p) => /^(SHOULD|GAUNT|LEG)/.test(p.attach)).length, 0, `${code}: material ${String(m)}`)
      assert.equal(at(pieces, 'CHEST_POINT').length, 0, `${code}: no breastplate below plate`)
      for (const p of pieces) assert.ok(hasIt(p.it), `${code}: ${p.it} exists`)
    }
  }
})

test('robes: the twelve robe actors swap chest, arms and wrists to the robe, hang its skirt, and wear nothing else but the helm', { skip: SKIP }, () => {
  const robeActors = ACTORS.filter((c) => ROBE_RACES.has(c.slice(0, 2)))
  assert.equal(robeActors.length, 12)
  for (const code of robeActors) {
    for (const robe of [10, 13, 16] as const) {
      const wear: EqModelWear = { ch: 0, ua: 3, fa: 3, ft: 3, lg: 3, helm: 2, robe, tint: { ch: [0.5, 0, 0.5] } }
      const dress = luclinDress(code, wear, hasIt, robeTex(code))
      const off = luclinOffset(code)!
      assert.deepEqual(at(dress.pieces, 'TUNIC_POINT').map((p) => p.it), [`IT${String(4000 + off + robe - 10)}`], `${code}: robe ${String(robe)} skirt`)
      assert.equal(dress.pieces.filter((p) => !['TUNIC_POINT', 'HEAD_POINT'].includes(p.attach)).length, 0, `${code}: under a robe only the robe and the helm`)
      assert.equal(at(dress.pieces, 'HEAD_POINT').length, code.startsWith('ER') ? 0 : 1, `${code}: ${code.startsWith('ER') ? "an Erudite's robe is its hood" : 'the helm stays'}`)
      assert.deepEqual([dress.wear.ch, dress.wear.ua, dress.wear.fa], [robe, robe, robe], `${code}: chest, arms and wrists take the robe`)
      assert.deepEqual(dress.wear.tint?.ua, [0.5, 0, 0.5], `${code}: and the robe's dye`)
      const { pfs, wld } = load(luclinFile(code), true)
      const model = readCharacter(wld, code, { wear: dress.wear, has: pfs.has })!
      const drawn = model.meshes.flatMap((m) => m.groups.map((g) => m.materials[g.materialIndex]?.texture ?? ''))
      assert.ok(drawn.some((t) => t === `${code.toLowerCase()}ch${String(robe)}01.dds`), `${code}: the robe texture is on the chest`)
    }
  }
  // A race without robe textures keeps its normal chest.
  const dwarf = luclinDress('DWM', { ch: 2, robe: 12 }, hasIt, robeTex('DWM'))
  assert.equal(dwarf.wear.ch, 2)
  assert.equal(at(dwarf.pieces, 'TUNIC_POINT').some((p) => p.it === `IT${String(4000 + 120 + 2)}`), false)
})
