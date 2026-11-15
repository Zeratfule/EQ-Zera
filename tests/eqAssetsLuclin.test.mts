// eqAssetsLuclin.test.mts - THE LUCLIN-ERA PLAYER MODELS read out of the user's own game files
// (EQ Zera, 2026-11-15: the Character tab's "Luclin model" switch). One archive per actor,
// global<code>_chr.s3d, for the twelve classic races and the Iksar. Like eqAssets.test.mts: runs
// where the game is installed and skipped (saying so) where it is not - CI has no game.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPfs, type PfsArchive } from '../src/main/eqassets/pfs'
import { facesFor, readCharacter, readWld, skeletonOf, type CharacterModel, type WldFile } from '../src/main/eqassets/wld'
import { lenderRank, rankBeats, readAnimation } from '../src/main/eqassets/wldAnim'
import { gripCorrection, luclinIdle, standsIdle } from '../src/main/eqassets/wldPose'
import { LUCLIN_LENDER, LUCLIN_RACES, luclinFile } from '../src/main/eqassets/luclin'

const EQ = 'C:/Users/Public/Daybreak Game Company/Installed Games/EverQuest Legends'
const ACTORS = [...LUCLIN_RACES].flatMap((r) => [`${r}M`, `${r}F`])
const SKIP = ACTORS.every((c) => existsSync(join(EQ, luclinFile(c)))) ? false : 'no Luclin model archives on this machine - run where the game is'

const cache = new Map<string, { pfs: PfsArchive; wld: WldFile }>()
function luclin(code: string): { pfs: PfsArchive; wld: WldFile } {
  const hit = cache.get(code)
  if (hit) return hit
  const pfs = readPfs(readFileSync(join(EQ, luclinFile(code))))
  const name = pfs.entries.find((e) => e.name.endsWith('.wld'))!.name
  const out = { pfs, wld: readWld(pfs.read(name)!, { scaledTracks: true }) }
  cache.set(code, out)
  return out
}

function drawn(m: CharacterModel): string[] {
  return [...new Set(m.meshes.flatMap((mesh) => mesh.groups.map((g) => mesh.materials[g.materialIndex]?.texture ?? '').filter((t) => t !== '')))]
}

test('the Luclin table names twenty-six actors: the twelve classic races and the Iksar, both sexes', () => {
  assert.equal(ACTORS.length, 26)
  assert.ok(!LUCLIN_RACES.has('KE') && !LUCLIN_RACES.has('HD'), 'Kerra and the Half Dark Elf have one model each')
})

test('every Luclin actor reads: a full rig, one body mesh with the head built in, two eyes, every drawn texture in its archive', { skip: SKIP }, () => {
  for (const code of ACTORS) {
    const { pfs, wld } = luclin(code)
    const m = readCharacter(wld, code, { wear: {}, has: pfs.has })
    assert.ok(m, `${code}: reads`)
    assert.ok(m.bones.length >= 90, `${code}: a Luclin-sized rig (${String(m.bones.length)} bones)`)
    const names = m.meshes.map((x) => x.name).sort()
    assert.deepEqual(names, [`${code}EYE_L_DMSPRITEDEF`, `${code}EYE_R_DMSPRITEDEF`, `${code}_DMSPRITEDEF`].sort(), `${code}: body and both eyes are drawn`)
    const textures = drawn(m)
    assert.ok(textures.length >= 20, `${code}: ${String(textures.length)} drawn textures`)
    for (const t of textures) assert.ok(pfs.has(t), `${code}: ${t} is in the archive`)
  }
})

test('a Luclin bone track’s last value is a SCALE: read that way every body binds in one piece, read the classic way the human does not', { skip: SKIP }, () => {
  for (const code of ACTORS) {
    const { pfs, wld } = luclin(code)
    const body = readCharacter(wld, code, { wear: {}, has: pfs.has })!.meshes.find((m) => m.name === `${code}_DMSPRITEDEF`)!
    const far = body.positions.reduce((a, v) => Math.max(a, Math.abs(v)), 0)
    assert.ok(far < 5, `${code}: every bind-pose vertex within 5 units of the root (furthest ${far.toFixed(2)})`)
  }
  const hum = readCharacter(luclin('HUM').wld, 'HUM')!
  const butt = hum.bones.find((b) => b.name === 'HUMPEBUTTR_DAG')!
  assert.ok(butt.s !== undefined && Math.abs(butt.s - 6 / 256) < 1e-9, 'HUMPEBUTTR binds at scale 6/256, folded away')
  const { pfs } = luclin('HUM')
  const classicRead = readWld(pfs.read('globalhum_chr.wld')!)
  const unscaled = readCharacter(classicRead, 'HUM')!.meshes.find((m) => m.name === 'HUM_DMSPRITEDEF')!
  assert.ok(unscaled.positions.some((v) => Math.abs(v) > 10), 'read as a shift denominator, that buttock lands more than ten units off the hip (the bug this reading fixes)')
  const idle = readAnimation(luclin('HUM').wld, 'HUM', hum.skeleton, 'P01')!
  assert.ok(Object.values(idle.tracks).every((t) => t.s?.length === t.q.length / 4), 'an own Luclin clip carries a scale per frame')
})

