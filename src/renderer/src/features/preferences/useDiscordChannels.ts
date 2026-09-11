// useDiscordChannels — the Sharing card's state, which is mostly somebody else's browser
// (owner, 2026-09-11; docs/plans/discord-connect.md).
//
// Its own hook rather than more state inside SharingSetting.tsx, for `useShareLink`'s reason: a
// connect is a round trip that takes MINUTES and happens in another program, and a component that
// also owns one reads as two things. TWO hooks, in fact, because the two halves keep different
// kinds of state: `useConnectAttempt` watches an attempt that belongs to the main process, and
// `useDiscordChannels` owns the list and the round trips that change it.
//
// THE WAIT IS MAIN'S, AND THIS POLLS MAIN. Preferences is a tab, a tab unmounts the moment the
// user looks at their meters, and a loop owned by an effect here would die with it in the middle
// of somebody's authorize. So main mints the state, opens the browser and runs the poll
// (src/main/discordConnect.ts); this asks it how that is going, and - the reason this shape is
// worth the extra channel - a REMOUNT PICKS THE WAIT BACK UP, because the first thing the hook
// does is ask whether an attempt is already running.
//
// MAIN'S REPLY IS AUTHORITATIVE, ALWAYS. Every action here takes the view main hands back and
// records it (prefsSnapshot.ts); nothing assembles a list of its own out of what it just sent. A
// rename is the sharpest case: the label main returns is CLAMPED, so what the row draws is what is
// stored rather than the 400 characters somebody pasted into the box.

import { useCallback, useEffect, useState } from 'react'
import type { DiscordChannelsView } from '@shared/discordChannels'
import { recordPref, usePrefsSeed } from './prefsHydration'

/** What the card is saying right now: nothing, an outcome, or a refusal. */
export interface SharingStatus {
  text: string
  bad: boolean
}

const NONE: SharingStatus = { text: '', bad: false }

/** What the card says while it is waiting on main, so a slow round trip is not silence. */
const WORKING: SharingStatus = { text: 'Working…', bad: false }

/** How often the renderer asks main how the connect is going. A second: it is one in-memory read. */
const POLL_MS = 1_000

/** The one sentence a failed IPC gets. Main's own prose is preferred whenever there is any. */
const LOST = 'That did not work. Try again.'

/** …and what a Cancel says, which is a state rather than an apology. */
const STOPPED = 'Stopped waiting for Discord.'

export interface DiscordChannelsState {
  view: DiscordChannelsView
  /** an attempt is running - the card shows Waiting for Discord and a Cancel */
  waiting: boolean
  /** a round trip is in flight, so the buttons are off for a moment */
  busy: boolean
  status: SharingStatus
  connect: () => void
  cancel: () => void
  test: (id: string) => void
  remove: (id: string) => void
  rename: (id: string, label: string) => void
  makeDefault: (id: string) => void
  savePasted: (text: string) => void
  clearStatus: () => void
}

/** What the connect half needs from the list half: somewhere to say things, and a way to reload. */
interface AttemptHooks {
  say: (status: SharingStatus) => void
  refresh: () => void
}

/**
 * THE ATTEMPT, WHICH IS MAIN'S. This hook only watches it: it starts one, stops one, and asks how
 * one is going. Nothing about a webhook passes through here - `label` is a channel's name.
 */
