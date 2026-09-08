/**
 * hookHost.mts — run ONE React hook, for real, with no browser and no test renderer.
 *
 * WHY THIS EXISTS. This repo's unit suite is `node:test` + tsx over pure modules: there is no
 * jsdom, no @testing-library, no react-test-renderer in the tree, and adding a DOM emulator to
 * assert one hook would be a large dependency for a small claim. But some hook behaviour is not
 * pure arithmetic that can be extracted and tested beside it — the JOS-260 defect was a DEPENDENCY
 * ARRAY. `useWindowedRows` bound its scroll listener in an effect keyed on the ref OBJECT, so when
 * the container node was replaced the effect never re-ran and the listener stayed on the detached
 * element. No amount of testing the maths can see that; only running the hook across a re-render
 * can.
 *
 * WHAT IT IS. React exposes its hook DISPATCHER — the indirection every `useState`/`useEffect`
 * call goes through, and the same seam react-dom and react-test-renderer install themselves into.
 * This host installs a minimal one: slot-indexed state, dependency-compared memos and effects, and
 * a commit phase that runs layout effects before passive ones. The hook under test is imported and
 * called UNMODIFIED, from the real `react` package, with the real `useState` and `useLayoutEffect`
 * identifiers — the only thing that is not React's is the ~90 lines below.
 *
 * WHAT IT IS NOT. Not a renderer: no elements, no children, no concurrent features, no batching
 * beyond "a state write marks the host dirty and `flush()` re-renders until it settles". Effects
 * are flushed synchronously rather than after paint. It is deliberately the smallest thing that
 * can answer "does this effect re-run when that value changes", and anything needing a real DOM
 * belongs in the e2e suite, where the app under test has one.
 *
 * `Object.is` bail-out included, because that is load-bearing for the hook it was written for: an
 * effect that re-reads a ref on every commit must not re-render when nothing changed.
 */

import React from 'react'

interface DispatcherHost {
  ReactCurrentDispatcher: { current: unknown }
}

const internals = (React as unknown as Record<string, unknown>)
  .__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as DispatcherHost | undefined

if (!internals?.ReactCurrentDispatcher) {
  throw new Error('hookHost: this React build exposes no dispatcher seam — see the header')
}
const CURRENT = internals.ReactCurrentDispatcher

type Deps = readonly unknown[] | undefined
/** What an effect may return: a cleanup, or nothing. React's own `Destructor | void`, spelled in
 *  the one way the lint rules accept — `undefined` rather than `void` inside a union. */
type Destructor = (() => void) | undefined

interface StateSlot {
  kind: 'state'
  value: unknown
}
interface MemoSlot {
  kind: 'memo'
  value: unknown
  deps: Deps
}
interface RefSlot {
  kind: 'ref'
  ref: { current: unknown }
}
interface EffectSlot {
  kind: 'effect'
  layout: boolean
  deps: Deps
  cleanup: Destructor
  pending: (() => Destructor) | null
}
type Slot = StateSlot | MemoSlot | RefSlot | EffectSlot

/** A mounted hook: its latest return value, and the three things a test does to it. */
export interface HookHost<T> {
  /** What the hook returned on the most recent render. */
  readonly value: T
  /** Re-render (what a parent re-render does), then flush effects until the host settles. */
  render(): T
  /** Run `body` — an event handler, a resize, anything that writes state — then settle. */
  act(body: () => void): T
  /** Unmount: every effect cleanup runs, exactly once. */
  unmount(): void
}

const sameDeps = (a: Deps, b: Deps): boolean =>
  a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))

/** Mount `hook` and drive it. `hook` is called like a component body: hooks in a stable order. */
export function mountHook<T>(hook: () => T): HookHost<T> {
  const slots: Slot[] = []
  let index = 0
  let dirty = false
  let mounted = true
  // Assigned by the first `settle()` below, before anything can read it.
  let value = undefined as unknown as T

  const slotAt = <S extends Slot>(make: () => S): S => {
    const existing = slots[index]
    if (existing === undefined) slots[index] = make()
    index += 1
    return slots[index - 1] as S
  }

  const useState = <S,>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] => {
    const slot = slotAt<StateSlot>(() => ({
      kind: 'state',
      value: typeof initial === 'function' ? (initial as () => S)() : initial
    }))
    const set = (next: S | ((prev: S) => S)): void => {
      const resolved = typeof next === 'function' ? (next as (prev: S) => S)(slot.value as S) : next
      // React bails out of a write whose value is Object.is-equal to the current one; the hook
      // under test relies on exactly that to read a ref every commit for free.
      if (Object.is(resolved, slot.value)) return
      slot.value = resolved
      dirty = true
    }
    return [slot.value as S, set]
  }

  const useMemoLike = <S,>(make: () => S, deps: Deps): S => {
    const slot = slotAt<MemoSlot>(() => ({ kind: 'memo', value: undefined, deps: undefined }))
    if (slot.value === undefined || !sameDeps(slot.deps, deps)) {
      slot.value = make()
      slot.deps = deps
    }
    return slot.value as S
  }

  const useEffectLike = (layout: boolean) => (create: () => Destructor, deps: Deps): void => {
    const slot = slotAt<EffectSlot>(() => ({
      kind: 'effect',
      layout,
      deps: undefined,
      cleanup: undefined,
      pending: null
    }))
    // No dependency array ⇒ every commit. Otherwise only when the array actually moved.
    if (slot.pending === null && (deps === undefined || !sameDeps(slot.deps, deps))) {
      slot.pending = create
    }
    slot.deps = deps
  }

  const dispatcher = {
    useState,
    useRef: <S,>(initial: S) => slotAt<RefSlot>(() => ({ kind: 'ref', ref: { current: initial } })).ref,
    useMemo: useMemoLike,
    useCallback: <F,>(fn: F, deps: Deps): F => useMemoLike(() => fn, deps),
    useEffect: useEffectLike(false),
    useLayoutEffect: useEffectLike(true),
    useInsertionEffect: useEffectLike(true),
    useDebugValue: (): void => undefined,
    useContext: (): never => {
      throw new Error('hookHost: useContext is out of scope — see the header')
    }
  }

  const commit = (): void => {
    for (const layout of [true, false]) {
      for (const slot of slots) {
        if (slot.kind !== 'effect' || slot.layout !== layout || slot.pending === null) continue
        const create = slot.pending
        slot.pending = null
        slot.cleanup?.()
        slot.cleanup = create()
      }
    }
  }

  const renderOnce = (): void => {
    index = 0
    const previous = CURRENT.current
    CURRENT.current = dispatcher
    try {
      value = hook()
    } finally {
      CURRENT.current = previous
    }
    commit()
  }

  const settle = (): T => {
    let guard = 0
    do {
      dirty = false
      renderOnce()
      guard += 1
      if (guard > 50) throw new Error('hookHost: the hook never settled — 50 renders and still dirty')
    } while (dirty)
    return value
  }

  settle()

  return {
    get value(): T {
      return value
    },
    render: settle,
    act: (body: () => void): T => {
      body()
      return settle()
    },
    unmount: (): void => {
      if (!mounted) return
      mounted = false
      for (const slot of slots) {
        if (slot.kind !== 'effect') continue
        slot.cleanup?.()
        slot.cleanup = undefined
      }
    }
  }
}