test('every Luclin actor offers eight faces, and a pick re-skins the head only where the file exists', { skip: SKIP }, () => {
  for (const code of ACTORS) {
    const { pfs, wld } = luclin(code)
    assert.deepEqual(facesFor(code, pfs.has), [0, 1, 2, 3, 4, 5, 6, 7], `${code}: faces`)
    const bare = readCharacter(wld, code, { wear: {}, has: pfs.has })!
    assert.equal(bare.defaultFace, 0, `${code}: the bare head binds face 0`)
    const picked = readCharacter(wld, code, { wear: { face: 5 }, has: pfs.has })!
    const heads = drawn(picked).filter((t) => t.startsWith(`${code.toLowerCase()}hesk`))
    assert.ok(heads.some((t) => /hesk5\d\.dds$/.test(t)), `${code}: face 6 reaches the head`)
    for (const t of drawn(picked)) assert.ok(pfs.has(t), `${code}: ${t} exists after the pick`)
  }
})

test('every Luclin actor stands in an idle that STANDS: arms down, thighs under it, spine upright, own or borrowed', { skip: SKIP }, () => {
  const chosen: string[] = []
  for (const code of ACTORS) {
    const { pfs, wld } = luclin(code)
    const m = readCharacter(wld, code, { wear: {}, has: pfs.has })!
    const lenders = (LUCLIN_LENDER[code] ?? []).map((l) => ({ wld: luclin(l).wld, code: l }))
    if (lenders.length > 0) assert.equal(readAnimation(wld, code, m.skeleton, 'P01'), null, `${code}: the archive ships no animation (luclindefaults.txt says 0)`)
    const idle = luclinIdle({ wld, code, skeleton: m.skeleton }, lenders)
    assert.ok(idle, `${code}: some candidate clip stands`)
    assert.ok(standsIdle(m.skeleton, code, idle), `${code}: and it passes the arms-down / upright check on every frame`)
    assert.equal(idle.name.endsWith('*'), lenders.length > 0, `${code}: borrowed exactly when the archive has no clips of its own`)
    assert.ok(Object.keys(idle.tracks).length >= m.bones.length * 0.9, `${code}: a track for (nearly) every bone`)
    for (const track of Object.values(idle.tracks)) assert.equal(track.t.length / 3, track.q.length / 4)
    chosen.push(`${code}:${idle.name}`)
  }
  // The measured choices: P01 stands for most; the Iksar (crouch, one arm out) and BAF (one arm out) take a clean stand.
  for (const pick of ['IKF:P08A', 'IKM:P08A', 'BAF:P01B', 'HUM:P01A', 'DAF:P01A*', 'ERM:P01A*']) assert.ok(chosen.includes(pick), `${pick} (got ${chosen.join(' ')})`)
})

test('the Iksar female’s P01 is the crouch the owner saw, which is why it is not her idle', { skip: SKIP }, () => {
  const { wld } = luclin('IKF')
  const sk = skeletonOf(wld, 'IKF')!
  assert.equal(standsIdle(sk, 'IKF', readAnimation(wld, 'IKF', sk, 'P01A')!), false)
  assert.equal(standsIdle(sk, 'IKF', readAnimation(wld, 'IKF', sk, 'P01B')!), false)
})

test('the Luclin lender table leads with what the donor ranking picks, not a hand-written guess', { skip: SKIP }, () => {
  const animated = ACTORS.filter((c) => LUCLIN_LENDER[c] === undefined)
  for (const [code, lenders] of Object.entries(LUCLIN_LENDER)) {
    const lender = lenders[0]
    const target = skeletonOf(luclin(code).wld, code)!
    const first = lenderRank(target, code, skeletonOf(luclin(lender).wld, lender)!, lender)
    assert.ok(first, `${code}: ${lender} can lend at all`)
    for (const other of animated) {
      const rank = lenderRank(target, code, skeletonOf(luclin(other).wld, other)!, other)
      assert.ok(!rank || !rankBeats(rank, first), `${code}: ${other} outranks the table's ${lender}`)
    }
    assert.ok(lenders.every((l) => l.slice(2) === code.slice(2)), `${code}: every lender is the same sex`)
  }
})

/** One drawn texture of a worn part: the worn variant or the closest lower one the archive has, or the bare skin only where it has none. */
function checkWorn(pfs: PfsArchive, code: string, [part, v]: readonly [string, number], t: string): void {
  const lc = code.toLowerCase()
  const got = new RegExp(`^${lc}${part}0(\\d)(\\d\\d)\\.dds$`).exec(t)
  const bare = new RegExp(`^${lc}${part}sk0(\\d)\\.dds$`).exec(t)
  assert.ok(got || bare, `${code}: ${t} is armour or the bare skin`)
  if (got) {
    const drawnV = Number(got[1])
    assert.ok(drawnV >= 1 && drawnV <= v, `${code}: ${t} is the worn variant or a lower one`)
    for (let higher = drawnV + 1; higher <= v; higher++) assert.ok(!pfs.has(`${lc}${part}0${String(higher)}${got[2]}.dds`), `${code}: ${t} stepped down only past variants the archive lacks`)
  }
  if (bare) for (let k = 1; k <= v; k++) assert.ok(!pfs.has(`${lc}${part}0${String(k)}0${bare[1]}.dds`), `${code}: ${t} is bare only because no armour of variant 1..${String(v)} exists for it`)
}

