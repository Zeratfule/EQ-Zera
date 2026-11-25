// One quest, in full (EQ Zera, 2026-09-06): who gives it and where, who can take it, what it
// needs and what it pays, and the steps — with the items this character has already looted
// marked in the item lists and lit in the step they appear in.
//
// AND, SINCE THE TRACKER WAVE, IT IS A PAGE YOU CAN KEEP. Track this quest pins it to the top of
// the tab; the walkthrough became a CHECKLIST (./QuestSteps.tsx) that the LOG ticks where it can —
// a completed turn-in to the giver ticks the hand-in steps naming what it carried — and that the
// player ticks everywhere else. When every required item has reached the giver the page says so,
// dated off EQ's own clock rather than off `Date.now()`.

import { type JSX, type ReactNode, useMemo } from 'react'
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CheckIcon from '@mui/icons-material/Check'
import type { QuestEntry } from '@shared/types'
import { wikiPageUrl } from '@shared/wiki'
import { questClasses, questItemKey, type LootedQuestItem } from '../../../../shared/questIndex'
import type { QuestProgress } from '../../../../shared/questProgress'
import { formatDate } from '../../lib/formatDate'
import { QuestSteps, type QuestStepsProps } from './QuestSteps'
import { GroundSpawnList, ItemSourcesList, NpcList } from './QuestWhere'
import { groundSpawnsTitle, splitGroundSpawns } from '../../../../shared/questGroundSpawns'
import { questLocationsFor } from './questLocIndex'
import { rememberQuestPage } from './questResume'
import type { MapAnchor } from '../maps/mapTarget'
import { isPinned, ticksFor, useQuestPins } from './useQuestPins'
import { useQuestProgress } from './useQuestProgress'

type Held = ReadonlyMap<string, LootedQuestItem>
type OpenLoot = (item: string) => void

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Typography variant="caption" className="eq-display-label" sx={{ display: 'block', color: 'text.secondary', mb: 0.75 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  )
}

/** An item chip: a tick and a count when this character has looted it, a plain chip otherwise. */
function ItemChip({ name, held, onOpenLoot }: { name: string; held: LootedQuestItem | undefined; onOpenLoot: OpenLoot }): JSX.Element {
  return (
    <Chip
      size="small"
      variant="outlined"
      label={held && held.count > 1 ? `${name} ×${String(held.count)}` : name}
      icon={held ? <CheckIcon sx={{ fontSize: 14 }} /> : undefined}
      color={held ? 'success' : 'default'}
      onClick={() => onOpenLoot(name)}
      data-testid="quest-item-chip"
      sx={{ maxWidth: '100%' }}
    />
  )
}

/** "Items needed" / "Rewards": nothing at all when the quest lists none. `children` rides under. */
function ItemsSection({
  title,
  names,
  held,
  onOpenLoot,
  children
}: {
  title: string
  names: readonly string[]
  held: Held
  onOpenLoot: OpenLoot
  children?: ReactNode
}): JSX.Element | null {
  if (names.length === 0) return null
  return (
    <Section title={`${title} · ${String(names.length)}`}>
      <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
        {names.map((name) => (
          <ItemChip key={name} name={name} held={held.get(questItemKey(name))} onOpenLoot={onOpenLoot} />
        ))}
      </Stack>
      {children}
    </Section>
  )
}

/**
 * The checklist section, and the one line that says the quest is over.
 *
 * The completion date comes off `QuestProgress.completeAt` — the `TurnInEvent.ts` of the turn-in
 * that finished the set, EQ's own clock — so a quest completed last Tuesday says Tuesday however
 * many times the log is re-read. A quest the evidence says is complete but whose completing instant
 * we somehow do not hold prints the plain word rather than an invented date (law 1).
 */
function StepsSection({
  steps,
  progress,
  ticks,
  onTick,
  where
}: {
  steps: readonly string[]
  progress: QuestProgress | undefined
  ticks: readonly number[]
  onTick: ((step: number, on: boolean) => void) | null
  /** the per-step location chips and the jump they make */
  where: Pick<QuestStepsProps, 'chips' | 'quest' | 'onOpenMap'>
}): JSX.Element {
  const done = progress?.done ?? 0
  const title = steps.length === 0 ? 'Steps' : `Steps · ${String(done)}/${String(steps.length)}`
  return (
    <Section title={title}>
      {progress?.complete === true && (
        <Typography variant="body2" sx={{ color: 'success.main', mb: 0.75 }} data-testid="quest-complete">
          {progress.completeAt === undefined ? 'Completed' : `Completed ${formatDate(progress.completeAt)}`}
        </Typography>
      )}
      <QuestSteps steps={steps} progress={progress} ticks={ticks} onTick={onTick} {...where} />
    </Section>
  )
}

