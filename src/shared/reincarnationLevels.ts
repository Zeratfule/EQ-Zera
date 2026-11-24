// reincarnationLevels.ts — a reincarnation folded into the ding series, for every level surface.
//
// A CONFIRMED reincarnation becomes a point of its own — level 1 at the grant lines — so the new
// life is a run that opens there and its 1→2 bar is timed from it. An INFERRED `levelDrop` marks the
// first fresh ding after its drop, labelled possible, and times nothing across it. An unclaimed-line
// event carries no level and adds nothing here. Pure; relative imports only.

import { lifeOf, type ReincarnationEvent } from './reincarnation'

/** A reincarnation opened this point's run. */
export interface RebirthMark {
  /** The life it began (2 = the first reincarnation), or null when nothing states it. */
  life: number | null
  /** Inferred from levels or an unclaimed line, never from the grant lines. */
  inferred: boolean
}

/** The minimum a level point needs to carry a mark. */
export interface MarkablePoint {
  ts: number
  level: number
  rebirth?: RebirthMark
}

/** The dings with each reincarnation folded in. Input sorted by `ts`; output sorted. */
export function withRebirths<T extends MarkablePoint>(sorted: readonly T[], events: readonly ReincarnationEvent[]): (T | MarkablePoint)[] {
  const out: (T | MarkablePoint)[] = [...sorted]
  let life = 1
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (e.source === 'message') continue
    life = lifeOf(e) ?? life + 1
    const mark: RebirthMark = { life, inferred: e.inferred }
    if (!e.inferred) {
      out.push({ ts: e.ts, level: 1, rebirth: mark })
      continue
    }
    const i = out.findIndex((p) => p.ts > e.lo && p.level <= 2 && !p.rebirth)
    if (i >= 0) out[i] = { ...out[i], rebirth: mark }
  }
  return out.sort((a, b) => a.ts - b.ts)
}

/** "Reincarnated (life 2)", with "Possible" when it is inferred — one wording for every surface. */
export function rebirthLabel(mark: RebirthMark): string {
  const life = mark.life != null ? ` (life ${String(mark.life)})` : ''
  return `${mark.inferred ? 'Possible reincarnation' : 'Reincarnated'}${life}`
}
