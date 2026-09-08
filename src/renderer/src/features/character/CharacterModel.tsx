// THE CHARACTER MODEL (EQ Zera, 2026-09-06): a paper doll of what you are wearing, drawn from the
// same dump the slot grid reads. shared/characterModel.ts decides what each slot LOOKS like (the
// item or its ornament, the material off the name, the helm toggle); this file only draws it - a
// stylised body in the app's retro line style, each region filled with its armour's material
// colour, the item's icon pinned to the region, and a tooltip naming the piece.

import { type JSX, useMemo, useState } from 'react'
import { Box, FormControlLabel, Paper, Stack, Switch, Tooltip, Typography } from '@mui/material'
import type { SheetCellView } from '@shared/characterSheet'
import {
  MATERIAL_COLOR,
  MATERIAL_LABEL,
  applyPreview,
  handsFromLooks,
  modelLooks,
  wearFromLooks,
  type ModelOptions,
  type ModelSlotId,
  type PreviewLook,
  type SlotLook
} from '../../../../shared/characterModel'
import { PALETTE, withAlpha } from '../../../../shared/palette'
import { itemIconUrl } from '../../lib/ItemWindow'
import { CharacterModel3D, useEqModel } from './CharacterModel3D'
import { ModelPickers, useModelPrefs } from './ModelPickers'
import { actorCode } from './modelPrefs'

const HELM_KEY = 'eq.character.showHelm'
const ORNAMENT_KEY = 'eq.character.ornaments'
/** The turntable. Absent reads as ON, so an upgrade stops nobody's figure turning. */
const ROTATE_KEY = 'eq.character.rotate'

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}
function writeFlag(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch {
    /* storage refused - the toggle still works for this session */
  }
}

/** Skin and hair for the parts armour leaves bare. */
const SKIN = '#c9a27d'
const HAIR = '#3b2a22'

/** One body region: a path, the slot that colours it, and where its icon pins. */
interface Region {
  slot: ModelSlotId
  d: string
  /** icon anchor, in viewBox units */
  x: number
  y: number
  /** what the region is when nothing is worn there */
  bare: string
}

// A 200 x 360 figure. Regions are drawn back-to-front; the order below is the paint order.
const REGIONS: readonly Region[] = [
  { slot: 'back', d: 'M62 96 L138 96 L150 250 L50 250 Z', x: 100, y: 236, bare: 'none' },
  { slot: 'legs', d: 'M70 196 L96 196 L96 292 L72 292 Z M104 196 L130 196 L128 292 L104 292 Z', x: 100, y: 246, bare: SKIN },
  { slot: 'feet', d: 'M66 288 L98 288 L98 312 L60 312 Z M102 288 L134 288 L140 312 L102 312 Z', x: 100, y: 300, bare: SKIN },
  { slot: 'chest', d: 'M68 92 L132 92 L136 190 L64 190 Z', x: 100, y: 134, bare: SKIN },
  { slot: 'waist', d: 'M66 178 L134 178 L134 196 L66 196 Z', x: 100, y: 187, bare: 'none' },
  { slot: 'arms', d: 'M44 100 L66 100 L62 168 L40 168 Z M134 100 L156 100 L160 168 L138 168 Z', x: 46, y: 132, bare: SKIN },
  { slot: 'shoulders', d: 'M40 88 L74 88 L74 108 L40 108 Z M126 88 L160 88 L160 108 L126 108 Z', x: 156, y: 96, bare: 'none' },
  { slot: 'wrist1', d: 'M40 166 L62 166 L60 180 L38 180 Z', x: 36, y: 176, bare: SKIN },
  { slot: 'wrist2', d: 'M138 166 L160 166 L162 180 L140 180 Z', x: 164, y: 176, bare: SKIN },
  { slot: 'hands', d: 'M36 180 L60 180 L58 204 L34 204 Z M140 180 L164 180 L166 204 L142 204 Z', x: 46, y: 198, bare: SKIN },
  { slot: 'neck', d: 'M90 74 L110 74 L110 92 L90 92 Z', x: 100, y: 86, bare: SKIN },
  { slot: 'head', d: 'M100 18 A26 26 0 1 1 99.9 18 Z', x: 100, y: 22, bare: SKIN },
  { slot: 'face', d: 'M82 42 L118 42 L118 56 L82 56 Z', x: 100, y: 52, bare: 'none' }
]

