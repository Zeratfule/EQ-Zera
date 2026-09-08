import { type JSX, useEffect, useRef, useState } from 'react'
import { Box, LinearProgress, Typography } from '@mui/material'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import NewReleasesIcon from '@mui/icons-material/NewReleases'
import type { UpdateStatus } from '@shared/types'
import { updateChipLine, updateChipState } from '@shared/update'
import { formatAge } from '../lib/formatDate'
import { PALETTE, withAlpha } from '../../../shared/palette'

/**
 * UpdateChip (Task #60) — the AMBIENT update affordance, pinned in the left nav
 * directly under Preferences.
 *
 * The product rule this encodes: an update is a REWARD, not a nag. There is
 * exactly one loud state (downloaded + staged ⇒ "Restart to update", in the accent,
 * clickable, glowing softly ONCE on arrival) and one resting state (a muted
 * "checked 2h ago" line, click to check). Downloading is a hairline bar.
 *
 * AND A FAILED CHECK SAYS SO, IN THE SAME BREATH AND AT THE SAME VOLUME (JOS-307).
 * It used to render character-for-character like a successful one, admitting the
 * failure only in a `title` nobody hovers — and after a manual check that failed,
 * the cooldown line read "checked just now", a sentence about a check that did not
 * happen. It now reads "update check failed", one step out of `text.disabled` and
 * no further: still no badge, no red, no modal, no repeat. Preferences > Updates
 * remains the DETAIL surface (exact timestamp, version, manual check, error text).
 *
 * Nothing here ever re-prompts: if the user ignores the chip, apply-on-quit
 * installs the update the next time they close the app, silently.
 *
 * AND THE VERSION NUMBER HAS A DOOR NEXT TO IT (JOS-254). This line is where the
 * app states which version you are running, from every tab, all the time — so it
 * is where the question "…and what changed in it?" occurs to somebody, and a
 * small icon beside the number answers it in one click. The notes already had a
 * home (Preferences → What's new) and two ways in: a teaser strip that a user can
 * dismiss forever in half a second, and a link on a Preferences row you have to
 * already be standing on. Neither is reachable from the number itself, which is
 * why players kept asking for the changelog and going to GitHub for it (feedback
 * 01KZVG3NCT7AAFGFSPYVHBQMHN). The icon is a rail switch to that one panel, never
 * a second copy of it.
 *
 * It rides the two states that PRINT THE INSTALLED VERSION — the quiet line and
 * the dev line — and is deliberately absent from the other two: "Restart to
 * update" names the version you are about to get rather than the one you have,
 * and it is a single-action chip that a second control would dilute; downloading
 * names no version at all. Both are transient, and the quiet line comes back.
 *
 * NO MUI TOOLTIP LIVES IN THIS FILE, and that is a rule rather than an omission
 * (owner report, 2026-08-04: "it interferes with clicking Preferences more often
 * than not"). The chip is pinned DIRECTLY under the Preferences row, and a
 * `placement="top"` popper opens exactly over it — a full-width overlay that eats
 * the click the user was aiming at. The strings the tooltips carried are native
 * `title` attributes now: an OS tooltip is not in the DOM, has no hit area, and
 * cannot swallow a click. Everything with any detail to it (exact timestamp,
 * version, manual check, the error text) already lives in Preferences > Updates,
 * which is the surface this chip's own click leads to.
 *
 * The status/UI mapping (including the "we were already updated to that version"
 * demotion) is pure and tested — see src/shared/update.ts `updateChipState`.
 */

const ACCENT = PALETTE.accent
/** How often the "checked …" age re-renders. Coarse text ⇒ a lazy tick is fine. */
const AGE_TICK_MS = 60_000
/** How long the arrival glow runs before the chip settles into a calm resting look. */
const GLOW_MS = 6_000

/** Post-manual-check window: "up to date" is shown and re-checking is disabled. One
 *  answer is valid for at least this long, and it keeps a rapid clicker off GitHub. */
const CHECK_COOLDOWN_MS = 10_000

