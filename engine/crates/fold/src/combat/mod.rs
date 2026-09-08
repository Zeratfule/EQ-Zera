//! The combat engine — the Rust port of `src/main/combat/`, a state machine over the log stream.
//! One file here per TypeScript module there, a submodule of `fold` because it is driven by
//! `Fold::on_primary` and pulls the roster back through `EqModule::as_roster`.
//!
//! No wall clock, ever. `snapshot(now, …)` takes `now` as a parameter and the recorder passes the
//! slice's last event ts; the hydrating gate, deferred encounter closure, the charm sweep and the
//! ally-bind expiry all evaluate against it, so a fold that read the host clock would answer a
//! different question every day it ran.
//!
//! A live snapshot ages the model — the four sweeps — so it is a mutating read. Determinism comes
//! from the gate, not from purity: while `hydrating` the sweep block is not entered at all, so a
//! mid-fold answer touches nothing and re-asking it at the same `seq` gives the same object.
//!
//! Three models are live-only and so publish nothing in a historical fold: the pet nudge (armed only
//! when `!hydrating`), the classification ring (written only `if recording`) and the session mark
//! (refused while hydrating).

pub mod aggregate;
pub mod ally;
pub mod charm;
mod checkpoint;
pub mod collate;
pub mod encounter;
pub mod healing;
pub mod ingest;
pub mod lifecycle;
pub mod others;
pub mod petnudge;
pub mod poisons;
pub mod procbuffs;
pub mod procdetect;
pub mod procrouting;
pub mod procviews;
pub mod procwindows;
pub mod roster;
pub mod rounds;
pub mod routing;
pub mod spellfacts;
pub mod state;
pub mod statetimeline;
pub mod timeline;
pub mod views;
pub mod world;

pub use encounter::ZoneSessionClose;
pub use roster::{RosterMember, RosterSnap, RosterSource};

use crate::event::Event;
use encounter::{ACTIVE_MS, SLOW_SAMPLE_CAP};
use serde::Serialize;
use serde_json::{json, Value};
use state::EngineState;
use std::cell::RefCell;

/// How many classified lines one snapshot carries — the newest 150.
///
/// Half the ring's own bound: what the engine remembers and what a payload costs are different
/// budgets, which is what lets `showUnparsed` be a client-side question with a real answer either way.
const RECENT_VIEW: usize = 150;

/// `shared/combat.ts SnapshotOpts`.
#[derive(Debug, Clone, Default)]
pub struct SnapshotOpts {
    pub selected_id: Option<String>,
    /// Include lines the engine could not classify (damage-shaped but unmatched). Reads the
    /// classification ring, which a historical fold never writes.
    pub show_unparsed: bool,
    /// Cap on how many finalized-fight summaries to serialize, newest-first. The current encounter
    /// and the zone summary are always included, and a selected fight outside the cap is still
    /// resolvable through `selected` — the cap is a payload bound, never a retention one.
    pub max_segments: usize,
    /// Include the selected encounter's event timeline. Off by default: heavier than the bar view,
    /// so it is fetched only in Timeline mode.
    pub timeline: bool,
}

impl SnapshotOpts {
    /// The recorder's full-fat options.
    pub fn full() -> Self {
        SnapshotOpts {
            selected_id: None,
            show_unparsed: true,
            max_segments: 100_000,
            timeline: true,
        }
    }

    /// The per-scope walk's options — one segment, one resolved selection, no timeline.
    pub fn scope(id: &str) -> Self {
        SnapshotOpts {
            selected_id: Some(id.to_string()),
            show_unparsed: false,
            max_segments: 1,
            timeline: false,
        }
    }
}

/// The rolling time-to-slow rollup. Statistics are computed over the landed samples only and the
/// nulls surface as `noLand`; with no landed samples every statistic is absent rather than 0.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SlowRollup {
    pulls: usize,
    landed: usize,
    no_land: usize,
    window: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    avg_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    median_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_ms: Option<i64>,
}

/// The live stance/invocation pair. Every field is absent rather than null when never observed this
/// session.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StanceState {
    #[serde(skip_serializing_if = "Option::is_none")]
    stance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stance_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    invocation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    invocation_ts: Option<i64>,
}

/// One engine owning one `EngineState`, plus snapshot assembly.
pub struct CombatEngine {
    /// `snapshot()` is a mutating read when live — it ages the model, and the deferred closure it
    /// evaluates finalizes the open fight, so the answer has to stick. The cell keeps that mutation
    /// off the reader seam (`EventSink::combat_snapshot` is `&self`, and turning it `&mut` reaches
    /// four signatures in three files). The borrow is taken and dropped inside one method:
    /// `snapshot()` and `fight_summaries()` are the only borrowers and neither calls the other.
    st: RefCell<EngineState>,
    /// Whose log this is, held so `reset()` can re-inject it the way every construction path does
    /// (`reset()` then `setPlayerName`).
    player_name: Option<String>,
}

