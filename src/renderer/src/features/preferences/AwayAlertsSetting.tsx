// AwayAlertsSetting — Preferences → Away alerts (src/shared/awayAlerts.ts).
//
// WHAT THE CARD PROMISES: the alerts you tick here are ALSO posted to a Discord channel you have
// connected, while you are away from this keyboard. Discord's own mobile notification is what
// reaches the phone, which is why the caption says to turn that on - this app cannot do it for you
// and a feature that silently depended on it would look broken.
//
// Its own file for SharingSetting.tsx's reason: PreferencesView.tsx is the settings TABLE and sits
// at the repo's 400-code-line factoring ceiling, so a section's UI and its descriptor live beside
// each other here.
//
// IT DRAWS NOTHING UNTIL IT KNOWS (JOS-340's law, answered the way `lib/discordChannels`'s hook
// answers it): the card's frame is always in the DOM so a rail click has something to land on, and
// every CONTROL waits for the one read. A switch that painted OFF and flipped ON a hop later is the
// exact defect the hydration gate exists to remove, and this card is outside that gate on purpose
// (it reads the alert LIST as well as a preference - see ./useAwayAlerts.ts).
//
// THE CHANNEL IS A GATE, NOT A WARNING. With nothing connected there is nowhere to post, so the
// switch is disabled and says so in one clause rather than letting somebody turn on a feature that
// cannot do anything.

import { type JSX } from 'react'
import {
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive'
import { AWAY_IDLE_CHOICES, type AwayIdleMinutes } from '@shared/awayAlerts'
import {
  DiscordChannelPicker,
  showsSettingsLink,
  useDiscordChannels,
  type DiscordChannelsState
} from '../../lib/discordChannels'
import { useAwayAlerts, type AwayAlertsState } from './useAwayAlerts'
import type { PrefSection } from './PreferencesView'

/** The whole feature in one sentence, including the half that happens inside Discord. */
const CAPTION =
  'Connect a private Discord channel and turn on its mobile notifications in Discord; while you are away, these alerts are posted there in small batches, at most one message every ten seconds.'

/** What the switch says when there is nowhere to post. */
const NEEDS_CHANNEL = 'Connect a Discord channel first.'

/** …and where to do that, said once, only when a failure means it. */
const WHERE_TO_CONNECT = 'Connect one in the Sharing section.'

/** What the checklist says when this install has no enabled alerts at all. */
const NO_ALERTS = 'You have no enabled alerts to send.'

/** …and when the search box has excluded all of them. */
const NO_MATCHES = 'No alerts match that.'

/** The checklist of alerts that can travel, with its search box and its two bulk actions.
 *
 *  A FIXED-HEIGHT SCROLL BOX, per the repo's growing-list law: an alert list is as long as the user
 *  made it, and a panel that sizes to its content would squeeze every card under it to nothing. */
function AlertChecklist({ state }: { state: AwayAlertsState }): JSX.Element {
  const { prefs, rows, allIds } = state
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
        <TextField
          size="small"
          placeholder="Search alerts…"
          data-testid="pref-away-search"
          value={state.query}
          onChange={(e) => {
            state.setQuery(e.target.value)
          }}
          sx={{ minWidth: 200 }}
        />
        <Button
          size="small"
          data-testid="pref-away-all"
          onClick={() => {
            state.update({ alertIds: allIds })
          }}
        >
          Select all
        </Button>
        <Button
          size="small"
          data-testid="pref-away-none"
          onClick={() => {
            state.update({ alertIds: [] })
          }}
        >
          Select none
        </Button>
      </Stack>
      <Stack sx={{ maxHeight: 220, overflowY: 'auto', pr: 1 }}>
        {allIds.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {NO_ALERTS}
          </Typography>
        )}
        {allIds.length > 0 && rows.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {NO_MATCHES}
          </Typography>
        )}
        {rows.map((row) => (
          <FormControlLabel
            key={row.id}
            control={
              <Checkbox
                size="small"
                data-testid={`pref-away-alert-${row.id}`}
                checked={prefs.alertIds.includes(row.id)}
                onChange={(e) => {
                  state.toggleAlert(row.id, e.target.checked)
                }}
              />
            }
            label={<Typography variant="body2">{row.name}</Typography>}
          />
        ))}
      </Stack>
    </Stack>
  )
}

