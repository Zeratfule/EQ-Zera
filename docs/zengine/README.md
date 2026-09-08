# The Z Engine

The Rust log engine under `engine/` is EQ Zera's own line of development. It began as
everquest-companion's `engined` (a port of the app's TypeScript fold, proven byte-identical to it by
the `parity` crate); the fork takes it over as **the Z Engine**, keeps the parity oracle as the
safety net, and improves it against measurements taken on a real log with the shipped binary.

Rules the program inherits, all from `docs/plans/data-server.md` and still binding:

- The fold is a pure function of the log's bytes. Every determinism pin is also a cache-correctness
  proof; new nondeterminism is a bug, not a style issue.
- The engine never spawns PowerShell, never pins a core, and runs at below-normal priority: the
  person at the machine is playing EverQuest.
- Accuracy is proven, not asserted: a change to the parser or a module must leave the golden
  oracles (`engine/crates/parity`, the fold's snapshot tests) green.

## Measuring

    npm run engine:baseline [-- --label <name>]

Spawns `engine/target/release/zengine.exe` exactly as the app does, attaches the largest log under
the game's `Logs` folder, and polls `perf.snapshot` until the fold is live. One JSON record lands
in this folder per run. The stage attribution comes from the parity tool:

    engine/target/release/parity.exe <log> --character <Name> --stages

## Baseline: 2026-09-06, Z0 (the engine as inherited)

Log: `eqlog_Zeratfule_freeport.txt`, 141.8 MB, 1,723,857 lines, 1,723,854 events.
Machine: the owner's desktop, engine at below-normal priority, nothing else folding.

| measure | value |
| --- | --- |
| attach to live (what the app feels at launch) | 22.6 s |
| scan (engine-reported) | 21.6 s, 6.3 MB/s, 79.7k events/s |
| spell DB load per engine start | 0.47 s (release), 0.74 to 1.03 s under the dev app |
| working set at live | 408 MB |
| CPU over the scan | 22.0 s |
| release binary | 27.4 MB |

Stage attribution (`2026-09-06-z0-stages.txt`), full fold 18.6 s in the parity harness:

| stage | wall | share |
| --- | --- | --- |
| split into lines | 0.09 s | 0.5% |
| parse (eqlog) | 5.18 s | 27.9% |
| serialize events | 0.20 s | 1.1% |
| twenty modules + combat | 13.10 s | 70.5% |

Inside the modules, by consumer: **combat 7.9 s (59%)**, buffs 2.1 s (15%), resist 1.5 s (11%),
respawn 0.5 s; the other seventeen modules together are under 1.2 s.

What the log is made of: damage 650k, miss 374k, buffApply 297k, unknown 139k, heal 99k,
otherCastBegin 66k; everything else is under 15k each. Damage and miss lines are 59% of all events,
and they all go through the combat module.

## Where the combat cost is (Z1, 2026-09-06)

Phase timers on the two hottest lanes (`fold/profile` feature, printed by `parity --stages` when
built with `--features profile`; `2026-09-06-z1-stages.txt`). Of combat's 7.3 s:

| phase | wall | what it is |
| --- | --- | --- |
| damage.route | 3.35 s | attribute, resolve, aggregate, engage, timeline, log for 650k hits |
| of which out.agg | 0.81 s | the per-skill / per-category / per-modifier / round rows, on the encounter AND the zone aggregate |
| miss | 2.21 s | the same for 374k avoided swings |
| damage.closure | 0.41 s | encounter idle-closure check per hit |
| damage.analytics | 0.39 s | proc windows and state split |
| damage.origin / prepare | 0.47 s | cast-claim verdict, event decode |

There is no single defect: it is ~5 µs of small work per hit, most of it string keys and hashing
into a dozen small maps, done twice (encounter and zone aggregates). Two things were fixed on the
way, both parity-neutral:

- The encounter timeline and marker rings were `Vec`s that dropped their oldest with `remove(0)`
  (a 1.4 MB memmove per hit once a fight passed 8,000 records). Now deques. Small on this log,
  since few fights pass the cap; pathological on a long raid.
- The round grouper built four strings per swing per aggregate; the row lookups hashed three times
  per key. Now one hash (`JsMap::get_or_insert_with`) and no allocation when the spelling is
  already folded. The parser memoises the last stamp, so a burst of lines in one second skips the
  stamp regex and the zone conversion.

Z0 → Z1 in the parity harness: parse 5.18 → 4.79 s, fold 18.57 → 17.66 s (about 5%); in the app
(`2026-09-06-z1-release.json`): scan 21.6 → 17.7 s, attach-to-live 22.6 → 18.5 s (18%), working
set unchanged at 407 MB.

Z1 → Z2, the parse-ahead pipeline (`zengine/src/scan.rs`: the parser on its own thread, batches of
owned events to the fold thread, the same sequence): scan 17.7 → 13.5 s, attach-to-live 18.5 →
14.4 s (`2026-09-06-z2-release.json`), peak working set 407 → 445 MB (two batches in flight).
Against Z0 that is 22.6 → 14.4 s at launch, 36% less.

Z2 → Z3, the combat lane (2026-09-07, `fold/src/lane.rs`): the combat engine folds on a thread of
its own beside a private roster copy, fed every bus event in order; the fold thread waits only when
something reads the engine. Scan 13.5 → 8.7 s (15.5 MB/s, 197k events/s), attach-to-live 14.4 →
**9.7 s** (`2026-09-07-z3-release.json`), peak working set 450 MB. Against Z0: 22.6 → 9.7 s at
launch, **57% less**. Proof of exactness: `fold/tests/lane_parity.rs` folds every log fixture
inline and on the lane and requires byte-identical combat snapshots, fight summaries, scope walks
and module snapshots; with `ZENGINE_LANE_LOG` it did the same over the owner's whole 142 MB log
(passed, 34 s). Three threads now share a scan: parse, the nineteen modules, combat.

Z3 → Z4, the fold checkpoint (2026-09-07). At the fold's landing - before the first beat, while the
fold is still a pure function of the bytes - the engine writes the whole fold state under the app's
state directory (`<userData>/checkpoints/<log>.zck`: one JSON header line, then every module's and
the combat engine's state as JSON parts; 40 MB for this log, written in 0.2 s). The next attach
restores it and scans only what was appended. The key is everything the fold is a function of: the
engine build, the held defines, the persisted seed files, the spell table's stamp, the zone and
character, and a hash of the log's bytes up to the offset - any mismatch is a cold fold, never a
repair. Measured (`2026-09-07-z4-cold.json`, `-warm.json`): cold 10.0 s to live (the write
included); **warm 1.14 s**, 270 MB working set. Against Z0 that is 22.6 → 1.1 s at launch, 95% less.

Proof of exactness, three layers: `fold/tests/checkpoint_parity.rs` folds every fixture whole and
restore-then-continue from three cut points (modules only, and with the combat engine) and requires
byte-identical answers - it caught a one-ulp float drift in `serde_json`'s default parser, so the
workspace now uses its `float_roundtrip` feature; the same test over the owner's whole 142 MB log
(`ZENGINE_LANE_LOG`); and `zengine/tests/checkpoint.rs` drives two real engine processes: the
second restores the first's landing and answers the same, a restored engine folding appended lines
matches a cold fold of the whole file, and a changed log prefix is refused.

The register of what is left, in order of expected payoff:

1. **Fold in parallel** (done: parse ‖ modules ‖ combat, Z2 and Z3). Modules are independent `on_event` folds over the same event stream, so
   combat (7.3 s), the other nineteen modules (5.3 s) and the parser (4.8 s) can run as a bounded
   three-stage pipeline: wall ≈ the slowest stage rather than the sum, roughly 8 s on this log.
   Constraints to honour: derived events (`take_derived`) re-enter the stream in order, and
   combat reads the roster module (`as_roster`), so those stay on one thread; below-normal
   priority and a fixed thread count, never one per module.
2. **Fold checkpoint** (done as Z4, above).
3. **Fold each hit once.** The zone aggregate is the encounters summed; folding into the encounter
   only and merging at finalize halves out.agg and the miss ledger.
4. **Intern names.** Attacker/target/skill keys are re-hashed as strings on every hit.

## The program

1. **Brand and own it** (done 2026-09-06). Crate and binary `zengine`, log prefix `[z-engine]`,
   the parity tool accepts `--character` so it runs on a live log's filename, and this folder holds
   the measurements.
2. **Baseline** (done, above).
3. **Launch time.** Two routes, in order of payoff per risk:
   - *Make the fold cheaper.* Combat is 59% of module time and damage/miss lines are 59% of events;
     the parser is a further 28% at 27 MB/s. Each is judged by the stage table and kept honest by
     the parity oracle. Target: halve attach-to-live.
   - *Fold checkpoint.* State addressed by (log identity, byte offset), invalidated by engine build +
     schema + input hashes, never patched. Needs every module's state to serialize; today 4 of 37
     module files do. Target: attach-to-live under a second on a warm start. This is the larger job
     and comes after the cheaper wins, which it also benefits from (a cold start still folds).
4. **Spell index** (done, cheaply, 2026-09-07): the compiled-in spell DB is parsed on a named
   thread from process start, overlapping the app's handshake, so an attach no longer waits ~0.45 s
   for it. (`spells_us.txt`, the client table, is a separate lookup surface and was never on the
   attach path.)
5. **Memory budget** (done, 2026-09-07): `tests/budget.rs` reads the engine's resident working set
   at the landing off the OS and asserts `MAX_LIVE_WORKING_SET_BYTES` (512 MB, four times the
   synthetic corpus's measurement) beside the two time budgets, so an uncapped ring or a per-event
   leak is a red CI run.
6. **Parser coverage** (started 2026-09-07). The `unknown` kind was 138,892 events (8.1%) over
   24,221 distinct shapes on the owner's log. The two largest that carry meaning are now parsed:
   `You gain experience (with a bonus)! (3.3%)` (400 of the log's 1,775 experience gains were
   dropped) and the first-person DoT line `You have taken 12 damage from Choking by a thunder
   spirit princess.` (~1,500 lines of incoming damage the meter never saw). Both have unit tests
   in `eqlog`; the DoT line is folded through the third-person shape, so it takes the same road
   and fields. What remains `unknown` is overwhelmingly chatter, emotes and faction lines
   (`aria lifts you into the air`, `voice booms`, `faction standing ... adjusted`); the one
   substantive family left is bard mez landings (`is bound by chords of music`, ~5k), which need
   the spell's landing text in the spell DB rather than a parser change.

7. **Parser coverage, round 2** (2026-09-08). Step 6 named "faction lines" as the largest
   meaningful family still `unknown` and left it there. It is now parsed, along with the hail, and
   the auto-vendor's price is captured instead of discarded. Five shapes, five new fold modules
   (`hails`, `faction`, `coin`, `skills`, `deaths`), no change to the combat engine.

   | shape | kind | fixture lines |
   | --- | --- | --- |
   | `You say, 'Hail[,] <NPC>'` | `hail` `{npc}` | 0 — the committed fixtures hold no chat at all; the shape is verified against the quest catalog's own dialogue transcripts and pinned by an `eqlog` unit test |
   | `Your faction standing with <F> has been adjusted by <n>.` | `factionHit` `{faction, delta}` | 97 |
   | `Your faction standing with <F> could not possibly get any worse.` | `factionHit` `{faction, cap:'min'}` | 130 |
   | `… could not possibly get any better.` | `factionHit` `{faction, cap:'max'}` | 16 |
   | `You looted <item> from <mob>'s corpse and sold it for <money\|free>.` | `loot` `{…, coins}` | 1,219 (981 priced, 238 `free`) |

   THE SATURATION FORMS CARRY NO MAGNITUDE. `could not possibly get any worse.` says the standing
   did NOT move, because it is already at the rail. `delta` and `cap` are mutually exclusive on the
   event, and the `faction` module counts the caps into `maxed`/`bottomed` while summing only the
   deltas. A saturation folded in as a zero would be a lie a chart would draw. And `delta` is never
   your STANDING — no line the client prints states an absolute one.

   `You say` LINES THAT ARE NOT HAILS STAY `unknown`. A hail opens every NPC dialogue tree, so it is
   the one piece of your own chat that carries world meaning; no generic `say` kind was minted
   beside it (the awaiting-sample law — a kind whose only reader would be a chat log).

   THE SOLD PRICE IS THE ONE CHANGE TO AN EXISTING SERIALIZED EVENT. `loot_sold`'s money clause was
   non-capturing, so the parser read the price and threw it away on all 1,219 lines — which is why
   platinum-per-hour was unanswerable, the auto-vendor being by far the largest coin stream a
   farming session produces. `coins` is APPENDED after every field a sold row already carried, so
   the bytes ahead of it are byte-identical to the frozen goldens; `for free.` writes the
   present-and-empty `{}` that `purchase.price` has used for the free merchant form since JOS-144.
   The divergence is declared in `tests/bench/rustParity.mts`'s intended list beside JOS-521/527/535.

   `skillUp` needed no parser change — it has been parsed since JOS-119 with `{skill, value?}`
   (3,464 fixture lines, every one carrying its value) and simply had no consumer.

   THE DEATH RECAP IS FOLDED IN A MODULE, NOT QUERIED OFF THE COMBAT ENGINE. The engine's timeline
   ring files a hit by SOURCE, so its incoming rows carry no target, and law 8's tripwire says every
   damage total stays byte-identical across a change. `deaths` keeps its own 60 s / 500-entry ring of
   incoming instants, aged off the LOG's clock (never a wall clock), and quotes the last 15 s on a
   `playerDeath`. Nothing under `fold/src/combat/` was touched, and every combat total is unchanged.

   THE ENGINE FACTORING RATCHET CANNOT ABSORB A NEW EVENT KIND. A kind costs four lines and two
   match arms in `eqlog/src/event.rs`, so `Kind::as_str`, `Kind::parse`, `Key::as_str`, `Key::parse`
   and that file's line count all grow by construction; `Parser::classify` grows one point per
   classifier added, and `WIRING_ORDER` one line per module. `engine/factoring-baseline.json` only
   ever shrinks, so nine entries need an integrator's hand-widening — see the report for the exact
   old → new values. This is a property of the register, not of this change.

Numbers after steps 3 to 5 (`2026-09-07-z5-warm.json`): warm start 1.18 s to live. The early
spell-DB parse only overlaps the app's handshake, so an attach that arrives within ~0.45 s of the
spawn still waits for it; a binary form of the DB would take that off entirely and is the next
thing on this list.