/** The pieces that are not a body region: pinned beside the figure with a small marker. */
const PINS: readonly { slot: ModelSlotId; x: number; y: number }[] = [
  { slot: 'ear1', x: 66, y: 42 },
  { slot: 'ear2', x: 134, y: 42 },
  { slot: 'primary', x: 22, y: 236 },
  { slot: 'secondary', x: 178, y: 236 },
  { slot: 'range', x: 22, y: 292 },
  { slot: 'finger1', x: 30, y: 208 },
  { slot: 'finger2', x: 170, y: 208 }
]

const ICON = 22

function tip(look: SlotLook): string {
  const make = MATERIAL_LABEL[look.material]
  return look.ornamented ? `${look.name} (ornamentation) · ${make}` : `${look.name} · ${make}`
}

function Icon({ look, x, y, previewing }: { look: SlotLook; x: number; y: number; previewing: boolean }): JSX.Element | null {
  if (look.hidden) return null
  // The ornament outline is magenta and stays magenta; a PREVIEW outlines in the app's accent, so
  // the two statements ("this slot wears somebody else's look" / "this slot is not yours yet")
  // never wear the same colour.
  const stroke = previewing ? PALETTE.accent : look.ornamented ? PALETTE.magenta : withAlpha(PALETTE.accent, 0.6)
  return (
    <Tooltip title={tip(look)} placement="right">
      <g transform={`translate(${x - ICON / 2} ${y - ICON / 2})`} data-testid={`character-model-${look.id}`} data-name={look.name}>
        <rect width={ICON} height={ICON} rx={3} fill={PALETTE.paper} stroke={stroke} strokeWidth={previewing ? 2 : 1} />
        {look.iconId !== undefined && (
          <image href={itemIconUrl(look.iconId)} x={2} y={2} width={ICON - 4} height={ICON - 4} style={{ imageRendering: 'pixelated' }} />
        )}
      </g>
    </Tooltip>
  )
}

function Figure({ looks, previewSlot }: { looks: Map<ModelSlotId, SlotLook>; previewSlot?: ModelSlotId }): JSX.Element {
  const regionFill = (r: Region): string => {
    const look = looks.get(r.slot)
    if (!look || look.hidden) return r.bare
    return MATERIAL_COLOR[look.material]
  }
  return (
    <svg viewBox="0 0 200 330" width="100%" style={{ maxWidth: 260, display: 'block', margin: '0 auto' }} role="img" aria-label="Your character">
      {/* The ground grid the figure stands on. */}
      <line x1="30" y1="314" x2="170" y2="314" stroke={withAlpha(PALETTE.accent, 0.5)} strokeWidth="1.5" />
      {REGIONS.map((r) => (
        <path key={r.slot} d={r.d} fill={regionFill(r)} stroke={r.slot === previewSlot ? PALETTE.accent : withAlpha(PALETTE.accent, 0.55)} strokeWidth={r.slot === previewSlot ? 2.6 : 1.4} strokeLinejoin="round" data-testid={`character-region-${r.slot}`} data-material={looks.get(r.slot)?.hidden ? 'bare' : (looks.get(r.slot)?.material ?? 'bare')} />
      ))}
      {/* Hair shows when the head is bare - the helm-off look. */}
      {!looks.get('head') || looks.get('head')?.hidden ? <path d="M76 30 A26 26 0 0 1 124 30 L120 22 A24 24 0 0 0 80 22 Z" fill={HAIR} /> : null}
      {/* The face: two eyes, unless a face piece covers them. */}
      {!looks.get('face') && (
        <>
          <circle cx="91" cy="50" r="2" fill={PALETTE.bg} />
          <circle cx="109" cy="50" r="2" fill={PALETTE.bg} />
        </>
      )}
      {REGIONS.map((r) => {
        const look = looks.get(r.slot)
        return look ? <Icon key={`i-${r.slot}`} look={look} x={r.x} y={r.y} previewing={r.slot === previewSlot} /> : null
      })}
      {PINS.map((p) => {
        const look = looks.get(p.slot)
        return look ? <Icon key={`p-${p.slot}`} look={look} x={p.x} y={p.y} previewing={p.slot === previewSlot} /> : null
      })}
    </svg>
  )
}

/**
 * The game's model when the install is there; the stylised doll otherwise.
 *
 * THE FACE RIDES INSIDE THE WEAR, merged over what the sheet decided. That is deliberate: the
 * `useEqModel` cache key is the wear and the hands by value, so a face change is a new payload
 * exactly like a new breastplate is - and the camera, which is kept per ACTOR, holds still through
 * it. Changing race or sex changes the actor and re-frames the figure, which is the right answer
 * for a different body.
 */