/** The three settings that decide WHERE a post goes and WHEN one counts as away. */
function AwayRules({
  state,
  picker
}: {
  state: AwayAlertsState
  picker: DiscordChannelsState
}): JSX.Element {
  return (
    <Stack spacing={1}>
      <DiscordChannelPicker state={picker} testId="pref-away-channel" />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="body2">Count me away after</Typography>
        <Select
          size="small"
          data-testid="pref-away-idle"
          aria-label="Minutes without keyboard or mouse input"
          value={state.prefs.idleMinutes}
          onChange={(e) => {
            state.update({ idleMinutes: Number(e.target.value) as AwayIdleMinutes })
          }}
        >
          {AWAY_IDLE_CHOICES.map((m) => (
            <MenuItem key={m} value={m}>
              {m} minutes without keyboard or mouse input
            </MenuItem>
          ))}
        </Select>
      </Stack>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            data-testid="pref-away-game-closed"
            checked={state.prefs.alsoWhenGameClosed}
            onChange={(e) => {
              state.update({ alsoWhenGameClosed: e.target.checked })
            }}
          />
        }
        label={<Typography variant="body2">Also when the game is not running</Typography>}
      />
    </Stack>
  )
}

/**
 * The test button and everything the card has to SAY: the outcome of a press, and the last failure
 * a real post met.
 *
 * THE DOOR IS OFFERED ONLY FOR THE ONE SENTENCE that Preferences can fix (`showsSettingsLink`), and
 * here it is a sentence rather than a button: this card IS in Preferences, so a button back to
 * Preferences would point at where the reader is standing. The Sharing section is two rows up the
 * rail, and naming it is the whole of the help needed.
 */
function AwayOutcome({ state }: { state: AwayAlertsState }): JSX.Element {
  const error = state.health.lastError ?? ''
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
        <Button
          size="small"
          variant="outlined"
          data-testid="pref-away-test"
          disabled={state.busy}
          onClick={state.sendTest}
        >
          Send a test
        </Button>
        {state.flash.text !== '' && (
          <Typography
            variant="body2"
            color={state.flash.bad ? 'error' : 'success.main'}
            data-testid="pref-away-flash"
          >
            {state.flash.text}
          </Typography>
        )}
      </Stack>
      {error !== '' && (
        <Typography variant="body2" color="error" data-testid="pref-away-error">
          {error}
          {showsSettingsLink(error) ? ` ${WHERE_TO_CONNECT}` : ''}
        </Typography>
      )}
    </Stack>
  )
}

export function AwayAlertsSetting(): JSX.Element {
  const state = useAwayAlerts()
  const channels = useDiscordChannels()
  // The picker reads the LIST from `lib/discordChannels` and writes the CHOICE into the stored
  // preference, so the row somebody picks here is the row a post at 3am actually uses. Composed
  // rather than forked: one picker, one list, one idea of what a channel is.
  const picker: DiscordChannelsState = {
    ready: channels.ready,
    channels: channels.channels,
    channelId: state.prefs.channelId ?? channels.channelId,
    choose: (id) => {
      state.update({ channelId: id })
    },
    labelOf: channels.labelOf
  }
  return (
    <Stack spacing={1} data-testid="pref-away-alerts">
      {state.loaded && (
        <>
          <FormControlLabel
            control={
              <Switch
                size="small"
                data-testid="pref-away-enabled"
                disabled={!channels.ready}
                checked={state.prefs.enabled}
                onChange={(e) => {
                  state.update({ enabled: e.target.checked })
                }}
              />
            }
            label={
              <Typography variant="body2">Send chosen alerts to Discord while I am away</Typography>
            }
          />
          <Typography variant="caption" color="text.secondary">
            {channels.ready ? CAPTION : NEEDS_CHANNEL}
          </Typography>
          {state.prefs.enabled && (
            <>
              <AwayRules state={state} picker={picker} />
              <AlertChecklist state={state} />
              <AwayOutcome state={state} />
            </>
          )}
        </>
      )}
    </Stack>
  )
}

/**
 * The section, named beside the card that renders it — the arrangement PerfSetting,
 * GraphicsSetting, CloseToTraySetting and the rest use, and for their reason: PreferencesView.tsx
 * sits at the repo's 400-code-line factoring ceiling.
 *
 * A SECTION rather than a line under Sharing, because Sharing is about where your CHARACTER CARD
 * goes when you press a button, and this is about what happens when you are not at the machine to
 * press one. The keywords are the words somebody would search for having felt the problem ("afk",
 * "phone", "notify", "mobile", "tell"), not the words the feature is built out of.
 */
export function awayAlertsSection(): PrefSection {
  return {
    id: 'away',
    label: 'Away alerts',
    icon: <NotificationsActiveIcon fontSize="small" />,
    items: [
      {
        id: 'away-alerts',
        label: 'Alerts while you are away',
        keywords:
          'away afk idle keyboard mouse discord phone mobile notification notify push alert alerts tell tells raid target spawn batch channel chat forward send remote',
        content: <AwayAlertsSetting />
      }
    ]
  }
}
