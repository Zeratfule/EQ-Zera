// LuclinModelsSetting - Preferences -> Game -> "Luclin character models".
//
// The community guide's edit, as a card: pick the races, Apply, and start the game from Play or
// the desktop shortcut so LaunchPad does not put the classic models back. OFF by default; the
// switch only decides what Play does and whether the controls show. Turning it off does not touch
// the file (LaunchPad reverts it on its next run anyway; Revert is here for doing it now).
//
// ONE BORDER: PreferencesView wraps each item in an outlined Paper, so this renders bare Stacks.

import type { JSX } from 'react'
import { Box, Button, Checkbox, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { LUCLIN_RACES, type LuclinStatus } from '@shared/luclinModels'
import { GAME_FILE_DISCLAIMER } from '@shared/gameModsDisclaimer'
import { useLuclin, type LuclinState } from './useLuclin'
import { LuclinRiskDialog } from './LuclinRiskDialog'

const HOW_IT_WORKS =
  'This edits one game text file (Resources\\GlobalLoad.txt) and nothing else: nothing in memory, nothing on the network. ' +
  'The EverQuest launcher puts the file back every time it runs, so start the game from Play or the shortcut. ' +
  'Still run the launcher to take game patches, then Play re-applies the models.'

/** One plain sentence about the file, never about how we read it. */
export function luclinStatusText(s: LuclinStatus | null): string {
  if (!s) return 'Checking GlobalLoad.txt...'
  const running = s.eqRunning ? ' EverQuest is running, so changes wait until it is closed.' : ''
  switch (s.state) {
    case 'file-missing':
      return `GlobalLoad.txt was not found in your EverQuest folder (${s.root}).`
    case 'anchor-missing':
      return 'GlobalLoad.txt does not have the line this edit goes after, so it will not be changed.'
    case 'applied':
      return `Applied for ${String(s.appliedRaces.length)} of ${String(s.availableRaces.length)} races.${running}`
    case 'partial':
      return `Partly applied (${String(s.appliedRaces.length)} races). Apply to match your choices.${running}`
    case 'not-applied':
      return s.reverted
        ? `The EverQuest launcher put the classic models back.${running}`
        : `Not applied. The game uses its classic models.${running}`
  }
}

function RaceList({ state }: { state: LuclinState }): JSX.Element {
  const { prefs, status, setPrefs } = state
  const available = new Set(status?.availableRaces ?? [])
  const toggle = (id: string, on: boolean): void => {
    const next = new Set(prefs.races)
    if (on) next.add(id)
    else next.delete(id)
    setPrefs({ races: LUCLIN_RACES.map((r) => r.id).filter((r) => next.has(r)) })
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
      {LUCLIN_RACES.map((race) => {
        const missing = status !== null && !available.has(race.id)
        return (
          <FormControlLabel
            key={race.id}
            control={
              <Checkbox
                size="small"
                data-testid={`pref-luclin-race-${race.id}`}
                checked={prefs.races.includes(race.id)}
                disabled={missing}
                onChange={(e) => toggle(race.id, e.target.checked)}
              />
            }
            label={
              <Typography variant="body2" color={missing ? 'text.disabled' : undefined}>
                {race.label}
              </Typography>
            }
          />
        )
      })}
    </Box>
  )
}

function Actions({ state }: { state: LuclinState }): JSX.Element {
  const { status, busy, prefs } = state
  const editable = status !== null && (status.state !== 'file-missing' && status.state !== 'anchor-missing')
  const blocked = busy || !editable || (status?.eqRunning ?? false)
  const reapply = status?.reverted === true
  return (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      <Button
        size="small"
        variant="contained"
        data-testid="pref-luclin-apply"
        disabled={blocked || prefs.races.length === 0}
        onClick={state.apply}
      >
        {reapply ? 'Re-apply' : 'Apply'}
      </Button>
      <Button
        size="small"
        variant="outlined"
        data-testid="pref-luclin-revert"
        disabled={blocked || status?.state === 'not-applied'}
        onClick={state.revert}
      >
        Revert
      </Button>
      <Button size="small" data-testid="pref-luclin-play" disabled={busy} onClick={state.play}>
        Play with Luclin models
      </Button>
      <Button size="small" data-testid="pref-luclin-shortcut" disabled={busy} onClick={state.shortcut}>
        Create desktop shortcut
      </Button>
    </Stack>
  )
}

export function LuclinModelsSetting(): JSX.Element {
  const state = useLuclin()
  const { prefs, status, message } = state
  return (
    <Stack spacing={1.5} data-testid="pref-luclin">
      <FormControlLabel
        control={
          <Switch
            size="small"
            data-testid="pref-luclin-enabled"
            checked={prefs.enabled}
            onChange={(e) => state.setPrefs({ enabled: e.target.checked })}
          />
        }
        label={<Typography variant="body2">Use the Luclin-era player models</Typography>}
      />
      <Typography variant="body2" data-testid="pref-luclin-status">
        {luclinStatusText(status)}
      </Typography>
      {prefs.enabled && (
        <>
          <RaceList state={state} />
          <Actions state={state} />
          <FormControlLabel
            control={
              <Switch
                size="small"
                data-testid="pref-luclin-keep"
                checked={prefs.keepApplied}
                onChange={(e) => state.setPrefs({ keepApplied: e.target.checked })}
              />
            }
            label={
              <Typography variant="body2">Keep it applied: re-apply when the launcher puts it back</Typography>
            }
          />
        </>
      )}
      {message && (
        <Typography
          variant="body2"
          color={message.bad ? 'error' : 'success.main'}
          data-testid="pref-luclin-message"
        >
          {message.text}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {HOW_IT_WORKS}
      </Typography>
      <Typography variant="caption" color="warning.main" data-testid="pref-luclin-disclaimer">
        {GAME_FILE_DISCLAIMER}
      </Typography>
      <LuclinRiskDialog state={state} />
    </Stack>
  )
}
