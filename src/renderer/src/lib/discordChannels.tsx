// lib/discordChannels — WHICH CHANNEL A POST GOES TO, for every surface that posts one.
//
// It began inside the character share dialog (`features/character/share/useDiscordPost.ts`,
// 2026-09-10) and moved here the moment a SECOND thing could be posted (the fight card, owner
// 2026-09-11: *"We should also make the Discord sharing be able to have DPS meter sharing
// also."*). Two copies of "read the list, remember which row, draw a select" is two answers to
// "where does this go", and the one nobody was looking at is the one that would start posting to
// the wrong server.
//
// IT LIVES IN `lib/` rather than in either feature for the reason `lib/Tooltip.tsx` does: neither
// the Character tab nor the Combat tab owns it, and a component one feature imports out of another
// feature's folder is an import edge that says the wrong thing about who owns what.
//
// THE SELECTION IS GATED ON A VIEW, NEVER ON A SECRET. All the renderer is ever told is the LIST -
// ids, labels, dates - and which one main calls the default. The URLs, the tokens and the request
// are main's (src/main/share/discord.ts); nothing here fetches anything.
//
// ONE CHANNEL, NO SELECTOR. A dropdown with one row in it is a decision the reader did not need to
// be asked to make, so with a single connected channel there is no control at all and the button
// posts there.

import { useCallback, useEffect, useState, type JSX } from 'react'
import { MenuItem, Select } from '@mui/material'
import type { DiscordChannelView } from '@shared/discordChannels'

/** What a disabled post button says about itself, in one clause (UI conventions: a tooltip is for
 *  enabling an action, not for caveating it). */
export const DISCORD_HINT = 'Connect a Discord channel in Preferences, Sharing'

/** The sentence main sends when nothing is connected. MATCHED, never composed: main owns the
 *  wording, and a surface that spelled its own would drift from it. See `showsSettingsLink`. */
const NOT_CONFIGURED = 'Connect a Discord channel in Preferences, Sharing.'

/** Does this failure mean "you have not set this up yet"? Then the dialog offers the door.
 *
 *  ONLY for that one sentence: a rate limit or an unreachable Discord is not something Preferences
 *  can fix, and a button that pretended otherwise would send the reader somewhere useless. */
export function showsSettingsLink(error: string): boolean {
  return error === NOT_CONFIGURED
}

/** The channel list as a posting surface holds it, and the one thing it can change. */
export interface DiscordChannelsState {
  /** main holds at least one channel, so a post button is live */
  ready: boolean
  /** every channel, for the selector - empty when this install has none */
  channels: DiscordChannelView[]
  /** the channel a press would post to, or '' while main's own default stands */
  channelId: string
  choose: (id: string) => void
  /** the label of the channel a press would post to, or undefined when nothing names one */
  labelOf: (id: string) => string | undefined
}

/**
 * READ THE LIST ONCE, WHEN THE DIALOG OPENS.
 *
 * There is no push for this - the list changes in Preferences, which is a different tab and
 * therefore a different mount of whatever dialog is asking. A read that did not answer leaves the
 * button disabled with its own hint, which is the same thing the honest answer would have said.
 */
export function useDiscordChannels(): DiscordChannelsState {
  const [channels, setChannels] = useState<DiscordChannelView[]>([])
  const [channelId, setChannelId] = useState('')

  useEffect(() => {
    let alive = true
    void window.eq
      .listDiscordChannels()
      .then((view) => {
        if (!alive) return
        setChannels(view.channels)
        // The selection starts where main's default is, so the picker states the answer a press
        // would actually give rather than "pick one".
        setChannelId(view.defaultId ?? view.channels[0]?.id ?? '')
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const labelOf = useCallback(
    (id: string) => channels.find((c) => c.id === id)?.label,
    [channels]
  )

  return { ready: channels.length > 0, channels, channelId, choose: setChannelId, labelOf }
}

/**
 * WHICH CHANNEL, drawn only when there is something to choose. See the header for why one channel
 * draws no control at all.
 *
 * `testId` is the caller's because the two dialogs are two surfaces to a harness, and naming both
 * selects the same thing would make a spec unable to say which one it had found.
 */
export function DiscordChannelPicker({
  state,
  testId
}: {
  state: DiscordChannelsState
  testId: string
}): JSX.Element | null {
  if (state.channels.length < 2) return null
  return (
    <Select
      size="small"
      value={state.channelId}
      data-testid={testId}
      aria-label="Discord channel to post to"
      sx={{ maxWidth: 220 }}
      onChange={(e) => {
        state.choose(e.target.value)
      }}
    >
      {state.channels.map((channel) => (
        <MenuItem key={channel.id} value={channel.id}>
          {channel.label}
        </MenuItem>
      ))}
    </Select>
  )
}
