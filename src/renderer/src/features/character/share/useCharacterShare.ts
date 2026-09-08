// character/share/useCharacterShare — everything the Share dialog needs, assembled once.
//
// It pulls four already-existing reads together and projects them into ONE wire value
// (`buildCharacterShare`), so the card, the share string and the text summary are three renderings
// of a single fact rather than three walks over the same data:
//
//   useCharacterSheet()    the armory cells and the gear totals, off the `/outputfile` dump
//   useBuild()             the tank / DPS / healer meters and the solo reading
//   useResolvedClasses()   the loadout, from the combo module - unresolved slots contribute nothing
//   useModelPrefs()        race, sex and face: three PICKS, never log facts (modelPrefs.ts)
//   the character module   the name, and the ONE level statement (JOS-192, currentLevelRead)
//
// CALLING `useBuild()` HERE IS A DELIBERATE EXCEPTION, and the reason it is safe is the reason it
// would not be anywhere else: that hook scores every candidate row in the gear index against every
// cell, and this hook is mounted ONLY while the dialog is open. Nothing on the Character tab pays
// for it until somebody presses Share.
//
// A SCORE THE BUILD TAB COULD NOT COMPUTE IS OMITTED (world-model law 1). `meterPercent` answers 0
// both for "your set is worthless" and for "there was no best to measure against", so the reading
// travels only when the tab genuinely had one: the index loaded, a dump present, and a reachable
// best above zero. Otherwise `scores` is absent and the card says so out loud.

import { useEffect, useMemo, useState } from 'react'
import type { CharacterSnap, ProgressionSnap } from '@shared/types'
import { currentLevelRead } from '@shared/currentLevel'
import { buildCharacterShare, characterShareText, type CharacterProfileShare, type ShareScores } from '@shared/characterShare'
import { useModule } from '../../../lib/useModule'
import { EMPTY_PROGRESSION } from '../../leveling/progressionDelta'
import { useResolvedClasses } from '../../alerts/lineIntel'
import { useBuild } from '../../build/useBuild'
import { useCharacterSheet } from '../useCharacterSheet'
import { useModelPrefs } from '../ModelPickers'
import { characterModelSnapshot } from '../CharacterModel3D'

export interface CharacterShareState {
  /** null until there is a dump to build one from - the dialog says so rather than drawing an empty card */
  profile: CharacterProfileShare | null
  /** the encoded `EQC1-` string; '' until main has answered, or when there was nothing to encode */
  text: string
  /** the same profile as a chat-pasteable summary */
  summary: string
  /** the figure's last drawn frame, captured once when the dialog opened */
  image: string | null
  /** false while the sheet read is still settling */
  ready: boolean
}

export function useCharacterShare(): CharacterShareState {
  const { sheet, ready } = useCharacterSheet()
  const build = useBuild()
  const classes = useResolvedClasses()
  const prefs = useModelPrefs()
  const who = useModule<CharacterSnap>('character')
  const prog = useModule<ProgressionSnap>('progression')
  // BOTH CAPTURED ONCE, ON OPEN. The stamp is what the card prints and what the viewer reads back,
  // so it must not creep forward on every render; the figure's frame is a photograph of a scene
  // that is still animating behind the dialog, and re-taking it would make the card flicker.
  const [capturedAt] = useState(() => Date.now())
  const [image] = useState(() => characterModelSnapshot())

  const level = currentLevelRead(who?.level, prog ?? EMPTY_PROGRESSION)
  const name = who?.character?.name

  // MEMOIZED ON PRIMITIVES, not on `build`: every one of that hook's return values is a fresh
  // object per render, so a profile keyed on it would be a new profile every render and this
  // dialog would encode a share string sixty times a second.
  const { tank, dps, heal } = build.meters
  const solo = build.solo.percent
  const measurable = build.ready && build.hasDump && build.score.best > 0
  const scores: ShareScores | undefined = useMemo(
    () => (measurable ? { tank, dps, heal, solo } : undefined),
    [measurable, tank, dps, heal, solo]
  )

  const profile = useMemo(
    () =>
      sheet === null
        ? null
        : buildCharacterShare({
            cells: sheet.cells,
            totals: sheet.totals,
            look: { race: prefs.race, sex: prefs.sex, ...(prefs.face === undefined ? {} : { face: prefs.face }) },
            classes,
            name,
            level: level?.level,
            scores,
            capturedAt
          }),
    [sheet, prefs.race, prefs.sex, prefs.face, classes, name, level?.level, scores, capturedAt]
  )

  const [text, setText] = useState('')
  useEffect(() => {
    if (profile === null) {
      setText('')
      return
    }
    let alive = true
    // The codec lives in main (`EQC1-` is deflate and the renderer has no zlib), so the string
    // arrives a tick after the card does. A failure is an empty string: the Copy buttons disable
    // themselves rather than putting something half-encoded on somebody's clipboard.
    void window.eq
      .shareCharacterString(profile)
      .then((encoded) => {
        if (alive) setText(encoded ?? '')
      })
      .catch(() => {
        if (alive) setText('')
      })
    return () => {
      alive = false
    }
  }, [profile])

  const summary = useMemo(() => (profile === null ? '' : characterShareText(profile)), [profile])

  return { profile, text, summary, image, ready }
}
