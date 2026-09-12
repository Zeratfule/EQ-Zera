// CelebrationPostSetting — Preferences → Sharing → "Post celebrations to Discord".
//
// The second item in the Sharing section, and it only makes sense under the first one: the card
// above is where a channel gets CONNECTED, and this is what gets sent there without anybody
// pressing a button. Every card the celebration overlay puts on screen - a level, a boss, a Sky
// quest, a wish-list drop - becomes a message in the channel.
//
// ITS OWN FILE for the reason every other `*Setting.tsx` here is one: PreferencesView.tsx is the
// settings TABLE, a section's UI lives beside it, and SharingSetting.tsx is already a card of its
// own. Two cards in one file would push it toward the 400-code-line ceiling for no benefit.
//
// NOTHING HERE POSTS, AND NOTHING HERE HOLDS A SECRET. The switch, the picker and the six
// checkboxes are PREFERENCES; the sending happens in main, off the one function every celebration
// card already passes through (src/main/toast.ts). What crosses the bridge is a boolean, a webhook
// id the renderer already holds from the card above, a list of kinds, and a sentence main wrote.
//
// A DEAD SWITCH IS EXPLAINED, NEVER JUST GREY (the pattern the owner's 2026-08-17 review set): with
// no channel connected there is nowhere for a card to go, so the switch is disabled and the line
// under it says what to do about it - which is the card directly above this one.

import { useCallback, useEffect, useState, type JSX } from 'react'
import { Checkbox, FormControlLabel, FormGroup, Stack, Switch, Typography } from '@mui/material'
import {
  CELEBRATION_KIND_LABEL,
  CELEBRATION_POST_KINDS,
  DEFAULT_CELEBRATION_POST,
  type CelebrationPostKind,
  type CelebrationPostPrefs,
  type CelebrationPostView
} from '@shared/celebrationPost'
import type { DiscordChannelView } from '@shared/discordChannels'
import { DiscordChannelPicker, showsSettingsLink, type DiscordChannelsState } from '../../lib/discordChannels'

/** What the card promises, in one line: the text travels, the pictures do not. The icons are
 *  `eqimg://` URLs out of a local cache and Discord cannot fetch one, so saying so here is the
 *  difference between a limit and a bug report. */
const CAPTION =
  'Each card the celebration overlay shows is also posted to the channel. Cards keep their text only; item icons stay in the app.'

/** …and what a switch with nowhere to post says for itself. */
const NO_CHANNEL = 'Connect a Discord channel first.'

/** The prefs as this card holds them, and the one thing it can change. */
export interface CelebrationPostState {
  view: CelebrationPostView
  set: (patch: Partial<CelebrationPostPrefs>) => void
}

/**
 * READ ONCE, WRITE THROUGH MAIN.
 *
 * There is no push for this: nothing else in the app changes these preferences, and the card
 * remounts on every visit to Preferences (a view unmounts on every tab switch - the repo's law).
 * Every write RESOLVES to what was actually stored and that answer is what the card draws, so a
 * patch main normalized differently can never leave the checkboxes lying.
 *
 * A read that never answers leaves the shipped default on screen, which is the honest picture of an
 * install that has never turned this on.
 */
