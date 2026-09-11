// combat/share/useFightDiscordPost — the Post to Discord button's half of the fight dialog
// (owner, 2026-09-11: *"We should also make the Discord sharing be able to have DPS meter sharing
// also."*).
//
// Its own hook rather than more state inside the dialog, for `useDiscordPost`'s reason: posting is
// a round trip, and a component that also owns one reads as two things.
//
// THE BUTTON IS GATED ON A VIEW, NEVER ON A SECRET. The channel list, the remembered row and the
// picker are `lib/discordChannels.tsx`'s, shared with the character dialog; the tokens and the
// request are main's (src/main/share/discord.ts) and nothing here fetches anything.
//
// IT PUBLISHES NOTHING. A character card becomes a page on the share service first and the post
// wraps that link; a fight has no page, nothing to revoke and nothing left serving afterwards -
// the card's bytes ride INSIDE the message as its own attachment (src/main/ipc/combatShare.ts). So
// there is no `updated`, no url to copy back, and this hook makes exactly one round trip.
//
// THE RECTANGLE IS READ AT THE MOMENT OF THE PRESS, never on mount: main photographs the pixels
// that are on screen, so a rectangle measured earlier is a rectangle from before the reader
// scrolled.

import { useCallback, useState } from 'react'
import type { FightShare } from '@shared/fightShare'
import { useDiscordChannels, type DiscordChannelsState } from '../../../lib/discordChannels'

/** The card's rectangle, in CSS pixels, as the dialog measured it. */
export interface FightCardRect {
  x: number
  y: number
  width: number
  height: number
}

/** What the dialog needs to draw the button, plus the post and the sentence it may fail with. */
export interface FightDiscordState extends DiscordChannelsState {
  /** the last failure's own sentence, or '' */
  error: string
  post: () => void
}

export function useFightDiscordPost(
  fight: FightShare | null,
  rectOf: () => FightCardRect | null,
  report: (id: string, outcome: string) => void
): FightDiscordState {
  const list = useDiscordChannels()
  const { channelId, labelOf } = list
  const [error, setError] = useState('')

  const post = useCallback(() => {
    const rect = rectOf()
    if (fight === null || rect === null) return
    setError('')
    void window.eq
      .postFightToDiscord(rect, fight, channelId === '' ? undefined : channelId)
      .then((res) => {
        if (!res.ok) {
          setError(res.error)
          report('combat-share-discord', 'Could not')
          return
        }
        const label = labelOf(channelId)
        report('combat-share-discord', label === undefined ? 'Posted to Discord' : `Posted to ${label}`)
      })
      .catch(() => {
        setError('The fight could not be posted to Discord.')
        report('combat-share-discord', 'Could not')
      })
  }, [fight, rectOf, report, channelId, labelOf])

  return { ...list, error, post }
}
