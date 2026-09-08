// useVoices — the React half of the speech seam: one hook that hands a picker the voices a
// tier can actually speak with.
//
// It lives beside `lib/speech.ts` rather than inside it because that module is loaded by
// node:test (its two pure decisions are unit-pinned) and must stay React-free and DOM-free at
// module scope. Everything asynchronous and platform-specific — including the `voiceschanged`
// dance that makes a cold `getVoices()` lie — is already handled there; this is the subscription.
//
// BOTH pickers use it (the preferences default voice and the alert editor's per-alert override),
// so "which voices exist" has one answer in the UI, and swapping the engine tier re-reads
// exactly once.

import { useEffect, useState } from 'react'
import type { SpeechEngine, SpeechVoice } from '@shared/types'
import {
  currentVoicePrefs,
  listVoices,
  onSpeechEngineFault,
  speechEngineFault,
  speechSetupGap,
  type SpeechEngineFault,
  type SpeechSetupGap
} from './speech'

/** A tier's voices plus the one fact `[]` alone cannot state: has the answer ARRIVED yet. */
interface VoiceInventory {
  voices: SpeechVoice[]
  loaded: boolean
}

/**
 * The subscription both public hooks are built on. `loaded` exists because an empty list means
 * two different things one frame apart — "still doing the `voiceschanged` dance" and "this
 * machine genuinely has none" — and a UI that renders a setup warning must only ever react to
 * the second (see `useSpeechSetup`).
 */
function useVoiceInventory(engine: SpeechEngine, refreshKey: number): VoiceInventory {
  const [inventory, setInventory] = useState<VoiceInventory>({ voices: [], loaded: false })
  useEffect(() => {
    let alive = true
    setInventory({ voices: [], loaded: false })
    void listVoices(engine).then((list) => {
      if (alive) setInventory({ voices: list, loaded: true })
    })
    return () => {
      alive = false
    }
  }, [engine, refreshKey])
  return inventory
}

/**
 * The voices of one engine tier, or `[]` while they load — and `[]` for a tier that is not
 * installed, which is not an error but the accurate inventory (the kokoro row renders
 * "not installed" from exactly this emptiness, per voice-alerts §2).
 *
 * `refreshKey` is the seam for the one thing that CHANGES a tier's inventory while the panel is
 * open: finishing the Kokoro download. Engine alone is not enough — the tier the user is looking
 * at is the same tier before and after the install, so a bump of this number is what re-asks. Any
 * changing value works; the preferences panel counts completed installs.
 */
export function useVoiceOptions(engine: SpeechEngine, refreshKey = 0): SpeechVoice[] {
  return useVoiceInventory(engine, refreshKey).voices
}

/**
 * The fault `speak()` latched, live. A subscription rather than a read because the fault is
 * learned by an UTTERANCE, which happens on the alert firing path — so a panel that was already
 * open when the first alert spoke has to be told, not asked at mount.
 */
export function useSpeechEngineFault(): SpeechEngineFault | null {
  const [fault, setFault] = useState<SpeechEngineFault | null>(speechEngineFault)
  useEffect(() => {
    setFault(speechEngineFault())
    return onSpeechEngineFault(setFault)
  }, [])
  return fault
}

/**
 * The SETUP gap for the tier the app is currently configured to speak with, or null while the
 * inventory is still loading and null when there is nothing to say.
 *
 * This is what the alert row and the editor render their "set up in Preferences" link from, now
 * that speech has no master switch: the only remaining reason a spoken alert does not sound the
 * way it says it will is that the chosen tier has nothing to speak with. The engine comes from
 * `lib/speech`'s hydrated prefs cache (the same copy every firing reads), so the annotation and
 * the utterance can never disagree about which tier is selected.
 *
 * THE FAULT OUTRANKS THE INVENTORY (JOS-247), and only for the tier that can have one. A tier
 * that failed to speak is a stronger and more recent fact than anything the inventory can say —
 * and for the case this fixes, the inventory says nothing at all: 54 downloaded voices, all
 * listed, none of them audible. The system tier never latches a fault (it never crosses IPC), so
 * this cannot annotate a Windows voice with a Kokoro failure.
 */
export function useSpeechSetup(engine: SpeechEngine = currentVoicePrefs().engine): SpeechSetupGap | null {
  const { voices, loaded } = useVoiceInventory(engine, 0)
  const fault = useSpeechEngineFault()
  if (engine === 'kokoro' && fault) return fault
  return loaded ? speechSetupGap(engine, voices) : null
}