/** Title and the one-line facts under it: giver · zone, level, classes, experience, the wiki page. */
function QuestHeader({ quest }: { quest: QuestEntry }): JSX.Element {
  const open = questClasses(quest)
  const where = [quest.giver, quest.startZone].filter(Boolean).join(' · ')
  const wikiUrl = wikiPageUrl(quest.page)
  const facts: { key: string; text: string; color?: string }[] = [
    { key: 'where', text: where },
    { key: 'level', text: quest.minLevel === undefined ? '' : `Level ${String(quest.minLevel)}+` },
    { key: 'classes', text: open === 'all' ? 'Any class' : open.join(' · ') },
    { key: 'exp', text: quest.expReward ? 'Gives experience' : '', color: 'success.main' }
  ]
  return (
    <Box>
      <Typography variant="h5" sx={{ color: 'primary.main', lineHeight: 1.15 }} data-testid="quest-page-title">
        {quest.name}
      </Typography>
      <Stack direction="row" spacing={1.5} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
        {facts
          .filter((f) => f.text !== '')
          .map((f) => (
            <Typography key={f.key} variant="caption" sx={{ color: f.color ?? 'text.secondary' }}>
              {f.text}
            </Typography>
          ))}
        {wikiUrl && (
          <Typography variant="caption" color="text.secondary">
            <a href={wikiUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
              eqlwiki.com
            </a>
          </Typography>
        )}
      </Stack>
    </Box>
  )
}

export function QuestPage({
  quest,
  held,
  onBack,
  onOpenLoot,
  onOpenMap
}: {
  quest: QuestEntry
  /** the looted items this quest needs or gives (useQuestItems().byQuest) */
  held: LootedQuestItem[]
  onBack: () => void
  onOpenLoot: OpenLoot
  /** a location chip's jump to the Maps tab; absent ⇒ the chips are text */
  onOpenMap?: (a: MapAnchor) => void
}): JSX.Element {
  const heldByKey: Held = useMemo(() => new Map(held.map((h) => [h.key, h])), [held])
  // WHERE (quest locations wave): resolved once per page by the pure resolver, cached per page.
  const locs = useMemo(() => questLocationsFor(quest), [quest])
  // A ground spawn of a NEEDED item reads under "Where to get it"; the rest get their own block.
  const ground = useMemo(() => splitGroundSpawns(locs.groundSpawns, quest.requiredItems ?? []), [locs, quest.requiredItems])
  // Leaving for the map remembers this page, so coming back lands here (questResume.ts).
  const openMap = useMemo(
    () =>
      onOpenMap
        ? (a: MapAnchor) => {
            rememberQuestPage(quest.page)
            onOpenMap(a)
          }
        : undefined,
    [onOpenMap, quest.page]
  )
  const [pins, api] = useQuestPins()
  const pages = useMemo(() => [quest.page], [quest.page])
  const progress = useQuestProgress(pages).get(quest.page)
  const pinned = isPinned(pins, quest.page)
  const ticks = ticksFor(pins, quest.page)
  const steps = quest.steps ?? []

  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }} data-testid="quest-page">
      <Stack direction="row" spacing={1} alignItems="center">
        <Button size="small" data-testid="quest-back" startIcon={<ArrowBackIcon />} onClick={onBack}>
          Back
        </Button>
        <Button
          size="small"
          data-testid="quest-pin"
          variant={pinned ? 'contained' : 'outlined'}
          onClick={() => api.toggle(quest.page)}
        >
          {pinned ? 'Tracking' : 'Track this quest'}
        </Button>
      </Stack>
      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto', pr: 0.5 }}>
        <Stack spacing={1.5}>
          <QuestHeader quest={quest} />
          <ItemsSection title="Items needed" names={quest.requiredItems ?? []} held={heldByKey} onOpenLoot={onOpenLoot}>
            <ItemSourcesList items={locs.items} ground={ground.needed} quest={quest.page} onOpenMap={openMap} />
          </ItemsSection>
          {ground.rest.length > 0 && (
            <Section title={groundSpawnsTitle(ground.rest)}>
              <GroundSpawnList ground={ground.rest} quest={quest.page} onOpenMap={openMap} />
            </Section>
          )}
          <ItemsSection title="Rewards" names={(quest.rewards ?? []).map((r) => r.name)} held={heldByKey} onOpenLoot={onOpenLoot} />
          <StepsSection
            steps={steps}
            progress={progress}
            ticks={ticks}
            onTick={pinned ? (step, on) => api.tick(quest.page, step, on) : null}
            where={{ chips: locs.steps, quest: quest.page, onOpenMap: openMap }}
          />
          {locs.npcs.length > 0 && (
            <Section title="NPCs involved">
              <NpcList npcs={locs.npcs} quest={quest.page} onOpenMap={openMap} />
            </Section>
          )}
        </Stack>
      </Box>
    </Stack>
  )
}
