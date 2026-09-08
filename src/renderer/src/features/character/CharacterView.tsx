// character/CharacterView — the Magelo-style character sheet (JOS-45), released in JOS-327.
//
// Identity across the top, the armory slot grid on the left, what the gear adds up to on the
// right, and — since JOS-327 — the whole rest of the dump underneath: every bag slot, every bank
// slot, every key ring, searchable. Everything on this tab comes from two places and says which:
// the log (name, level, class loadout) and the newest `/outputfile inventory` dump.
//
// IT WAS UNRELEASED, AND THIS PARAGRAPH IS THE LAW IT LIVED UNDER, KEPT ON PURPOSE. From JOS-45
// (owner, 2026-08-06) this whole tree sat behind the compile-time `UNRELEASED` flag: reachable in
// a dev build, STRIPPED from every packaged build, pending the owner's review — and it was stated
// that it would graduate by DELETING its gate rather than by flipping a setting. That is exactly
// what happened on 2026-08-13: `unreleasedCharacter.tsx` deleted, the `KNOWN_VIEWS` splice made
// unconditional, the main-side handler registered like any other. The flag machinery survives with
// no tenant (src/renderer/src/devFlags.ts, src/main/unreleased.ts) because the arrangement is worth
// more than this one use of it. Nothing about the gate is left in this file but its history.
//
// WHAT THIS TAB DOES NOT SHOW, AND WHY THERE IS NO PANEL APOLOGISING FOR IT: your real AC, HP,
// mana, resists and AA. The JOS-45 spike read the shipped client's own string table — no
// `/outputfile` variant exports character stats, and no AA export exists at all. So there is no
// empty "AA" card here to explain a permanent absence; the sheet shows what can be known and
// the gear panel names its own scope in its heading.
//
// AND THE TOTALS READ EACH ITEM AT ITS ` +N` (owner ruling, JOS-416, 2026-08-19 — reversing
// JOS-327's "keep character totals base initially"). The gear panel used to sum the item pages'
// BASE blocks while the rest of the app — the Gear tab's comparison, the wish list, every hover
// delta — already scaled the same worn item by the same suffix, so this tab was the one surface
// answering a different number for the same cloak. It now goes through `shared/itemUpgrade.ts
// scaleStatBlock`, the same algorithm, for EVERY stat that algorithm scales; the caption that used
// to say `base` says `with +N`, so the panel's meaning moved on purpose and out loud rather than
// silently. The per-item ` +N` is still visible where the dump spelled it, on the item's own name
// in the slot grid and in the carry-all ledger.
//
// ---------------------------------------------------------------------------
// THE LAYOUT: A SHEET ON TOP, A LEDGER UNDERNEATH, AND A MEASURED REASON THE PAGE SCROLLS
// ---------------------------------------------------------------------------
// MEASURED at the default window (1280x860, windowState.ts): identity + freshness line + the slot
// grid + the gear panel come to about 656px of the ~740px content area. The sheet is not a growing
// list — it is twenty-four cells and it is that tall on every character — so a ledger sharing the
// remaining height with `flexGrow` alone got EIGHTY-FIVE PIXELS, which is one row and a scrollbar.
// That is a worse surface than the one this ticket set out to build, so this tab is a naturally
// tall page: the root asks for `minHeight: 100%` rather than `height: 100%`, and `CarryAll` takes a
// FLOOR (`minHeight`) plus `flexGrow`, so it fills a tall window and still gets a usable box on a
// short one. The app shell scrolls the difference.
//
// THE GROWING-LIST LAW IS KEPT, AND KEPT WHERE IT MATTERS. What that law protects against is a page
// whose height is a function of the DATA — an append-only panel that squeezes its siblings to 0px
// as it fills. Nothing here does: the ledger is windowed inside its own `overflow: auto` box at a
// height that does not know how many rows exist, so a character with thirty things and a character
// with three hundred produce a page of exactly the same height. `tests/e2e/character-sheet.e2e.mts`
// asserts that identity directly (search the ledger down to four rows; the page must not move) and
// separately asserts that the WINDOW itself never scrolls, which is the half of the law that has no
// carve-outs anywhere.

