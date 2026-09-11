// DiscordChannelList — the channels this install can post to, one row each
// (owner, 2026-09-11; docs/plans/discord-connect.md).
//
// Its own file because SharingSetting.tsx is the CARD - the Connect button, the wait and the
// advanced paste - and a list with a per-row editor inside it would put that card past the repo's
// factoring ceiling. Same split as PreferencesView.tsx and the sections it renders.
//
// WHAT A ROW IS: a Default radio, a label, and the three things you can do to it. The radio is a
// radio rather than a menu because "which channel do posts go to" has exactly one answer and the
// control that says so should look like it. With ONE channel the radio is still drawn and still
// checked - a single row that could not be selected would read as broken, and the person who
// connects a second one should find the control where it already was.
//
// RENAME IS INLINE AND OPTIMISTIC ABOUT NOTHING. The row becomes a text box; Save sends it and
// main answers with the list as stored, CLAMPED to 60 characters. What the row then draws is
// main's label, never the draft - so a paste of a paragraph visibly becomes what was kept.

import { type JSX, useState } from 'react'
import { Button, Radio, Stack, TextField, Typography } from '@mui/material'
import type { DiscordChannelView } from '@shared/discordChannels'
import type { DiscordChannelsState } from './useDiscordChannels'

/** The three buttons a row carries, and the one it becomes while it is being renamed. */
function RowActions({
  channel,
  state,
  editing,
  onRename
}: {
  channel: DiscordChannelView
  state: DiscordChannelsState
  editing: boolean
  onRename: () => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={0.5}>
      <Button
        size="small"
        data-testid={`pref-discord-test-${channel.id}`}
        disabled={state.busy}
        onClick={() => {
          state.test(channel.id)
        }}
      >
        Test
      </Button>
      <Button size="small" data-testid={`pref-discord-rename-${channel.id}`} disabled={state.busy} onClick={onRename}>
        {editing ? 'Save' : 'Rename'}
      </Button>
      <Button
        size="small"
        color="inherit"
        data-testid={`pref-discord-remove-${channel.id}`}
        disabled={state.busy}
        onClick={() => {
          state.remove(channel.id)
        }}
      >
        Remove
      </Button>
    </Stack>
  )
}

/** One channel. The label is either text or the box it is being edited in. */
function ChannelRow({
  channel,
  state,
  editing,
  draft,
  onEdit
}: {
  channel: DiscordChannelView
  state: DiscordChannelsState
  editing: boolean
  draft: string
  onEdit: (id: string | null, draft: string) => void
}): JSX.Element {
  const commit = (): void => {
    if (!editing) {
      onEdit(channel.id, channel.label)
      return
    }
    const next = draft.trim()
    if (next !== '' && next !== channel.label) state.rename(channel.id, next)
    onEdit(null, '')
  }
  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{ flexWrap: 'wrap' }}
      useFlexGap
      data-testid={`pref-discord-channel-${channel.id}`}
    >
      <Radio
        size="small"
        checked={state.view.defaultId === channel.id}
        slotProps={{ input: { 'aria-label': `Post to ${channel.label} by default` } }}
        data-testid={`pref-discord-default-${channel.id}`}
        disabled={state.busy}
        onChange={() => {
          state.makeDefault(channel.id)
        }}
      />
      {editing ? (
        <TextField
          size="small"
          value={draft}
          autoFocus
          data-testid={`pref-discord-rename-field-${channel.id}`}
          onChange={(e) => {
            onEdit(channel.id, e.target.value)
          }}
        />
      ) : (
        <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 120 }}>
          {channel.label}
        </Typography>
      )}
      <RowActions channel={channel} state={state} editing={editing} onRename={commit} />
    </Stack>
  )
}

/** Every channel, oldest first, or nothing at all when this install has none yet. */
export function DiscordChannelList({ state }: { state: DiscordChannelsState }): JSX.Element | null {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const channels = state.view.channels
  if (channels.length === 0) return null
  const onEdit = (id: string | null, next: string): void => {
    setEditing(id)
    setDraft(next)
  }
  return (
    <Stack spacing={0.5} data-testid="pref-discord-channels">
      {channels.map((channel) => (
        <ChannelRow
          key={channel.id}
          channel={channel}
          state={state}
          editing={editing === channel.id}
          draft={draft}
          onEdit={onEdit}
        />
      ))}
    </Stack>
  )
}
