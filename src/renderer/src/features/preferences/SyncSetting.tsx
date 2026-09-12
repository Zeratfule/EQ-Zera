// SyncSetting — send your settings to another PC of your own (docs/plans/settings-sync.md).
//
// Its own file for the reason SharingSetting.tsx and UpdateSetting.tsx are: PreferencesView.tsx is
// the settings TABLE, and a section's actual UI lives beside it rather than inside it.
//
// WHAT THE USER DOES. On the machine that has the settings: press Send settings to another PC, and
// a transfer code appears. On the other machine: type the code, press Receive, look at what it
// would add, press Apply. That is the whole feature.
//
// THE CODE IS THE KEY, AND THE CARD SAYS SO. Main encrypts the bundle locally and uploads only
// ciphertext; the second half of the code is the key that opens it (src/main/share/syncCrypto.ts).
// So the notice under the code is not a caveat, it is the operating instruction: anyone holding the
// code can read the bundle, which is why the intended reader is the user's own second machine.
//
// THE DISCORD BOX IS OFF BY DEFAULT AT BOTH ENDS. A connected channel carries the webhook token
// that posts to somebody's server, so it travels only when the sender ticks the box and is stored
// only when the receiver ticks theirs.
//
// AND THE IMPORT IS THE IMPORT THIS APP ALREADY HAS. What comes back is the same `SharePreview` the
// paste box renders and the same additive merge applies (src/shared/profiles.ts) - this feature
// adds a pipe, not a second set of rules about what an import may do.

import type { JSX } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import SyncAltIcon from '@mui/icons-material/SyncAlt'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import type { SharePreview } from '@shared/profiles'
import { SYNC_CODE_NOTICE, SYNC_DISCORD_NOTICE, SYNC_ERROR } from '@shared/settingsSync'
import { useSettingsSync, type SettingsSyncState } from './useSettingsSync'
import type { PrefSection } from './PreferencesView'

/** The one line of help under the Send button, which is the whole feature written out. */
const HELP = 'Your settings are encrypted here and uploaded as a code. Type the code on the other PC.'

/** How many rows a preview would actually add, said the way the import dialog says it. */
function previewSummary(preview: SharePreview, channels: number): string {
  const bits: string[] = []
  const alerts = preview.alerts.filter((a) => a.action !== 'skip').length
  if (alerts > 0) bits.push(`${String(alerts)} alert${alerts === 1 ? '' : 's'}`)
  const scalars = preview.scalars.length
  if (scalars > 0) bits.push(`${String(scalars)} setting${scalars === 1 ? '' : 's'}`)
  if (channels > 0) bits.push(`${String(channels)} Discord channel${channels === 1 ? '' : 's'}`)
  return bits.length === 0 ? 'Nothing new - you already have it all.' : `This transfer carries ${bits.join(', ')}.`
}

/** The transfer code, once there is one: monospace, selectable, and copyable. */
function CodeBox({ state }: { state: SettingsSyncState }): JSX.Element | null {
  if (state.code === '') return null
  return (
    <Stack spacing={0.75}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
        <Box
          data-testid="pref-sync-code-text"
          sx={{
            fontFamily: 'monospace',
            fontSize: 16,
            px: 1,
            py: 0.5,
            borderRadius: 1,
            border: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
            userSelect: 'all'
          }}
        >
          {state.code}
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ContentCopyIcon />}
          data-testid="pref-sync-code"
          onClick={state.copyCode}
        >
          Copy
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {SYNC_CODE_NOTICE}
      </Typography>
    </Stack>
  )
}

/** The sending half: the box, the button, and the code it produces. */
function SendHalf({ state }: { state: SettingsSyncState }): JSX.Element {
  const off = state.busy || state.available !== true
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          size="small"
          variant="contained"
          startIcon={<SyncAltIcon />}
          data-testid="pref-sync-send"
          disabled={off}
          onClick={state.send}
        >
          Send settings to another PC
        </Button>
      </Stack>
      <FormControlLabel
        sx={{ ml: 0 }}
        control={
          <Checkbox
            size="small"
            sx={{ p: 0.5 }}
            data-testid="pref-sync-include-discord"
            disabled={off}
            checked={state.includeDiscord}
            onChange={(e) => state.setIncludeDiscord(e.target.checked)}
          />
        }
        label={<Typography variant="body2">Include connected Discord channels</Typography>}
      />
      <Typography variant="caption" color="text.secondary">
        {SYNC_DISCORD_NOTICE}
      </Typography>
      <CodeBox state={state} />
    </Stack>
  )
}

