// lib/currentView.ts — which tab is on screen, for the error reporter and nothing else.
//
// A MODULE VARIABLE RATHER THAN CONTEXT, deliberately. Its two readers are `main.tsx`'s
// `window.onerror` / `unhandledrejection` handlers and `ErrorBoundary.componentDidCatch` —
// neither of which is inside the React tree in any useful sense at the moment it runs. An
// ErrorBoundary catches by definition when the tree below it has failed, and a global error
// handler is not in a component at all; asking either of them to read a context would be
// asking the thing that just broke to still work.
//
// It is also the reason this module imports NOTHING. `ErrorBoundary.tsx` deliberately imports
// no app code (the theme itself can be the crash source), and a plain string setter is the only
// kind of import that does not weaken that.
//
// WHAT IT IS FOR (JOS-100): an `errorReport`'s `view` field. Main cannot know which tab is open
// — that is renderer state — so the renderer states it on every error it reports, and main
// remembers the last one for its OWN errors. The value is checked against the closed view enum
// in main (`noteCurrentView`), because renderer input is untrusted there, always.

let current = 'unknown'

/** Called from App.tsx beside `useViewDwell`, on every view change. */
export function setCurrentView(view: string): void {
  current = view
}

/** The last view App.tsx announced, or `'unknown'` before the first render. */
export function currentViewId(): string {
  return current
}