function ModelOrDoll({ looks, previewSlot, spin }: { looks: Map<ModelSlotId, SlotLook>; previewSlot?: ModelSlotId; spin: boolean }): JSX.Element {
  const prefs = useModelPrefs()
  const worn = useMemo(() => wearFromLooks(looks), [looks])
  const wear = useMemo(() => (prefs.face === undefined ? worn : { ...worn, face: prefs.face }), [worn, prefs.face])
  const hands = useMemo(() => handsFromLooks(looks), [looks])
  const { model, ready } = useEqModel(actorCode(prefs.race, prefs.sex), wear, hands)
  return (
    <>
      {model ? <CharacterModel3D model={model} spin={spin} /> : ready ? <Figure looks={looks} previewSlot={previewSlot} /> : <Box sx={{ height: 340 }} />}
      <ModelPickers prefs={prefs} faces={model?.faces} defaultFace={model?.defaultFace} />
      {ready && !model && (
        <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
          The game's model files were not found under the configured EverQuest folder, so this is the stylised figure.
        </Typography>
      )}
    </>
  )
}

export default function CharacterModel({
  cells,
  preview
}: {
  cells: readonly SheetCellView[]
  /**
   * ONE CELL OVERRIDDEN, and it happens BEFORE anything here reads a look (shared/characterModel.ts
   * `applyPreview`). Every resolver below - the material, the texture variant, the dye, the held
   * model - is the one the dump's own cells go through, so a preview cannot grow a second opinion
   * about what an item looks like. Null ⇒ the cells by identity, so the memo below does not move.
   */
  preview: PreviewLook | null
}): JSX.Element {
  const [showHelm, setShowHelm] = useState(() => readFlag(HELM_KEY, true))
  const [showOrnaments, setShowOrnaments] = useState(() => readFlag(ORNAMENT_KEY, true))
  const [rotate, setRotate] = useState(() => readFlag(ROTATE_KEY, true))
  const opts: ModelOptions = useMemo(() => ({ showHelm, showOrnaments }), [showHelm, showOrnaments])
  const shown = useMemo(() => applyPreview(cells, preview), [cells, preview])
  const looks = useMemo(() => modelLooks(shown, opts), [shown, opts])
  let ornamentCount = 0
  for (const look of looks.values()) if (look.ornamented) ornamentCount++

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.25, width: { xs: '100%', lg: 300 }, flexShrink: 0 }}
      data-testid="character-model"
      {...(preview ? { 'data-preview-slot': preview.slot } : {})}
    >
      <Typography variant="caption" className="eq-display-label eq-card-rule" sx={{ display: 'block', color: 'text.secondary', pb: 0.5, mb: 0.75 }}>
        Your character
      </Typography>
      <ModelOrDoll looks={looks} previewSlot={preview?.slot} spin={rotate} />
      <Stack spacing={0} sx={{ mt: 0.5 }}>
        <FormControlLabel
          control={<Switch size="small" checked={showHelm} onChange={(e) => { setShowHelm(e.target.checked); writeFlag(HELM_KEY, e.target.checked) }} data-testid="character-model-helm" />}
          label={<Typography variant="caption">Show helmet</Typography>}
        />
        <FormControlLabel
          control={<Switch size="small" checked={showOrnaments} onChange={(e) => { setShowOrnaments(e.target.checked); writeFlag(ORNAMENT_KEY, e.target.checked) }} data-testid="character-model-ornaments" />}
          label={<Typography variant="caption">Show ornamentations{ornamentCount > 0 ? ` · ${String(ornamentCount)} worn` : ''}</Typography>}
        />
        <FormControlLabel
          control={<Switch size="small" checked={rotate} onChange={(e) => { setRotate(e.target.checked); writeFlag(ROTATE_KEY, e.target.checked) }} data-testid="character-model-rotate" />}
          label={<Typography variant="caption">Rotate</Typography>}
        />
      </Stack>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
        {(['plate', 'chain', 'leather', 'cloth'] as const).map((m) => (
          <Typography key={m} variant="caption" color="text.disabled" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: MATERIAL_COLOR[m], display: 'inline-block' }} />
            {m}
          </Typography>
        ))}
      </Box>
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5 }}>
        Armour, dye and weapon models come from the game's own item table and files; the name decides the material when the table does not know an item. Ornamented slots are outlined in magenta.
      </Typography>
    </Paper>
  )
}
