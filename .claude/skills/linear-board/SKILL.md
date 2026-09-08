---
name: linear-board
description: The Linear-driven dispatch loop for EQ Companion — sync the owner-steered board, dispatch top Todo tickets to worker branches, merge and close. Use at the start of any work session, before dispatching agents, and after any merge.
---

# The Linear board loop

Canonical project management is the kanban in the owner's PERSONAL Linear
workspace (**Josh's Maker Space**, team **JOS** — never the Encamp work
workspace). CLI: `npx tsx scripts/linear.mts` (auth: `.triage/linear.env`,
gitignored). The owner STEERS BY EDITING THE BOARD — reordering, reprioritizing,
cancelling — so the board is read fresh at every decision point, never cached.

## The loop

1. **SYNC** — `linear.mts list --state Todo`. Output is sorted by the board's
   own manual column order with the priority field shown. This listing IS the
   dispatch queue. A ticket that has moved is a decision; a ticket that is
   Canceled is a STOP order (including for in-flight work: if a dispatched
   ticket gets cancelled, stop the agent, discard or park the branch, comment
   what was in progress when the stop landed).
2. **PICK** — take tickets from the top, skipping any whose stated gate is
   unmet (e.g. "waiting on the reporter", "gated on owner verification") —
   note the skip in a ticket comment so the owner sees why it was passed over.
   Batch only up to disjoint-file parallelism (1–5 agents); when two top
   tickets would touch the same files, dispatch the higher one and queue the
   other with a comment.
3. **DISPATCH** — the TICKET IS THE BRIEF (bodies are written self-contained;
   `linear.mts show JOS-N` prints body + comments). The agent brief is:
   read the ticket, read AGENTS.md, build it on your own worktree branch,
   merge-ready per the BRANCH INTEGRATION RULES. Move the ticket to
   In Progress with a comment naming the wave/agent.
4. **INTEGRATE** — `git merge --no-ff` the worker branch, re-verify on merged
   main (typecheck + lint + full unit + affected e2e), push, delete
   branch + worktree. Move the ticket to Done with the merge commit hash in
   a comment. Cherry-pick is salvage-only.
5. **REPEAT** — re-SYNC before the next pick; the owner may have edited the
   board while agents ran.

## Board conventions

- **States: Todo → In Progress → Done (+ Canceled).** No Backlog — everything
  accepted lives in Todo, ordered by the owner.
- **Tickets are END-TO-END improvements**, not story pieces. One improvement =
  one ticket = one branch = one merge. Owner rattle-lists for one module get
  grouped into one ticket. Split only when something proves independently
  shippable — comment why.
- **Titles: `Module / What the user gets`** — no wave names, no agent names.
  Those live in comments at pickup.
- **Bodies are self-contained build briefs**: plain-language story first
  (what/why/who asked), then `### Build brief` with design decisions, file
  pointers, plan-doc references, measured facts, house rules, and acceptance
  criteria — enough for an agent with zero conversation context.
- **Only create tickets the owner has asked for or accepted** — the board is
  not a scratchpad for speculative work.
- **Comments carry the operational trail**: dispatch notes, skip reasons,
  milestone updates on long tickets, merge hashes, release stamps.
