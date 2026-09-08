// QuestToastSetting — Preferences → Overlays → "Quest item pop-ups" (ROADMAP §1).
//
// It sits directly under the celebration-toast card because it is a card THAT card draws: the
// quest-item pop-up is a fifth toast kind, so the switch below decides whether the app SENDS one
// and the switch above decides whether the window that would draw it is open at all. The caption
// says exactly that rather than leaving a user to discover it by turning this on and seeing
// nothing.
//
// THREE CONTROLS FOR THREE QUESTIONS, and none of them is a duplicate of the toast card's:
//   * on/off        — is a looted quest item worth a card
//   * my classes    — only the quests this character can take, or every quest the item feeds
//   * same item again — how long the SAME item stays quiet, because a stack of Bone Chips is forty
//     loot lines in an hour and one thing worth saying
//
// The two lower controls are DISABLED while the feature is off, for the reason the toast card's
// "Move it" switch is: a control that governs nothing while it is on screen is the pattern the
// owner's 2026-08-17 review threw out.
//
// STATE, NEVER PROCESS (the repo's UI law): every caption says what is true now. Nothing here
// mentions the catalog join, the loot module or a baseline. No tooltips — the labels earn their
// keep (the tooltip diet).

import { type JSX } from 'react'
import { FormControlLabel, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { REPEAT_CHOICES, repeatLabel, type RepeatMinutes } from '../quests/questToastPrefs'
import { useQuestToastPrefs } from '../quests/useQuestToastPrefs'

export function QuestToastSetting(): JSX.Element {
  const [prefs, setPrefs] = useQuestToastPrefs()

  return (
    <Stack spacing={2} data-testid="pref-quest-toast">
      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-quest-toast-enabled"
              checked={prefs.enabled}
              onChange={(e) => setPrefs({ enabled: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Pop up the quests an item is for when you loot it</Typography>}
        />
        <Typography variant="caption" color="text.secondary">
          {prefs.enabled
            ? 'A card names the quest and its steps, with the step that needs the item lit. It appears in the celebration overlay, so it follows that switch.'
            : 'Off. Quest items are still marked on the Loot and Quests tabs.'}
        </Typography>
      </Stack>

      <FormControlLabel
        control={
          <Switch
            size="small"
            data-testid="pref-quest-toast-my-classes"
            disabled={!prefs.enabled}
            checked={prefs.myClasses}
            onChange={(e) => setPrefs({ myClasses: e.target.checked })}
          />
        }
        label={<Typography variant="body2">Only quests my classes can take</Typography>}
      />

      <Stack spacing={0.75}>
        <Typography variant="body2">Same item again after</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          disabled={!prefs.enabled}
          value={prefs.repeatMin}
          data-testid="pref-quest-toast-repeat"
          // A group with `exclusive` hands back `null` when the pressed button is the selected one.
          // There is no "no window" here — a repeat always waits for something — so a null is a
          // no-op rather than a fifth state.
          onChange={(_e, v: RepeatMinutes | null) => {
            if (v !== null) setPrefs({ repeatMin: v })
          }}
          sx={{ alignSelf: 'flex-start' }}
        >
          {REPEAT_CHOICES.map((m) => (
            <ToggleButton key={m} value={m} data-testid={`pref-quest-toast-repeat-${String(m)}`} sx={{ px: 1.5, py: 0.25 }}>
              {repeatLabel(m)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
    </Stack>
  )
}