/** The one inviting, clickable state: downloaded + staged, waiting on a restart. */
function ReadyChip({
  version,
  glow,
  onInstall
}: {
  version?: string
  glow: boolean
  onInstall: () => void
}): JSX.Element {
  return (
    <Box sx={{ px: 1, pt: 0.75, pb: 1 }}>
      <Box
        component="button"
        type="button"
        data-testid="update-chip-ready"
        onClick={onInstall}
        title={version ? `Restart to update to v${version}` : 'Restart to update'}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          py: 0.9,
          border: 1,
          borderColor: withAlpha(PALETTE.accent, 0.55),
          borderRadius: 1.5,
          bgcolor: withAlpha(PALETTE.accent, 0.10),
          color: ACCENT,
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'background-color 140ms ease, border-color 140ms ease',
          '&:hover': { bgcolor: withAlpha(PALETTE.accent, 0.20), borderColor: ACCENT },
          // Soft, finite arrival glow — two slow breaths, then it rests. No
          // badge, no red, no repeat.
          ...(glow && {
            animation: 'eqUpdateGlow 3s ease-in-out 2',
            '@keyframes eqUpdateGlow': {
              '0%, 100%': { boxShadow: `0 0 0 0 ${withAlpha(PALETTE.accent, 0)}` },
              '50%': { boxShadow: `0 0 12px 1px ${withAlpha(PALETTE.accent, 0.45)}` }
            }
          })
        }}
      >
        <RestartAltIcon fontSize="small" />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            Restart to update
          </Typography>
          {version && (
            <Typography
              variant="caption"
              sx={{ display: 'block', opacity: 0.75, lineHeight: 1.2, fontFamily: 'monospace' }}
            >
              v{version}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  )
}

/**
 * The patch-notes door beside the version number (JOS-254).
 *
 * A plain button rather than MUI's IconButton, for the same reason the chips
 * above are plain buttons: this line lives at 11px in a 220px rail, and a ripple
 * surface with its own 40px hit box would own more of the row than the version it
 * sits beside. The label is a NATIVE `title` — never a MUI Tooltip, which is the
 * rule this whole file obeys (see the header: a popper here eats the click the
 * user was aiming at Preferences).
 */
function NotesButton({ onOpen }: { onOpen: () => void }): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      data-testid="update-chip-notes"
      aria-label="What's new in this version"
      title="What's new in this version"
      onClick={onOpen}
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        border: 0,
        p: 0,
        bgcolor: 'transparent',
        color: 'text.disabled',
        cursor: 'pointer',
        transition: 'color 140ms ease',
        '&:hover': { color: 'text.secondary' }
      }}
    >
      <NewReleasesIcon sx={{ fontSize: 14 }} />
    </Box>
  )
}

/**
 * The row the version line sits in: the line itself, then the notes door.
 *
 * One place rather than two, so the quiet line and the dev line can never drift
 * apart on padding — the chip's bottom-left footprint is a fixed thing and the
 * icon must land in the same spot whichever line is showing.
 */
function VersionRow({ line, notes }: { line: JSX.Element; notes: JSX.Element | null }): JSX.Element {
  return (
    <Box sx={{ px: 1, pt: 0.75, pb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>{line}</Box>
      {notes}
    </Box>
  )
}

/** Downloading: a hairline bar, still quiet. */
function DownloadingChip({ percent }: { percent: number }): JSX.Element {
  return (
    <Box sx={{ px: 1, pt: 0.75, pb: 1 }} data-testid="update-chip-downloading">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4 }}>
        Downloading update · {percent}%
      </Typography>
      <LinearProgress
        variant="determinate"
        value={percent}
        sx={{
          mt: 0.5,
          height: 2,
          borderRadius: 1,
          bgcolor: 'rgba(255,255,255,0.08)',
          '& .MuiLinearProgress-bar': { bgcolor: withAlpha(PALETTE.accent, 0.7) }
        }}
      />
    </Box>
  )
}

/**
 * Dev build: the updater is OFF, and the line says so. Without this the dev app showed
 * "not checked yet" forever — a truthful but misleading state that reads as a broken
 * production updater. Static text, not a button: clicking would no-op.
 */
function DisabledChip({ version, notes }: { version: string; notes: JSX.Element | null }): JSX.Element {
  return (
    <VersionRow
      notes={notes}
      line={
        <Typography
          data-testid="update-chip-disabled"
          variant="caption"
          title="Only the installed app auto-updates."
          sx={{ display: 'block', color: 'text.disabled', lineHeight: 1.4, cursor: 'default' }}
        >
          {version ? `v${version} · ` : ''}updates off (dev)
        </Typography>
      }
    />
  )
}