/** What the fetched transfer would add, with the two ways out of it. */
function PreviewPanel({ state }: { state: SettingsSyncState }): JSX.Element | null {
  const preview = state.preview
  if (preview === null) return null
  return (
    <Stack spacing={1} data-testid="pref-sync-preview" sx={{ pl: 1, borderLeft: 2, borderColor: 'divider' }}>
      <Typography variant="body2">{previewSummary(preview, state.incoming)}</Typography>
      {state.incoming > 0 && (
        <FormControlLabel
          sx={{ ml: 0 }}
          control={
            <Checkbox
              size="small"
              sx={{ p: 0.5 }}
              data-testid="pref-sync-take-discord"
              checked={state.takeDiscord}
              onChange={(e) => state.setTakeDiscord(e.target.checked)}
            />
          }
          label={<Typography variant="body2">Also add the Discord channels it carries</Typography>}
        />
      )}
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="contained"
          data-testid="pref-sync-apply"
          disabled={state.busy}
          onClick={state.apply}
        >
          Apply
        </Button>
        <Button size="small" data-testid="pref-sync-cancel" disabled={state.busy} onClick={state.cancel}>
          Cancel
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Imports only ever ADD. Anything you already have is left exactly as it is.
      </Typography>
    </Stack>
  )
}

/** The receiving half: type the code, fetch it, then look before you take it. */
function ReceiveHalf({ state }: { state: SettingsSyncState }): JSX.Element {
  const off = state.busy || state.available !== true
  return (
    <Stack spacing={1}>
      <Typography variant="overline" color="text.secondary">
        Receive settings
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
        <TextField
          size="small"
          label="Transfer code"
          placeholder="Ab3dE9fGh1-K7xYpQr2sTu9v"
          value={state.typed}
          data-testid="pref-sync-receive-code"
          disabled={off}
          onChange={(e) => state.setTyped(e.target.value)}
          slotProps={{ htmlInput: { style: { fontFamily: 'monospace' }, spellCheck: false } }}
        />
        <Button
          size="small"
          variant="outlined"
          data-testid="pref-sync-receive"
          disabled={off || state.typed.trim() === ''}
          onClick={state.receive}
        >
          Receive
        </Button>
      </Stack>
      <PreviewPanel state={state} />
    </Stack>
  )
}

export function SyncSetting(): JSX.Element {
  const state = useSettingsSync()
  return (
    <Stack spacing={1.5}>
      <SendHalf state={state} />
      <Typography variant="caption" color="text.secondary">
        {HELP}
      </Typography>
      {state.available === false && (
        <Alert severity="info" variant="outlined" data-testid="pref-sync-dark">
          {SYNC_ERROR.dark}
        </Alert>
      )}
      <ReceiveHalf state={state} />
      {state.status.text !== '' && (
        <Typography
          variant="body2"
          color={state.status.bad ? 'error' : 'success.main'}
          data-testid="pref-sync-status"
        >
          {state.status.text}
        </Typography>
      )}
    </Stack>
  )
}

/**
 * The Sync section, named beside the card that renders it — the arrangement PerfSetting,
 * GraphicsSetting and SharingSetting use, and for the same reason: PreferencesView.tsx sits at the
 * repo's 400-code-line factoring ceiling, and a split is the answer to that rather than a widened
 * threshold.
 *
 * A SECTION rather than a line under Profiles, and the line between them is who the other end is.
 * Profiles hands a settings bundle to ANOTHER PERSON, by hand, as a string they can read. This
 * carries the same bundle to ANOTHER MACHINE OF YOURS, encrypted, through a service that cannot
 * read it. The keywords carry the words somebody would actually search for ("new pc", "move",
 * "transfer", "copy settings").
 */
export function syncSection(): PrefSection {
  return {
    id: 'sync',
    label: 'Sync',
    icon: <SyncAltIcon fontSize="small" />,
    items: [
      {
        id: 'settings-sync',
        label: 'Send settings to another PC',
        keywords:
          'sync send receive transfer code another second new pc computer machine laptop desktop ' +
          'move copy settings alerts migrate backup restore encrypted',
        content: <SyncSetting />
      }
    ]
  }
}
