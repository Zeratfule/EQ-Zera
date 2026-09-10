// THE REAL MODEL (EQ Zera, 2026-09-06; character-model spike): the game's own classic race model,
// read out of global_chr.s3d by main (ipc/eqModel.ts) and drawn here with three.js.
//
// PHASE 3 SKINS AND ANIMATES IT. The payload carries the skeleton (bind transforms), a bone per
// vertex, the idle clip and the weapon meshes; this file builds a THREE.Skeleton, SkinnedMeshes
// bound in the bind pose, an AnimationMixer playing the idle, and hangs each weapon off its
// attachment bone (`R_POINT` / `L_POINT` / `SHIELD_POINT`). Everything arrives in the game's own
// Z-up frame and the whole figure is rotated once.
//
// The race, the sex and the face are the things the app cannot read from any file, so they are
// three pickers (ModelPickers.tsx / modelPrefs.ts), remembered in localStorage the way CarryAll
// remembers its lane. This file draws whatever payload they ask for.

import { type JSX, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { PALETTE } from '../../../../shared/palette'
import type { EqModelClip, EqModelHands, EqModelMaterial, EqModelMesh, EqModelPayload, EqModelWear, Tint } from '@shared/eqModel'

/** A texture from a data URL, in the game's pixel look: nearest magnification, sRGB, repeating. */
function loadTexture(loader: THREE.TextureLoader, url: string): THREE.Texture {
  const map = loader.load(url)
  map.colorSpace = THREE.SRGBColorSpace
  map.magFilter = THREE.NearestFilter
  map.minFilter = THREE.LinearMipMapLinearFilter
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  return map
}

/** The WLD render types that ADD their texture over what is behind them: a glow, so black is invisible. */
const ADDITIVE_TYPES = new Set([0x05, 0x0a, 0x0b, 0x17])

/**
 * A material for a WLD render type: 0 is invisible (never drawn), 2..4 translucent, the additive
 * kinds (`ADDITIVE_TYPES`: a weapon's glow) add over the scene without writing depth, 0x13 masked;
 * dyed by `tint`.
 */
function makeMaterial(map: THREE.Texture | null, type: number, tint?: Tint): THREE.MeshLambertMaterial {
  const additive = ADDITIVE_TYPES.has(type)
  const translucent = type >= 2 && type <= 4
  const color = tint ? new THREE.Color(tint[0], tint[1], tint[2]) : new THREE.Color(map ? 0xffffff : 0x8892a8)
  const mat = new THREE.MeshLambertMaterial({
    map,
    color,
    side: THREE.DoubleSide,
    transparent: translucent || additive,
    opacity: translucent ? 0.6 : 1,
    alphaTest: type === 0x13 ? 0.5 : 0
  })
  if (additive) {
    mat.blending = THREE.AdditiveBlending
    mat.depthWrite = false
    // The glow is self-lit: a Lambert surface facing away from the light would swallow it.
    mat.emissive = new THREE.Color(0xffffff)
    mat.emissiveMap = map
  }
  return mat
}

/** Everything a built figure allocates on the GPU, so unmount can give it all back. */
interface Built {
  group: THREE.Group
  geometries: THREE.BufferGeometry[]
  materials: THREE.MeshLambertMaterial[]
  textures: THREE.Texture[]
  mixer: THREE.AnimationMixer | null
  /** the animated materials, each with its frame textures and period */
  flipbooks: Flipbook[]
  /** held things the client turns in the hand (an orb): pivots spun each tick, with their glow materials to pulse */
  turning: { pivot: THREE.Object3D; glows: THREE.MeshLambertMaterial[] }[]
}

const TURN_RATE = 1.6 // radians per second
const PULSE_RATE = 3

/** Turn every rigged item about its own upright axis and breathe its glow. */
function advanceTurning(turning: readonly Built['turning'][number][], elapsed: number, dt: number): void {
  for (const t of turning) {
    t.pivot.rotation.z += dt * TURN_RATE
    for (const m of t.glows) m.emissiveIntensity = 0.8 + 0.2 * Math.sin(elapsed * PULSE_RATE)
  }
}

/** An animated texture on a material: the frames it cycles and how fast. */
interface Flipbook {
  material: THREE.MeshLambertMaterial
  frames: THREE.Texture[]
  frameMs: number
}

/** Point every flipbook at the frame the clock says. */
function advanceFlipbooks(flipbooks: readonly Flipbook[], elapsedMs: number): void {
  for (const fb of flipbooks) {
    const map = fb.frames[Math.floor(elapsedMs / fb.frameMs) % fb.frames.length] ?? null
    if (fb.material.map === map) continue
    fb.material.map = map
    if (fb.material.emissiveMap) fb.material.emissiveMap = map
    fb.material.needsUpdate = true
  }
}

/** The skeleton as THREE bones in the bind pose, parented as the payload says. */
function buildSkeleton(model: EqModelPayload): THREE.Skeleton {
  const bones = model.bones.map((b) => {
    const bone = new THREE.Bone()
    bone.name = b.name
    bone.position.set(b.t[0], b.t[1], b.t[2])
    bone.quaternion.set(b.q[0], b.q[1], b.q[2], b.q[3])
    return bone
  })
  model.bones.forEach((b, i) => {
    if (b.parent >= 0) bones[b.parent].add(bones[i])
  })
  return new THREE.Skeleton(bones)
}

/** A clip from the payload's tracks: one position + one quaternion track per animated bone. */
function buildClip(clip: EqModelClip, skeleton: THREE.Skeleton): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = []
  const times = Array.from({ length: clip.frames }, (_, f) => (f * clip.frameMs) / 1000)
  for (const [index, track] of Object.entries(clip.tracks)) {
    const bone = skeleton.bones[Number(index)]
    const frames = track.q.length / 4
    if (frames === 0) continue
    // A track shorter than the clip holds its last frame.
    const pad = <T,>(arr: T[], stride: number): T[] => {
      const out = arr.slice()
      while (out.length < clip.frames * stride) out.push(...arr.slice(-stride))
      return out
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, pad(track.t, 3)))
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, pad(track.q, 4)))
  }
  return new THREE.AnimationClip(clip.name, (clip.frames * clip.frameMs) / 1000, tracks)
}

