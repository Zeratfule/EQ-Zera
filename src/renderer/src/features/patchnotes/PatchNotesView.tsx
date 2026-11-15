// PatchNotesView — the EverQuest Legends developers' patch and hotfix notes.
//
// A list on the left (newest first, as main sends it), the selected note on the right. Opening a
// note marks it read; the dot on a row and the count on the nav row are main's unread answer, so
// the renderer never counts anything. Main downloads on launch and on "Check now"; this view only
// reads the cache, which is why it opens instantly and works offline.

import { type JSX, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, Link, List, ListItemButton, Paper, Stack, Typography } from '@mui/material'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import type { PatchNoteRow, PatchNotesView as View } from '@shared/patchNotes'
import type { PatchNoteArticle } from '@shared/patchNotesParse'
import { formatAge, formatDate } from '../../lib/formatDate'
import PatchNoteBody from './PatchNoteBody'
import { loadSelectedNote, rememberSelectedNote, usePatchNotes } from './usePatchNotes'

const LIST_WIDTH = 300
const DATE_OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }

function KindChip({ row }: { row: PatchNoteRow }): JSX.Element {
  const hotfix = row.kind === 'hotfix'
  return (
    <Chip
      size="small"
      variant="outlined"
      color={hotfix ? 'warning' : 'primary'}
      label={hotfix ? 'Hotfix' : 'Patch'}
      data-testid="patchnotes-kind"
      sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }}
    />
  )
}

function UnreadDot(): JSX.Element {
  return (
    <Box
      data-testid="patchnotes-unread-dot"
      sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flexShrink: 0 }}
    />
  )
}

function NoteRow({ row, selected, onPick }: { row: PatchNoteRow; selected: boolean; onPick: (r: PatchNoteRow) => void }): JSX.Element {
  return (
    <ListItemButton
      data-testid="patchnotes-row"
      data-page={row.pageName}
      data-read={row.read ? 'true' : 'false'}
      selected={selected}
      onClick={() => onPick(row)}
      sx={{ alignItems: 'flex-start', gap: 1, py: 1 }}
    >
      <Box sx={{ width: 8, pt: 0.75 }}>{!row.read && <UnreadDot />}</Box>
      <Stack spacing={0.4} sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: row.read ? 400 : 600 }}>
          {row.title}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <KindChip row={row} />
          <Typography variant="caption" color="text.secondary">
            {formatDate(row.postedAt, DATE_OPTS)}
          </Typography>
        </Stack>
      </Stack>
    </ListItemButton>
  )
}

