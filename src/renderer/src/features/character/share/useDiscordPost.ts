// character/share/useDiscordPost — the Post to Discord button's half of the share dialog
// (owner, 2026-09-10; docs/plans/discord-webhook.md).
//
// Its own hook rather than more state inside ShareDialog, for `useShareLink`'s reason: posting is
// a round trip, and a component that also owns one reads as two things. It is also the file that
// keeps ShareDialog.tsx inside the repo's 400-code-line factoring ceiling.
//
// THE BUTTON IS GATED ON A VIEW, NEVER ON A SECRET. All the renderer is ever told is `{set}` -
// whether main holds a webhook - and that is what enables the button. The URL, the token and the
// request are main's (src/main/share/discord.ts); nothing here fetches anything.
//
// AND THE POST IS THE SAME PUBLISH COPY LINK PERFORMS. The measure-then-publish flow is identical
// because it is literally the same main-side function (`publishCharacterLink`), handed the same
// rectangle and the same hotspot map, taken in the same breath for the same reason: a map from
// another moment describes a card of another size.

import { useCallback, useEffect, useState } from 'react'
import type { CharacterProfileShare } from '@shared/characterShare'
import type { CardMapEntry } from '@shared/shareCardMap'

/** The card's rectangle and its cells' places inside it, read together. ShareDialog measures it. */
export interface CardShot {
  rect: { x: number; y: number; width: number; height: number }
  cardMap: CardMapEntry[]
}

/** What the dialog needs to know to draw the button, and the one thing it can do. */
export interface DiscordPostState {
  /** main holds a webhook, so the button is live */
  ready: boolean
  /** the last failure's own sentence, or '' */
  error: string
  post: () => void
}

/** The sentence main sends when nothing is configured. Matched so the button can offer the way
 *  there - see `showsSettingsLink`. It is compared, never composed: main owns the wording. */
const NOT_CONFIGURED = 'Add a Discord webhook in Preferences, Sharing.'

/** Does this failure mean "you have not set this up yet"? Then the dialog offers the door. */
export function showsSettingsLink(error: string): boolean {
  return error === NOT_CONFIGURED
}

export function useDiscordPost(
  profile: CharacterProfileShare | null,
  shotOf: () => CardShot | null,
  report: (id: string, outcome: string) => void
): DiscordPostState {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')

  // ONE READ, WHEN THE DIALOG OPENS. There is no push for this - the value changes in
  // Preferences, which is a different tab and therefore a different mount of this dialog.
  useEffect(() => {
    let alive = true
    void window.eq
      .getDiscordWebhook()
      .then((view) => {
        if (alive) setReady(view.set)
      })
      .catch(() => {
        // A read that did not answer leaves the button disabled with its own tooltip, which is
        // the same thing the honest answer would have said.
      })
    return () => {
      alive = false
    }
  }, [])

  const post = useCallback(() => {
    const shot = shotOf()
    if (profile === null || shot === null) return
    setError('')
    void window.eq
      .postCharacterToDiscord(shot.rect, profile, shot.cardMap)
      .then((res) => {
        if (!res.ok) {
          setError(res.error)
          report('character-share-discord', 'Could not')
          return
        }
        report('character-share-discord', 'Posted to Discord')
      })
      .catch(() => {
        setError('The card could not be posted to Discord.')
        report('character-share-discord', 'Could not')
      })
  }, [profile, shotOf, report])

  return { ready, error, post }
}
