// VoiceSetupLink — the one-line annotation an alert wears when it says it will SPEAK but the
// chosen voice tier has nothing to speak with, and the link that fixes it.
//
// IT REPLACED A DEAD END. The row and the editor used to annotate the voice outputs with
// "(voice is off — Preferences → Voice)": a sentence naming a place, in an app that could have
// taken you there. Worse, that place held a master switch whose whole job was to override the
// choice you had just made in the row — so the honest annotation is no longer "you forgot to turn
// something on" (nothing is off any more) but "the voice you picked isn't downloaded / this
// machine has no voices", and the honest control is a LINK straight into Preferences → Voice,
// which lands with the section highlighted (PreferencesView's arrival pulse).
//
// IT NEVER LIES BY OMISSION AND NEVER SHOUTS. `gap` null ⇒ nothing renders at all: an alert whose
// voice is fine must carry no chrome about voices. 'engine-not-installed' is a DOWNGRADE, not a
// failure (a Windows voice speaks meanwhile), so it is secondary text; 'no-voices' is genuine
// silence and is the one case worth a warning colour.
//
// …AND SO ARE THE TWO ENGINE FAULTS (JOS-247). A Windows voice speaks through those too, so by the
// first rule they would be secondary text — but the difference is whose fault it is. Not-downloaded
// is a step the user has not taken; a downloaded engine that will not run is broken, on their
// machine, with no step of theirs left to take. That earns the same colour silence does.
//
// The link degrades to plain text when no router was supplied (`onOpen` absent — see AlertsView's
// optional prop): the fact stays visible, only the shortcut goes.

import type { JSX } from 'react'
import { Link, Typography } from '@mui/material'
import { SPEECH_SETUP_NOTES, type SpeechSetupGap } from '../../lib/speech'

/** What this list/editor knows about voice setup, plus the one action that resolves it. */
export interface VoiceSetupNotice {
  /** The gap, or null when there is nothing to say (including "still loading"). */
  gap: SpeechSetupGap | null
  /** Navigate to Preferences → Voice. Absent ⇒ the note renders without a link. */
  onOpen?: () => void
}

export default function VoiceSetupLink({
  notice,
  testId
}: {
  notice: VoiceSetupNotice
  testId?: string
}): JSX.Element | null {
  const { gap, onOpen } = notice
  if (!gap) return null
  return (
    <Typography
      variant="caption"
      color={gap === 'engine-not-installed' ? 'text.secondary' : 'warning.main'}
      data-testid={testId ?? 'voice-setup-note'}
      sx={{ display: 'block', lineHeight: 1.4 }}
    >
      {SPEECH_SETUP_NOTES[gap]}
      {onOpen && (
        <>
          {' '}
          <Link
            component="button"
            type="button"
            variant="caption"
            underline="hover"
            data-testid="voice-setup-link"
            onClick={onOpen}
            sx={{ verticalAlign: 'baseline' }}
          >
            Set up in Preferences
          </Link>
        </>
      )}
    </Typography>
  )
}
