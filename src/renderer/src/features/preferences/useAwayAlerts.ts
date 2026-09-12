// useAwayAlerts — the Away alerts card's state, in one hook (src/shared/awayAlerts.ts).
//
// Its own file for AwayAlertsSetting.tsx's reason: that file is the card, and a card that also held
// two async reads, a search filter and a flash would be doing three jobs. The same split
// `useDiscordChannels.ts` makes beside it.
//
// IT READS FOR ITSELF rather than out of the pane's hydration snapshot (./prefsHydration.tsx), the
// way `lib/discordChannels`'s hook does. The reason is the ALERT LIST: this card paints a checklist
// of the user's own alert definitions, which is not a preference and has no business in a batched
// prefs read that every other section pays for. The card's own answer to JOS-340's law is that it
// draws NO CONTROL until the read lands - see AwayAlertsSetting.tsx.
//
// WHAT IT NEVER HOLDS: a webhook. `channelId` is a channel's id and nothing else; main owns the
// token and performs the post (src/main/awayAlerts.ts).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_AWAY_ALERTS, type AwayAlertsPrefs, type AwayHealth } from '@shared/awayAlerts'
import type { AlertDef } from '@shared/types'
import { normalizeQuery } from '../../lib/search'

/** Everything main says about this feature in one read. Mirrors `src/main/awayAlerts.ts`. */
export interface AwayAlertsView extends AwayHealth {
  prefs: AwayAlertsPrefs
  idleSeconds: number
}

/** One row of the checklist: an alert the user could send. */
export interface AwayAlertRow {
  id: string
  name: string
  /** Lowercased name, computed once per data change - the repo's search idiom. */
  searchKey: string
}

/** What the button's outcome says, and whether it went badly. Empty text means "nothing to say". */
export interface AwayFlash {
  text: string
  bad: boolean
}

/** What the card renders from. */
export interface AwayAlertsState {
  /** False until BOTH reads have landed. Nothing paints before it - see the header. */
  loaded: boolean
  prefs: AwayAlertsPrefs
  health: AwayHealth
  /** The user's ENABLED alerts, already filtered by the search box. */
  rows: AwayAlertRow[]
  /** Every enabled alert's id, filtered or not - what Select all ticks. */
  allIds: string[]
  query: string
  setQuery: (q: string) => void
  /** Write the whole preference, optimistically, and take main's reply as the truth. */
  update: (patch: Partial<AwayAlertsPrefs>) => void
  /** Tick or untick one alert. */
  toggleAlert: (id: string, on: boolean) => void
  busy: boolean
  flash: AwayFlash
  sendTest: () => void
}

/** What a test says when it worked. Main owns every failure sentence; this is the only one the
 *  renderer composes, because there is no failure for main to describe. */
const TEST_OK = 'Sent. Check the channel on your phone.'

const NO_FLASH: AwayFlash = { text: '', bad: false }

/** The alert definitions this feature can offer: the ENABLED ones, by name.
 *
 *  A disabled alert never fires, so listing one would be offering to forward something that cannot
 *  happen - and the row would read as a second, contradictory on/off for the same alert. */
function rowsOf(defs: readonly AlertDef[]): AwayAlertRow[] {
  return defs
    .filter((d) => d.enabled)
    .map((d) => ({ id: d.id, name: d.name, searchKey: d.name.toLowerCase() }))
}

/** The health half of a view, with the absent fields left absent rather than set to undefined. */
function healthOf(view: AwayAlertsView): AwayHealth {
  return {
    ...(view.lastError === undefined ? {} : { lastError: view.lastError }),
    ...(view.lastErrorAt === undefined ? {} : { lastErrorAt: view.lastErrorAt }),
    ...(view.lastSentAt === undefined ? {} : { lastSentAt: view.lastSentAt })
  }
}

export function useAwayAlerts(): AwayAlertsState {
  const [loaded, setLoaded] = useState(false)
  const [prefs, setPrefs] = useState<AwayAlertsPrefs>(DEFAULT_AWAY_ALERTS)
  const [health, setHealth] = useState<AwayHealth>({})
  const [defs, setDefs] = useState<AwayAlertRow[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<AwayFlash>(NO_FLASH)

  useEffect(() => {
    let alive = true
    const both = Promise.all([window.eq.getAwayAlerts(), window.eq.listAlerts()])
    void both
      .then(([view, alerts]) => {
        if (!alive) return
        setPrefs(view.prefs)
        setHealth(healthOf(view))
        setDefs(rowsOf(alerts))
        setLoaded(true)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  /**
   * Write the WHOLE preference (main's setter is a replace, not a merge - storeAwayAlerts.ts says
   * why), optimistically, and then take main's reply as the truth. The optimistic half is what
   * keeps a checkbox from lagging a click; the reply is what keeps the card honest about a value
   * main clamped or refused.
   */
  const update = useCallback(
    (patch: Partial<AwayAlertsPrefs>) => {
      const next: AwayAlertsPrefs = { ...prefs, ...patch }
      setPrefs(next)
      void window.eq
        .setAwayAlerts(next)
        .then((view) => {
          setPrefs(view.prefs)
          setHealth(healthOf(view))
        })
        .catch(() => undefined)
    },
    [prefs]
  )

  const toggleAlert = useCallback(
    (id: string, on: boolean) => {
      update({ alertIds: on ? [...prefs.alertIds, id] : prefs.alertIds.filter((x) => x !== id) })
    },
    [prefs.alertIds, update]
  )

  const sendTest = useCallback(() => {
    setBusy(true)
    setFlash(NO_FLASH)
    void window.eq
      .testAwayAlerts()
      .then((res) => {
        setBusy(false)
        setFlash(res.ok ? { text: TEST_OK, bad: false } : { text: res.error ?? '', bad: true })
      })
      .catch(() => {
        setBusy(false)
      })
  }, [])

  const q = normalizeQuery(query)
  const rows = useMemo(() => (q === '' ? defs : defs.filter((r) => r.searchKey.includes(q))), [defs, q])
  const allIds = useMemo(() => defs.map((r) => r.id), [defs])

  return {
    loaded,
    prefs,
    health,
    rows,
    allIds,
    query,
    setQuery,
    update,
    toggleAlert,
    busy,
    flash,
    sendTest
  }
}
