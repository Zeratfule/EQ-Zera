# Attack-round stats — riposte, flurry, double/triple attack, orthogonal to damage

> **§3 (the Rounds panel) is SUPERSEDED by JOS-37, 2026-08-06.** The owner found the readout
> hard to understand, so the panel became MULTI-ATTACK: one row per attack type,
> `<rounds> rounds · 24% doubled · 3% tripled`, flurry stated once for the source, and a single
> `est.` on the dual-wieldable verbs in place of the `inferred` chip and its four hover
> paragraphs (TOOLTIP AND CAVEAT DIET). Riposte, rampage, the exclusion tally and the modifier
> list are not multi-attack and left the view; they remain on `SourceRoundsView`. **§1, §2 and
> the ENGINE (combat/rounds.ts, roundViews.ts) are unchanged** — same grouping, same fan-out
> collapse, same per-event vs aggregate tiers. Only the reading changed.

Status: DESIGN. Author: planning session (Fable), 2026-08-05. Owner-requested
("track double/triple attack percentages — stats orthogonal to damage").
Research: the 2026-08-05 mechanics sweep (full report in the session; key
facts restated here with confidence labels). Constrained by AGENTS.md law 8
(first-class, damage-free — every damage total stays byte-identical, the
tripwire), law 6 (say what the log cannot say), law 11 (rate-aware), lint.

## 1. The mechanics, as verified

- EQL annotates riposte/flurry/rampage swings; **double/triple attack are
  SILENT extra swings** (zero annotations in 1.35M lines against thousands
  of measured multi-swing seconds). Complete modifier vocabulary: 14 forms
  over 8 base modifiers, measured counts in the research notes.
- Riposte: the `(Riposte…)` line IS the counter-swing. ASYMMETRY: a mob
  riposting the player prints NO avoidance line — the mob's annotated
  counter-swing is the only evidence. Double Riposte AA means counters ≠
  riposte events 1:1.
- Flurry (EQL): up to 2 extra primary swings after a triple, granted by the
  Burst of Power AA (lvl 46+) — provenance airtight (first outgoing flurry
  9s after the AA purchase). Annotated on hits AND misses.
- Rampage: annotated INCOMING/third-party only; the player's own Rampage AA
  swings log unannotated → outgoing rampage is unknowable as such (law 6).
- Double/triple attack applies to backstab (in-log confirmed + measured
  triple backstab) and to specials (bash/cleave wiki-stated; kick measured).
- Dual wield puts two weapons on one verb → same-second 2x on a WEAPON verb
  may be two hands, not a double. Reuse-timer skills (backstab ~10s, kick,
  bash, tiger claw) do not have this confound. Frenzy is multi-hit by
  design — excluded. Cross-target same-second equal-damage pairs are ONE
  swing fanned to two targets (measured on all five 4x-backstab seconds) —
  grouping is per (second, target) with fan-out collapse.

## 2. The honesty tiers (what ships as what)

| Stat | Tier | Shape |
|---|---|---|
| Riposte given/taken counts | stated | exact counts from annotations; taken = mob `(Riposte)` counter-swings (the asymmetry documented in the UI tooltip) |
| Flurry count + rate | stated | count; rate over primary attack rounds |
| Rampage taken | stated | incoming only; outgoing absent BY LAW, not omission |
| Modifier tallies (Critical, Slay Undead, Finishing Blow, …) | stated | the ×N rows the drill already earned |
| Double/triple BACKSTAB | inferred, high | per-event detection (same second, same target, fan-out collapsed, cooldown makes it near-certain); count + % of backstab rounds |
| Double/triple on reuse-timer specials (kick/bash/tiger claw/…) | inferred | per-event on the same rule; listed per skill |
| Multi-swing rate on weapon verbs | inferred, aggregate ONLY | "~N% of slash rounds were multi-swing" with the dual-wield confound stated; NEVER a per-event double-attack label |
| Outgoing rampage, Double Bow Shot | unknowable / unobserved | documented; bow annotations wait for a real archery log (awaiting-sample) |

## 3. Data model & surfacing

- Engine: additive per-source counters on the existing aggregates (the
  miss/resist precedent — same attribution, no amounts): modifier tallies
  by (source, modifier), round-structure counters by (source, skill,
  swings-per-round bucket 1/2/3/4+), riposte-taken. Ring events already
  carry modifiers; the counters make them cheap at read. Law 8 tripwire:
  Σ damage per source/category byte-identical before/after.
- Renderer: a **Rounds** panel in the Combat drill (beside the breakdown,
  scope-aware fight/overall, per source you/pet): riposte given/taken ·
  flurry ×N (rate) · per-skill round table (rounds, multi %, incl. the
  backstab double/triple row) · modifier tallies. Labels carry the tier
  chips (`db`-style: stated vs `inferred`). v1 is the main panel only; the
  overlay gets it later if dwell shows demand.
- Rates carry their denominators visibly (rounds, not swings — law 11's
  spirit: a rate without its exposure is a lie).

## 4. Wave X (implementation, single Opus executor)

Engine counters + fan-out-collapsing round grouper (pure, node-tested
against fixtures cut from the measured windows: the triple backstab second,
a fan-out 4x second, a flurry-era window) + the Rounds panel + tests + e2e
check. Byte-identity gate mandatory.
