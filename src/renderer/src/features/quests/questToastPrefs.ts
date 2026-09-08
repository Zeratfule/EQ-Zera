// QUEST-ITEM POP-UP PREFERENCES — the VOCABULARY, with no DOM and no React in it (ROADMAP §1).
//
// The same split `features/combat/combatPrefs.ts` makes and for the same reason: `useQuestToastPrefs.ts`
// is the storage half (localStorage + the cross-window subscription), and this is the half that
// decides what a stored string MEANS. Everything that can break silently — a default, a guard, a
// degrade — is here, where `tests/questToastPrefs.test.mts` runs it under plain node with no window
// object anywhere.
//
// THREE ANSWERS, because a pop-up over a game is three questions and not one:
//   enabled    — does a looted quest item put a card on screen at all
//   myClasses  — only quests this character's loadout can take, or every quest the item feeds
//   repeatMin  — how long the SAME item stays quiet after it popped (Bone Chips are a stack you
//                loot forty times in an hour, and forty identical cards is the failure mode)
//
// THE ONE RULE BOTH HALVES SHARE (JOS-105): an absent or unreadable value is the DEFAULT, never an
// error and never a dead feature. Every reader here takes `string | null` — what
// `localStorage.getItem` actually returns — and answers with something the detector can run on.
//
// MUI-FREE, JSX-FREE, REACT-FREE, and its value imports (there are none) would be RELATIVE — the
// combatPrefs.ts rule, so the node tests need no alias resolution.

/** How long the same item stays quiet after it popped. Four stops, not a slider: this is a
 *  "how often do you want to see this" question and four answers cover it. */
export type RepeatMinutes = 1 | 5 | 15 | 60

/** The four stops, in the order the toggle group draws them. */
export const REPEAT_CHOICES: readonly RepeatMinutes[] = [1, 5, 15, 60]

export interface QuestToastPrefs {
  enabled: boolean
  myClasses: boolean
  repeatMin: RepeatMinutes
}

/**
 * ON by default, narrowed to your own classes by default, five minutes between repeats.
 *
 * A DEFAULT SPEAKS FOR AN ABSENT KEY AND FOR NOTHING ELSE (the combatPrefs rule): a user who has
 * been to Preferences has a value in storage and gets it back verbatim. On-by-default is the same
 * argument the celebration overlay ships on — the card only ever appears on a LIVE loot of an item
 * the catalog knows, which is the moment the answer is worth something.
 */
export const DEFAULT_QUEST_TOAST_PREFS: QuestToastPrefs = { enabled: true, myClasses: true, repeatMin: 5 }

/** The three keys, in the app's `eq.<feature>.*` namespace. */
export const QUEST_TOAST_KEYS = {
  enabled: 'eq.questToast.enabled',
  myClasses: 'eq.questToast.myClasses',
  repeatMin: 'eq.questToast.repeatMin'
} as const

/** '1'/'0' rather than JSON: these are one-bit view prefs and the value should be readable in
 *  devtools at a glance. An absent key is the DEFAULT, never `false` — a user who has never
 *  touched the setting has not turned it off. */
function readBool(raw: string | null, dflt: boolean): boolean {
  return raw === null ? dflt : raw === '1'
}

function isRepeatMinutes(v: number): v is RepeatMinutes {
  return (REPEAT_CHOICES as readonly number[]).includes(v)
}

/** The stored window, or the default — for absent, empty, misspelled, out-of-range and
 *  hand-edited values alike. A minute count this build does not offer is not a fifth stop. */
function readRepeat(raw: string | null): RepeatMinutes {
  if (raw === null) return DEFAULT_QUEST_TOAST_PREFS.repeatMin
  const n = Number(raw)
  return Number.isFinite(n) && isRepeatMinutes(n) ? n : DEFAULT_QUEST_TOAST_PREFS.repeatMin
}

/**
 * The three preferences behind one getter. TOTAL: a getter that THROWS (a browser with site data
 * blocked, a packaged window with storage disabled) degrades to the defaults rather than taking
 * the detector down with it — the pop-up is a convenience, and a convenience must never be the
 * reason a tab fails to render.
 */
export function readQuestToastPrefs(get: (key: string) => string | null): QuestToastPrefs {
  const read = (key: string): string | null => {
    try {
      return get(key)
    } catch {
      return null
    }
  }
  return {
    enabled: readBool(read(QUEST_TOAST_KEYS.enabled), DEFAULT_QUEST_TOAST_PREFS.enabled),
    myClasses: readBool(read(QUEST_TOAST_KEYS.myClasses), DEFAULT_QUEST_TOAST_PREFS.myClasses),
    repeatMin: readRepeat(read(QUEST_TOAST_KEYS.repeatMin))
  }
}

/** What the toggle group prints on each stop. An hour is said as an hour, not as 60 minutes. */
export function repeatLabel(m: RepeatMinutes): string {
  return m === 60 ? '1 hour' : `${String(m)} min`
}