import { type JSX, useEffect, useRef, useState } from 'react'
import { Box, Button, Paper, Stack, Typography } from '@mui/material'
import { SHEET_SLOTS, type CharacterSheet, type SheetCellView } from '@shared/characterSheet'
import { INVISIBLE_MODEL_SLOTS, applyPreview, type PreviewLook } from '../../../../shared/characterModel'
import { PALETTE } from '../../../../shared/palette'
// The `/outputfile` registry (JOS-44) owns the command string and — since JOS-185 — the steps
// that make the dump complete. This tab never re-types either of them.
import { outputKind } from '@shared/outputs/kinds'
import OutputFileLine from '../../components/OutputFileLine'
import CarryAll from './CarryAll'
import CharacterIdentity from './CharacterIdentity'
import CharacterModel from './CharacterModel'
import FactionPanel from './FactionPanel'
import SkillsPanel from './SkillsPanel'
import GearStats from './GearStats'
import SlotGrid from './SlotGrid'
import { useCharacterSheet } from './useCharacterSheet'
import { usePreviewLook, type PreviewState } from './usePreviewLook'
// SHARING (EQ Zera). Both dialogs mount ONLY while they are open, which is what makes it
// acceptable for the Share one to call `useBuild()` - see useCharacterShare.ts's header.
import ShareDialog from './share/ShareDialog'
import ViewSharedProfile from './share/ViewSharedProfile'

/** The dump this tab is fed by, as the registry states it. */
const INVENTORY = outputKind('inventory')

/**
 * The one card that teaches the dump, shown only while there is no dump to read — the same
 * collaborative explainer the Planner's Inventory tab uses, because it is the same command and
 * the same live fill (main watches the install root for the FIRST dump to appear, not just for
 * later rewrites).
 */
function InstructionsCard(): JSX.Element {
  return (
    <Paper variant="outlined" data-testid="character-sheet-help" sx={{ p: 1.5 }}>
      <Stack spacing={0.5}>
        <Typography variant="subtitle2">Fill this in from the game</Typography>
        <Typography variant="body2" color="text.secondary">
          Type <b>/outputfile inventory</b> in EverQuest. Every slot below fills with what you are
          wearing, straight away - leave this tab open and watch it happen.
        </Typography>
      </Stack>
    </Paper>
  )
}

/** Equipped rows the grid has no cell for. Never seen in a real dump; drawn if one ever appears. */
function Unplaced({ cells }: { cells: SheetCellView[] }): JSX.Element | null {
  if (cells.length === 0) return null
  return (
    <Paper variant="outlined" sx={{ p: 1 }} data-testid="character-unplaced">
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Also equipped
      </Typography>
      <SlotGrid cells={cells} />
    </Paper>
  )
}

// ---------------------------------------------------------------------------
// PREVIEWING AN ITEM ON THE MODEL (EQ Zera)
// ---------------------------------------------------------------------------
// An item page anywhere in the app can ask this tab to draw its item on the character in the slot
// it belongs in (`AppRouting.openCharacter`). Nothing is written: the preview is one cell of the
// sheet overridden in memory (`applyPreview`), the dump is untouched, and there is always a way
// back on screen.
//
// AND THE BANNER SAYS WHAT THE GAME'S FILES CAN ACTUALLY SHOW, in one line, because the honest
// answer differs by slot and a reader who is not told will read the difference as a bug. Classic
// armour is a texture VARIANT per body part plus a dye, so a breastplate previews as its material
// and its colour and not as a unique mesh; a helm and a held item are real models; and ten of the
// twenty model slots - every ring, ear, the neck, the back, the shoulders, the face, the waist and
// the range slot - draw NOTHING on the character at all in this client. That last case is the one
// the caption exists for: without it, previewing a ring looks like a broken feature.

/** The slot's own name, as the sheet's grid spells it ("Chest", "Fingers"). */
function slotLabel(slot: string): string {
  return SHEET_SLOTS.find((s) => s.id === slot)?.label ?? slot
}

/** The slots that draw as a texture variant plus a dye rather than as their own mesh. */
const ARMOUR_SLOTS: readonly string[] = ['chest', 'arms', 'wrist1', 'wrist2', 'hands', 'legs', 'feet']

/**
 * THE ONE CAPTION, chosen by what this preview actually is. Empty means the preview needs no
 * sentence - the model is showing the item and there is nothing to admit to.
 */
