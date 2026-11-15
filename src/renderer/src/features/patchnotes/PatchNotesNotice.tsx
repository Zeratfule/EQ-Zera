// PatchNotesNotice — the one quiet line a launch shows when the developers posted something new.
//
// Main decides WHAT is new (a note this check found that the previous index did not have; the
// first index an install ever reads announces nothing) and holds the notice until it is
// dismissed, so this card only states it. A snackbar, never an overlay or a modal: it hides on its
// own, ignores clickaway, and "Read" opens the Patch Notes tab.
//
// PatchNotesBadge lives here too: the nav row's unread count, from the same main-side view.

import type { JSX } from 'react'
import { Alert, Box, Button, Snackbar } from '@mui/material'
import { rememberSelectedNote, usePatchNotes } from './usePatchNotes'
import { PALETTE } from '../../../../shared/palette'

const AUTO_HIDE_MS = 15_000

export function PatchNotesNotice({ onOpen }: { onOpen: () => void }): JSX.Element | null {
  const view = usePatchNotes()
  const notice = view?.notice ?? null
  if (notice === null) return null
  const dismiss = (): void => void window.eq.dismissPatchNotesNotice()
  const more = notice.count > 1 ? ` (and ${String(notice.count - 1)} more)` : ''
  return (
    <Snackbar
      open
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      autoHideDuration={AUTO_HIDE_MS}
      onClose={(_e, reason) => {
        if (reason !== 'clickaway') dismiss()
      }}
      data-testid="patchnotes-notice"
    >
      <Alert
        severity="info"
        variant="filled"
        onClose={dismiss}
        action={
          <Button
            size="small"
            color="inherit"
            data-testid="patchnotes-notice-open"
            onClick={() => {
              // The tab opens on the note this line named, not the one it showed last.
              rememberSelectedNote(notice.pageName)
              dismiss()
              onOpen()
            }}
          >
            Read
          </Button>
        }
        sx={{ alignItems: 'center', maxWidth: 460 }}
      >
        <span data-testid="patchnotes-notice-text">
          New EverQuest Legends notes: {notice.title}
          {more}
        </span>
      </Alert>
    </Snackbar>
  )
}

/** The nav row's unread count, or nothing when every note has been read. */
export function PatchNotesBadge(): JSX.Element | null {
  const view = usePatchNotes()
  const unread = view?.unread ?? 0
  if (unread === 0) return null
  return (
    <Box
      data-testid="nav-patchnotes-badge"
      sx={{
        minWidth: 16,
        height: 16,
        px: 0.5,
        borderRadius: 8,
        bgcolor: PALETTE.accent,
        color: 'background.paper',
        fontSize: 10,
        fontWeight: 700,
        lineHeight: '16px',
        textAlign: 'center'
      }}
    >
      {unread > 99 ? '99+' : String(unread)}
    </Box>
  )
}