impl Default for CombatEngine {
    fn default() -> Self {
        Self::new()
    }
}

impl CombatEngine {
    pub fn new() -> Self {
        CombatEngine {
            st: RefCell::new(EngineState::new()),
            player_name: None,
        }
    }

    /// Inject the player's own character name.
    pub fn set_player_name(&mut self, name: &str) {
        self.player_name = Some(name.to_string());
        self.st.get_mut().set_player_name(name);
    }

    pub fn reset(&mut self) {
        self.st.get_mut().reset();
        if let Some(name) = self.player_name.clone() {
            self.st.get_mut().set_player_name(&name);
        }
    }

    /// The scan has handed over to the tail — `engine.ts setLive()`, made at the end of the
    /// historical scan and before the tailer starts. From here on `hydrating` is false, so every
    /// snapshot runs the four sweeps at the instant it was asked for.
    ///
    /// A historical fold never calls it, which is what keeps the equivalence oracle whole: the
    /// sweeps are unreachable there rather than skipped by a flag somebody remembered to set.
    pub fn set_live(&mut self) {
        self.st.get_mut().set_live();
    }


    /// Is this engine still replaying? The flag the snapshot publishes, for a caller that needs it
    /// without serializing a whole meter.
    #[must_use]
    pub fn hydrating(&self) -> bool {
        self.st.borrow().hydrating
    }

    /// Fold one canonical event.
    ///
    /// `live` is the belt-and-braces half of going live: a live event is by definition one the tail
    /// delivered, so a world that folded one without being told is live anyway. It has to be cleared
    /// before the rest of the event folds — the pet-summon nudge is gated on `!hydrating`.
    ///
    /// The roster is refreshed first and once, which is exactly the per-decision live pull: the
    /// roster module is registered before the engine, so it has already advanced for this line, and
    /// nothing on this dispatch path can write it.
    pub fn on_event(&mut self, ev: &Event, live: bool, roster: Option<&dyn RosterSource>) {
        let st = self.st.get_mut();
        if live {
            st.set_live();
        }
        st.refresh_roster(roster);
        ingest::ingest_event(st, ev);
    }

    /// A session mark — "start a new session now" — `engine.ts sessionMark`.
    ///
    /// The move a zone line makes, minus the room change: close the open fight, freeze the running
    /// stay tagged `closedBy: 'mark'`, mint fresh accumulators. Everything else the zone case does
    /// is a statement about having LEFT, so `st.zone` keeps its value, `world.zone()` is never
    /// called, and the coats, stances, specials and state timeline run straight through.
    ///
    /// Refused while hydrating, which makes replay determinism structural: a mark is a user action,
    /// is stored nowhere, and cannot enter a replaying engine at all. Returns whether it was
    /// accepted; whether it minted a record is a different question, answered by the history.
    ///
    /// `ts` is the instant the caller stamped for the whole click, which is what makes the loot
    /// split and this split share one boundary. An empty stay mints nothing, so a double-click is
    /// harmless.
    pub fn session_mark(&mut self, ts: i64) -> bool {
        let st = self.st.get_mut();
        if st.hydrating {
            return false;
        }
        lifecycle::eval_closure(st, ts);
        lifecycle::finalize_current(st);
        st.finalize_zone_session(ZoneSessionClose::Mark);
        st.reset_zone_accumulators();
        true
    }

