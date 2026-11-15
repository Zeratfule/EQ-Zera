// UiSkinSetting — Preferences -> In-game UI -> "EQ Zera in-game UI skin" (docs/plans/eql-ui-skin.md).
//
// Builds a recoloured copy of the game's own default skin into <EQ folder>/uifiles/EQZera, shows
// whether it is current or out of date after a game patch, removes it, and tells the player the one
// command that switches to it. Main does all the file work and decides every path; this card asks.
//
// THE NOTICE IS THE OWNER'S RULING (2026-11-15): always on the card, and confirmed once, in page,
// before the first build. The acceptance is remembered in main's store, and main refuses a build
// without it, so the confirm is not the only thing standing between a click and a write.
//
// ONE BORDER: PreferencesView wraps each item in an outlined Paper, so this renders bare Stacks.

import { type JSX, useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, IconButton, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import BrushIcon from '@mui/icons-material/Brush'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { UI_SKIN_COMMAND, type UiSkinProgress, type UiSkinView } from '@shared/uiSkin'
import { UI_SKIN_DISCLAIMER } from '@shared/uiSkinDisclaimer'
import { copyText } from '../../lib/clipboard'
import type { PrefSection } from './PreferencesView'

type Confirming = 'none' | 'accept' | 'remove'

const STATE_TEXT: Record<UiSkinView['state'], string> = {
  current: 'Installed and up to date.',
  stale: 'Out of date: a game patch changed the default skin since this was built. Update it to match.',
  missing: 'Not installed.',
  foreign: 'Your uifiles folder already has an EQZera folder that EQ Zera did not create. Rename or remove it to build here.',
  noSource: 'No default UI skin was found in your EverQuest folder. Check the folder under Game.'
}

interface SkinActions {
  view: UiSkinView | null
  progress: UiSkinProgress | null
  error: string | null
  build: () => void
  accept: () => void
  remove: () => void
}

function useUiSkin(): SkinActions {
  const [view, setView] = useState<UiSkinView | null>(null)
  const [progress, setProgress] = useState<UiSkinProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.eq.getUiSkin().then(setView)
    return window.eq.onUiSkinProgress(setProgress)
  }, [])

  const build = useCallback(() => {
    setError(null)
    setProgress({ done: 0, total: 1 })
    setView((v) => (v ? { ...v, building: true } : v))
    void window.eq.buildUiSkin().then((r) => {
      setProgress(null)
      setView(r.view)
      if (!r.ok) setError(r.error)
    })
  }, [])
  const accept = useCallback(() => {
    void window.eq.acceptUiSkin().then((v) => {
      setView(v)
      build()
    })
  }, [build])
  const remove = useCallback(() => {
    setError(null)
    void window.eq.removeUiSkin().then(setView)
  }, [])
  return { view, progress, error, build, accept, remove }
}

function ConfirmBox(props: { text: string; yes: string; onYes: () => void; onNo: () => void; testid: string }): JSX.Element {
  return (
    <Alert
      severity="warning"
      data-testid={props.testid}
      action={
        <Stack direction="row" spacing={1}>
          <Button size="small" color="inherit" onClick={props.onNo}>
            Cancel
          </Button>
          <Button size="small" variant="contained" color="warning" onClick={props.onYes} data-testid={`${props.testid}-yes`}>
            {props.yes}
          </Button>
        </Stack>
      }
    >
      {props.text}
    </Alert>
  )
}

function LoadSkinHint(): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <Stack spacing={0.25}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="body2">In game, type</Typography>
        <Box component="code" data-testid="ui-skin-command" sx={{ fontFamily: 'monospace', px: 0.75, py: 0.25, borderRadius: 1, bgcolor: 'action.hover' }}>
          {UI_SKIN_COMMAND}
        </Box>
        <Tooltip title={copied ? 'Copied' : 'Copy the command'}>
          <IconButton
            size="small"
            aria-label="Copy the command"
            data-testid="ui-skin-copy"
            onClick={() => void copyText(UI_SKIN_COMMAND).then(setCopied)}
          >
            <ContentCopyIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Or pick EQZera as the UI skin in the game&apos;s Options window. Building is safe while the game is running; load the skin again after an update to see the changes.
      </Typography>
    </Stack>
  )
}

