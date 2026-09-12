// overview/share/SessionShareSlot — the mount that turns the last session into a share, and
// nothing else.
//
// ITS OWN COMPONENT so `LastSessionCard.tsx` gains a MOUNT and not a derivation, and - the part
// that is load-bearing rather than tidy - so `useSessionShare`'s reads only happen while the dialog
// is open. That hook carries a combat poll, and a poll that ran whenever the Overview was on screen
// would be the second concurrent `combat:snapshot` poller the Overview's design explicitly does not
// have (`useOverviewCombat`'s header). Mounted on the press, gone on the close.
//
// A session with no duration at all is not a thing to put in somebody's channel (main refuses it
// too), so the dialog simply does not open on one - and the card withholds the button in that state
// anyway, because `lastSessionView` already answered null.

import type { JSX } from 'react'
import SessionShareDialog from './SessionShareDialog'
import { useSessionShare } from './useSessionShare'
import type { LastSessionView } from '../lastSession'

export function SessionShareSlot({
  view,
  onClose,
  onOpenSharingPrefs
}: {
  view: LastSessionView
  onClose: () => void
  /** The way to Preferences, Sharing, when the surface holding this card has one to hand down. */
  onOpenSharingPrefs?: () => void
}): JSX.Element | null {
  const session = useSessionShare(view)
  if (session === null || session.durationMs <= 0) return null
  return (
    <SessionShareDialog
      session={session}
      onClose={onClose}
      {...(onOpenSharingPrefs === undefined ? {} : { onOpenSharingPrefs })}
    />
  )
}
