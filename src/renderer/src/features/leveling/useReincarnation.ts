// useReincarnation — the reincarnation record's two renderer halves (shared/reincarnation.ts).
//
//   * `useReincarnationRecorder` — ALWAYS MOUNTED (AppCelebrations, beside the ding detector): it
//     hands every CONFIRMED reincarnation the leveling snapshot holds to main, which merges by
//     instant, so the record outlives a rotated log whether or not the Leveling tab is ever opened.
//     It carries the character it was folding; main refuses a write that crossed a switch.
//   * `useReincarnationRecord` — the stored record, re-read on every `onProgress` push.

import { useEffect, useRef, useState } from 'react'
import type { CharacterSnap, LevelingSnap, ProgressState } from '@shared/types'
import type { ReincarnationRecord } from '@shared/reincarnation'
import { useModule } from '../../lib/useModule'
import { confirmedLives, sanitizeReincarnationRecord } from '../../../../shared/reincarnation'

/** Record confirmed reincarnations as the log shows them. Mount once, app-wide. */
export function useReincarnationRecorder(): void {
  const leveling = useModule<LevelingSnap>('leveling')
  const character = useModule<CharacterSnap>('character')?.character ?? null
  const sentRef = useRef('')
  useEffect(() => {
    const lives = confirmedLives(leveling?.reincarnations)
    if (lives.length === 0 || !character) return
    const key = `${character.name}_${character.server}|${lives.map((e) => `${String(e.ts)}:${String(e.grants.length)}`).join(',')}`
    if (sentRef.current === key) return
    sentRef.current = key
    void window.eq.recordReincarnations({ name: character.name, server: character.server }, lives)
  }, [leveling, character])
}

/** The active character's stored record; null until read once. */
export function useReincarnationRecord(): ReincarnationRecord | null {
  const [record, setRecord] = useState<ReincarnationRecord | null>(null)
  useEffect(() => {
    let alive = true
    const take = (p: ProgressState | null): void => {
      if (alive) setRecord(sanitizeReincarnationRecord(p?.reincarnation))
    }
    void window.eq.getProgress().then(take)
    const offProgress = window.eq.onProgress(take)
    const offChar = window.eq.onCharacter(() => void window.eq.getProgress().then(take))
    return () => {
      alive = false
      offProgress()
      offChar()
    }
  }, [])
  return record
}
