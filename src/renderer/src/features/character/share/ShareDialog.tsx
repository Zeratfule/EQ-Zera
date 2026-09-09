// character/share/ShareDialog — the five ways out of a character profile.
//
//   Copy image        the card, photographed by main and put on the clipboard as an IMAGE
//   Save image…       the same photograph, through the OS save dialog
//   Copy share string  the `EQC1-` string, which another EQ Zera reader pastes into the viewer
//   Copy text          a plain summary, for a chat client that would mangle a long string
//   Copy link         the same card published as a share.eqzera.com page, which unfurls in chat
//
// THE LINK IS MAIN'S WORK, ALL OF IT. The renderer performs no fetch (`connect-src 'self'`), so
// the button hands main the card's rectangle and its profile and gets back a url or a sentence;
// the private token that can revoke the link never comes here at all (shared/shareLinks.ts). One
// link per character: pressing the button again replaces the card the SAME url shows, which is
// what `updated` reports and why the outcome says "Link updated" rather than "Link copied".
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
import LinkIcon from '@mui/icons-material/Link'
import SaveAltIcon from '@mui/icons-material/SaveAlt'
import type { CharacterProfileShare } from '@shared/characterShare'
import type { CardMapEntry } from '@shared/shareCardMap'
import { copyText } from '../../../lib/clipboard'
import { measureCardMap } from './measureCardMap'
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

/** The five ways out, in one row. Its own component so the dialog stays inside the line ceiling. */
function ShareActions({
  flash,
  hasCard,
  text,
  summary,
  onImage,
  onCopy,
  onLink
}: {
  flash: Flash
  hasCard: boolean
  text: string
  summary: string
  onImage: (op: 'copy' | 'save') => void
  onCopy: (id: string, payload: string) => void
  onLink: () => void
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
        testId="character-share-copy-link"
        label="Copy link"
        icon={<LinkIcon />}
        flash={flash}
        disabled={!hasCard}
        onRun={onLink}
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

/** The card's rectangle in CSS pixels, as main wants it. Main clamps and scales what it gets. */
interface CardRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * ONE READING OF THE CARD: the rectangle main photographs, and where each worn cell sits inside
 * that same rectangle. They are taken together on purpose - the map is in fractions OF this
 * picture, so a map measured at another moment would describe a card of another size.
 */
interface CardShot {
  rect: CardRect
  cardMap: CardMapEntry[]
}

/** What the dialog knows about this character's published link, and the two ways to move it. */
interface LinkState {
  /** the published url, or '' when this character has none */
  url: string
  /** the last failure's own sentence, or '' */
  error: string
  publish: () => void
  revoke: () => void
}

/**
 * The link half of the dialog. Its own hook because publishing is a round trip and a component
 * that also owns one reads as two things; the loads and the writes both go through main, which
 * is the only side that ever holds the token that can revoke a link.
 */
function useShareLink(
  profile: CharacterProfileShare | null,
  shotOf: () => CardShot | null,
  report: (id: string, outcome: string) => void
): LinkState {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [id, setId] = useState('')

  // WHAT THIS CHARACTER ALREADY HAS. Main decides what "this character" means
  // (shared/shareLinks.ts) so the dialog cannot hold a second opinion about it, and the reply is
  // re-read after a publish rather than reconstructed from the url: the id is main's to state.
  const load = useCallback(() => {
    if (profile === null) return
    void window.eq
      .listCharacterLinks({ name: profile.name, classes: profile.classes })
      .then((links) => {
        const first = links[0]
        setUrl(first?.url ?? '')
        setId(first?.id ?? '')
      })
      .catch(() => {
        // A read that did not answer is not a failure the reader can act on: the button still
        // works, and publishing is what tells them where their link is.
      })
  }, [profile])

  useEffect(load, [load])

  const publish = useCallback(() => {
    const shot = shotOf()
    if (profile === null || shot === null) return
    setError('')
    void window.eq
      .shareCharacterLink(shot.rect, profile, shot.cardMap)
      .then(async (res) => {
        if (!res.ok) {
          setError(res.error)
          report('character-share-copy-link', 'Could not')
          return
        }
        setUrl(res.url)
        load()
        const copied = await copyText(res.url)
        report('character-share-copy-link', copied ? (res.updated ? 'Link updated' : 'Link copied') : 'Could not')
      })
      .catch(() => {
        setError('The link could not be created.')
        report('character-share-copy-link', 'Could not')
      })
  }, [profile, shotOf, report, load])

  const revoke = useCallback(() => {
    if (id === '') return
    setError('')
    void window.eq
      .revokeCharacterLink(id)
      .then((res) => {
        if (!res.ok) {
          setError(res.error ?? 'That link could not be revoked.')
          return
        }
        setUrl('')
        setId('')
        report('character-share-revoke', 'Link revoked')
      })
      .catch(() => {
        setError('That link could not be revoked.')
      })
  }, [id, report])

  return { url, error, publish, revoke }
}

/** The published link, when there is one, and the way to take it back. */
function ShareLinkRow({ link, flash }: { link: LinkState; flash: Flash }): JSX.Element | null {
  if (link.url === '' && link.error === '') return null
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
      {link.url !== '' && (
        <>
          <Typography variant="body2" color="text.secondary" data-testid="character-share-link" sx={{ wordBreak: 'break-all' }}>
            {link.url}
          </Typography>
          <Button
            size="small"
            data-testid="character-share-revoke"
            {...(flash.id === 'character-share-revoke' ? { 'data-flash': flash.outcome } : {})}
            onClick={link.revoke}
          >
            {flash.id === 'character-share-revoke' ? flash.outcome : 'Revoke'}
          </Button>
        </>
      )}
      {link.error !== '' && (
        <Typography variant="body2" color="error" data-testid="character-share-link-error">
          {link.error}
        </Typography>
      )}
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

  // The card's own rectangle AND its cells' places inside it, read at the moment the button is
  // pressed - main photographs the pixels that are on screen, so a rectangle measured on mount
  // would be a rectangle from before the reader scrolled, and the map would be of that card.
  const shotOf = useCallback((): CardShot | null => {
    const el = cardRef.current
    if (!el) return null
    const box = el.getBoundingClientRect()
    return {
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      cardMap: measureCardMap(el)
    }
  }, [])

  const link = useShareLink(profile, shotOf, report)

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
      <DialogActions sx={{ px: 3, pb: 2, display: 'block' }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <ShareActions
            flash={flash}
            hasCard={profile !== null}
            text={text}
            summary={summary}
            onImage={shareImage}
            onCopy={copy}
            onLink={link.publish}
          />
          <Button size="small" onClick={onClose} data-testid="character-share-close">
            Close
          </Button>
        </Stack>
        <ShareLinkRow link={link} flash={flash} />
      </DialogActions>
    </Dialog>
  )
}