/** Working / quiet: one muted line, click to check. */
function QuietChip({
  label,
  tip,
  failed,
  disabled,
  onCheck,
  notes
}: {
  label: string
  tip: string
  failed: boolean
  disabled: boolean
  onCheck: () => void
  notes: JSX.Element | null
}): JSX.Element {
  return (
    <VersionRow
      notes={notes}
      line={
        <Box
          component="button"
          type="button"
          data-testid="update-chip-quiet"
          // The one machine-readable statement that the line is about a failure. An attribute
          // rather than a second testid: the chip is ONE control in every state, and a test that
          // has to guess which testid exists cannot assert the transition between them.
          data-failed={failed ? 'true' : 'false'}
          disabled={disabled}
          onClick={onCheck}
          title={tip}
          sx={{
            display: 'block',
            width: '100%',
            // Centred and small: this sits at the foot of the 96px nav rail and wraps to two lines.
            textAlign: 'center',
            border: 0,
            p: 0,
            bgcolor: 'transparent',
            fontFamily: 'inherit',
            fontSize: 10,
            lineHeight: 1.4,
            // ONE STEP OUT OF `text.disabled`, AND NOT ONE MORE (JOS-307). The words carry the
            // fact; this only stops them being rendered at the opacity reserved for text nobody
            // is meant to read. No warning colour, no icon, no badge — the product rule that the
            // only loud state is 'ready' is not this ticket's to move.
            color: failed ? 'text.secondary' : 'text.disabled',
            cursor: 'pointer',
            transition: 'color 140ms ease',
            '&:hover': { color: 'text.secondary' },
            '&:disabled': { cursor: 'default' }
          }}
        >
          {label}
        </Box>
      }
    />
  )
}

export function UpdateChip({ onWhatsNew }: { onWhatsNew: () => void }): JSX.Element {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [version, setVersion] = useState<string>('')
  const [now, setNow] = useState(() => Date.now())
  const [glow, setGlow] = useState(false)
  const [busy, setBusy] = useState(false)
  // Post-manual-check window: the label says "up to date" and re-checking is disabled.
  const [cooldown, setCooldown] = useState(false)
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasReady = useRef<boolean | null>(null)

  const startCooldown = (): void => {
    setCooldown(true)
    if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
    cooldownTimer.current = setTimeout(() => setCooldown(false), CHECK_COOLDOWN_MS)
  }
  useEffect(
    () => () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current)
    },
    []
  )

  useEffect(() => {
    let alive = true
    // Pull first: a push that fired before this mounted would otherwise be lost.
    void window.eq.getUpdateStatus().then((s) => {
      if (alive) setStatus(s)
    })
    void window.eq.getAppVersion().then((v) => {
      if (alive) setVersion(v)
    })
    const off = window.eq.onUpdateStatus(setStatus)
    const t = setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => {
      alive = false
      off()
      clearInterval(t)
    }
  }, [])

  const ui = updateChipState(status, version || undefined)
  const ready = ui.kind === 'ready'

  // Glow exactly ONCE, on the TRANSITION into ready. `wasReady` starts null so
  // the first observed status only seeds the baseline — remounting (or a status
  // that was already ready) never re-fires the celebration.
  useEffect(() => {
    const prev = wasReady.current
    wasReady.current = ready
    if (prev !== false || !ready) return
    setGlow(true)
    const t = setTimeout(() => setGlow(false), GLOW_MS)
    return () => clearTimeout(t)
  }, [ready])

  if (ui.kind === 'ready') {
    return <ReadyChip version={ui.version} glow={glow} onInstall={() => void window.eq.installUpdate()} />
  }

  if (ui.kind === 'downloading') return <DownloadingChip percent={ui.percent} />

  // Built once and handed to whichever version line is showing — see the header for why only
  // those two states carry it.
  const notes = <NotesButton onOpen={onWhatsNew} />

  if (ui.kind === 'quiet' && ui.disabled) return <DisabledChip version={version} notes={notes} />

  // Working / quiet. The cooldown window ALSO disables re-checking — no spinner, no extra
  // chrome, the button just won't fire again for a few seconds. One click's answer is valid
  // for at least that long, and it keeps a rapid-clicker from hammering GitHub.
  //
  // THE SENTENCE ITSELF IS PURE AND LIVES IN `shared/update.ts` (JOS-307): what this chip says
  // when a check fails is the only artefact a user like issue 29's ever produced, so it is pinned
  // by a node test rather than by whoever reads this component next.
  const { label, tip, failed } = updateChipLine(ui, {
    version,
    age: ui.checkedAt === undefined ? null : formatAge(ui.checkedAt, now),
    busy,
    cooldown
  })
  return (
    <QuietChip
      label={label}
      tip={tip}
      failed={failed}
      notes={notes}
      disabled={busy || cooldown || ui.kind === 'working'}
      onCheck={() => {
        setBusy(true)
        void window.eq.checkForUpdates().finally(() => {
          setBusy(false)
          startCooldown()
        })
      }}
    />
  )
}

export default UpdateChip