    /// The snapshot, at the instant it is asked for — the log's own while replaying, the wall clock
    /// once the tail is running, and the caller's to choose either way.
    ///
    /// The four sweeps run only when live. Encounters can close purely from elapsed time, an
    /// uncorroborated charm bind expires on the same clock, an ally bind cannot outlive its spell,
    /// and the pet nudge is a display timer; a snapshot may be the first observation past any of
    /// those deadlines, the other being every ingested event. A replay is not a moment in time, so
    /// `hydrating` is the whole gate — a poll landing between two replay slices would otherwise
    /// finalize the open fight and hand the rest of it to a fresh encounter. Closure from the log's
    /// own clock is untouched either way; `ingest_event` evaluates it per event.
    ///
    /// The order is not arbitrary: charm, ally, nudge, then closure. The charm sweep uncharms
    /// through the world model, which is evidence the closure test then reads.
    pub fn snapshot(
        &self,
        now: i64,
        opts: &SnapshotOpts,
        roster: Option<&dyn RosterSource>,
    ) -> Value {
        let mut guard = self.st.borrow_mut();
        if !guard.hydrating {
            let st = &mut *guard;
            st.sweep_charm(now);
            st.sweep_ally(now);
            st.pet_nudge.sweep(now);
            lifecycle::eval_closure(st, now);
        }
        // Read-only from here down, and the borrow is released with this function.
        let st: &EngineState = &guard;

        let mut segments = lifecycle::collect_segments(st, now, opts.max_segments);
        segments.push(lifecycle::zone_summary(st));

        // `inCombat` — the one thing `now` decides in a historical fold besides a summary's
        // `active` flag: whether the open fight's last damage is inside the freshness window.
        let in_combat = st
            .current
            .as_ref()
            .is_some_and(|e| now - e.last_ts < ACTIVE_MS);

        let selected_id = resolve_selected_id(st, opts);
        let selected = match views::build_selected(st, &selected_id, now) {
            Some(v) => serde_json::to_value(v).unwrap_or(Value::Null),
            // Null, not an empty shell: with no fights at all the selection resolves to nothing.
            None => Value::Null,
        };

        // The classification ring, empty for the whole of a historical fold. The filter runs before
        // the slice and the two are not interchangeable: a burst of refused lines must not push
        // every classified one out of a panel that was not showing them anyway.
        let kept: Vec<&state::ClassifiedLine> = st
            .recent
            .iter()
            .filter(|r| opts.show_unparsed || r.cat != "unparsed")
            .collect();
        let recent: Vec<Value> = kept[kept.len().saturating_sub(RECENT_VIEW)..]
            .iter()
            .map(|r| serde_json::to_value(r).unwrap_or(Value::Null))
            .collect();

        let mut out = json!({
            "selectedId": selected_id,
            "selected": selected,
            "segments": segments,
            "inCombat": in_combat,
            "recent": recent,
            "stance": stance_state(st),
            "poison": { "coat": coat_state(st), "slow": slow_rollup(st) },
            "zoneSessions": lifecycle::zone_session_summaries(st),
            "hydrating": st.hydrating,
            "roster": st.roster_snap(roster),
        });
        // Absent is not null: `zone` until the first `You have entered X.` line, `currentTarget`
        // while no fight is open or none has landed an outgoing hit. `JSON.stringify` drops both
        // over there and so must this.
        if let Some(zone) = &st.zone {
            out["zone"] = json!(zone);
        }
        if let Some(target) = current_target(st) {
            out["currentTarget"] = json!(target);
        }
        // `timeline` is absent when the caller did not ask, and present-and-null when it asked and
        // the selection carries no timeline. `JSON.stringify` drops the first and keeps the second.
        if opts.timeline {
            out["timeline"] = timeline::build_timeline(st, &selected_id, now)
                .and_then(|t| serde_json::to_value(t).ok())
                .unwrap_or(Value::Null);
        }
        // The pet nudge is absent in every state but the one. It reads the same `now` the sweep
        // above used, so a nudge can never survive the poll that expired it.
        if let Some(nudge) = st.pet_nudge.view(now) {
            out["petNudge"] = serde_json::to_value(nudge).unwrap_or(Value::Null);
        }
        out
    }

    /// The fight-search corpus — `engine.ts searchFights`. The open fight as `kind: "current"`, then
    /// every finalized encounter newest-first and uncapped.
    ///
    /// A separate door from `snapshot()` so a search pays for no selection, zone list, stance or
    /// roster, and so the whole-stay `kind: "zone"` row is not findable as a fight. Read-only:
    /// typing in a search box must never finalize a fight.
    pub fn fight_summaries(&self, now: i64) -> Vec<Value> {
        lifecycle::collect_segments(&self.st.borrow(), now, usize::MAX)
            .into_iter()
            .filter_map(|s| serde_json::to_value(s).ok())
            .collect()
    }

