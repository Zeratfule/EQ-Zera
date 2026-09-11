// lib/shareActions — the button that reports what it just did, and the flash it reports with.
//
// EVERY WAY OUT OF A SHARE DIALOG REPORTS. A copy either happened or it did not (main's clipboard
// handler answers a boolean; the save dialog answers a path or a cancel), so each action flashes
// its own outcome for a couple of seconds instead of the UI pretending. Nothing here throws at the
// reader.
//
// It lived inside `character/share/ShareDialog.tsx` until the FIGHT dialog arrived (owner,
// 2026-09-11) and then had two callers, which is exactly one more than a component owned by one
// feature should have. `lib/` for `lib/discordChannels.tsx`'s reason: neither tab owns it, and a
// feature reaching into another feature's folder is an import edge that says the wrong thing.

import { useCallback, useEffect, useState, type JSX } from 'react'
import { Button } from '@mui/material'

/** How long an outcome stays on a button before it goes back to naming its action. */
const FLASH_MS = 2200

/** The last action that reported, and a counter so pressing the same one twice re-arms the timer. */
export interface Flash {
  id: string
  outcome: string
  n: number
}

export function useFlash(): { flash: Flash; report: (id: string, outcome: string) => void } {
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

export function ActionButton({
  testId,
  label,
  icon,
  flash,
  disabled,
  hint,
  onRun
}: {
  testId: string
  label: string
  icon: JSX.Element
  flash: Flash
  disabled: boolean
  /** a native `title`, for a button whose disabled state needs a reason (Post to Discord) */
  hint?: string
  onRun: () => void
}): JSX.Element {
  const showing = flash.id === testId
  const button = (
    <Button
      size="small"
      variant="outlined"
      data-testid={testId}
      {...(showing ? { 'data-flash': flash.outcome } : {})}
      {...(hint === undefined ? {} : { title: hint })}
      startIcon={icon}
      disabled={disabled}
      onClick={onRun}
    >
      {showing ? flash.outcome : label}
    </Button>
  )
  // MUI puts `pointer-events: none` on a disabled button, so the title on the button itself never
  // gets a hover to fire on. The wrapper is what actually shows the reason; the attribute stays on
  // the button too, because that is where a reader of the DOM looks for it.
  return hint === undefined ? button : <span title={hint}>{button}</span>
}
