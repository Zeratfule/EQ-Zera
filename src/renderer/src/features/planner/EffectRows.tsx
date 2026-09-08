// planner/EffectRows.tsx — THE TWO ROWS THE EFFECT BROWSER DRAWS: a group header, and a donor.
//
// Split out of `EffectBrowser.tsx` when JOS-42's readability work pushed that file past the
// measured 400-code-line ceiling, and this is the seam the ceiling was pointing at — the same one
// PlanCell was split from PlanBoard on. The browser owns the PIPELINE (fetch, filter, group,
// window) and the shell; this file owns what one row of that pipeline looks like. Both rows are
// exactly `ROW_HEIGHT` tall, because `useWindowedRows` is a fixed-row-height hook and a header is
// a ROW rather than a container (EffectBrowser's own header explains why that shape exists).
//
// A ROW IS A COMPACT BAR, and the flexWrap law governs it (AGENTS.md): `nowrap`, controls that
// never shrink, and world-supplied text in shrinkable ellipsizing groups. `SHRINK` is the whole of
// the arbitration between those groups, and it is half of the JOS-42 fix — the other half is the
// one-liner moving up to the header, which is `plannerGroups.says` and arrives here as a flag.
//
// AND SINCE JOS-344 THE DONOR NAME HAS ITS HOVER CARD BACK — the same one, this time (owner report
// 2026-08-13: *item mouseover on the exalt links too*). `PlannerChips.DonorName`'s own comment has
// recorded for a year that a native `title` is "the one thing the removed card did that nothing
// else on the row does"; what mounts here now is not that removed card but the GEAR tab's
// comparison PAIR — the donor item on the left, what you are wearing in its slots on the right —
// because a donor IS an item and the equipped half applies to it unchanged. One door
// (`GearCompareCard.tsx`'s `GearRowCompare`), one set of guarantees, two surfaces.

