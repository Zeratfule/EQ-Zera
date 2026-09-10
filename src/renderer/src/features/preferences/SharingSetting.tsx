// SharingSetting — where a Discord channel webhook is pasted in (owner, 2026-09-10;
// docs/plans/discord-webhook.md).
//
// Its own file for the reason UpdateSetting.tsx and FeedbackSetting.tsx are: PreferencesView.tsx
// is the settings TABLE, and a section's actual UI lives beside it rather than inside it.
//
// WHAT THE USER DOES ONCE: in Discord, open the channel they want cards in, Edit channel,
// Integrations, Webhooks, New Webhook, Copy Webhook URL. Paste, Save. From then on the share
// dialog has a Post to Discord button. No bot, no login, no account of theirs this app can reach.
//
// THE FIELD IS ALWAYS EMPTY WHEN THIS CARD MOUNTS, AND THAT IS THE DESIGN. What is stored is a
// SECRET (anyone holding it can post to that channel forever), so it never comes back across IPC:
// main hands out a masked view and nothing else (src/main/storeDiscord.ts). A text box that
// re-showed the value would need the value. So the card states what is stored in words, next to
// Test and Remove, and the box is for pasting a NEW one.
//
// AND THE PARSING IS MAIN'S. This card does not test the string, does not know the hosts and does
// not know what a token looks like — `discord:setWebhook` refuses a bad paste with a sentence and
// this shows it. One validator, at the boundary that is about to make the request
// (src/shared/discordWebhook.ts).

import { type JSX, useState } from 'react'
import { Button, Stack, TextField, Typography } from '@mui/material'
import ForumIcon from '@mui/icons-material/Forum'
import type { DiscordWebhookView } from '@shared/discordWebhook'
import { recordPref, usePrefsSeed } from './prefsHydration'
import type { PrefSection } from './PreferencesView'

/** What the card is saying right now: nothing, an outcome, or a refusal. */
interface Status {
  text: string
  bad: boolean
}

const NONE: Status = { text: '', bad: false }

/** The one line of help, which is the whole setup written out. */
const HELP = 'In Discord: channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL.'

/** What the card says while it is waiting on main, so a slow round trip is not silence. */
const WORKING: Status = { text: 'Working…', bad: false }

/** The stored webhook in words, or the invitation to add one. */
function CurrentValue({ view }: { view: DiscordWebhookView }): JSX.Element {
  return (
    <Typography variant="body2" color="text.secondary" data-testid="pref-discord-current">
      {view.set ? `Posting to ${view.masked ?? 'a channel webhook'}` : 'No channel webhook yet.'}
    </Typography>
  )
}

/** Save / Test / Remove. Its own component so the card stays inside the function-line ceiling. */
function SharingButtons({
  view,
  busy,
  canSave,
  onSave,
  onTest,
  onRemove
}: {
  view: DiscordWebhookView
  busy: boolean
  canSave: boolean
  onSave: () => void
  onTest: () => void
  onRemove: () => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap">
      <Button size="small" variant="outlined" data-testid="pref-discord-save" disabled={busy || !canSave} onClick={onSave}>
        Save
      </Button>
      <Button size="small" variant="outlined" data-testid="pref-discord-test" disabled={busy || !view.set} onClick={onTest}>
        Test
      </Button>
      <Button size="small" data-testid="pref-discord-remove" disabled={busy || !view.set} onClick={onRemove}>
        Remove
      </Button>
    </Stack>
  )
}

export function SharingSetting(): JSX.Element {
  // SEEDED SYNCHRONOUSLY (JOS-340): the pane's gate has already read main, so this card's first
  // painted frame states what is actually stored rather than "nothing here yet".
  const seed = usePrefsSeed()
  const [view, setView] = useState<DiscordWebhookView>(seed.discordWebhook)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>(NONE)
  const [busy, setBusy] = useState(false)

  // MAIN'S REPLY IS AUTHORITATIVE, and it is what the cache keeps (prefsSnapshot.ts): the card
  // never assembles a view of its own out of what it just sent.
  const adopt = (next: DiscordWebhookView): void => {
    setView(next)
    recordPref('discordWebhook', next)
  }

  const save = (): void => {
    setBusy(true)
    setStatus(WORKING)
    void window.eq
      .setDiscordWebhook(text.trim())
      .then((res) => {
        if (!res.ok) {
          setStatus({ text: res.error, bad: true })
          return
        }
        adopt(res.view)
        setText('')
        setStatus({ text: 'Saved. Try Test to see a message appear in the channel.', bad: false })
      })
      .catch(() => {
        setStatus({ text: 'That webhook could not be saved.', bad: true })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const test = (): void => {
    setBusy(true)
    setStatus(WORKING)
    void window.eq
      .testDiscordWebhook()
      .then((res) => {
        setStatus(
          res.ok
            ? { text: 'Sent. Check the channel.', bad: false }
            : { text: res.error ?? 'Could not reach Discord.', bad: true }
        )
      })
      .catch(() => {
        setStatus({ text: 'Could not reach Discord.', bad: true })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  const remove = (): void => {
    setBusy(true)
    setStatus(WORKING)
    void window.eq
      .clearDiscordWebhook()
      .then((next) => {
        adopt(next)
        setStatus({ text: 'Removed. Nothing is posted to Discord now.', bad: false })
      })
      .catch(() => {
        setStatus({ text: 'That webhook could not be removed.', bad: true })
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <Stack spacing={1}>
      <CurrentValue view={view} />
      <TextField
        size="small"
        fullWidth
        label="Discord webhook URL"
        placeholder="https://discord.com/api/webhooks/…"
        value={text}
        data-testid="pref-discord-webhook"
        onChange={(e) => {
          setText(e.target.value)
          setStatus(NONE)
        }}
      />
      <SharingButtons view={view} busy={busy} canSave={text.trim() !== ''} onSave={save} onTest={test} onRemove={remove} />
      <Typography variant="caption" color="text.secondary">
        {HELP}
      </Typography>
      {status.text !== '' && (
        <Typography variant="body2" color={status.bad ? 'error' : 'success.main'} data-testid="pref-discord-status">
          {status.text}
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
        keywords: 'discord webhook share post channel chat server card character profile link integration',
        content: <SharingSetting />
      }
    ]
  }
}