export function useCelebrationPostPrefs(): CelebrationPostState {
  const [view, setView] = useState<CelebrationPostView>({ prefs: DEFAULT_CELEBRATION_POST })

  useEffect(() => {
    let alive = true
    void window.eq
      .getCelebrationPost()
      .then((next) => {
        if (alive) setView(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const set = useCallback((patch: Partial<CelebrationPostPrefs>) => {
    void window.eq
      .setCelebrationPost(patch)
      .then(setView)
      .catch(() => undefined)
  }, [])

  return { view, set }
}

/** The connected channels, as this card needs them: the list, and which one main calls the default. */
interface ConnectedChannels {
  channels: DiscordChannelView[]
  defaultId?: string
}

/** How often the list above is re-read while the card is on screen. See `useConnectedChannels`. */
const CHANNEL_POLL_MS = 1500

/**
 * THE CHANNEL LIST, RE-READ WHILE THIS CARD IS ON SCREEN.
 *
 * `lib/discordChannels`'s own hook reads once and states its reason: the list changes in
 * Preferences, which is a different tab and therefore a different mount of whatever dialog is
 * asking. THIS card is the exception that reasoning did not cover - it lives in Preferences,
 * directly under the control that adds and removes channels, so a once-only read would leave the
 * switch dead until the user left the pane and came back, which is indistinguishable from broken.
 *
 * A POLL RATHER THAN A PUSH, because the read is a store lookup in main with nothing behind it and
 * this runs only while somebody is looking at the Sharing pane. The connect card already polls main
 * the same way while it waits for Discord (`discord:connectStatus`).
 */
function useConnectedChannels(): ConnectedChannels {
  const [list, setList] = useState<ConnectedChannels>({ channels: [] })

  useEffect(() => {
    let alive = true
    const read = (): void => {
      void window.eq
        .listDiscordChannels()
        .then((view) => {
          if (!alive) return
          setList((was) =>
            sameChannels(was, view) ? was : { channels: view.channels, ...(view.defaultId === undefined ? {} : { defaultId: view.defaultId }) }
          )
        })
        .catch(() => undefined)
    }
    read()
    const timer = window.setInterval(read, CHANNEL_POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return list
}

/** Is this the same list it already had? Compared so an unchanged poll re-renders nothing - a fresh
 *  object every 1.5 s would re-render the pane forever. */
function sameChannels(was: ConnectedChannels, next: ConnectedChannels): boolean {
  if (was.defaultId !== next.defaultId || was.channels.length !== next.channels.length) return false
  return was.channels.every((c, i) => c.id === next.channels[i]?.id && c.label === next.channels[i]?.label)
}

/** The six checkboxes, in `CELEBRATION_POST_KINDS`' own order so the list and its labels cannot
 *  come apart. A kind is added or removed by rewriting the whole list - main normalizes it back
 *  into that order, so what comes home always matches what is drawn. */
function KindChecks({ state }: { state: CelebrationPostState }): JSX.Element {
  const chosen = state.view.prefs.kinds
  return (
    <FormGroup row data-testid="pref-celebration-post-kinds">
      {CELEBRATION_POST_KINDS.map((kind: CelebrationPostKind) => (
        <FormControlLabel
          key={kind}
          control={
            <Checkbox
              size="small"
              data-testid={`pref-celebration-post-kind-${kind}`}
              checked={chosen.includes(kind)}
              onChange={(e) => {
                const kinds = e.target.checked
                  ? [...chosen, kind]
                  : chosen.filter((k) => k !== kind)
                state.set({ kinds })
              }}
            />
          }
          label={<Typography variant="body2">{CELEBRATION_KIND_LABEL[kind]}</Typography>}
        />
      ))}
    </FormGroup>
  )
}

/**
 * WHATEVER THE LAST POST FAILED WITH, in main's own words.
 *
 * `showsSettingsLink` is how every other posting surface decides whether to offer the door to
 * Preferences, Sharing. This card IS that door, so the one sentence it recognises is the one thing
 * this card must NOT repeat: the "connect a channel" line is already on screen above, and saying it
 * twice would read as two different problems. Everything else - a rate limit, an unreachable
 * Discord - is shown verbatim, because it is news and Preferences cannot fix it.
 */
function LastError({ view }: { view: CelebrationPostView }): JSX.Element | null {
  const error = view.lastError
  if (error === undefined || error === '' || showsSettingsLink(error)) return null
  return (
    <Typography variant="body2" color="error" data-testid="pref-celebration-post-error">
      {error}
    </Typography>
  )
}

/**
 * The channel selection, as `lib/discordChannels`'s picker wants it and wired so choosing one
 * PERSISTS rather than living in this mount. The selection starts at main's own DEFAULT channel, so
 * the control states the answer a celebration would actually get rather than "pick one".
 *
 * The picker draws NOTHING with fewer than two channels (that file's law: a dropdown with one row in
 * it is a question nobody needed asking), which is why this hands it the whole list either way.
 */
function channelState(list: ConnectedChannels, state: CelebrationPostState): DiscordChannelsState {
  return {
    ready: list.channels.length > 0,
    channels: list.channels,
    channelId: state.view.prefs.channelId ?? list.defaultId ?? list.channels[0]?.id ?? '',
    choose: (id: string) => {
      state.set({ channelId: id })
    },
    labelOf: (id: string) => list.channels.find((c) => c.id === id)?.label
  }
}

export function CelebrationPostSetting(): JSX.Element {
  const state = useCelebrationPostPrefs()
  const list = useConnectedChannels()
  const channels = channelState(list, state)
  const prefs = state.view.prefs

  return (
    <Stack spacing={1.5} data-testid="pref-celebration-post">
      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-celebration-post-enabled"
              disabled={!channels.ready}
              checked={prefs.enabled}
              onChange={(e) => {
                state.set({ enabled: e.target.checked })
              }}
            />
          }
          label={<Typography variant="body2">Post celebrations to Discord</Typography>}
        />
        {!channels.ready && (
          <Typography variant="caption" color="text.secondary" data-testid="pref-celebration-post-hint">
            {NO_CHANNEL}
          </Typography>
        )}
      </Stack>

      {prefs.enabled && (
        <Stack spacing={1}>
          <DiscordChannelPicker state={channels} testId="pref-celebration-post-channel" />
          <KindChecks state={state} />
          <Typography variant="caption" color="text.secondary">
            {CAPTION}
          </Typography>
          <LastError view={state.view} />
        </Stack>
      )}
    </Stack>
  )
}