interface MaterialCache {
  loader: THREE.TextureLoader
  cache: Map<string, THREE.MeshLambertMaterial>
  model: EqModelPayload
  built: Built
}

/** The loaded texture for a bitmap name, kept for disposal; null when the payload has no such bitmap. */
function textureFor(mc: MaterialCache, texture: string | null): THREE.Texture | null {
  const url = texture ? mc.model.textures[texture] : undefined
  const map = url ? loadTexture(mc.loader, url) : null
  if (map) mc.built.textures.push(map)
  return map
}

function materialFor(mc: MaterialCache, source: EqModelMaterial | undefined): THREE.MeshLambertMaterial {
  const texture = source?.texture ?? null
  const type = source?.type ?? 1
  const tint = source?.tint
  const key = `${texture ?? '-'}:${String(type)}:${tint ? tint.join(',') : '-'}`
  const hit = mc.cache.get(key)
  if (hit) return hit
  const mat = makeMaterial(textureFor(mc, texture), type, tint)
  mc.cache.set(key, mat)
  mc.built.materials.push(mat)
  if (source?.frames) addFlipbook(mc, mat, source.frames, source.frameMs ?? 100)
  return mat
}

/** Register an animated material's frames, when more than one of them loads. */
function addFlipbook(mc: MaterialCache, material: THREE.MeshLambertMaterial, names: readonly string[], frameMs: number): void {
  const frames: THREE.Texture[] = []
  for (const f of names) {
    const t = textureFor(mc, f)
    if (t) frames.push(t)
  }
  if (frames.length > 1) mc.built.flipbooks.push({ material, frames, frameMs: Math.max(16, frameMs) })
}

/** Geometry for one payload mesh, with skin attributes when it has a bone per vertex. */
function buildGeometry(m: EqModelMesh, mc: MaterialCache): { geo: THREE.BufferGeometry; mats: THREE.Material[] } {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(m.uvs, 2))
  geo.setIndex(m.indices)
  if (m.skinIndices.length > 0) {
    const n = m.skinIndices.length
    const idx = new Uint16Array(n * 4)
    const w = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      idx[i * 4] = m.skinIndices[i]
      w[i * 4] = 1
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4))
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4))
  }
  const mats: THREE.Material[] = []
  m.groups.forEach((g, i) => {
    mats.push(materialFor(mc, m.materials[g.materialIndex]))
    geo.addGroup(g.start, g.count, i)
  })
  mc.built.geometries.push(geo)
  return { geo, mats }
}

