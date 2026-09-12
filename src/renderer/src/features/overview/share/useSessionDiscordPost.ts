// overview/share/useSessionDiscordPost — the Post to Discord button's half of the session dialog.
//
// Its own hook rather than more state inside the dialog, for `useFightDiscordPost`'s reason:
// posting is a round trip, and a component that also owns one reads as two things.
//
// THE BUTTON IS GATED ON A VIEW, NEVER ON A SECRET. The channel list, the remembered row and the
// picker are `lib/discordChannels.tsx`'s, shared with the character and fight dialogs; the tokens
// and the request are main's (src/main/share/discord.ts) and nothing here fetches anything.
//
// IT PUBLISHES NOTHING. There is no session page, nothing to revoke and nothing left serving
// afterwards - the card's bytes ride INSIDE the message as its own attachment
// (src/main/ipc/sessionShare.ts). So there is no url to copy back, and this hook makes exactly one
// round trip.
//
// THE RECTANGLE IS READ AT THE MOMENT OF THE PRESS, never on mount: main photographs the pixels
// that are on screen, so a rectangle measured earlier is a rectangle from before the reader
// scrolled.

import { useCallback, useState } from 'react'
import type { SessionShare } from '@shared/sessionShare'
import { useDiscordChannels, type DiscordChannelsState } from '../../../lib/discordChannels'

/** The card's rectangle, in CSS pixels, as the dialog measured it. */
export interface SessionCardRect {
  x: number
  y: number
  width: number
  height: number
}

/** What the dialog needs to draw the button, plus the post and the sentence it may fail with. */
export interface SessionDiscordState extends DiscordChannelsState {
  /** the last failure's own sentence, or '' */
  error: string
  post: () => void
}

export function useSessionDiscordPost(
  session: SessionShare | null,
  rectOf: () => SessionCardRect | null,
  report: (id: string, outcome: string) => void
): SessionDiscordState {
  const list = useDiscordChannels()
  const { channelId, labelOf } = list
  const [error, setError] = useState('')

  const post = useCallback(() => {
    const rect = rectOf()
    if (session === null || rect === null) return
    setError('')
    void window.eq
      .postSessionToDiscord(rect, session, channelId === '' ? undefined : channelId)
      .then((res) => {
        if (!res.ok) {
          setError(res.error)
          report('session-share-discord', 'Could not')
          return
        }
        const label = labelOf(channelId)
        report('session-share-discord', label === undefined ? 'Posted to Discord' : `Posted to ${label}`)
      })
      .catch(() => {
        setError('The session could not be posted to Discord.')
        report('session-share-discord', 'Could not')
      })
  }, [session, rectOf, report, channelId, labelOf])

  return { ...list, error, post }
}