import { type JSX } from 'react'
import { Box, Chip, IconButton, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import type { ClassAbbr } from '@shared/classCombo'
import { effectOneLiner } from '@shared/planner/effectText'
import { extractionTier } from '@shared/planner/rules'
import { itemIconUrl } from '../../lib/ItemWindow'
import { Tooltip } from '../../lib/Tooltip'
// JOS-344 — the ONE door a compare card may reach any surface through. Its header states the three
// guarantees (never upward, no pointer events, gone on pointerdown) and the measured geometry that
// made the anchoring law what it is.
import { GearRowCompare } from '../gear/GearCompareCard'
import type { GearCompareData } from '../gear/gearData'
import { classFit, isNonEquippable, type DonorRow } from './plannerData'
import { SOCKET_LABEL, type DonorGroup } from './plannerGroups'
import { BestChip, DonorName, EraChip, NoSlotChip } from './PlannerChips'
import { sourcesFor } from './sourceIndex'
// JOS-343 — the one control both this row and the gear search row draw. It used to be a local
// `AddButton` here and a heart over there; the owner ruled them into one on 2026-08-13.
import WishToggle from '../wishlist/WishToggle'

/** Every row in the list is this tall — the windowing hook's whole contract. */
export const ROW_HEIGHT = 44
/** How many class chips fit on a dense row before the rest collapse into "+N". */
const CLASS_CHIP_CAP = 6

/**
 * HOW A ROW GIVES WIDTH BACK, IN ONE PLACE (JOS-42 refinement 2).
 *
 * `flex-shrink` is WEIGHTED BY BASE WIDTH, so these are ratios rather than an order: the source
 * line and the effect's one-liner (each ~300px base × 30) absorb the deficit long before the donor
 * NAME (×3) gives up a pixel. That is the owner's rule — the names have ellipsis priority over the
 * source text, not the other way round.
 *
 * THE EFFECT NAME IS THE ONE GROUP THAT DOES NOT SHRINK AT ALL, and it took a measurement to earn
 * that. Ratios alone were not enough: a weight of 1 against 30 still hands the effect ~1.4% of any
 * deficit, and the e2e caught "Percussion Resonance 14" clipped by those few pixels on the one
 * focus family in the whole corpus whose ranks disagree — so its rows keep their own one-liner and
 * the row is at its most crowded. `flexShrink: 0` is what makes "the effect name always reads" a
 * property rather than a tendency. It is BOUNDED by `EFFECT_MAX_WIDTH` so a pathological corpus
 * entry cannot push the row's controls off the end: past that it ellipsizes like anything else,
 * and the compact-bar contract (nowrap PLUS shrinkable groups) still holds through the other three.
 */
const SHRINK = { name: 3, says: 30, source: 30 }
/** Enough for every effect name the corpus states; a cap, not a size. */
const EFFECT_MAX_WIDTH = '34%'

// ---- one donor's source line ---------------------------------------------------------

interface SourceText {
  text: string
  /** "+3 more" when the catalog knows other mobs; empty when it doesn't */
  more: string
}

/**
 * What the catalog knows about where this donor comes from, in one line. The FIRST source plus a
 * count — a 40-mob drop list belongs in Farm mode, not on a dense row.
 */
function sourceText(donor: DonorRow): SourceText {
  const sources = sourcesFor(donor.key)
  const first = sources[0]
  if (first) {
    const zone = first.zones[0] ?? 'zone unstated'
    return { text: `${first.mob} - ${zone}`, more: sources.length > 1 ? `+${String(sources.length - 1)} more` : '' }
  }
  if (donor.quest) return { text: 'quest reward', more: '' }
  if (donor.playerCrafted) return { text: 'player crafted', more: '' }
  return { text: 'no known source', more: '' }
}

// ---- one donor row -------------------------------------------------------------------

function ClassChips({ donor, planClasses }: { donor: DonorRow; planClasses: readonly ClassAbbr[] }): JSX.Element {
  const fit = classFit(donor, planClasses)
  if (fit === 'unknown') {
    return <Chip size="small" variant="outlined" label="class unknown" sx={{ height: 18, fontSize: 10 }} />
  }
  const lit = donor.classes.filter((c) => planClasses.includes(c))
  const rest = donor.classes.filter((c) => !planClasses.includes(c))
  const shown = [...lit, ...rest].slice(0, CLASS_CHIP_CAP)
  return (
    <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
      {shown.map((c) => (
        <Chip
          key={c}
          size="small"
          label={c}
          color={lit.includes(c) ? 'primary' : 'default'}
          variant={lit.includes(c) ? 'filled' : 'outlined'}
          sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }}
        />
      ))}
      {donor.classes.length > CLASS_CHIP_CAP && (
        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
          +{donor.classes.length - CLASS_CHIP_CAP}
        </Typography>
      )}
    </Stack>
  )
}

export interface DonorLineProps {
  donor: DonorRow
  planClasses: readonly ClassAbbr[]
  /** this donor is already on the wish list (JOS-326 — it used to mean "already in the set") */
  wished: boolean
  /** V5 — this row holds the top tier of its focus family among the rows that survived the filters */
  best: boolean
  /** the header above does not name this row's effect (any axis but `effect`), so the row does */
  namesEffect: boolean
  /** the header above did not take this effect's one-liner, so the row still carries it (JOS-42) */
  namesSays: boolean
  /**
   * PUT THIS DONOR ON THE WISH LIST, OR TAKE IT OFF (JOS-343). It was `onAdd` until the owner
   * overruled the one-way version on 2026-08-13; the host reads `wished` back out of the argument
   * so the handler can stay a stable callback and this row's `memo`-shaped neighbours with it.
   *
   * ABSENT — NOT DISABLED — UNTIL THE WISH DOCUMENT HAS LOADED, which is the gear table's rule
   * (JOS-335, `GearTableProps.onToggleWish`) arriving here because JOS-343 gave this row the same
   * reason to need it. A one-way add could survive drawing itself unadded over an item that was
   * already on the list: the click was an add either way and `addWish` deduped it. A TOGGLE cannot
   * — an unadded reading taken off an empty default sends the click the WRONG DIRECTION. The e2e
   * caught exactly that (planner.e2e.mts, JOS-343's first run: a remounted browse offered an
   * unadded control for a donor that was on the list, and the click removed it).
   */
  onToggleWish?: (donor: DonorRow, wished: boolean) => void
  /** deep-link this donor into the Loot drill-down; absent when the app wired no router */
  onOpenLoot?: (item: string) => void
  /**
   * WHAT A HOVERED DONOR NAME IS COMPARED AGAINST (JOS-344) — the same seam the Gear tab's rows
   * use (`useGearCompare`): the equipped-by-cell index, the corpus by key, and when the dump was
   * exported. ABSENT MEANS NO CARD, which is the house rule `onOpenLoot` states one prop up: a
   * host that cannot answer "what are you wearing" should draw no card rather than one whose
   * equipped half is a permanent blank.
   */
  compare?: GearCompareData
}

