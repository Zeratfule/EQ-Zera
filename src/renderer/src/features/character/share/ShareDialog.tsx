// character/share/ShareDialog — the four ways out of a character profile.
//
//   Copy image        the card, photographed by main and put on the clipboard as an IMAGE
//   Save image…       the same photograph, through the OS save dialog
//   Copy share string  the `EQC1-` string, which another EQ Zera reader pastes into the viewer
//   Copy text          a plain summary, for a chat client that would mangle a long string
//
// THE IMAGE IS TAKEN WHERE THE CARD IS, not rendered offscreen: the button hands main the card's
// own `getBoundingClientRect()` and main photographs those pixels (`character:shareImage`). That is
// what lets the 3D figure appear in the copy at all - there is no second scene to render - and it
// is why the buttons sit OUTSIDE the card rather than on it.
//
// EVERY BUTTON REPORTS. A copy either happened or it did not (main's clipboard handler answers a
// boolean; the save dialog answers a path or a cancel), so each action flashes its own outcome for
// a couple of seconds instead of the UI pretending. Nothing here throws at the reader.

import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ImageIcon from '@mui/icons-material/Image'
import SaveAltIcon from '@mui/icons-material/SaveAlt'
import { copyText } from '../../../lib/clipboard'
import ShareCard from './ShareCard'
import { useCharacterShare } from './useCharacterShare'

/** How long an outcome stays on a button before it goes back to naming its action. */
const FLASH_MS = 2200

/** The last action that reported, and a counter so pressing the same one twice re-arms the timer. */
interface Flash {
  id: string
  outcome: string
  n: number
}

function useFlash(): { flash: Flash; report: (id: string, outcome: string) => void } {
  const [flash, setFlash] = useState<Flash>({ id: '', outcome: '', n: 0 })
  useEffect(() => {
    if (!flash.id) return
    const timer = setTimeout(() => {
      setFlash({ id: '', outcome: '', n: 0 })
    }, FLASH_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [flash])
  const report = useCallback((id: string, outcome: string) => {
    setFlash((f) => ({ id, outcome, n: f.n + 1 }))
  }, [])
  return { flash, report }
}

function ActionButton({
  testId,
  label,
  icon,
  flash,
  disabled,
  onRun
}: {
  testId: string
  label: string
  icon: JSX.Element
  flash: Flash
  disabled: boolean
  onRun: () => void
}): JSX.Element {
  const showing = flash.id === testId
  return (
    <Button
      size="small"
      variant="outlined"
      data-testid={testId}
      {...(showing ? { 'data-flash': flash.outcome } : {})}
      startIcon={icon}
      disabled={disabled}
      onClick={onRun}
    >
      {showing ? flash.outcome : label}
    </Button>
  )
}

/** The four ways out, in one row. Its own component so the dialog stays inside the line ceiling. */
function ShareActions({
  flash,
  hasCard,
  text,
  summary,
  onImage,
  onCopy
}: {
  flash: Flash
  hasCard: boolean
  text: string
  summary: string
  onImage: (op: 'copy' | 'save') => void
  onCopy: (id: string, payload: string) => void
}): JSX.Element {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
      <ActionButton
        testId="character-share-copy-image"
        label="Copy image"
        icon={<ImageIcon />}
        flash={flash}
        disabled={!hasCard}
        onRun={() => {
          onImage('copy')
        }}
      />
      <ActionButton
        testId="character-share-save-image"
        label="Save image…"
        icon={<SaveAltIcon />}
        flash={flash}
        disabled={!hasCard}
        onRun={() => {
          onImage('save')
        }}
      />
      <ActionButton
        testId="character-share-copy-string"
        label="Copy share string"
        icon={<ContentCopyIcon />}
        flash={flash}
        disabled={text === ''}
        onRun={() => {
          onCopy('character-share-copy-string', text)
        }}
      />
      <ActionButton
        testId="character-share-copy-text"
        label="Copy text"
        icon={<ContentCopyIcon />}
        flash={flash}
        disabled={summary === ''}
        onRun={() => {
          onCopy('character-share-copy-text', summary)
        }}
      />
    </Stack>
  )
}

export default function ShareDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { profile, text, summary, image, ready } = useCharacterShare()
  const { flash, report } = useFlash()
  const cardRef = useRef<HTMLDivElement>(null)

  const shareImage = useCallback(
    (op: 'copy' | 'save') => {
      const el = cardRef.current
      if (!el) return
      const box = el.getBoundingClientRect()
      const id = op === 'copy' ? 'character-share-copy-image' : 'character-share-save-image'
      void window.eq
        .shareCharacterImage(
          { x: box.x, y: box.y, width: box.width, height: box.height },
          op,
          profile?.name ?? ''
        )
        .then((res) => {
          if (res.ok) report(id, op === 'copy' ? 'Copied' : 'Saved')
          else if (res.canceled !== true) report(id, 'Could not')
        })
        .catch(() => {
          report(id, 'Could not')
        })
    },
    [profile?.name, report]
  )

  const copy = useCallback(
    (id: string, payload: string) => {
      void copyText(payload).then((ok) => {
        report(id, ok ? 'Copied' : 'Could not')
      })
    },
    [report]
  )

  return (
    <Dialog open fullWidth maxWidth={false} onClose={onClose} scroll="paper">
      <DialogTitle sx={{ pb: 0.5 }}>Share your character</DialogTitle>
      <DialogContent
        data-testid="character-share-dialog"
        {...(text ? { 'data-share-string': text } : {})}
        sx={{ display: 'flex', justifyContent: 'center' }}
      >
        {profile === null ? (
          <Typography variant="body2" color="text.secondary" data-testid="character-share-empty" sx={{ py: 2 }}>
            {ready
              ? 'Type /outputfile inventory in EverQuest first - a share card is built from that dump.'
              : 'Reading your gear…'}
          </Typography>
        ) : (
          <Box ref={cardRef} sx={{ flexShrink: 0 }}>
            <ShareCard profile={profile} image={image} />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <ShareActions
          flash={flash}
          hasCard={profile !== null}
          text={text}
          summary={summary}
          onImage={shareImage}
          onCopy={copy}
        />
        <Button size="small" onClick={onClose} data-testid="character-share-close">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
