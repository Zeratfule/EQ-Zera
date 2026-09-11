// combat/share/FightShareDialog — the four ways out of a fight.
//
//   Copy image       the card, photographed by main and put on the clipboard as an IMAGE
//   Save image…      the same photograph, through the OS save dialog
//   Post to Discord  the card ATTACHED to a message, with the numbers beside it as an embed
//   Copy text        the same numbers as plain text, for a chat client that mangles pictures
//
// THE IMAGE IS TAKEN WHERE THE CARD IS, not rendered offscreen: each button hands main the card's
// own `getBoundingClientRect()` and main photographs those pixels (src/main/ipc/cardCapture.ts,
// the same path the character card uses). That is why the buttons sit OUTSIDE the card rather than
// on it - an affordance drawn on the card would be a dead pixel in the copy.
//
// POST TO DISCORD IS NOT A LINK (and this is the one place it differs from the character dialog).
// Nothing is published, nothing is served afterwards, and there is no url to copy: the bytes ride
// inside the message. It is disabled - with a native title saying where to fix that - until a
// channel is connected, and beside it sits a picker WHEN THERE IS MORE THAN ONE. The webhook
// tokens are secrets main keeps (./useFightDiscordPost.ts, src/main/share/discord.ts).

import { type JSX, useCallback, useRef } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ForumIcon from '@mui/icons-material/Forum'
import ImageIcon from '@mui/icons-material/Image'
import SaveAltIcon from '@mui/icons-material/SaveAlt'
import { fightShareText, type FightShare } from '@shared/fightShare'
import { copyText } from '../../../lib/clipboard'
import { DISCORD_HINT, DiscordChannelPicker, showsSettingsLink } from '../../../lib/discordChannels'
import { ActionButton, useFlash, type Flash } from '../../../lib/shareActions'
import FightCard from './FightCard'
import { useFightDiscordPost, type FightCardRect, type FightDiscordState } from './useFightDiscordPost'

/** The four ways out, in one row. Its own component so the dialog stays inside the line ceiling. */
function FightShareActions({
  flash,
  summary,
  discord,
  onImage,
  onCopyText
}: {
  flash: Flash
  summary: string
  discord: FightDiscordState
  onImage: (op: 'copy' | 'save') => void
  onCopyText: () => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
      <ActionButton
        testId="combat-share-copy-image"
        label="Copy image"
        icon={<ImageIcon />}
        flash={flash}
        disabled={false}
        onRun={() => {
          onImage('copy')
        }}
      />
      <ActionButton
        testId="combat-share-save-image"
        label="Save image…"
        icon={<SaveAltIcon />}
        flash={flash}
        disabled={false}
        onRun={() => {
          onImage('save')
        }}
      />
      <ActionButton
        testId="combat-share-discord"
        label="Post to Discord"
        icon={<ForumIcon />}
        flash={flash}
        disabled={!discord.ready}
        {...(discord.ready ? {} : { hint: DISCORD_HINT })}
        onRun={discord.post}
      />
      <DiscordChannelPicker state={discord} testId="combat-share-discord-channel" />
      <ActionButton
        testId="combat-share-copy-text"
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
 * What went wrong with a post, and - when what went wrong is that nothing is set up yet - the way
 * to go and set it up. The door is offered ONLY for that one sentence: a rate limit or an
 * unreachable Discord is not something Preferences can fix.
 */
function FightDiscordRow({
  discord,
  onOpenSharingPrefs
}: {
  discord: FightDiscordState
  onOpenSharingPrefs: () => void
}): JSX.Element | null {
  if (discord.error === '') return null
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', mt: 1 }} useFlexGap>
      <Typography variant="body2" color="error" data-testid="combat-share-discord-error">
        {discord.error}
      </Typography>
      {showsSettingsLink(discord.error) && (
        <Button size="small" data-testid="combat-share-discord-settings" onClick={onOpenSharingPrefs}>
          Open Preferences, Sharing
        </Button>
      )}
    </Stack>
  )
}

export default function FightShareDialog({
  fight,
  onClose,
  onOpenSharingPrefs
}: {
  fight: FightShare
  onClose: () => void
  /** The way to Preferences, Sharing - handed down from the Combat tab, like the character card's. */
  onOpenSharingPrefs: () => void
}): JSX.Element {
  const { flash, report } = useFlash()
  const cardRef = useRef<HTMLDivElement>(null)

  // The card's own rectangle, read at the moment a button is pressed - main photographs the pixels
  // that are on screen, so a rectangle measured on mount would be one from before the reader
  // scrolled the dialog.
  const rectOf = useCallback((): FightCardRect | null => {
    const el = cardRef.current
    if (!el) return null
    const box = el.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }, [])

  const shareImage = useCallback(
    (op: 'copy' | 'save') => {
      const rect = rectOf()
      if (rect === null) return
      const id = op === 'copy' ? 'combat-share-copy-image' : 'combat-share-save-image'
      void window.eq
        .shareFightImage(rect, op, fight.mob)
        .then((res) => {
          if (res.ok) report(id, op === 'copy' ? 'Copied' : 'Saved')
          else if (res.canceled !== true) report(id, 'Could not')
        })
        .catch(() => {
          report(id, 'Could not')
        })
    },
    [rectOf, fight.mob, report]
  )

  const summary = fightShareText(fight)
  const copySummary = useCallback(() => {
    void copyText(summary).then((ok) => {
      report('combat-share-copy-text', ok ? 'Copied' : 'Could not')
    })
  }, [summary, report])

  const discord = useFightDiscordPost(fight, rectOf, report)

  return (
    <Dialog open fullWidth maxWidth={false} onClose={onClose} scroll="paper">
      <DialogTitle sx={{ pb: 0.5 }}>Share this fight</DialogTitle>
      <DialogContent
        data-testid="combat-share-dialog"
        sx={{ display: 'flex', justifyContent: 'center' }}
      >
        <Box ref={cardRef} sx={{ flexShrink: 0 }}>
          <FightCard fight={fight} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, display: 'block' }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <FightShareActions
            flash={flash}
            summary={summary}
            discord={discord}
            onImage={shareImage}
            onCopyText={copySummary}
          />
          <Button size="small" onClick={onClose} data-testid="combat-share-close">
            Close
          </Button>
        </Stack>
        <FightDiscordRow discord={discord} onOpenSharingPrefs={onOpenSharingPrefs} />
      </DialogActions>
    </Dialog>
  )
}