function previewCaption(preview: PreviewLook): string {
  if (INVISIBLE_MODEL_SLOTS.includes(preview.slot)) {
    return 'This slot has no look in the game files - the model is unchanged.'
  }
  if (preview.looks !== undefined && preview.looks > 1) {
    return `The item table lists ${String(preview.looks)} looks for this name - showing one.`
  }
  if (ARMOUR_SLOTS.includes(preview.slot) && preview.model === undefined && preview.materialCode === undefined) {
    return 'Armour draws as its material and dye; the name decides the material.'
  }
  return ''
}

/** What the banner says when the gear index has no equip slot for this name at all. */
function unwearableLine(item: string): string {
  return `${item} is not something the model can wear.`
}

function PreviewBanner({
  item,
  preview,
  state,
  onClear
}: {
  item: string
  preview: PreviewLook | null
  state: PreviewState
  onClear: () => void
}): JSX.Element {
  const headline = preview ? `Previewing ${item} in ${slotLabel(preview.slot)}` : state === 'unwearable' ? unwearableLine(item) : `Previewing ${item}`
  const caption = preview ? previewCaption(preview) : ''
  return (
    <Paper variant="outlined" data-testid="character-preview" sx={{ p: 1, borderColor: PALETTE.accent, flexShrink: 0 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ minWidth: 0 }}>
          {headline}
        </Typography>
        <Box sx={{ flexGrow: 1, minWidth: 8 }} />
        <Button size="small" variant="outlined" data-testid="character-preview-clear" onClick={onClear}>
          Back to my gear
        </Button>
      </Stack>
      {caption !== '' && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {caption}
        </Typography>
      )}
    </Paper>
  )
}

/**
 * THE SHEET PROPER: the model, the armory grid, and what the gear adds up to.
 *
 * Its own component so `CharacterView` stays inside the measured complexity ceiling, and because
 * one rule reads better stated once here than spread across three conditionals: THE MODEL DRAWS
 * FOR A PREVIEW EVEN WITH NO DUMP AT ALL. `applyPreview` appends the cell when the sheet has none,
 * so someone who has never typed the command can still see what a sword looks like on their race;
 * the grid and the totals still need a dump, because they describe one.
 */
function SheetBody({ sheet, preview }: { sheet: CharacterSheet | null; preview: PreviewLook | null }): JSX.Element | null {
  if (sheet === null && preview === null) return null
  const worn = sheet?.cells ?? []
  return (
    <Stack
      direction={{ xs: 'column', lg: 'row' }}
      spacing={1}
      alignItems="flex-start"
      sx={{ minWidth: 0, flexShrink: 0 }}
      data-testid="character-sheet"
    >
      {/* THE MODEL (EQ Zera): the paper doll, first, reading the same cells the grid does. */}
      <CharacterModel cells={worn} preview={preview} />
      {sheet && (
        <>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <SlotGrid cells={applyPreview(worn, preview)} previewSlot={preview?.slot} />
          </Box>
          <Stack spacing={1} sx={{ width: { xs: '100%', lg: 340 }, flexShrink: 0 }}>
            <GearStats totals={sheet.totals} />
            <Unplaced cells={sheet.unplaced} />
          </Stack>
        </>
      )}
    </Stack>
  )
}

/**
 * THE TWO WAYS IN AND OUT OF A SHARE, one row, above the sheet they describe.
 *
 * Share is disabled without a dump for the honest reason: a share card IS the dump, and a button
 * that opened an empty card would be teaching the wrong thing about what the feature reads. The
 * viewer is never disabled - reading somebody else's character has nothing to do with having typed
 * `/outputfile` yourself, and it is the half of this feature a brand new reader meets first.
 */
function ShareBar({ hasSheet }: { hasSheet: boolean }): JSX.Element {
  const [sharing, setSharing] = useState(false)
  const [viewing, setViewing] = useState(false)
  return (
    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }} data-testid="character-share-bar">
      <Button
        size="small"
        variant="outlined"
        data-testid="character-share"
        disabled={!hasSheet}
        onClick={() => {
          setSharing(true)
        }}
      >
        Share
      </Button>
      <Button
        size="small"
        variant="text"
        data-testid="character-share-view"
        onClick={() => {
          setViewing(true)
        }}
      >
        View a shared profile
      </Button>
      {sharing && (
        <ShareDialog
          onClose={() => {
            setSharing(false)
          }}
        />
      )}
      {viewing && (
        <ViewSharedProfile
          onClose={() => {
            setViewing(false)
          }}
        />
      )}
    </Stack>
  )
}

