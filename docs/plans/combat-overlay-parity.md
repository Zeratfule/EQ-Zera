# Combat panel ⇄ overlay parity — one model, five owner rulings

Status: DESIGN. Author: planning session (Fable), 2026-08-05. Owner-requested.
Builds ON wave M (in flight: overlay meter rows collapse onto petRows.ts —
one row builder for both surfaces). Constrained by AGENTS.md: overlay laws
(MUI-free bundle, WH_MOUSE_LL cursor-freeze note in windows.ts, persisted
bounds/config), "Fight vs Overall is an explicit SCOPE, never an automatic
switch", lint ceilings.

## 0. The rulings (owner, verbatim intent)

1. The combat panel lacks the overlay's HEAL functionality — parity.
2. Panel and overlay share as much functionality as possible through shared
   components — drill-down included.
3. A LOCKED overlay keeps its top dropdown usable; click-through everywhere
   else.
4. Fight selection is GLOBAL: picking a fight in the combat panel or ANY
   overlay switches every fight-scoped surface (app + overlays). Overall
   (zone-session) selection stays per-overlay.
5. Share more code, generally.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| P1 | LOGIC is shared 100%; CHROME stays per-surface but thin. Row building (petRows), drill state machine, selection model, scope filtering (scopeOptions) live in shared modules imported by BOTH bundles; the main view wraps them in MUI, the overlay in its MUI-free primitives. Every shared seam gets a one-builder pin test (the wave-M pattern) so divergence has no place to live | The overlay bundle is MUI-free by law — components can't be literally shared, functions can |
| P2 | Main combat view gains a **Healing dimension** beside Outgoing/Incoming, reading the SAME heal aggregates the overlay heal kinds read, through the same shared builders; Fight/Overall scope toggle applies as it does for damage | Parity ruling 1; the data already exists (heal-fight/heal-overall overlays render it today) |
| P3 | Locked-overlay selective input: the selector row stays interactive; the rest stays click-through. Mechanism: the overlay already receives forwarded mouse moves (its hover sensor); when the cursor enters the selector's bounds (or its popup is open) the renderer asks main to `setIgnoreMouseEvents(false)`, re-ignoring on leave/close. No new WH_MOUSE_LL hook — forward:true is already on for meter kinds | Ruling 3; the freeze hazard note in windows.ts stays true because nothing new hooks the mouse |
| P4 | **Global fight selection** is a tiny main-process module: `{ fightId: '__live__' \| 'e<n>' }`, ephemeral (resets to `__live__` at startup), broadcast over one IPC channel to the main window + every overlay. Any fight-scoped selector WRITES it; every fight-scoped surface FOLLOWS it. Zone-session ('overall') selectors keep their per-overlay selection untouched | Ruling 4, including its carve-out |
| P5 | Global selection changes the SELECTED FIGHT, never the SCOPE. A surface in Overall scope stays in Overall; the standing law ("scope is explicit, never automatic") is untouched. `__live__` stays the sentinel that re-resolves per tick | Reconciles ruling 4 with the existing scope law |
| P6 | Stale global fightId (fight aged out of the ring) degrades exactly like a stale drill: the surface renders its default (live/last-fight) without clearing the global | The overlay stale-id law generalized |

## 2. Wave partition

- **Wave M (in flight):** the row-builder collapse. Lands first; P builds on it.
- **Wave P (after M):** P2 heal dimension in the main view · P3 locked-mode
  selector interactivity · P4/P5 global fight selection (main module + IPC +
  both surfaces' selectors) · the shared-seam pin tests · e2e: change fight
  in an overlay ⇒ main view follows (and vice versa), overall selector
  unaffected; locked overlay's dropdown clicks while its body click-throughs.
- Anything M's report flags as leftover divergence (heal row-building,
  selector code) folds into P's scope explicitly.