/** Build the figure: skinned body meshes on one skeleton, weapons on their bones, the idle playing. */
function buildFigure(model: EqModelPayload): Built {
  const built: Built = { group: new THREE.Group(), geometries: [], materials: [], textures: [], mixer: null, flipbooks: [], turning: [] }
  const mc: MaterialCache = { loader: new THREE.TextureLoader(), cache: new Map(), model, built }
  // The game is Z-up; one rotation puts the whole figure on its feet. Set BEFORE binding so the
  // bind matrices and the bone matrices agree about the frame.
  built.group.rotation.x = -Math.PI / 2
  const skeleton = buildSkeleton(model)
  const root = skeleton.bones[0]
  if (root) built.group.add(root)
  const skinned: THREE.SkinnedMesh[] = []
  for (const m of model.meshes) {
    const { geo, mats } = buildGeometry(m, mc)
    const mesh = new THREE.SkinnedMesh(geo, mats)
    mesh.frustumCulled = false
    built.group.add(mesh)
    skinned.push(mesh)
  }
  // THE BIND, IN ORDER. The vertices arrive already in the bind pose, so the skeleton's inverse
  // bind matrices must be taken from the bones' REAL world matrices in that pose - which exist
  // only after an updateMatrixWorld. Binding with an identity matrix before that update left the
  // inverses at identity and applied every bone's transform a second time: the stretched figure.
  built.group.updateMatrixWorld(true)
  for (const mesh of skinned) mesh.bind(skeleton)
  for (const w of model.weapons) {
    const bone = skeleton.bones.find((b) => b.name.endsWith(`${w.attach}_DAG`))
    if (!bone) continue
    const { geo, mats } = buildGeometry(w.mesh, mc)
    const held = new THREE.Mesh(geo, mats)
    if (!w.mesh.rigged) {
      bone.add(held)
      continue
    }
    // A rigged item turns about its own upright axis (the item frame's z), so it pivots at the hand.
    const pivot = new THREE.Group()
    pivot.add(held)
    bone.add(pivot)
    const glows: THREE.MeshLambertMaterial[] = []
    for (const m of mats) if (m instanceof THREE.MeshLambertMaterial && m.blending === THREE.AdditiveBlending) glows.push(m)
    built.turning.push({ pivot, glows })
  }
  const idle = model.clips[0]
  if (idle && root) {
    built.mixer = new THREE.AnimationMixer(root)
    built.mixer.clipAction(buildClip(idle, skeleton)).play()
  }
  return built
}

function disposeAll(built: Built): void {
  built.mixer?.stopAllAction()
  for (const g of built.geometries) g.dispose()
  for (const m of built.materials) m.dispose()
  for (const t of built.textures) t.dispose()
}

/** Where the orbit camera was left, for the race it was left on. See `CharacterModel3D`. */
interface CameraView {
  actor: string
  pos: THREE.Vector3
  target: THREE.Vector3
}

