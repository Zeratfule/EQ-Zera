//! THE DAMAGE AND MISS LANES OF THE COMBAT FOLD, AND THE PHASE TIMERS ON THEM (Z Engine).
//!
//! Lifted out of `ingest.rs` unchanged in behaviour so the two hottest event kinds of a real log
//! (damage 650k and miss 374k of 1.72M events on the 2026-09-06 baseline) can be timed by phase.
//! `prof` is the timer: a no-op unless the `profile` feature is on, which the parity tool's
//! stage report turns on to print the split. Nothing in it reaches the fold's OUTPUT - the oracle
//! stays the oracle with the feature on or off.

use super::*;

/// Phase timers for the profile arm. Every function is a no-op without `--features profile`.
pub mod prof {
    pub const NAMES: [&str; 15] = [
        "damage.closure",
        "damage.prepare",
        "damage.origin",
        "damage.route",
        "damage.analytics",
        "miss",
        "route.classify",
        "route.ensure",
        "out.source",
        "out.resolve",
        "out.agg",
        "out.engage",
        "out.timeline",
        "out.log",
        "inc",
    ];
    pub const CLOSURE: usize = 0;
    pub const PREPARE: usize = 1;
    pub const ORIGIN: usize = 2;
    pub const ROUTE: usize = 3;
    pub const ANALYTICS: usize = 4;
    pub const MISS: usize = 5;
    pub const R_CLASSIFY: usize = 6;
    pub const R_ENSURE: usize = 7;
    pub const OUT_SOURCE: usize = 8;
    pub const OUT_RESOLVE: usize = 9;
    pub const OUT_AGG: usize = 10;
    pub const OUT_ENGAGE: usize = 11;
    pub const OUT_TIMELINE: usize = 12;
    pub const OUT_LOG: usize = 13;
    pub const INC: usize = 14;

    #[cfg(feature = "profile")]
    static NS: [std::sync::atomic::AtomicU64; 15] = [
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
        std::sync::atomic::AtomicU64::new(0),
    ];

    /// An open phase: dropping it books the elapsed time to its slot.
    pub struct Span {
        #[cfg(feature = "profile")]
        slot: usize,
        #[cfg(feature = "profile")]
        at: std::time::Instant,
    }

    #[cfg(feature = "profile")]
    pub fn span(slot: usize) -> Span {
        Span {
            slot,
            at: std::time::Instant::now(),
        }
    }

    #[cfg(not(feature = "profile"))]
    pub fn span(_slot: usize) -> Span {
        Span {}
    }

    impl Drop for Span {
        fn drop(&mut self) {
            #[cfg(feature = "profile")]
            NS[self.slot].fetch_add(
                self.at.elapsed().as_nanos() as u64,
                std::sync::atomic::Ordering::Relaxed,
            );
        }
    }

    /// Every phase and its booked nanoseconds, in `NAMES` order. All zero without the feature.
    pub fn report() -> Vec<(&'static str, u64)> {
        #[cfg(feature = "profile")]
        {
            NAMES
                .iter()
                .enumerate()
                .map(|(i, n)| (*n, NS[i].load(std::sync::atomic::Ordering::Relaxed)))
                .collect()
        }
        #[cfg(not(feature = "profile"))]
        {
            NAMES.iter().map(|n| (*n, 0)).collect()
        }
    }
}

/// One canonical `damage` line: close any pending encounter at this ts BEFORE routing, so attributed
/// damage after a closure starts a fresh encounter rather than reviving the old one.
pub(super) fn ingest_damage(st: &mut EngineState, ev: &Event) {
    // Caster-less other-player DoTs (`attacker: null`) are not our fight, and the raw line is what
    // the ring keeps: there is nothing else to say about a line nobody owns.
    let Some(attacker) = ev.str(Key::Attacker) else {
        st.log(ev.ts(), "other", "dropped", ev.raw().to_owned());
        return;
    };
    let closure = prof::span(prof::CLOSURE);
    eval_closure(st, ev.ts());
    drop(closure);
    let prepare = prof::span(prof::PREPARE);
    // Built here rather than inside `to_damage_event` so the record can borrow it.
    let modifiers = ev.arr_str(Key::Modifiers);
    let dmg = to_damage_event(st, ev, attacker, &modifiers);
    // The origin verdict names the LANE, so it is reached before `route()` folds the hit — and
    // exactly once, because it CONSUMES the cast claim. Asking twice would take two claims off one
    // cast line and count the second landing as a proc.
    drop(prepare);
    let origin = {
        let _s = prof::span(prof::ORIGIN);
        damage_origin(st, &dmg)
    };
    // The lane a cast-less firing lands in — a fresh record, never a mutation of the one the ledger
    // gets, because `spell_procs` is keyed by the SPELL and its row must stay one lane however many
    // meter rows the spell occupies. The clone copies pointers: every field but `skill` is borrowed.
    let laned = match origin {
        None => None,
        Some(o) => Some(DamageEvent {
            skill: Cow::Owned(lane_name_for(&dmg.skill, o)),
            ..dmg.clone()
        }),
    };
    // Read the active-time clock either side of `route()`: the DIFFERENCE is the capped-gap delta
    // this hit accrued, and a fresh encounter contributes 0 exactly as the routing path does. Only
    // the `before` reading is owned, because `route()` takes the whole state mutably and may replace
    // the encounter under it.
    let route = prof::span(prof::ROUTE);
    let enc_before = st.current.as_ref().map(|e| e.id.clone());
    let active_before = st.current.as_ref().map_or(0, |e| e.active_ms);
    let Some(at) = routing::route(st, laned.as_ref().unwrap_or(&dmg)) else {
        return;
    };
    drop(route);
    let same_encounter = st.current.as_ref().map(|e| e.id.as_str()) == enc_before.as_deref();
    let delta = if same_encounter {
        st.current.as_ref().map_or(0, |e| e.active_ms) - active_before
    } else {
        0
    };
    let _analytics = prof::span(prof::ANALYTICS);
    fold_damage_analytics(st, &dmg, delta, &at, origin);
}

/// A miss line: the avoidance ledger, and your own avoided swing as a proc attempt.
pub(super) fn ingest_miss(st: &mut EngineState, ev: &Event) -> bool {
    let _span = prof::span(prof::MISS);
    let Some(mtype) = ev.str(Key::Mtype).and_then(MissType::parse) else {
        return true;
    };
    let attacker = ev.str(Key::Attacker).unwrap_or_default().to_string();
    routing::route_miss(
        st,
        &MissLine {
            ts: ev.ts(),
            attacker: attacker.clone(),
            target: ev.str(Key::Target).unwrap_or_default().to_string(),
            mtype,
            verb: ev.str(Key::Verb).map(str::to_string),
            // A miss line names no skill, so the round lane's floor is the parser's own
            // `melee_skill(verb)` answer, asked through the parser's port so the two ends
            // cannot answer differently.
            verb_skill: ev
                .str(Key::Verb)
                .map(|v| eqlog::parse::combat::melee_skill(v).to_string()),
            modifiers: ev
                .arr_str(Key::Modifiers)
                .iter()
                .map(|s| s.to_string())
                .collect(),
        },
    );
    // Your avoided swing is still an ATTEMPT, and the mechanical proc denominator is
    // attempts — a proc that cannot fire on a miss still had the chance to.
    if id_key_ref(&attacker) == "you" {
        fold_both(st, ev.ts(), |agg, active| {
            agg.windows.fold(
                &WindowFold {
                    ts: ev.ts(),
                    swings: 1,
                    ..WindowFold::default()
                },
                active,
            );
            agg.procs.add_swing(active);
        });
    }
    true
}
