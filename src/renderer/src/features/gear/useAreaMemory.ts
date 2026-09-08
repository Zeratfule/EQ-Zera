// gear/useAreaMemory.ts — the ONE hook every remembered field in the gear area goes through
// (JOS-329). `areaMemory.ts` next door owns the RULE and the sanitizers; this file owns the two
// Storages and nothing else.
//
// THE WHOLE MECHANISM IS ONE FUNCTION, and that is the point of the ticket rather than an economy.
// The complaint was that four tabs each remembered a different amount of what the user had done —
// two localStorage keys on Gear, four on Exaltations, one on Character, nothing anywhere else — so
// the fix is not "persist more things", it is "there is one way to remember a field, and every
// field uses it". `useRemembered` is that way. A surface adds a line to `AREA_FORM_TIER` and calls
// this; it never touches `localStorage`, never picks a tier, and never writes its own reader.
//
// THE TIER IS LOOKED UP, NOT PASSED. `tierOf(key)` decides which Storage a field lives in, so the
// restart split is enforced by the key you name rather than by remembering which argument to pass.
// Putting the gear search box on the restart tier is not a mistake this API can make.
//
// READING NEVER THROWS AND WRITING NEVER THROWS — the `useGearPrefs` rule, widened to both tiers. A
// private-mode window, a disabled storage, a quota, a half-written JSON value from a build that
// crashed mid-write: all of them are "nobody has expressed a preference", which every sanitizer
// answers with its own default. A preference that cannot be persisted still applies to this
// session, which is strictly better than a render that throws inside a tab switch.
//
// THE INITIALISER RUNS ON MOUNT, WHICH IS EXACTLY THE EVENT THE BUG IS ABOUT. A view unmounts on
// every tab switch (JOS-90/97/116); this hook re-reads storage every time one mounts, so coming
// back to a tab rebuilds the form from what was written when you left it. Nothing here runs from an
// effect — the other half of that law, because an effect cannot tell a click from a mount, and
// every write below is on a change handler.

import { useCallback, useState } from 'react'
import { sanitizeSearch, tierOf, type AreaFormKey, type MemoryTier } from './areaMemory'

/**
 * The Storage a tier lives in, or `null` when this window will not hand one over.
 *
 * Reading `window.sessionStorage` can THROW rather than return null (a Chromium window with storage
 * denied), so even the lookup is guarded — the failure mode is a feature that forgets, never a
 * renderer that white-screens on a tab click.
 */
function storageFor(tier: MemoryTier): Storage | null {
  try {
    return tier === 'restart' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

/**
 * One remembered field as parsed JSON, or `null` for anything unusable — absent, empty, truncated,
 * or a storage we cannot reach. The SANITIZER above this decides what the parsed value MEANS; this
 * only decides that reading it can never throw.
 */
function readJson(key: AreaFormKey): unknown {
  try {
    const raw = storageFor(tierOf(key))?.getItem(key) ?? null
    return raw === null || raw === '' ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Write a value, or REMOVE the key when it is `null`.
 *
 * `null` is a real answer for two fields in this area — a gear class filter that is still following
 * detection, and an item narrowing that has been cleared — and for both of them "no key" is the
 * honest storage of it. Writing the string `null` would work too; removing keeps the store readable
 * and makes a cleared field indistinguishable from one nobody ever touched, which is what it is.
 */
function writeJson(key: AreaFormKey, value: unknown): void {
  try {
    const store = storageFor(tierOf(key))
    if (store === null) return
    if (value === null) store.removeItem(key)
    else store.setItem(key, JSON.stringify(value))
  } catch {
    // A field that cannot be persisted still applies to this session.
  }
}

/**
 * A piece of form state that survives leaving the tab — read through `sanitize` on mount, written
 * through on every change.
 *
 * `sanitize` is called ONCE per mount, inside the lazy initialiser, so it does not need a stable
 * identity and a caller may pass an arrow. It is also the only thing that ever converts storage
 * into state: there is no path in this file that hands a raw parsed value to a component.
 */
export function useRemembered<T>(key: AreaFormKey, sanitize: (raw: unknown) => T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => sanitize(readJson(key)))
  const set = useCallback(
    (next: T) => {
      setValue(next)
      writeJson(key, next)
    },
    [key]
  )
  return [value, set]
}

/**
 * THE COMMON CASE, SPELLED ONCE: a free-text search box.
 *
 * All four tabs have exactly one, all four were three identical lines of `useState('')`, and all
 * four were the state the owner lost most often. The key still decides the tier — every search key
 * in `AREA_FORM_TIER` is `session`, and this helper does not hardcode that, it just stops four
 * call sites from each naming the sanitizer.
 */
export function useRememberedSearch(key: AreaFormKey): [string, (v: string) => void] {
  return useRemembered<string>(key, sanitizeSearch)
}
