// overview/share/SessionShareDialog — the four ways out of a play session.
//
//   Copy image       the card, photographed by main and put on the clipboard as an IMAGE
//   Save image…      the same photograph, through the OS save dialog
//   Post to Discord  the card ATTACHED to a message, with the numbers beside it as an embed
//   Copy text        the same numbers as plain text, for a chat client that mangles pictures
//
// `FightShareDialog`'s four, deliberately: one feature, one vocabulary. What differs is the subject
// and therefore only the card inside it.
//
// THE IMAGE IS TAKEN WHERE THE CARD IS, not rendered offscreen: each button hands main the card's
// own `getBoundingClientRect()` and main photographs those pixels (src/main/ipc/cardCapture.ts).
// That is why the buttons sit OUTSIDE the card rather than on it - an affordance drawn on the card
// would be a dead pixel in the copy.
//
// POST TO DISCORD IS NOT A LINK. Nothing is published, nothing is served afterwards, and there is
// no url to copy: the bytes ride inside the message. It is disabled - with a native title saying
// where to fix that - until a channel is connected, and beside it sits a picker WHEN THERE IS MORE
// THAN ONE.
//
// THE WAY TO PREFERENCES IS OFFERED ONLY WHEN THE CARD WAS GIVEN ONE. The Overview is composed from
// cards that take no routing props of their own, so `onOpenSharingPrefs` is optional here in the
// way `FightShareState.opener` is optional there: an absent opener draws no button rather than a
// button that goes nowhere. The disabled Post button still carries the sentence naming where to go.

import { type JSX, useCallback, useRef } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ForumIcon from '@mui/icons-material/Forum'
import ImageIcon from '@mui/icons-material/Image'
import SaveAltIcon from '@mui/icons-material/SaveAlt'
import { sessionShareText, type SessionShare } from '@shared/sessionShare'
import { copyText } from '../../../lib/clipboard'
import { DISCORD_HINT, DiscordChannelPicker, showsSettingsLink } from '../../../lib/discordChannels'
import { ActionButton, useFlash, type Flash } from '../../../lib/shareActions'
import SessionCard from './SessionCard'
import { useSessionDiscordPost, type SessionCardRect, type SessionDiscordState } from './useSessionDiscordPost'

/** The four ways out, in one row. Its own component so the dialog stays inside the line ceiling. */
function SessionShareActions({
  flash,
  summary,
  discord,
  onImage,
  onCopyText
}: {
  flash: Flash
  summary: string
  discord: SessionDiscordState
  onImage: (op: 'copy' | 'save') => void
  onCopyText: () => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
      <ActionButton
        testId="session-share-copy-image"
        label="Copy image"
        icon={<ImageIcon />}
        flash={flash}
        disabled={false}
        onRun={() => {
          onImage('copy')
        }}
      />
      <ActionButton
        testId="session-share-save-image"
        label="Save image…"
        icon={<SaveAltIcon />}
        flash={flash}
        disabled={false}
        onRun={() => {
          onImage('save')
        }}
      />
      <ActionButton
        testId="session-share-discord"
        label="Post to Discord"
        icon={<ForumIcon />}
        flash={flash}
        disabled={!discord.ready}
        {...(discord.ready ? {} : { hint: DISCORD_HINT })}
        onRun={discord.post}
      />
      <DiscordChannelPicker state={discord} testId="session-share-discord-channel" />
      <ActionButton
        testId="session-share-copy-text"
        label="Copy text"
        icon={<ContentCopyIcon />}
        flash={flash}
        disabled={summary === ''}
        onRun={onCopyText}
      />
    </Stack>
  )
}

/**
 * What went wrong with a post, and - when what went wrong is that nothing is set up yet, and this
 * card was given a way there - the way to go and set it up. The door is offered ONLY for that one
 * sentence: a rate limit or an unreachable Discord is not something Preferences can fix.
 */
function SessionDiscordRow({
  discord,
  onOpenSharingPrefs
}: {
  discord: SessionDiscordState
  onOpenSharingPrefs?: () => void
}): JSX.Element | null {
  if (discord.error === '') return null
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', mt: 1 }} useFlexGap>
      <Typography variant="body2" color="error" data-testid="session-share-discord-error">
        {discord.error}
      </Typography>
      {onOpenSharingPrefs !== undefined && showsSettingsLink(discord.error) && (
        <Button size="small" data-testid="session-share-discord-settings" onClick={onOpenSharingPrefs}>
          Open Preferences, Sharing
        </Button>
      )}
    </Stack>
  )
}

export default function SessionShareDialog({
  session,
  onClose,
  onOpenSharingPrefs
}: {
  session: SessionShare
  onClose: () => void
  /** The way to Preferences, Sharing - absent while no caller has one to hand down. */
  onOpenSharingPrefs?: () => void
}): JSX.Element {
  const { flash, report } = useFlash()
  const cardRef = useRef<HTMLDivElement>(null)

  // The card's own rectangle, read at the moment a button is pressed - main photographs the pixels
  // that are on screen, so a rectangle measured on mount would be one from before the reader
  // scrolled the dialog.
  const rectOf = useCallback((): SessionCardRect | null => {
    const el = cardRef.current
    if (!el) return null
    const box = el.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }, [])

  const shareImage = useCallback(
    (op: 'copy' | 'save') => {
      const rect = rectOf()
      if (rect === null) return
      const id = op === 'copy' ? 'session-share-copy-image' : 'session-share-save-image'
      void window.eq
        .shareSessionImage(rect, op, session.character ?? '')
        .then((res) => {
          if (res.ok) report(id, op === 'copy' ? 'Copied' : 'Saved')
          else if (res.canceled !== true) report(id, 'Could not')
        })
        .catch(() => {
          report(id, 'Could not')
        })
    },
    [rectOf, session.character, report]
  )

  const summary = sessionShareText(session)
  const copySummary = useCallback(() => {
    void copyText(summary).then((ok) => {
      report('session-share-copy-text', ok ? 'Copied' : 'Could not')
    })
  }, [summary, report])

  const discord = useSessionDiscordPost(session, rectOf, report)

  return (
    <Dialog open fullWidth maxWidth={false} onClose={onClose} scroll="paper">
      <DialogTitle sx={{ pb: 0.5 }}>Share this session</DialogTitle>
      <DialogContent data-testid="session-share-dialog" sx={{ display: 'flex', justifyContent: 'center' }}>
        <Box ref={cardRef} sx={{ flexShrink: 0 }}>
          <SessionCard session={session} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, display: 'block' }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <SessionShareActions
            flash={flash}
            summary={summary}
            discord={discord}
            onImage={shareImage}
            onCopyText={copySummary}
          />
          <Button size="small" onClick={onClose} data-testid="session-share-close">
            Close
          </Button>
        </Stack>
        <SessionDiscordRow
          discord={discord}
          {...(onOpenSharingPrefs === undefined ? {} : { onOpenSharingPrefs })}
        />
      </DialogActions>
    </Dialog>
  )
}