export function CharacterModel3D({ model, spin }: { model: EqModelPayload; spin: boolean }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  // THE TURNTABLE IS A REF, NOT A DEPENDENCY (owner, "a toggle to stop the model rotating"). The
  // effect below builds and disposes a whole WebGL scene; re-running it to answer a switch would
  // throw the figure away and rebuild it, and the reader's orbit with it. The frame loop reads the
  // ref instead, so OFF simply stops adding to the angle - the model holds exactly where it is and
  // drag and zoom keep working, because those are OrbitControls' and never this line's.
  const spinning = useRef(spin)
  // THE CAMERA SURVIVES A SCENE REBUILD (EQ Zera, item preview). Every wear or hands change is a
  // NEW payload, so this whole effect tears the scene down and builds another - and until now that
  // threw the reader's orbit away with it, which is what made previewing an item feel like the tab
  // had reloaded. The last position is kept per RACE ACTOR: the figure's bounds decide the framing,
  // so a different race legitimately re-frames, while dressing the same one must not move the
  // camera a pixel. It is a ref rather than a module value on purpose - leaving the tab entirely is
  // a fresh look at the character, and that is worth re-framing for.
  const lastView = useRef<CameraView | null>(null)

  useEffect(() => {
    spinning.current = spin
  }, [spin])

  useEffect(() => {
    const el = host.current
    if (!el) return
    const width = el.clientWidth || 260
    const height = 340
    // `preserveDrawingBuffer` IS WHAT MAKES THE FIGURE SHAREABLE — and what it buys is a GUARANTEE,
    // not a fix, which is worth stating precisely because it is easy to measure the wrong thing.
    //
    // WebGL is permitted to clear the drawing buffer after every composite, so `canvas.toDataURL()`
    // on the default renderer is a race against the compositor: it answers real pixels or a fully
    // transparent image depending on when the read lands. This flag removes the race. MEASURED
    // 2026-09-08 against the real install: the snapshot came back with ~70k non-transparent pixels
    // BOTH with the flag and without it — which proves nothing, because the e2e window is never
    // shown (`EQ_E2E=1`) and a window Chromium is not compositing never reaches the clear. The
    // share button is pressed on a VISIBLE window, at an arbitrary moment, and that is the case no
    // harness here can measure. So the flag stays on the guarantee rather than on an observation.
    //
    // It is not free, and the cost is small: the driver keeps one 260x340 buffer per frame on a
    // canvas that is already skinning a mesh at 60 Hz. The alternative — re-rendering into an
    // offscreen target on demand — needs a second camera, a second render target and a second
    // opinion about framing, to answer a question one flag answers.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xe5e9f5, 0x0b0f1a, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 1.4)
    key.position.set(3, 6, 5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 0.8)
    rim.position.set(-4, 2, -5)
    scene.add(rim)

    const built = buildFigure(model)
    const figure = built.group
    scene.add(figure)
    // FRAME AND STAND IT ON THE POSE IT ACTUALLY PLAYS, not on the pose it is stored in. The bind
    // pose is a T shape and every idle stands shorter and narrower than it, so measuring the bind
    // bounds put the ring at a bottom the figure never reaches - which is why animated figures
    // hovered above their own ring. TWO THINGS ARE NEEDED and neither is optional: `mixer.update(0)`
    // applies frame 0 before anything is measured, and the box is taken PRECISELY, because a Box3
    // over a SkinnedMesh reads the geometry's BIND vertices unless it is asked to walk each one
    // through the skin (three's `getVertexPosition`). A figure with no clip has nothing to apply
    // and measures its bind pose, which for it IS the pose it plays.
    built.mixer?.update(0)
    figure.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(figure, true)
    const size = box.getSize(new THREE.Vector3())
    const centre = box.getCenter(new THREE.Vector3())
    figure.position.sub(centre)
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100)
    camera.position.set(0, size.y * 0.1, size.y * 1.9)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enablePan = false
    controls.minDistance = size.y * 0.8
    controls.maxDistance = size.y * 4
    controls.target.set(0, 0, 0)
    // …unless this is the same character wearing something different, in which case the reader's
    // own orbit is restored over the freshly framed default.
    const kept = lastView.current
    if (kept?.actor === model.actor) {
      camera.position.copy(kept.pos)
      controls.target.copy(kept.target)
    }

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(size.x * 0.9, size.x * 0.95, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = -size.y / 2
    scene.add(ring)

    const clock = new THREE.Clock()
    let raf = 0
    let alive = true
    const tick = (): void => {
      if (!alive) return
      const dt = clock.getDelta()
      built.mixer?.update(dt)
      advanceFlipbooks(built.flipbooks, clock.elapsedTime * 1000)
      advanceTurning(built.turning, clock.elapsedTime, dt)
      if (spinning.current) figure.rotation.z += 0.003
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      alive = false
      // FIRST, before anything is disposed: where the reader was looking from.
      lastView.current = { actor: model.actor, pos: camera.position.clone(), target: controls.target.clone() }
      cancelAnimationFrame(raf)
      controls.dispose()
      renderer.dispose()
      disposeAll(built)
      ring.geometry.dispose()
      ring.material.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [model])

  return <div ref={host} data-testid="character-model-3d" style={{ width: '100%', height: 340 }} />
}

/**
 * THE LAST FRAME THE FIGURE DREW, as a PNG data URL — what the share card pins in place of a live
 * scene (features/character/share/).
 *
 * It reads the canvas out of the DOM rather than taking a ref, because the reader of this is a
 * DIALOG and the figure is on the page BEHIND it: there is no props path between them, and adding
 * one would mean the model card holding a snapshot nobody has asked for yet. One query against the
 * testid this component already carries is the whole mechanism.
 *
 * Null is an ordinary answer, not a failure: a machine with no EverQuest install draws the stylised
 * doll and has no canvas at all, and the card says what it can say instead. `preserveDrawingBuffer`
 * (above) is what makes the non-null case reliably return pixels rather than a transparent frame.
 */
export function characterModelSnapshot(): string | null {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="character-model-3d"] canvas')
  if (!canvas) return null
  try {
    return cropToFigure(canvas) ?? canvas.toDataURL('image/png')
  } catch {
    // A tainted or zero-sized canvas throws rather than answering; the card simply has no figure.
    return null
  }
}

/**
 * THE SNAPSHOT IS CROPPED TO THE FIGURE (owner, 2026-09-10: "now the character model is very, very
 * small. it needs to fit the portrait appropriately"). The 3D view is a wide landscape canvas with
 * the figure standing small in its middle; pinned whole into the card's 200px portrait, the figure
 * came out as a sixty-pixel doll under a lot of empty air. The canvas clears to transparent, so the
 * figure's bounds are simply the opaque pixels (ring included): scan the alpha channel, take that
 * box with a small margin, and hand the card only that. The card then scales it to fill the
 * portrait at whatever size it is captured. A frame with nothing drawn answers null and the
 * caller falls back to the whole canvas rather than a zero-sized image.
 */
const CROP_ALPHA_MIN = 8
const CROP_MARGIN = 0.06

function opaqueBounds(data: Uint8ClampedArray, w: number, h: number): [number, number, number, number] | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] <= CROP_ALPHA_MIN) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX, maxY]
}

