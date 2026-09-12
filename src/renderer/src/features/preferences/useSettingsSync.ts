// useSettingsSync — the Sync card's state (docs/plans/settings-sync.md).
//
// Its own hook rather than more state inside SyncSetting.tsx, for `useDiscordChannels`'s reason:
// this is two round trips and a three-step flow (receive -> look -> apply), and a component that
// also owns those reads as two things.
//
// MAIN DOES ALL OF IT. The renderer performs no network, holds no key, and never sees the
// decrypted payload: it asks for a code, it asks for a preview, and it says Apply. What comes back
// is a code, a `SharePreview`, counts and sentences (src/preload/syncApi.ts).
//
// THE TWO TICK BOXES ARE INDEPENDENT ON PURPOSE. The sending machine decides whether its Discord
// channels travel; the receiving machine decides whether it stores them. Both start OFF - they are
// credentials - and neither is persisted, because the answer belongs to the transfer rather than to
// the install.
//
// THE ONLY THING THIS FILE WRITES IS localStorage, and only what main handed back: an import's UI
// prefs live on this side of the boundary (lib/uiPrefs.ts), so main returns the merged values and
// the renderer performs the writes, exactly as the paste-box import does.

import { useCallback, useEffect, useState } from 'react'
import type { SharePreview } from '@shared/profiles'
import { copyText } from '../../lib/clipboard'
import { readUiPrefs, writeUiPrefs } from '../../lib/uiPrefs'

/** What the card is saying right now: nothing, an outcome, or a refusal. */
export interface SyncStatus {
  text: string
  bad: boolean
}

const NONE: SyncStatus = { text: '', bad: false }

/** What the card says while it is waiting on main, so a slow round trip is not silence. */
const WORKING: SyncStatus = { text: 'Working…', bad: false }

/** The one sentence a failed IPC gets. Main's own prose is preferred whenever there is any. */
const LOST = 'That did not work. Try again.'

export interface SettingsSyncState {
  /** null until main has answered; false in a dark build, where both buttons are off */
  available: boolean | null
  busy: boolean
  status: SyncStatus
  // ---- sending
  includeDiscord: boolean
  setIncludeDiscord: (on: boolean) => void
  /** the transfer code, once there is one */
  code: string
  send: () => void
  copyCode: () => void
  // ---- receiving
  typed: string
  setTyped: (text: string) => void
  receive: () => void
  /** what the fetched transfer would add, or null while there is nothing to look at */
  preview: SharePreview | null
  /** how many Discord channels rode along with it */
  incoming: number
  takeDiscord: boolean
  setTakeDiscord: (on: boolean) => void
  apply: () => void
  cancel: () => void
}

/** "Settings imported" plus the channels, when there were any. The success flash, in one place. */
function importedText(channels: number): string {
  if (channels === 0) return 'Settings imported'
  return `Settings imported. ${String(channels)} Discord channel${channels === 1 ? '' : 's'} added`
}

/** The send half: the box, the round trip, the code and its Copy. */
function useSendHalf(say: (s: SyncStatus) => void, hold: (busy: boolean) => void): {
  includeDiscord: boolean
  setIncludeDiscord: (on: boolean) => void
  code: string
  send: () => void
  copyCode: () => void
} {
  const [includeDiscord, setIncludeDiscord] = useState(false)
  const [code, setCode] = useState('')

  const send = useCallback(() => {
    hold(true)
    say(WORKING)
    setCode('')
    void (async () => {
      try {
        const res = await window.eq.sendSettingsToPc(readUiPrefs(), includeDiscord)
        if (res.ok) {
          setCode(res.code)
          say(NONE)
        } else {
          say({ text: res.error, bad: true })
        }
      } catch {
        say({ text: LOST, bad: true })
      } finally {
        hold(false)
      }
    })()
  }, [includeDiscord, say, hold])

  const copyCode = useCallback(() => {
    if (code === '') return
    void (async () => {
      const ok = await copyText(code)
      say(ok ? { text: 'Code copied', bad: false } : { text: 'Could not reach the clipboard.', bad: true })
    })()
  }, [code, say])

  return { includeDiscord, setIncludeDiscord, code, send, copyCode }
}

/** What the receive half owns: the typed code, the preview it fetched, and the two answers. */
interface ReceiveHalf {
  typed: string
  setTyped: (text: string) => void
  receive: () => void
  preview: SharePreview | null
  incoming: number
  takeDiscord: boolean
  setTakeDiscord: (on: boolean) => void
  apply: () => void
  cancel: () => void
}

/** The receive half: fetch a transfer, look at what it would add, then take it or leave it. */
function useReceiveHalf(say: (s: SyncStatus) => void, hold: (busy: boolean) => void): ReceiveHalf {
  const [typed, setTyped] = useState('')
  const [preview, setPreview] = useState<SharePreview | null>(null)
  const [incoming, setIncoming] = useState(0)
  const [takeDiscord, setTakeDiscord] = useState(false)

  const clear = useCallback(() => {
    setPreview(null)
    setIncoming(0)
    setTakeDiscord(false)
  }, [])

  const receive = useCallback(() => {
    hold(true)
    say(WORKING)
    clear()
    void (async () => {
      try {
        const res = await window.eq.receiveSettingsFromPc(typed, readUiPrefs())
        if (res.ok) {
          setPreview(res.preview)
          setIncoming(res.discordChannels ?? 0)
          say(NONE)
        } else {
          say({ text: res.error, bad: true })
        }
      } catch {
        say({ text: LOST, bad: true })
      } finally {
        hold(false)
      }
    })()
  }, [typed, say, hold, clear])

  const apply = useCallback(() => {
    if (preview === null) return
    hold(true)
    say(WORKING)
    void (async () => {
      try {
        const res = await window.eq.applySettingsFromPc(typed, readUiPrefs(), takeDiscord)
        if (res.ok) {
          // Main cannot touch localStorage; it hands back the merged values for us to write.
          writeUiPrefs(res.ui)
          say({ text: importedText(res.channelsAdded), bad: false })
          clear()
          setTyped('')
        } else {
          say({ text: res.error, bad: true })
        }
      } catch {
        say({ text: LOST, bad: true })
      } finally {
        hold(false)
      }
    })()
  }, [preview, typed, takeDiscord, say, hold, clear])

  const cancel = useCallback(() => {
    clear()
    say(NONE)
  }, [clear, say])

  return { typed, setTyped, receive, preview, incoming, takeDiscord, setTakeDiscord, apply, cancel }
}

export function useSettingsSync(): SettingsSyncState {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<SyncStatus>(NONE)

  // ASKED ONCE, AND A REFUSAL IS "NO". A build with no origin compiled in is exactly the case this
  // question exists for, so an IPC that cannot answer it reads as the dark build rather than as an
  // unknown - the card then says why, instead of leaving two live buttons that cannot work.
  useEffect(() => {
    let live = true
    void window.eq
      .syncAvailable()
      .then((ok) => {
        if (live) setAvailable(ok)
      })
      .catch(() => {
        if (live) setAvailable(false)
      })
    return () => {
      live = false
    }
  }, [])

  const say = useCallback((s: SyncStatus) => setStatus(s), [])
  const hold = useCallback((on: boolean) => setBusy(on), [])
  const sending = useSendHalf(say, hold)
  const receiving = useReceiveHalf(say, hold)

  // THE DARK SENTENCE IS NOT A STATUS. A status is the outcome of something the user did; "this
  // build cannot sync settings" is a fact about the build, so the card states it beside the
  // disabled buttons rather than in the line that reports round trips.
  return { available, busy, status, ...sending, ...receiving }
}
