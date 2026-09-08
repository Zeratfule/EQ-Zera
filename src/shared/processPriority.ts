// shared/processPriority.ts — THE PURE HALF of "the companion yields the CPU to the game"
// (JOS-366).
//
// WHY THERE IS A SETTING AT ALL, in one paragraph, because the mechanism reads like a magic
// trick otherwise. The companion and EverQuest run at the same Windows priority class, so every
// burst of work on our side — a GC pause, a delta flush to five overlay windows, a Kokoro
// synthesis, a store write — is a FAIR FIGHT with the game's render thread for a core. It should
// never be a fair fight. The game is the foreground experience; nothing this app does is
// latency-critical at the millisecond scale (an alert that fires 20 ms later is the same alert).
// Below-normal priority is how Windows is told that, once, for the whole process tree.
//
// ONE FIELD, DEFAULT ON. It is a setting rather than a hard-wired behaviour because the one
// person who might legitimately want it off is the person whose companion is the foreground app —
// someone reading the leveling planner between sessions, or an owner profiling a build — and
// because a switch is what makes a field hitch report answerable ("turn it off, does the stutter
// change?"). Default ON is the whole point: the players who need it are exactly the ones who will
// never find this section.
//
// A ZERO-IMPORT module, for the same reason `shared/perf.ts` and `shared/graphicsPrefs.ts` are:
// `storeMigrations.ts` runs from store.ts's module scope, before electron-store exists, and needs
// this normalizer without dragging anything in behind it. The MECHANISM (which pids, applied
// when, and what to do when Windows refuses) lives in `src/main/processPriority.ts`, which is
// Electron-free for its own reason — see that file's header.

/**
 * The persisted switch. ONE boolean, and a blob rather than a bare key so the feature has
 * somewhere to grow (a per-window class, an "only while EverQuest is running" gate) without a
 * second schema shape — the `perfHud` precedent exactly.
 */
export interface ProcessPriorityPrefs {
  /** Run the companion's processes below normal priority, so the game wins every tie. */
  yieldToGame: boolean
}

/** ON. See the header: the people this helps are the ones who will never open Preferences. */
export const DEFAULT_PROCESS_PRIORITY_PREFS: ProcessPriorityPrefs = { yieldToGame: true }

/**
 * Defaulted field by field, from `unknown`: the same value arrives from the store file, from a
 * renderer toggle and from the v11 → v12 migration. A malformed value is replaced by the
 * documented default, never coerced — so an absent key on an EXISTING install reads as `true`,
 * which is what "default true for existing installs" means in practice.
 */
export function normalizeProcessPriorityPrefs(value: unknown): ProcessPriorityPrefs {
  const v: Record<string, unknown> =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    yieldToGame:
      typeof v.yieldToGame === 'boolean'
        ? v.yieldToGame
        : DEFAULT_PROCESS_PRIORITY_PREFS.yieldToGame
  }
}
