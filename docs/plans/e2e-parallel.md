# E2E, made repeatable — parallel-safe, worktree-runnable, deterministic

Status: **DONE — E1, E2 and E3 all landed** (E2/E3: JOS-29, 2026-08-06). The suite reads
committed per-spec fixtures, scripts its own live gameplay, and waits for conditions:
13/13 green twice consecutively at 150.4 s and 148.2 s wall from a worktree, against
12/13 at 175.7 s before. Author: planning session (Fable), 2026-08-05.
Grounded in a full harness audit (same date): 13 hand-listed serial specs, ~28 min
observed wall clock (one spec: ~20 min), one shared userData dir for every spec
and rerun, the user's LIVE EverQuest log as the system input, ~60 raw sleeps,
no runner timeout/filter/timings. AGENTS.md:138-142 already records the
parallel-run failure (5/13, 6/13, then 13/13 with zero code change); the serial
runner IS that workaround. This plan removes the reasons for it.

## The seven causes, and the decision that kills each

| # | Cause (audited) | Decision |
|---|---|---|
| 1 | Isolation unit is a CHECKOUT: `USER_DATA = sha1(ROOT)`, shared by 13 specs × 16 launches × every rerun; E2E never takes the single-instance lock; `freshUserData()` rm-rf's the shared dir under a neighbour | **E1**: isolation unit becomes ONE LAUNCH — `mkdtempSync` per `launchApp()`, cleaned best-effort after close, orphans reaped by age at runner start. `freshUserData()` dies; nothing is ever deleted out from under a live process |
| 2 | The system under test is the user's live, growing log (no fixture, 1.37M lines, 10.8 s replay × 16 launches ≈ 3 min of redundant hydration) | **E2**: per-spec COMMITTED fixture logs (the `extract-*-fixtures.mjs` family already builds slices; `wl2-aa-potion.log` is the pattern), pointed at via the log-config env override. "Live lines" become the HARNESS APPENDING to the tailed fixture — deterministic gameplay, no 45 s waits on real play. Replay cost collapses from 10.8 s to ms |
| 3 | ~60 raw sleeps betting on render latency (800 ms post-toggle, 1200 ms post-resize, 1500 ms post-hydration…) — bets that lose exactly under the CPU contention parallelism creates | **E3**: every sleep becomes a condition: one shared `settle()` (poll-to-deadline on selector/predicate). The specs already own the right tools (`until`, `waitForReplay`, `waitForCombatText`) — the sleeps are the unconverted remainder |
| 4 | Single-instant reads (`lanes` read once, before the panel's existence is even checked; absence asserted after a flat 1.5 s) | **E3**: assertions read a SETTLED state with a deadline; absence assertions wait for the positive signal that layout completed, then assert absence |
| 5 | `no renderer console errors` is secretly a network assertion: cold `eqimg://` cache + deliberate no-negative-caching ⇒ 404 console noise on any missing wiki icon | **E1**: `imageCache` goes network-off under `EQ_E2E` (returns 404 without fetching), the SAME gate feedback/telemetry already obey. The assertion becomes what it claims to be |
| 6 | Failure is expensive and blind: 20 s screenshot timeout against a hidden window that never composites (verified: FAIL specs produced no PNG), and one spec rm-rf's the whole shared artifacts dir | **E1**: artifacts under `artifacts/<runId>/<spec>/`, nothing ever deletes a sibling; screenshot timeout 3 s and absence tolerated (the HTML dump is the evidence that matters) |
| 7 | Runner: no discovery, no arg filter, no per-spec timeout, no timings, exit-0-vs-12/13 confusion risk lives in caller pipelines | **E1**: runner discovers `*.e2e.mts`, takes name filters, enforces a per-spec timeout (default 5 min), prints + writes per-spec durations (`artifacts/<runId>/summary.json`), runs specs in parallel with a concurrency cap (default `min(4, cores/2)`; `--serial` remains) — safe because of #1/#2 |

**Worktrees (E1):** the ONLY breakage is hardcoded `join(ROOT,'node_modules',…)`
for electron-vite and electron.exe. Both become `createRequire(ROOT)` resolution —
Node's ancestor walk finds the repo root's `node_modules` from
`.claude/worktrees/<agent>` with zero installs. Build output stays per-worktree
(`out-e2e/`), first build ≈ 2 s (measured). After E1, "the harness cannot run in
a worktree" stops being an excuse any doer can reach for — see the standing rule
(workers fix and RUN the tests they touch).

## Waves

- **E1 — the floor (dispatched)**: per-launch userData; resolution not joins;
  runner rewrite (discovery/filter/timeout/timings/parallel); artifacts per run;
  screenshot 3 s; imageCache E2E gate; delete `freshUserData` and the artifacts
  rm-rf. NO spec-assertion changes beyond what the isolation forces. Exit
  criterion: two `npm run test:e2e` invocations racing each other both go 13/13,
  and a worktree run completes.
- **E2 — determinism (DONE, JOS-29)**: 13 committed fixtures cut by
  `tests/extract-e2e-fixtures.mjs` through the shared scrub (~800 KB, largest
  225 KB); `tests/e2e/logFixture.mts` stages a throwaway EQ install per launch
  and hands it over via `EQ_INSTALL_DIR`; the APPEND DRIVER writes whole
  EQ-stamped lines into the tailed copy, so `tests/e2e/gameplay.mts` scripts a
  pull whose damage the repo STATES — ten hits, 442 points, four seconds — and
  the combat and overview specs assert that total exactly instead of a floor.
  The maps spec junctions the real install's `maps/` dir in beside its fixture
  (200 MB of packs is a game install, not a repo artifact).
- **E3 — the sleep purge (DONE, JOS-29)**: `tests/e2e/settle.mts` — `settle` /
  `settleCount` / `settleGone` / `settleStable`, plus a `hoverAt` that clips
  against every ancestor and verifies its own hit. ~60 raw sleeps → 2, and both
  survivors are instruments: the timeline SAMPLES geometry on a clock because
  change over time is its subject, and telemetry dwells past a second because
  `useViewDwell` ignores anything shorter.
  **The leveling red was the harness**: `hoverAt` clamped only to the window, so
  the drag point for a chart clipped by its own scrolling column landed on the
  app's content area and the pointer handlers never fired.

## What deliberately does NOT change

- The hand-rolled `check()/note()` harness stays — it is small, honest, and the
  specs are written against it. No Playwright test-runner migration; the win is
  isolation + determinism, not a framework brand.
- `EQ_E2E` skipping the single-instance lock stays — per-launch userData makes
  it correct instead of dangerous.
- Serial mode stays available for debugging (`--serial`).
