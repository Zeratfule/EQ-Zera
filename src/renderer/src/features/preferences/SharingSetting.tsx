// SharingSetting — where a Discord channel is connected (owner, 2026-09-11;
// docs/plans/discord-connect.md, docs/plans/discord-webhook.md).
//
// Its own file for the reason UpdateSetting.tsx and FeedbackSetting.tsx are: PreferencesView.tsx
// is the settings TABLE, and a section's actual UI lives beside it rather than inside it.
//
// WHAT THE USER DOES NOW: press Connect a Discord channel. Their browser opens, Discord asks which
// server and which channel with its own two dropdowns, they press Authorize, and the row appears
// here. Nothing is copied and nothing is pasted. That is the whole of the owner's 2026-09-11
// direction - *"There's got to be a better way to share to Discord instead of having people input
// webhooks for each channel they want to send to."*
//
// PASTING STILL WORKS, UNDER ADVANCED AND COLLAPSED. Somebody who cannot authorize an app in a
// server they do not run can still copy a webhook URL out of channel settings, and what they paste
// lands in the SAME list with the same Test, Rename, Remove and Default. It is collapsed because
// it is now the unusual path, not because it is deprecated.
//
// NO SECRET IS EVER DRAWN HERE. What the card holds is a list of ids, labels and dates; the
// webhook tokens never cross IPC at all (src/main/storeDiscord.ts). That is also why the paste box
// is always empty on mount: a box that re-showed the value would need the value.
//
// AND THE PARSING, THE CLAMPING AND THE WAITING ARE MAIN'S. This card does not test a URL, does not
// know the hosts, does not cut a label and does not own the connect poll - it shows what main says.

import { type JSX, useState } from 'react'
import { Button, Collapse, Stack, TextField, Typography } from '@mui/material'
import ForumIcon from '@mui/icons-material/Forum'
import { CelebrationPostSetting } from './CelebrationPostSetting'
import { DiscordChannelList } from './DiscordChannelList'
import { useDiscordChannels, type DiscordChannelsState } from './useDiscordChannels'
import type { PrefSection } from './PreferencesView'

/** The one line of help under the button, which is the whole setup written out. */
const HELP = 'Discord opens in your browser and asks which server and channel. Nothing to copy or paste.'

/** …and the one under the advanced box, which is the old setup written out. */
const PASTE_HELP = 'In Discord: channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL.'

/** What the card says about a list that is empty, which is what a fresh install sees. */
const EMPTY = 'No Discord channels yet.'

/** The primary action, or - while an attempt is running - the wait and the way out of it. */
function ConnectRow({ state }: { state: DiscordChannelsState }): JSX.Element {
  if (state.waiting) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="body2" data-testid="pref-discord-waiting">
          Waiting for Discord…
        </Typography>
        <Button size="small" data-testid="pref-discord-connect-cancel" onClick={state.cancel}>
          Cancel
        </Button>
      </Stack>
    )
  }
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Button
        size="small"
        variant="contained"
        data-testid="pref-discord-connect"
        disabled={state.busy}
        onClick={state.connect}
      >
        Connect a Discord channel
      </Button>
    </Stack>
  )
}

/** The collapsed paste box. Kept for the servers where authorizing an app is not on offer. */
function AdvancedPaste({ state }: { state: DiscordChannelsState }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  return (
    <Stack spacing={1}>
      <Button
        size="small"
        color="inherit"
        sx={{ alignSelf: 'flex-start' }}
        data-testid="pref-discord-advanced"
        onClick={() => {
          setOpen((was) => !was)
        }}
      >
        Advanced: paste a webhook URL
      </Button>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={1}>
          <TextField
            size="small"
            fullWidth
            label="Discord webhook URL"
            placeholder="https://discord.com/api/webhooks/…"
            value={text}
            data-testid="pref-discord-webhook"
            onChange={(e) => {
              setText(e.target.value)
              state.clearStatus()
            }}
          />
          <Button
            size="small"
            variant="outlined"
            sx={{ alignSelf: 'flex-start' }}
            data-testid="pref-discord-save"
            disabled={state.busy || text.trim() === ''}
            onClick={() => {
              state.savePasted(text)
              setText('')
            }}
          >
            Save
          </Button>
          <Typography variant="caption" color="text.secondary">
            {PASTE_HELP}
          </Typography>
        </Stack>
      </Collapse>
    </Stack>
  )
}

export function SharingSetting(): JSX.Element {
  const state = useDiscordChannels()
  return (
    <Stack spacing={1}>
      <ConnectRow state={state} />
      <Typography variant="caption" color="text.secondary">
        {HELP}
      </Typography>
      {state.view.channels.length === 0 ? (
        <Typography variant="body2" color="text.secondary" data-testid="pref-discord-current">
          {EMPTY}
        </Typography>
      ) : (
        <DiscordChannelList state={state} />
      )}
      <AdvancedPaste state={state} />
      {state.status.text !== '' && (
        <Typography
          variant="body2"
          color={state.status.bad ? 'error' : 'success.main'}
          data-testid="pref-discord-status"
        >
          {state.status.text}
        </Typography>
      )}
    </Stack>
  )
}

/**
 * The Sharing section, named beside the card that renders it — the arrangement PerfSetting,
 * GraphicsSetting and the rest use, and for the same reason: PreferencesView.tsx sits at the
 * repo's 400-code-line factoring ceiling, and a split is the answer to that rather than a widened
 * threshold. The words somebody types to find this setting belong with the setting.
 *
 * A SECTION rather than a line under Profiles, because Profiles is about SETTINGS bundles you
 * hand to another EQ Zera user, and this is about where your character card gets posted. They
 * share a verb and nothing else.
 */
export function sharingSection(): PrefSection {
  return {
    id: 'sharing',
    label: 'Sharing',
    icon: <ForumIcon fontSize="small" />,
    items: [
      {
        id: 'discord-webhook',
        label: 'Post to Discord',
        keywords:
          'discord webhook share post channel chat server card character profile link integration connect oauth',
        content: <SharingSetting />
      },
      {
        // The SECOND item rather than a line inside the first, because they answer different
        // questions: the card above is WHERE this app may post, and this is what gets posted there
        // without anybody pressing a button (./CelebrationPostSetting.tsx).
        id: 'celebration-post',
        label: 'Post celebrations to Discord',
        keywords:
          'discord celebration toast overlay post channel level boss quest wish list death automatic announce guild',
        content: <CelebrationPostSetting />
      }
    ]
  }
}
