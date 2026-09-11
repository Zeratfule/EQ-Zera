// character/share/useDiscordPost — the Post to Discord button's half of the share dialog
// (owner, 2026-09-10 and 2026-09-11; docs/plans/discord-connect.md).
//
// Its own hook rather than more state inside ShareDialog, for `useShareLink`'s reason: posting is
// a round trip, and a component that also owns one reads as two things. It is also the file that
// keeps ShareDialog.tsx inside the repo's 400-code-line factoring ceiling.
//
// THE BUTTON IS GATED ON A VIEW, NEVER ON A SECRET. All the renderer is ever told is the LIST of
// channels - ids, labels, dates - and which one is the default. The URLs, the tokens and the
// request are main's (src/main/share/discord.ts); nothing here fetches anything.
//
// THE CHANNEL LIST IS NOT THIS FILE'S ANY MORE. Reading it, remembering which row and drawing the
// picker moved to `lib/discordChannels.tsx` when the FIGHT card became a second thing that posts
// (2026-09-11): two copies of "where does this go" is two answers to it. What is left here is the
// PROFILE half - the publish, the post, and the sentences that press reports.
//
// AND THE POST IS THE SAME PUBLISH COPY LINK PERFORMS. The measure-then-publish flow is identical
// because it is literally the same main-side function (`publishCharacterLink`), handed the same
// rectangle and the same hotspot map, taken in the same breath for the same reason: a map from
// another moment describes a card of another size.

import { useCallback, useState } from 'react'
import type { CharacterProfileShare } from '@shared/characterShare'
import type { CardMapEntry } from '@shared/shareCardMap'
import { useDiscordChannels, type DiscordChannelsState } from '../../../lib/discordChannels'

/** The card's rectangle and its cells' places inside it, read together. ShareDialog measures it. */
export interface CardShot {
  rect: { x: number; y: number; width: number; height: number }
  cardMap: CardMapEntry[]
}

/** What the dialog needs to know to draw the button, and the two things it can do. The channel
 *  half is `lib/discordChannels.tsx`'s; this adds the post and the sentence it may fail with. */
export interface DiscordPostState extends DiscordChannelsState {
  /** the last failure's own sentence, or '' */
  error: string
  post: () => void
}

export function useDiscordPost(
  profile: CharacterProfileShare | null,
  shotOf: () => CardShot | null,
  report: (id: string, outcome: string) => void
): DiscordPostState {
  const list = useDiscordChannels()
  const { channelId, labelOf } = list
  const [error, setError] = useState('')

  const post = useCallback(() => {
    const shot = shotOf()
    if (profile === null || shot === null) return
    setError('')
    void window.eq
      .postCharacterToDiscord(shot.rect, profile, shot.cardMap, channelId === '' ? undefined : channelId)
      .then((res) => {
        if (!res.ok) {
          setError(res.error)
          report('character-share-discord', 'Could not')
          return
        }
        const label = labelOf(channelId)
        report('character-share-discord', label === undefined ? 'Posted to Discord' : `Posted to ${label}`)
      })
      .catch(() => {
        setError('The card could not be posted to Discord.')
        report('character-share-discord', 'Could not')
      })
  }, [profile, shotOf, report, channelId, labelOf])

  return { ...list, error, post }
}
