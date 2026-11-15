// useLuclin - the state behind the Luclin models card and the Overview Play button.
//
// Everything is main's: this hook presses doors and draws what comes back. Every mount re-reads
// GlobalLoad.txt through `checkLuclin`, which is how a LaunchPad revert is noticed when the card
// or the Overview opens (and re-applied by main when keep-applied is on).
//
// THE FIRST APPLY OR LUCLIN LAUNCH ASKS ONCE (owner ruling): the action waits behind an in-page
// notice carrying GAME_FILE_DISCLAIMER, and Accept is stored (`riskAccepted`) before it runs. Main
// refuses an apply or Luclin launch without it as well, so the tray and a shortcut cannot skip it.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_LUCLIN_PREFS,
  type LuclinPrefs,
  type LuclinResult,
  type LuclinStatus,
  type PlayResult
} from '@shared/luclinModels'

export interface LuclinMessage {
  text: string
  bad: boolean
}

type Action = () => Promise<LuclinResult | PlayResult>

export interface LuclinState {
  prefs: LuclinPrefs
  /** Null until main has answered (or when the file could not be read). */
  status: LuclinStatus | null
  busy: boolean
  message: LuclinMessage | null
  setPrefs: (patch: Partial<LuclinPrefs>) => void
  apply: () => void
  revert: () => void
  play: () => void
  openLauncher: () => void
  shortcut: () => void
  /** The first-use notice is up, waiting for Accept or Cancel. */
  confirming: boolean
  accept: () => void
  cancel: () => void
}

function useLuclinData(): {
  prefs: LuclinPrefs
  setPrefsState: (p: LuclinPrefs | ((cur: LuclinPrefs) => LuclinPrefs)) => void
  status: LuclinStatus | null
  setStatus: (s: LuclinStatus | null) => void
  message: LuclinMessage | null
  setMessage: (m: LuclinMessage | null) => void
  alive: { current: boolean }
  refresh: () => void
} {
  const [prefs, setPrefsState] = useState<LuclinPrefs>(DEFAULT_LUCLIN_PREFS)
  const [status, setStatus] = useState<LuclinStatus | null>(null)
  const [message, setMessage] = useState<LuclinMessage | null>(null)
  const alive = useRef(true)

  const refresh = useCallback(() => {
    void Promise.all([window.eq.getLuclinPrefs(), window.eq.checkLuclin()]).then(([p, s]) => {
      if (!alive.current) return
      setPrefsState(p)
      setStatus(s)
    })
  }, [])

  useEffect(() => {
    alive.current = true
    refresh()
    const off = window.eq.onEverQuestPlayed((r) => {
      if (!alive.current) return
      setMessage({ text: r.message, bad: !r.ok })
      if (r.status) setStatus(r.status)
    })
    return () => {
      alive.current = false
      off()
    }
  }, [refresh])

  return { prefs, setPrefsState, status, setStatus, message, setMessage, alive, refresh }
}

export function useLuclin(): LuclinState {
  const { prefs, setPrefsState, status, setStatus, message, setMessage, alive, refresh } = useLuclinData()
  const [busy, setBusy] = useState(false)
  // The Luclin action waiting behind the first-use notice (null when none is).
  const [pending, setPending] = useState<Action | null>(null)

  const setPrefs = useCallback(
    (patch: Partial<LuclinPrefs>) => {
      setPrefsState((cur) => ({ ...cur, ...patch }))
      void window.eq.setLuclinPrefs(patch).then((stored) => {
        if (!alive.current) return
        setPrefsState(stored)
        refresh()
      })
    },
    [alive, refresh, setPrefsState]
  )

  const run = useCallback(
    (action: Action) => {
      setBusy(true)
      setMessage(null)
      void action()
        .then((r) => {
          if (!alive.current) return
          setMessage({ text: r.message, bad: !r.ok })
          if (r.status) setStatus(r.status)
        })
        .finally(() => {
          if (alive.current) setBusy(false)
          refresh()
        })
    },
    [alive, refresh, setMessage, setStatus]
  )

  const guarded = useCallback(
    (action: Action, luclin: boolean) => {
      if (luclin && !prefs.riskAccepted) setPending(() => action)
      else run(action)
    },
    [prefs.riskAccepted, run]
  )

  const accept = useCallback(() => {
    const action = pending
    setPending(null)
    void window.eq.setLuclinPrefs({ riskAccepted: true }).then((stored) => {
      if (!alive.current) return
      setPrefsState(stored)
      if (action) run(action)
    })
  }, [alive, pending, run, setPrefsState])

  return {
    prefs,
    status,
    busy,
    message,
    setPrefs,
    apply: useCallback(() => guarded(() => window.eq.applyLuclin(), true), [guarded]),
    revert: useCallback(() => run(() => window.eq.revertLuclin()), [run]),
    play: useCallback(() => guarded(() => window.eq.playEverQuest(), prefs.enabled), [guarded, prefs.enabled]),
    openLauncher: useCallback(() => run(() => window.eq.openEqLauncher()), [run]),
    shortcut: useCallback(() => run(() => window.eq.createLuclinShortcut()), [run]),
    confirming: pending !== null,
    accept,
    cancel: useCallback(() => setPending(null), [])
  }
}