function cropToFigure(src: HTMLCanvasElement): string | null {
  const w = src.width
  const h = src.height
  if (w === 0 || h === 0) return null
  const probe = document.createElement('canvas')
  probe.width = w
  probe.height = h
  const pctx = probe.getContext('2d')
  if (!pctx) return null
  pctx.drawImage(src, 0, 0)
  const bounds = opaqueBounds(pctx.getImageData(0, 0, w, h).data, w, h)
  if (!bounds) return null
  const [minX, minY, maxX, maxY] = bounds
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * CROP_MARGIN)
  const sx = Math.max(0, minX - pad)
  const sy = Math.max(0, minY - pad)
  const cw = Math.min(w, maxX + pad + 1) - sx
  const ch = Math.min(h, maxY + pad + 1) - sy
  if (cw <= 0 || ch <= 0) return null
  const out = document.createElement('canvas')
  out.width = cw
  out.height = ch
  const octx = out.getContext('2d')
  if (!octx) return null
  octx.drawImage(probe, sx, sy, cw, ch, 0, 0, cw, ch)
  return out.toDataURL('image/png')
}

/**
 * THE LAST FEW DRESSED FIGURES, BY THE EXACT ARGUMENTS THAT PRODUCED THEM (EQ Zera, item preview).
 *
 * Every wear or hands change is an IPC round trip into a five-megabyte archive parse, and a preview
 * is a change you undo: put the sword on, take it off, put it back. Without this, "Back to my gear"
 * re-parses the figure the user was looking at four seconds ago. Keyed on race + the same value
 * `argsKey` the effect is keyed on, so a hit is bit-identical to what the fetch would have answered.
 *
 * CAPPED AT EIGHT, oldest evicted (a `Map` iterates in insertion order and a hit is re-inserted, so
 * the eviction is LRU rather than FIFO). A payload is megabytes; this is a working set for a
 * try-it-on session, not a cache of the corpus. `null` is cached too - a machine with no EverQuest
 * install answers null for every combination and should not be asked twice per toggle.
 */
const PAYLOADS = new Map<string, EqModelPayload | null>()
const PAYLOAD_MAX = 8

function remember(key: string, model: EqModelPayload | null): void {
  PAYLOADS.delete(key)
  PAYLOADS.set(key, model)
  if (PAYLOADS.size <= PAYLOAD_MAX) return
  const oldest = PAYLOADS.keys().next()
  if (!oldest.done) PAYLOADS.delete(oldest.value)
}

/** Fetch the model for a race code, dressed and armed; null while loading or when the game is not installed. */
export function useEqModel(code: string, wear: EqModelWear, hands: EqModelHands): { model: EqModelPayload | null; ready: boolean } {
  // Compared by VALUE: a fresh object per render must not refetch a five-megabyte parse.
  const argsKey = JSON.stringify([wear, hands])
  const key = `${code}|${argsKey}`
  const [state, setState] = useState<{ model: EqModelPayload | null; ready: boolean }>(() =>
    PAYLOADS.has(key) ? { model: PAYLOADS.get(key) ?? null, ready: true } : { model: null, ready: false }
  )
  useEffect(() => {
    if (PAYLOADS.has(key)) {
      // A hit is applied SYNCHRONOUSLY in this effect: there is no loading state to pass through,
      // which is the whole point - the figure does not blink on the way back to your own gear.
      remember(key, PAYLOADS.get(key) ?? null)
      setState({ model: PAYLOADS.get(key) ?? null, ready: true })
      return
    }
    let alive = true
    setState((s) => ({ ...s, ready: false }))
    const [w, h] = JSON.parse(argsKey) as [EqModelWear, EqModelHands]
    void window.eq
      .eqModel(code, w, h)
      .then((model) => {
        remember(key, model)
        if (alive) setState({ model, ready: true })
      })
      .catch(() => {
        remember(key, null)
        if (alive) setState({ model: null, ready: true })
      })
    return () => {
      alive = false
    }
  }, [code, argsKey, key])
  return state
}