    /// The per-scope walk, as `goldenOracle.mts walkScopes` performs it: every zone session and every
    /// finalized fight resolved through the same `snapshot({selectedId})` door the UI uses, so a
    /// moved number cannot hide behind an internal field that did not move.
    ///
    /// Uncapped — a cap is a hole in an acceptance oracle. Zone sessions first, then fights with
    /// `kind == 'zone'` skipped, because array order is a claim the comparator checks.
    pub fn walk_scopes(&self, now: i64, roster: Option<&dyn RosterSource>) -> Vec<Value> {
        let base = self.snapshot(now, &SnapshotOpts::full(), roster);
        let mut out = Vec::new();
        for zs in base["zoneSessions"].as_array().into_iter().flatten() {
            let id = zs["id"].as_str().unwrap_or_default().to_string();
            let sel = self.snapshot(now, &SnapshotOpts::scope(&id), roster);
            out.push(json!({ "kind": "zoneSession", "id": id, "selected": sel["selected"] }));
        }
        for seg in base["segments"].as_array().into_iter().flatten() {
            if seg["kind"] == "zone" {
                continue;
            }
            let id = seg["id"].as_str().unwrap_or_default().to_string();
            let sel = self.snapshot(now, &SnapshotOpts::scope(&id), roster);
            out.push(json!({ "kind": "fight", "id": id, "selected": sel["selected"] }));
        }
        out
    }
}

/// Default selection = the fight scope's head row: the open fight, else the most recent finalized
/// one. It must never wander into the zone aggregate; overall is reached by asking for a
/// zone-session id (`zone` / `zs<n>`), never by default.
///
/// An explicit request is validated against all encounters, not just the capped segment window.
fn resolve_selected_id(st: &EngineState, opts: &SnapshotOpts) -> String {
    let default_id = st
        .current
        .as_ref()
        .map(|e| e.id.clone())
        .or_else(|| st.history.last().map(|e| e.id.clone()))
        .unwrap_or_default();
    let Some(want) = opts.selected_id.as_deref().filter(|s| !s.is_empty()) else {
        return default_id;
    };
    let selectable = want == "zone"
        || st.current.as_ref().is_some_and(|e| e.id == want)
        || st.history.iter().any(|h| h.id == want)
        || st.zone_history.iter().any(|z| z.id == want);
    if selectable {
        want.to_string()
    } else {
        default_id
    }
}

/// The mob in front of you (world-model law 6, live half). Absent when no encounter is open or the
/// open one has landed no outgoing hit — never a guess, and never the largest target, which is the
/// finalized naming rule and would relabel a live pull retroactively.
///
/// Read-only, and deliberately does not evaluate closure: the snapshot has already done so.
fn current_target(st: &EngineState) -> Option<Value> {
    let e = st.current.as_ref()?;
    let name = e.last_out_target.as_ref()?;
    Some(json!({
        "name": name,
        "others": e.agg.targets.len().saturating_sub(1),
        "lastTs": e.last_ts,
    }))
}

/// The live blade-coat pair, copied out so a consumer cannot mutate engine state. Every consumer
/// must render both slots: a rogue can run combat venoms with no utility poison on at all.
fn coat_state(st: &EngineState) -> Value {
    let mut out = json!({ "combat": st.coat_combat });
    if let Some(u) = &st.coat_utility {
        out["utility"] = json!(u);
    }
    out
}

fn stance_state(st: &EngineState) -> StanceState {
    StanceState {
        stance: st.stance.as_ref().map(|m| m.name.clone()),
        stance_ts: st.stance.as_ref().map(|m| m.ts),
        invocation: st.invocation.as_ref().map(|m| m.name.clone()),
        invocation_ts: st.invocation.as_ref().map(|m| m.ts),
    }
}

/// `engine.ts slowRollup`. The median of an even-length sample is the rounded mean of the two middle
/// values, and the mean is rounded too — `Math.round`, which differs from Rust only for negatives.
fn slow_rollup(st: &EngineState) -> SlowRollup {
    let mut landed: Vec<i64> = st.slow_samples.iter().flatten().copied().collect();
    landed.sort_unstable();
    let pulls = st.slow_samples.len();
    let mut out = SlowRollup {
        pulls,
        landed: landed.len(),
        no_land: pulls - landed.len(),
        window: SLOW_SAMPLE_CAP,
        avg_ms: None,
        median_ms: None,
        min_ms: None,
        max_ms: None,
    };
    if landed.is_empty() {
        return out;
    }
    let sum: i64 = landed.iter().sum();
    let mid = landed.len() >> 1;
    out.avg_ms = Some(js_round(sum as f64 / landed.len() as f64));
    out.median_ms = Some(if landed.len() % 2 == 1 {
        landed[mid]
    } else {
        js_round((landed[mid - 1] + landed[mid]) as f64 / 2.0)
    });
    out.min_ms = Some(landed[0]);
    out.max_ms = Some(landed[landed.len() - 1]);
    out
}

/// `Math.round` — round half UP, which is not `f64::round` (half away from zero). They differ only
/// for negatives; stated so a later reader does not "simplify" it.
fn js_round(v: f64) -> i64 {
    (v + 0.5).floor() as i64
}

#[cfg(test)]
mod tests;