/**
 * ADD TO THE WISH LIST — AND, SINCE JOS-343, TAKE IT BACK OFF.
 *
 * THIS BUTTON USED TO WRITE A SOCKET, and everything complicated about it came from that. It said
 * "Add to set"; it could open a slot menu when the donor fit more than one cell; and when the
 * target socket was occupied it turned into a warning-coloured "Replace" naming the effect it was
 * about to overwrite (JOS-42 refinement 3). All three were consequences of the plan board, which
 * JOS-326 removed: there are no cells, so there is nothing to disambiguate, and a wish list DEDUPES
 * rather than displaces, so there is nothing to overwrite.
 *
 * "AN ALREADY-WISHED DONOR STAYS DISABLED" WAS THE RULE HERE UNTIL 2026-08-13, AND THE OWNER
 * OVERRULED IT. The argument had been that a click which changes nothing should be refused rather
 * than swallowed — true of an ADD, and the mistake was assuming the second click had to be an add.
 * It is a REMOVE now: the same `useWishlist.remove` → `removeWish` fold the Wish list tab's own
 * per-row remove calls, so there is one deletion in the app and no second shape of it. The row
 * still wears the `wished` chip; the button now states what a click would DO about it.
 *
 * SLOTLESS DONORS STAY DISABLED for the reason they always were — R2 says an effect can only move
 * into an item sharing its equipment slot, so a donor with none can never donate, and the row is
 * chipped `no slot` beside this button saying why. That is the one remaining disabled case, and it
 * is about the CORPUS rather than about the document.
 *
 * THE CONTROL ITSELF LIVES IN `wishlist/WishToggle.tsx` NOW, shared byte-for-byte with the gear
 * search row's — the owner's parity ruling, made unbreakable by there being one component.
 */
function AddButton({
  donor,
  wished,
  onToggleWish
}: Pick<DonorLineProps, 'donor' | 'wished'> & {
  onToggleWish: (donor: DonorRow, wished: boolean) => void
}): JSX.Element {
  return (
    <WishToggle
      testId="planner-add"
      name={donor.name}
      wished={wished}
      disabled={donor.slots.length === 0}
      onToggle={() => onToggleWish(donor, wished)}
    />
  )
}

/**
 * THE DONOR'S NAME, WITH THE COMPARISON PAIR BEHIND IT (JOS-344).
 *
 * THREE THINGS DECIDED HERE, and each is a refusal rather than a feature:
 *
 * 1. NO GEAR ROW, NO CARD. The gear index only carries EQUIPPABLE pages (`gearIndex.ts` drops a
 *    slotless one), and this browser deliberately shows slotless donors under an escape toggle —
 *    chipped `no slot`, because R2 says their effect can never move. A donor the corpus has no
 *    vector for gets the plain name it has always had, never an empty card.
 *
 * 2. THE ANCHOR IS A PLAIN `<span>` AROUND THE NAME, not `DonorName` itself. MUI's Tooltip needs a
 *    ref on its child and the shared `Tooltip` clones a className onto it; `DonorName` is a
 *    function component that forwards neither, and teaching it to would change a component three
 *    other surfaces draw. An inline span inside an already-`noWrap` Typography is layout-neutral —
 *    the compact-bar contract at the top of this file is untouched — and its box IS the name's box,
 *    which is the corner the pair opens from.
 *
 * 3. IT IS THE SAME `row.key`. `DonorRow.key` and `GearRow.key` are both `itemKey(name)`, so the
 *    join is one `Map.get` per rendered row and there is nothing to normalise (the standing rule
 *    every index in this app is built on).
 */
