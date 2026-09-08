// character/share/ViewSharedProfile — somebody else's character, read from a pasted string.
//
// READ-ONLY, BY DESIGN AND NOT BY OMISSION. A character body is a SNAPSHOT (shared/profiles.ts's
// forward-design section settled this long before there was one): you do not additively import a
// stranger's AA total into yours, so this opens a VIEWER and offers no apply, no merge and no
// "add to my wish list". Nothing it does writes anything. That is also why it is a different
// `ShareKind` from a settings bundle rather than one growing blob.
//
// THE VALIDATOR DOES THE TALKING. Every failure the codec knows about already has user-facing
// prose (`SHARE_ERROR_TEXT` - "damaged, it may have been cut off when it was copied", "made by a
// newer version"), so this prints main's answer verbatim instead of inventing a second vocabulary
// for the same failures. A pasted settings bundle gets its own sentence, because the useful thing
// to tell somebody holding a real share string is where it belongs.
//
// THE CARD IS THE SAME COMPONENT the Share dialog draws, from the same wire value. What a sharer
// checked before copying is exactly what a reader sees.
//
// A LINK IS A PASTE TOO (docs/plans/share-links.md). `character:readShare` recognizes a
// share.eqzera.com link and fetches it FROM MAIN — the renderer performs no fetch, so nothing here
// changes but the placeholder: the same box, the same button, and the same validator's prose for
// every failure, whether the profile came out of a string or off the wire.

import { type JSX, useCallback, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material'
import type { CharacterProfileShare } from '@shared/characterShare'
import { formatDate } from '../../../lib/formatDate'
import ShareCard from './ShareCard'

/** A decoded profile plus the envelope facts the provenance line reads. */
interface Viewed {
  profile: CharacterProfileShare
  createdAt: string
}

/**
 * "Shared by Vebarn on 12 Aug 2026" - the name the PROFILE carries, never one this app supplies,
 * and a moment read through the app's own date formatter (user-local, never UTC).
 *
 * The body's own `capturedAt` is preferred over the envelope's `at` because the envelope can be
 * rewritten by a re-wrap (profiles.ts's backend note: the checksum is over the BODY for exactly
 * that reason) while the capture stamp is what the sharer's card printed. Neither is trusted to
 * exist: an unreadable one simply drops the clause rather than printing an epoch.
 */
function sharedLine(view: Viewed): string {
  const who = view.profile.name ?? 'someone'
  const ts = view.profile.capturedAt > 0 ? view.profile.capturedAt : Date.parse(view.createdAt)
  const when = Number.isFinite(ts) && ts > 0 ? formatDate(ts) : ''
  return when ? `Shared by ${who} on ${when}` : `Shared by ${who}`
}

export default function ViewSharedProfile({ onClose }: { onClose: () => void }): JSX.Element {
  const [pasted, setPasted] = useState('')
  const [view, setView] = useState<Viewed | null>(null)
  const [error, setError] = useState('')

  const show = useCallback(() => {
    setError('')
    void window.eq
      .readCharacterShare(pasted)
      .then((res) => {
        if (res.ok) {
          setView({ profile: res.profile, createdAt: res.createdAt })
          return
        }
        setView(null)
        setError(res.error)
      })
      .catch(() => {
        setView(null)
        setError('That share string could not be read.')
      })
  }, [pasted])

  return (
    <Dialog open fullWidth maxWidth={false} onClose={onClose} scroll="paper">
      <DialogTitle sx={{ pb: 0.5 }}>View a shared profile</DialogTitle>
      <DialogContent data-testid="character-share-viewer">
        <Stack spacing={1.25} alignItems="center">
          <Stack direction="row" spacing={1} sx={{ width: '100%', maxWidth: 720 }} alignItems="flex-start">
            <TextField
              size="small"
              fullWidth
              multiline
              maxRows={3}
              placeholder="Paste a share string or a share.eqzera.com link"
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value)
              }}
              slotProps={{ htmlInput: { 'data-testid': 'character-share-paste' } }}
            />
            <Button
              size="small"
              variant="contained"
              data-testid="character-share-show"
              disabled={pasted.trim() === ''}
              onClick={show}
              sx={{ flexShrink: 0, mt: 0.25 }}
            >
              Show profile
            </Button>
          </Stack>
          {error !== '' && (
            <Typography variant="body2" color="error" data-testid="character-share-error" sx={{ maxWidth: 720 }}>
              {error}
            </Typography>
          )}
          {view && (
            <Box sx={{ flexShrink: 0 }}>
              <ShareCard profile={view.profile} sharedLine={sharedLine(view)} />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={onClose} data-testid="character-share-view-close">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
