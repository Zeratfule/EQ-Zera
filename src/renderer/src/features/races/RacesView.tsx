// RacesView — the Races tab: every race unlock from the `/outputfile achievements` dump, closest
// to unlocking first, each one opening onto the factions it needs and the fastest stated ways to
// raise them. The model is shared/raceUnlockPlan.ts; this file draws it.
//
// WHICH CARDS ARE OPEN is a choice the user made, so it lives in a renderer pref rather than in
// `useState` alone: a view unmounts on every tab switch.

import { type JSX, useCallback, useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import OutputKindLine from '../../components/OutputKindLine'
import type { MobTarget } from '../mobs/mobTarget'
import { unlockedCount } from '../../../../shared/raceUnlockPlan'
import RaceCard from './RaceCard'
import { useRaceUnlocks } from './useRaceUnlocks'

const OPEN_KEY = 'eq.races.open'

/** Said by the freshness line on this tab, in place of the registry's Sky-flavoured clause. */
const WHY = 'Type it in game to see how far each race unlock has come.'

function loadOpen(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveOpen(open: Set<string>): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]))
  } catch {
    // A pref that cannot be written is a pref that is not remembered, never an error.
  }
}

function useOpenRaces(): [Set<string>, (race: string) => void] {
  const [open, setOpen] = useState<Set<string>>(loadOpen)
  const toggle = useCallback((race: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(race)) next.delete(race)
      else next.add(race)
      saveOpen(next)
      return next
    })
  }, [])
  return [open, toggle]
}

function EmptyState({ readAt }: { readAt: number | null }): JSX.Element {
  return (
    <Stack spacing={1} data-testid="races-empty" sx={{ maxWidth: 640 }}>
      <Typography variant="body1">No race unlock progress yet.</Typography>
      <Typography variant="body2" color="text.secondary">
        EverQuest writes your race unlocks into its achievements export. Type the command below in game and this tab fills in
        on its own.
      </Typography>
      <OutputKindLine kind="achievements" why={WHY} loadedAt={readAt} testId="races-achievements-fresh" />
    </Stack>
  )
}

export default function RacesView({
  onOpenMob,
  onOpenQuestPage
}: {
  onOpenMob: (t: MobTarget) => void
  onOpenQuestPage: (page: string) => void
}): JSX.Element | null {
  const { ready, plans, readAt } = useRaceUnlocks()
  const [open, toggle] = useOpenRaces()
  if (!ready) return null
  if (plans.length === 0) return <EmptyState readAt={readAt} />
  const links = {
    onOpenMob: (mob: string) => {
      onOpenMob({ mob })
    },
    onOpenQuest: onOpenQuestPage
  }
  const unlocked = unlockedCount(plans)
  return (
    <Stack spacing={1} data-testid="races" sx={{ height: '100%', minHeight: 0 }}>
      <Typography variant="body2" color="text.secondary" data-testid="races-note">
        {unlocked} of {plans.length} unlocked. Closest to unlocking first. Click a race to see the factions it needs and the fastest
        ways to raise them. Faction change is what your log has seen, never your standing.
      </Typography>
      <OutputKindLine quiet kind="achievements" why={WHY} loadedAt={readAt} testId="races-achievements-fresh" />
      <Box sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
        <Stack spacing={0.75}>
          {plans.map((p) => (
            <RaceCard
              key={p.race}
              plan={p}
              open={open.has(p.race)}
              onToggle={() => {
                toggle(p.race)
              }}
              links={links}
            />
          ))}
        </Stack>
      </Box>
    </Stack>
  )
}