/** The selected note's article, re-read when it is first downloaded. */
function useArticle(row: PatchNoteRow | null): PatchNoteArticle | null {
  const [article, setArticle] = useState<PatchNoteArticle | null>(null)
  const pageName = row?.pageName ?? null
  const downloaded = row?.downloaded ?? false
  useEffect(() => {
    let alive = true
    setArticle(null)
    if (pageName === null || !downloaded) return
    void window.eq
      .getPatchNote(pageName)
      .then((a) => {
        if (alive) setArticle(a)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [pageName, downloaded])
  return article
}

function OpenOnSite({ row }: { row: PatchNoteRow }): JSX.Element {
  return (
    <Link href={row.url} target="_blank" rel="noreferrer" variant="body2" data-testid="patchnotes-open-site">
      Open on everquestlegends.com <OpenInNewIcon sx={{ fontSize: 14, verticalAlign: 'text-bottom' }} />
    </Link>
  )
}

function NoteDetail({ row }: { row: PatchNoteRow }): JSX.Element {
  const article = useArticle(row)
  return (
    <Stack spacing={1.5} data-testid="patchnotes-detail" data-page={row.pageName}>
      <Stack spacing={0.5}>
        <Typography variant="h6" data-testid="patchnotes-detail-title">
          {row.title}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <KindChip row={row} />
          <Typography variant="body2" color="text.secondary">
            {formatDate(row.postedAt, DATE_OPTS)}
          </Typography>
          <OpenOnSite row={row} />
        </Stack>
      </Stack>
      {article ? (
        <PatchNoteBody nodes={article.body} />
      ) : (
        <Typography variant="body2" color="text.secondary" data-testid="patchnotes-not-downloaded">
          {row.downloaded ? 'Loading...' : 'Not downloaded yet. It will be on the next check, or read it on the site.'}
        </Typography>
      )}
    </Stack>
  )
}

function statusLine(view: View): string {
  if (view.checking) return 'Checking everquestlegends.com...'
  if (view.lastOkAt === null) return 'Not checked yet'
  return `Checked ${formatAge(view.lastOkAt)}`
}

function Header({ view }: { view: View }): JSX.Element {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'nowrap' }}>
      <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="h6">EverQuest Legends patch notes</Typography>
        <Typography variant="caption" color="text.secondary" data-testid="patchnotes-status">
          {statusLine(view)}
        </Typography>
      </Stack>
      <Button
        size="small"
        variant="text"
        disabled={view.unread === 0}
        data-testid="patchnotes-mark-all"
        onClick={() => void window.eq.markPatchNoteRead(null)}
      >
        Mark all read
      </Button>
      <Button
        size="small"
        variant="outlined"
        disabled={view.checking || !view.available}
        data-testid="patchnotes-check"
        onClick={() => void window.eq.checkPatchNotes()}
      >
        Check now
      </Button>
    </Stack>
  )
}

function EmptyState({ view }: { view: View }): JSX.Element {
  let text = 'No patch notes saved yet. Check now to download them.'
  if (!view.available) text = 'Patch notes are not available in this build.'
  else if (view.checking) text = 'Downloading the patch notes...'
  return (
    <Typography variant="body2" color="text.secondary" data-testid="patchnotes-empty" sx={{ p: 2 }}>
      {text}
    </Typography>
  )
}

/** Which row is on screen: the remembered one, else the newest. */
function pickRow(view: View, selected: string | null): PatchNoteRow | null {
  return view.rows.find((r) => r.pageName === selected) ?? view.rows[0] ?? null
}

function NotesPanes({ view }: { view: View }): JSX.Element {
  const [selected, setSelected] = useState<string | null>(loadSelectedNote)
  const row = pickRow(view, selected)
  const rowName = row?.pageName ?? null
  const rowRead = row?.read ?? true
  // Whatever is on screen has been read - including the note the tab opened on.
  useEffect(() => {
    if (rowName !== null && !rowRead) void window.eq.markPatchNoteRead(rowName)
  }, [rowName, rowRead])
  const onPick = (r: PatchNoteRow): void => {
    setSelected(r.pageName)
    rememberSelectedNote(r.pageName)
  }
  return (
    <Stack direction="row" spacing={2} sx={{ flexGrow: 1, minHeight: 0 }}>
      <Paper variant="outlined" sx={{ width: LIST_WIDTH, flexShrink: 0, overflow: 'auto', overscrollBehavior: 'contain' }}>
        <List dense disablePadding data-testid="patchnotes-list">
          {view.rows.map((r) => (
            <NoteRow key={r.pageName} row={r} selected={r.pageName === rowName} onPick={onPick} />
          ))}
        </List>
      </Paper>
      <Paper variant="outlined" sx={{ flexGrow: 1, minWidth: 0, overflow: 'auto', overscrollBehavior: 'contain', p: 2.5 }}>
        {row && <NoteDetail row={row} />}
      </Paper>
    </Stack>
  )
}

export default function PatchNotesView(): JSX.Element {
  const view = usePatchNotes()
  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }} data-testid="patchnotes-view">
      {view && <Header view={view} />}
      {view?.error && (
        <Alert severity="warning" variant="outlined" data-testid="patchnotes-error">
          {view.error}
        </Alert>
      )}
      {view && view.rows.length > 0 ? <NotesPanes view={view} /> : view && <EmptyState view={view} />}
    </Stack>
  )
}