function useConnectAttempt(hooks: AttemptHooks): {
  waiting: boolean
  starting: boolean
  connect: () => void
  cancel: () => void
} {
  const [waiting, setWaiting] = useState(false)
  const [starting, setStarting] = useState(false)
  const { say, refresh } = hooks

  /** What main says about the running attempt, turned into what the card shows. */
  const read = useCallback(
    (said: { state: string; label?: string; error?: string }): void => {
      if (said.state === 'waiting') {
        setWaiting(true)
        return
      }
      setWaiting(false)
      if (said.state === 'done') {
        say({ text: `Connected ${said.label ?? 'a channel'}.`, bad: false })
        refresh()
      } else if (said.state === 'failed') say({ text: said.error ?? LOST, bad: true })
      else if (said.state === 'cancelled') say({ text: STOPPED, bad: false })
    },
    [say, refresh]
  )

  // IS ONE ALREADY RUNNING? Asked once per mount, because the attempt outlives this component -
  // coming back to Preferences mid-connect must show the wait, not an idle Connect button.
  // …and while it IS running, asked again every second. The interval is torn down on unmount; main
  // keeps waiting either way, which is the whole point.
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      void window.eq
        .discordConnectStatus()
        .then((said) => {
          if (alive) read(said)
        })
        .catch(() => undefined)
    }
    tick()
    const timer = waiting ? setInterval(tick, POLL_MS) : null
    return () => {
      alive = false
      if (timer !== null) clearInterval(timer)
    }
  }, [waiting, read])

  const connect = useCallback((): void => {
    say(NONE)
    setStarting(true)
    void window.eq
      .connectDiscordChannel()
      .then((res) => {
        if (res.ok) setWaiting(true)
        else say({ text: res.error ?? LOST, bad: true })
      })
      .catch(() => {
        say({ text: LOST, bad: true })
      })
      .finally(() => {
        setStarting(false)
      })
  }, [say])

  const cancel = useCallback((): void => {
    setWaiting(false)
    say({ text: STOPPED, bad: false })
    void window.eq.cancelDiscordConnect().catch(() => undefined)
  }, [say])

  return { waiting, starting, connect, cancel }
}

export function useDiscordChannels(): DiscordChannelsState {
  // SEEDED SYNCHRONOUSLY (JOS-340): the pane's gate has already read main, so this card's first
  // painted frame lists the channels that are actually stored rather than "none yet".
  const seed = usePrefsSeed()
  const [view, setView] = useState<DiscordChannelsView>(seed.discordChannels)
  const [status, setStatus] = useState<SharingStatus>(NONE)
  const [busy, setBusy] = useState(false)

  const adopt = useCallback((next: DiscordChannelsView): void => {
    setView(next)
    recordPref('discordChannels', next)
  }, [])

  const refresh = useCallback((): void => {
    void window.eq.listDiscordChannels().then(adopt).catch(() => undefined)
  }, [adopt])

  const attempt = useConnectAttempt({ say: setStatus, refresh })

  /** One round trip that changes the list, with the buttons off and a sentence at the end of it. */
  const run = useCallback(
    (work: () => Promise<DiscordChannelsView>, said: string): void => {
      setBusy(true)
      setStatus(WORKING)
      void work()
        .then((next) => {
          adopt(next)
          setStatus({ text: said, bad: false })
        })
        .catch(() => {
          setStatus({ text: LOST, bad: true })
        })
        .finally(() => {
          setBusy(false)
        })
    },
    [adopt]
  )

  /** One round trip that only REPORTS - the Test button and the advanced paste. */
  const ask = useCallback((work: () => Promise<SharingStatus>): void => {
    setBusy(true)
    setStatus(WORKING)
    void work()
      .then(setStatus)
      .catch(() => {
        setStatus({ text: LOST, bad: true })
      })
      .finally(() => {
        setBusy(false)
      })
  }, [])

  const savePasted = useCallback(
    (text: string): void => {
      ask(async () => {
        const res = await window.eq.setDiscordWebhook(text.trim())
        if (!res.ok) return { text: res.error, bad: true }
        adopt(res.channels)
        return { text: 'Saved. Try Test to see a message appear in the channel.', bad: false }
      })
    },
    [ask, adopt]
  )

  return {
    view,
    status,
    savePasted,
    waiting: attempt.waiting,
    busy: busy || attempt.starting,
    connect: attempt.connect,
    cancel: attempt.cancel,
    test: (id) => {
      ask(async () => {
        const res = await window.eq.testDiscordChannel(id)
        return res.ok
          ? { text: 'Sent. Check the channel.', bad: false }
          : { text: res.error ?? 'Could not reach Discord.', bad: true }
      })
    },
    remove: (id) => {
      run(() => window.eq.removeDiscordChannel(id), 'Removed.')
    },
    rename: (id, label) => {
      run(() => window.eq.renameDiscordChannel(id, label), 'Renamed.')
    },
    makeDefault: (id) => {
      run(() => window.eq.setDefaultDiscordChannel(id), 'Default channel set.')
    },
    clearStatus: () => {
      setStatus(NONE)
    }
  }
}