/**
 * WHERE THIS DONOR COMES FROM, at the right end of the row.
 *
 * Lifted out of `DonorLine` when JOS-344's hover pushed that function past the measured
 * 100-code-line ceiling — a factoring split, byte-for-byte the same two elements, and the seam the
 * ceiling was pointing at: everything else on the row is a chip or a control, and this is the one
 * place a whole SENTENCE from the catalog is drawn. `SHRINK.source` stays here with it, which is
 * the point: the arbitration is one number applied where the text is.
 */
function SourceLine({ src }: { src: SourceText }): JSX.Element {
  return (
    <>
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        title={src.text}
        sx={{ minWidth: 0, flexShrink: SHRINK.source, maxWidth: 320 }}
      >
        {src.text}
      </Typography>
      {src.more !== '' && (
        <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>
          {src.more}
        </Typography>
      )}
    </>
  )
}

function DonorNameCell({
  donor,
  compare,
  onOpenLoot
}: Pick<DonorLineProps, 'donor' | 'compare' | 'onOpenLoot'>): JSX.Element {
  const name = <DonorName name={donor.name} bold onOpen={onOpenLoot} />
  const row = compare?.byKey.get(donor.key)
  if (compare === undefined || row === undefined) return name
  return (
    <GearRowCompare row={row} data={compare}>
      <span>{name}</span>
    </GearRowCompare>
  )
}

export function DonorLine({
  donor,
  planClasses,
  wished,
  best,
  namesEffect,
  namesSays,
  onToggleWish,
  onOpenLoot,
  compare
}: DonorLineProps): JSX.Element {
  const src = sourceText(donor)
  // V6 — "Beneficial · Single Friendly · 27 minutes", or '' when the spell DB never named this
  // effect. Same 44px row (the windowing law): muted inline text, ellipsized, with the full line
  // in `title` for the ones that do not fit.
  //
  // JOS-42: silent here when the GROUP HEADER already states it for every row under it (the focus
  // families), which is what stopped "Burning Af…" truncating on every donor of one family.
  const says = namesSays ? effectOneLiner(donor) : ''
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      // JOS-344 — the corpus join key rides the row now, so a spec can point at ONE donor and say
      // which. Same key the gear table's rows carry (`itemKey`), which is what makes the compare
      // pair's own `data-item-key` checkable against the row it was opened from.
      data-testid="planner-donor-row" data-item-key={donor.key}
      sx={{ height: ROW_HEIGHT, pl: 5, pr: 1, flexWrap: 'nowrap', borderBottom: 1, borderColor: 'divider' }}
    >
      {donor.iconId !== undefined && (
        <Box
          component="img"
          src={itemIconUrl(donor.iconId)}
          alt=""
          onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
            e.currentTarget.style.display = 'none'
          }}
          sx={{ width: 22, height: 22, imageRendering: 'pixelated', flexShrink: 0 }}
        />
      )}
      <Typography variant="body2" component="div" noWrap sx={{ minWidth: 0, flexShrink: SHRINK.name }}>
        <DonorNameCell donor={donor} compare={compare} onOpenLoot={onOpenLoot} />
      </Typography>
      {namesEffect && (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          data-testid="planner-donor-effect"
          sx={{ minWidth: 0, flexShrink: 0, maxWidth: EFFECT_MAX_WIDTH }}
        >
          {donor.effect}
        </Typography>
      )}
      {says !== '' && (
        <Typography
          variant="caption"
          color="text.disabled"
          noWrap
          title={says}
          data-testid="planner-effect-says"
          sx={{ minWidth: 0, flexShrink: SHRINK.says }}
        >
          {says}
        </Typography>
      )}
      {best && <BestChip />}
      <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
        {donor.slots.map((s) => (
          <Chip key={s} size="small" variant="outlined" label={s} sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }} />
        ))}
      </Stack>
      {isNonEquippable(donor) && <NoSlotChip />}
      <ClassChips donor={donor} planClasses={planClasses} />
      <Tooltip title={`This effect only extracts once the donor is merged to +${String(donor.tierRequired)}.`}>
        <Chip size="small" color="secondary" variant="outlined" label={`+${String(donor.tierRequired)} to extract`} sx={{ height: 18, fontSize: 10 }} />
      </Tooltip>
      {donor.hasteLocked && <Chip size="small" color="warning" label="haste - can't move" sx={{ height: 18, fontSize: 10 }} />}
      <EraChip subject={donor} />
      <Box sx={{ flexGrow: 1, minWidth: 8 }} />
      <SourceLine src={src} />
      {wished && (
        <Chip
          size="small"
          color="success"
          variant="outlined"
          label="wished"
          data-testid="planner-wished-chip"
          sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
        />
      )}
      {/* Nothing at all until the host can answer "is this already wished" — see the prop. */}
      {onToggleWish !== undefined && <AddButton donor={donor} wished={wished} onToggleWish={onToggleWish} />}
    </Stack>
  )
}