export interface CharacterViewProps {
  /** The item a deep link asked to see on the model, or null for the sheet as the dump wrote it. */
  previewItem: string | null
  /**
   * The nonce is what makes asking twice arrive twice, AND what makes asking once arrive at all:
   * this view unmounts on every tab switch, so the request has to be read on MOUNT as well as on
   * a change. A `lastNonce` ref covers both with one rule.
   */
  previewNonce: number
  /** Told the moment the request is taken up, so the router drops it and a later plain visit to
   *  this tab shows the sheet rather than whatever the last link pointed at. */
  onPreviewApplied: () => void
}

export default function CharacterView({ previewItem, previewNonce, onPreviewApplied }: CharacterViewProps): JSX.Element {
  const { sheet, ready } = useCharacterSheet()
  // THE REQUEST, TAKEN UP AS LOCAL STATE. It has to live here rather than being read off the prop:
  // the router retires the payload the instant it is applied (so a stale one cannot re-fire), and
  // "Back to my gear" is this view's own decision, not a navigation.
  const [previewing, setPreviewing] = useState<string | null>(null)
  const lastNonce = useRef<number | null>(null)
  useEffect(() => {
    if (lastNonce.current === previewNonce) return
    lastNonce.current = previewNonce
    setPreviewing(previewItem)
    if (previewItem !== null) onPreviewApplied()
  }, [previewNonce, previewItem, onPreviewApplied])
  const { preview, state } = usePreviewLook(previewing)

  return (
    // `minHeight` rather than `height` — see the layout note in the header. It still FILLS the
    // content box (so the ledger's `flexGrow` has something to grow into on a tall window) and it no
    // longer CLAMPS it, so a short window scrolls the page instead of crushing the one panel below
    // the fold to nothing.
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minHeight: '100%', p: 0.5 }}>
      <CharacterIdentity />

      {/* SHARING (EQ Zera), directly under the identity it is about to put on a card. */}
      <ShareBar hasSheet={sheet !== null} />

      {/* Only once the read has settled: a card that flashes before the dump loads would teach
          a command to someone who already ran it. */}
      {ready && sheet === null && <InstructionsCard />}
      {/* …and once a dump EXISTS, the shared freshness line (JOS-42's OutputFileLine, whose
          header asked the second `/outputfile` surface to adopt it rather than grow a second
          dialect). It is the case the card cannot cover: every slot below renders with total
          confidence whether the dump is a minute or a month old, and the file's own mtime is
          the difference between reading your gear and reading a memory of it. */}
      {sheet && (
        <OutputFileLine
          command={INVENTORY.command}
          why="Re-type it in game whenever your gear changes - this sheet follows the dump."
          updatedAt={sheet.loadedAt}
          steps={INVENTORY.steps}
          testId="character-outputfile"
        />
      )}

      {/* THE PREVIEW BANNER sits directly above the model card it is talking about, and it is the
          ONE affordance out of a preview - see the section header above for what its caption says
          and why the invisible slots need it most. */}
      {previewing !== null && (
        <PreviewBanner item={previewing} preview={preview} state={state} onClear={() => setPreviewing(null)} />
      )}

      <SheetBody sheet={sheet} preview={preview} />

      {/* …and the rest of the same dump (JOS-327). It is the one panel here that GROWS with what
          the player owns, so it is the one that takes the leftover height and scrolls inside
          itself; everything above is `flexShrink: 0` and sizes to its content. */}
      {sheet && <CarryAll carry={sheet.carry} />}

      {/* THE TWO TRACKERS (EQ Zera, ROADMAP items 9 and 10). They belong on this tab and not on
          Leveling because they describe WHAT YOU ARE rather than how fast you are getting there:
          who you have made angry, and what the client says your skills are worth. Unlike everything
          above them they are fed by the LOG rather than by a `/outputfile` dump, so they render
          with no dump at all - which is why they sit outside the `sheet &&` gate. Both are bounded
          internally (an explicit-height scroll box each), so this pair adds a FIXED amount to the
          page whatever the log holds. */}
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} sx={{ minWidth: 0, flexShrink: 0 }}>
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <FactionPanel />
        </Box>
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <SkillsPanel />
        </Box>
      </Stack>
    </Box>
  )
}