test('Luclin wear: the variant digit maps onto the Luclin armour files, stepping down to the closest armour the actor has', { skip: SKIP }, () => {
  for (const code of ACTORS) {
    const { pfs, wld } = luclin(code)
    const lc = code.toLowerCase()
    const dressed = readCharacter(wld, code, { wear: { ch: 3, lg: 2, ua: 1, fa: 1, hn: 2, ft: 3, tint: { lg: [1, 0, 0], ch: [0, 1, 0] } }, has: pfs.has })!
    const textures = drawn(dressed)
    for (const [part, v] of [['ch', 3], ['lg', 2], ['ua', 1], ['fa', 1], ['hn', 2], ['ft', 3]] as const) {
      const mine = textures.filter((t) => t.startsWith(`${lc}${part}`))
      assert.ok(mine.length > 0, `${code}: the ${part} is drawn`)
      for (const t of mine) checkWorn(pfs, code, [part, v], t)
    }
    const expectBare = (['ch', 'lg', 'ua', 'fa', 'hn', 'ft'] as const).filter((p) => textures.some((t) => new RegExp(`^${lc}${p}sk\\d+\\.dds$`).test(t)))
    assert.deepEqual(dressed.undressed ?? [], expectBare, `${code}: only the parts genuinely left bare are named for the card's note`)
    const chest = dressed.meshes.flatMap((m) => m.groups.map((g) => m.materials[g.materialIndex])).filter((mt) => mt?.texture?.startsWith(`${lc}ch`))
    assert.ok(chest.length > 0 && chest.every((mt) => !mt.texture!.startsWith(`${lc}chsk`)), `${code}: no bare skin under a breastplate`)
    assert.ok(chest.every((mt) => mt.tint?.[1] === 1), `${code}: the stepped-down chest keeps the plate's dye`)
    const legs = dressed.meshes.flatMap((m) => m.materials).filter((mt) => mt.texture?.startsWith(`${lc}lg02`))
    assert.ok(legs.length > 0 && legs.every((mt) => mt.tint?.[0] === 1), `${code}: chain legs are drawn, and take the dye`)
  }
  // Every Luclin actor in every armour variant: the chest is never bare skin.
  for (const code of ACTORS) {
    const { pfs, wld } = luclin(code)
    for (const v of [1, 2, 3] as const) {
      const m = readCharacter(wld, code, { wear: { ch: v }, has: pfs.has })!
      assert.ok(!drawn(m).some((t) => t.startsWith(`${code.toLowerCase()}chsk`)), `${code}: chest variant ${String(v)} is never drawn as bare skin`)
    }
  }
  const plateChests = ACTORS.filter((c) => luclin(c).pfs.has(`${c.toLowerCase()}ch0301.dds`))
  assert.deepEqual(plateChests, ['BAF'], 'only the Barbarian female ships a Luclin plate chest; the rest step down to chain')
})

test('every Luclin figure gets a grip that holds the weapon as its classic twin does', { skip: SKIP }, () => {
  const classicOf = (file: string): WldFile => {
    const pfs = readPfs(readFileSync(join(EQ, file)))
    return readWld(pfs.read(pfs.entries.find((e) => e.name.endsWith('.wld'))!.name)!)
  }
  const classic = classicOf('global_chr.s3d')
  const iksar = classicOf('global4_chr.s3d')
  for (const code of ACTORS) {
    const { wld } = luclin(code)
    const sk = skeletonOf(wld, code)!
    const idle = luclinIdle({ wld, code, skeleton: sk }, (LUCLIN_LENDER[code] ?? []).map((l) => ({ wld: luclin(l).wld, code: l })))
    const cw = code.startsWith('IK') ? iksar : classic
    const csk = skeletonOf(cw, code)!
    for (const attach of ['R_POINT', 'L_POINT']) {
      const grip = gripCorrection({ skeleton: sk, code, clip: idle }, { skeleton: csk, code, clip: readAnimation(cw, code, csk, 'P01') }, attach)
      assert.ok(grip, `${code}: a ${attach} grip`)
      assert.ok(Math.abs(Math.hypot(...grip) - 1) < 1e-6, `${code}: the ${attach} grip is a unit rotation`)
    }
  }
})

test('a helm asks for a Luclin head mesh that does not exist, so the head stays the body mesh’s own', { skip: SKIP }, () => {
  const { pfs, wld } = luclin('HUM')
  const helmed = readCharacter(wld, 'HUM', { wear: { helm: 3 }, has: pfs.has })!
  assert.deepEqual(helmed.meshes.map((m) => m.name).sort(), ['HUMEYE_L_DMSPRITEDEF', 'HUMEYE_R_DMSPRITEDEF', 'HUM_DMSPRITEDEF'])
})