// ---- one group header row --------------------------------------------------------------

export function GroupLine({
  group,
  expanded,
  onToggle
}: {
  group: DonorGroup
  expanded: boolean
  onToggle: (id: string) => void
}): JSX.Element {
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      data-testid="planner-effect-row"
      data-axis={group.axis}
      onClick={() => onToggle(group.id)}
      sx={{
        height: ROW_HEIGHT,
        px: 1,
        flexWrap: 'nowrap',
        cursor: 'pointer',
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'action.hover'
      }}
    >
      <IconButton size="small" sx={{ flexShrink: 0 }}>
        {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
      </IconButton>
      {/* The family's own name gets the header's equivalent of the row rule: it does not shrink,
          because it is the thing you are reading the header for. */}
      <Typography variant="body2" noWrap sx={{ minWidth: 0, flexShrink: 0, maxWidth: EFFECT_MAX_WIDTH, fontWeight: 600 }}>
        {group.label}
      </Typography>
      {group.note !== '' && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flexShrink: SHRINK.name }}>
          best: {group.note}
        </Typography>
      )}
      {/* JOS-42 — the line every row under this header shares, stated ONCE where there is room.
          Shrinks first of everything on the row: it is the least load-bearing text here, and the
          header's job is to name the family. */}
      {group.says !== '' && (
        <Typography
          variant="caption"
          color="text.disabled"
          noWrap
          title={group.says}
          data-testid="planner-group-says"
          sx={{ minWidth: 0, flexShrink: SHRINK.says }}
        >
          {group.says}
        </Typography>
      )}
      <Chip size="small" variant="outlined" label={SOCKET_LABEL[group.socket]} sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />
      <Chip
        size="small"
        color="secondary"
        variant="outlined"
        label={`+${String(extractionTier(group.socket))} to extract`}
        sx={{ height: 18, fontSize: 10, flexShrink: 0 }}
      />
      {group.hasteLocked && <Chip size="small" color="warning" label="haste - can't move" sx={{ height: 18, fontSize: 10, flexShrink: 0 }} />}
      <Box sx={{ flexGrow: 1 }} />
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        {group.donors.length} {group.donors.length === 1 ? 'donor' : 'donors'}
      </Typography>
    </Stack>
  )
}
