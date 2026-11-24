// AaPlannerView — the AAs tab: every Alternate Advancement your class trio can use, what your log
// says you hold, and a plan of target ranks with its cost, shortfall and an estimated time to
// afford it. The model is shared/aaPlanner.ts + shared/aaPlanStore.ts; inputs come from
// useAaPlanner. Collapsed sections and the plan are renderer prefs: a view unmounts on every tab
// switch.

import { type JSX, useCallback, useDeferredValue, useMemo, useState } from 'react'
import { Box, Paper, Stack, TextField, Typography } from '@mui/material'
import type { AaCatalogEntry, AaSection } from '@shared/aaCatalog'
import { aaKey } from '../../../../shared/aaCatalog'
import { evaluatePlan, heldRank, plannerSections } from '../../../../shared/aaPlanner'
import { moveStep, setStated, setTarget, targetOf } from '../../../../shared/aaPlanStore'
import { formatDate } from '../../lib/formatDate'
import AaRow from './AaRow'
import AaPlanPanel from './AaPlanPanel'
import { useAaPlanner, type AaPlannerInputs } from './useAaPlanner'

const COLLAPSED_KEY = 'eq.aa.collapsed'

const SECTION_TITLE: Record<AaSection, string> = {
  general: 'General',
  archetype: 'Archetype',
  class: 'Class',
  special: 'Special'
}

const SECTION_NOTE: Partial<Record<AaSection, string>> = {
  archetype: 'The wiki does not say which archetype AAs each class gets, so every one is listed. Your in-game Archetype tab shows the ones your combo has.',
  special: 'Granted by reincarnating or by achievements, never bought - never part of a plan.'
}

function loadCollapsed(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

function useCollapsed(): [Set<string>, (s: string) => void] {
  const [collapsed, set] = useState<Set<string>>(loadCollapsed)
  const toggle = useCallback((s: string) => {
    set((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // not remembered, never an error
      }
      return next
    })
  }, [])
  return [collapsed, toggle]
}

function Header({ p }: { p: AaPlannerInputs }): JSX.Element {
  const trio = p.classes.length > 0 ? p.classes.join(' / ') : 'unknown'
  const partial = p.slots > p.classes.length && p.classes.length > 0 ? ` (${String(p.classes.length)} of ${String(p.slots)} known)` : ''
  const seen = p.seenSince === null ? 'Your log has no AA lines yet.' : `Held ranks are what your log has seen since ${formatDate(p.seenSince)}; mark any others with "I hold".`
  return (
    <Stack spacing={0.25}>
      <Typography variant="body2" data-testid="aa-planner-trio">
        Classes: {trio}
        {partial}
        {p.level !== null ? ` - level ${String(p.level)}` : ''} - {p.banked} points banked
      </Typography>
      <Typography variant="caption" color="text.secondary" data-testid="aa-planner-seen">
        {seen}
      </Typography>
      {p.unmatched.length > 0 && (
        <Typography variant="caption" color="text.secondary" data-testid="aa-planner-unmatched">
          In your log but not in the wiki list: {p.unmatched.join(', ')}
        </Typography>
      )}
    </Stack>
  )
}

interface SectionProps {
  section: AaSection
  entries: AaCatalogEntry[]
  collapsed: boolean
  onToggle: () => void
  row: (e: AaCatalogEntry) => JSX.Element
}

function Section({ section, entries, collapsed, onToggle, row }: SectionProps): JSX.Element {
  const note = SECTION_NOTE[section]
  return (
    <Box data-testid={`aa-planner-section-${section}`} data-collapsed={collapsed}>
      <Typography
        variant="subtitle1"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        data-testid="aa-planner-section-toggle"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
        sx={{ cursor: 'pointer' }}
      >
        {collapsed ? '+' : '-'} {SECTION_TITLE[section]} ({entries.length})
      </Typography>
      {!collapsed && note && (
        <Typography variant="caption" color="text.secondary" data-testid="aa-planner-section-note" sx={{ display: 'block', mb: 0.5 }}>
          {note}
        </Typography>
      )}
      {!collapsed && <Stack spacing={0.5}>{entries.map(row)}</Stack>}
    </Box>
  )
}

export default function AaPlannerView(): JSX.Element {
  const p = useAaPlanner()
  const [search, setSearch] = useState('')
  const deferred = useDeferredValue(search)
  const [collapsed, toggle] = useCollapsed()
  const { catalog, classes, plan, updatePlan, index, held, level, banked, allocated, pointsPerHour } = p
  const sections = useMemo(() => plannerSections(catalog, classes, deferred), [catalog, classes, deferred])
  const { rows, totals } = useMemo(
    () => evaluatePlan(plan.steps, index, held, { level, banked, allocated, pointsPerHour }),
    [plan.steps, index, held, level, banked, allocated, pointsPerHour]
  )
  const row = (e: AaCatalogEntry): JSX.Element => (
    <AaRow
      key={aaKey(e.name)}
      entry={e}
      held={held.get(aaKey(e.name))}
      target={targetOf(plan, e.name)}
      onTarget={(t) => updatePlan((pl) => setTarget(pl, e, t, heldRank(held, e.name)))}
      onStated={(r) => updatePlan((pl) => setStated(pl, e, r))}
    />
  )
  const actions = {
    onMove: (i: number, d: -1 | 1) => updatePlan((pl) => moveStep(pl, i, d)),
    onRemove: (name: string) => {
      const e = index.get(aaKey(name))
      if (e) updatePlan((pl) => setTarget(pl, e, 0, 0))
    }
  }
  return (
    <Stack spacing={1} data-testid="aa-planner" sx={{ height: '100%', minHeight: 0 }}>
      <Header p={p} />
      <Stack direction="row" spacing={1.5} sx={{ flexGrow: 1, minHeight: 0 }}>
        <Stack spacing={1} sx={{ flexGrow: 1, minWidth: 0, minHeight: 0 }}>
          <TextField
            size="small"
            placeholder="Search AAs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{ htmlInput: { 'data-testid': 'aa-planner-search' } }}
          />
          <Box data-testid="aa-planner-list" sx={{ flexGrow: 1, minHeight: 0, overflow: 'auto' }}>
            <Stack spacing={1.5}>
              {sections.map((s) => (
                <Section key={s.section} section={s.section} entries={s.entries} collapsed={collapsed.has(s.section)} onToggle={() => toggle(s.section)} row={row} />
              ))}
              {sections.length === 0 && (
                <Typography variant="body2" color="text.secondary" data-testid="aa-planner-no-match">
                  No AA matches that search.
                </Typography>
              )}
            </Stack>
          </Box>
        </Stack>
        <Paper variant="outlined" sx={{ p: 1, width: 360, flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <AaPlanPanel rows={rows} totals={totals} hasPace={pointsPerHour !== null} actions={actions} />
        </Paper>
      </Stack>
    </Stack>
  )
}
