// ============================================================================
// devTriage — the ONE place the compile-time dev-tools flag reaches a component tree.
// ============================================================================
//
// `__EQ_DEV_TOOLS__` is substituted by the renderer `define` in electron.vite.config.ts: `true`
// under `electron-vite dev`, `false` for `electron-vite build`. When it is false this file
// compiles to `const Lazy = null` and the `import()` below is DEAD CODE — rollup removes the
// call, the chunk it would have produced is never emitted, and `features/triage/**` leaves no
// trace in `out/renderer`. That is a STRIP, not a hide: there is no bundled component to
// un-hide, no string to grep, and no route into it.
//
// The dynamic import is what makes the strip possible. A static `import TriageView from …`
// would pull the tree into the graph before any branch could remove it.
//
// THE LAZY CONST STAYS ON `DEV_TOOLS`, AND THAT IS NOT AN OVERSIGHT (JOS-72). Stripping is a
// COMPILE-TIME question and only a compile-time literal can answer it; `OWNER_TOOLS` carries a
// runtime term (`EQ_OWNER_TOOLS=1`), so writing it here would leave the whole triage tree in
// every bundle behind a boolean. Whether to SHOW the tab is the other question, it is runtime,
// and `OWNER_TOOLS` is its answer — checked below as a second lock behind App.tsx's route.

import { type JSX, Suspense, lazy } from 'react'
import { CircularProgress } from '@mui/material'
import { DEV_TOOLS, OWNER_TOOLS } from './devFlags'

const LazyTriageView = DEV_TOOLS ? lazy(() => import('./features/triage/TriageView')) : null

/** The owner's triage tab — nothing at all in a build without the flag, or a checkout without
 *  the opt-in. */
export default function DevTriageView(): JSX.Element | null {
  if (!LazyTriageView || !OWNER_TOOLS) return null
  return (
    <Suspense fallback={<CircularProgress size={20} />}>
      <LazyTriageView />
    </Suspense>
  )
}