function SkinButtons({ s, confirm }: { s: SkinActions; confirm: (c: Confirming) => void }): JSX.Element | null {
  const v = s.view
  if (!v || v.state === 'noSource' || v.state === 'foreign') return null
  const installed = isInstalled(v)
  return (
    <Stack direction="row" spacing={1}>
      <Button
        size="small"
        variant="contained"
        disabled={v.building}
        data-testid="ui-skin-build"
        onClick={() => (v.accepted ? s.build() : confirm('accept'))}
      >
        {installed ? 'Update skin' : 'Build skin'}
      </Button>
      {installed && (
        <Button size="small" color="error" disabled={v.building} data-testid="ui-skin-remove" onClick={() => confirm('remove')}>
          Remove skin
        </Button>
      )}
    </Stack>
  )
}

const isInstalled = (v: UiSkinView | null): boolean => v?.state === 'current' || v?.state === 'stale'

function StateLine({ view }: { view: UiSkinView | null }): JSX.Element {
  const built = view?.builtAt && isInstalled(view) ? ` Built ${new Date(view.builtAt).toLocaleString()}.` : ''
  return (
    <Typography variant="body2" data-testid="ui-skin-state" color={view?.state === 'stale' ? 'warning.main' : 'text.primary'}>
      {view ? STATE_TEXT[view.state] : 'Checking your game folder...'}
      {built}
    </Typography>
  )
}

function BuildFeedback({ s }: { s: SkinActions }): JSX.Element {
  const pct = s.progress && s.progress.total > 0 ? (100 * s.progress.done) / s.progress.total : 0
  return (
    <>
      {s.progress && <LinearProgress variant="determinate" data-testid="ui-skin-progress" value={pct} />}
      {s.error && (
        <Alert severity="error" data-testid="ui-skin-error">
          The skin could not be built: {s.error}
        </Alert>
      )}
    </>
  )
}

/** The two in-page confirms, or the buttons when neither is open. */
function SkinControls({ s }: { s: SkinActions }): JSX.Element {
  const [confirming, setConfirming] = useState<Confirming>('none')
  const answer = (then: () => void) => (): void => {
    setConfirming('none')
    then()
  }
  const no = (): void => setConfirming('none')
  if (confirming === 'accept') {
    return <ConfirmBox testid="ui-skin-accept" text={UI_SKIN_DISCLAIMER} yes="I understand, build it" onNo={no} onYes={answer(s.accept)} />
  }
  if (confirming === 'remove') {
    return (
      <ConfirmBox
        testid="ui-skin-remove-confirm"
        text="Delete the EQZera skin folder? The game goes back to the default skin the next time it loads one."
        yes="Remove"
        onNo={no}
        onYes={answer(s.remove)}
      />
    )
  }
  return <SkinButtons s={s} confirm={setConfirming} />
}

export function UiSkinSetting(): JSX.Element {
  const s = useUiSkin()
  return (
    <Stack spacing={1.25} data-testid="pref-ui-skin">
      <Typography variant="body2">
        Recolors the game&apos;s own windows, buttons, frames and gauges in EQ Zera&apos;s colors. Icons, spell gems and item art stay as they are.
      </Typography>
      <Alert severity="warning" data-testid="ui-skin-disclaimer">
        {UI_SKIN_DISCLAIMER}
      </Alert>
      <StateLine view={s.view} />
      <BuildFeedback s={s} />
      <SkinControls s={s} />
      {isInstalled(s.view) && <LoadSkinHint />}
    </Stack>
  )
}

export function uiSkinSection(): PrefSection {
  return {
    id: 'ingame-ui',
    label: 'In-game UI',
    icon: <BrushIcon fontSize="small" />,
    items: [
      {
        id: 'ui-skin',
        label: 'EQ Zera in-game UI skin',
        keywords:
          'skin ui theme in game ingame loadskin uifiles windows colors colours recolor purple violet custom interface eqzera',
        content: <UiSkinSetting />
      }
    ]
  }
}
