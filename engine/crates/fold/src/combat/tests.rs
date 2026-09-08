//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::*;

fn fold(lines: &[&str]) -> CombatEngine {
    let mut e = CombatEngine::new();
    e.set_player_name("Primitive");
    for line in lines {
        let ev = Event::from_json(line).expect("a JSON object");
        e.on_event(&ev, false, None);
    }
    e
}

/// The same fold, then the handover the tail makes.
fn fold_then_go_live(lines: &[&str]) -> CombatEngine {
    let mut e = fold(lines);
    e.set_live();
    e
}

/// One outgoing hit, as the parser emits it.
fn hit(seq: i64, ts: i64, amount: i64) -> String {
    format!(
        r#"{{"kind":"damage","seq":{seq},"ts":{ts},"raw":"d","attacker":"You","target":"a kodiak","amount":{amount},"dtype":"spell","skill":"Smiting Strike","crit":false}}"#
    )
}

/// A historical fold never leaves hydration, and the whole snapshot-time sweep block hangs off
/// that one flag.
#[test]
fn a_historical_fold_stays_hydrating_and_records_no_lines() {
    let e = fold(&[r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Innothule Swamp"}"#]);
    let snap = e.snapshot(10, &SnapshotOpts::full(), None);
    assert_eq!(snap["hydrating"], json!(true));
    assert_eq!(snap["recent"], json!([]));
}

/// …and the handover is the only thing that changes it. Nothing else writes the flag except a
/// live event, the belt-and-braces half of the same handover.
#[test]
fn hydrating_is_true_until_the_handover_and_false_after_it() {
    let lines = [r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Najena"}"#];
    let mut e = fold(&lines);
    assert!(
        e.hydrating(),
        "a fold that has not handed over is replaying"
    );
    assert_eq!(
        e.snapshot(10, &SnapshotOpts::full(), None)["hydrating"],
        json!(true)
    );

    e.set_live();
    assert!(!e.hydrating());
    assert_eq!(
        e.snapshot(10, &SnapshotOpts::full(), None)["hydrating"],
        json!(false)
    );

    // …and the fallback path, with no `set_live()` at all: one event the tail delivered says
    // the same thing, before the rest of that event is folded.
    let mut e = fold(&lines);
    let ev = Event::from_json(&hit(1, 1_000, 10)).expect("a JSON object");
    e.on_event(&ev, true, None);
    assert!(!e.hydrating(), "a live event is a live world");
}

/// A live fight closes on elapsed time at the snapshot — the death-linger arm of `eval_closure`,
/// reached by a poll rather than by a line.
#[test]
fn a_live_snapshot_closes_a_fight_the_log_stopped_talking_about() {
    let e = fold_then_go_live(&[
        r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
        &hit(1, 1_000, 500),
    ]);
    let now = 1_000 + encounter::PRESENCE_GONE_MS;

    let snap = e.snapshot(now, &SnapshotOpts::full(), None);
    assert_eq!(
        snap["segments"][0]["kind"],
        json!("fight"),
        "the open fight was finalized by the poll: {snap}"
    );
    assert_eq!(snap["inCombat"], json!(false));
    // Finalized at the fight's own clock, never at `now`: the closure is deferred, the fight is
    // not. This one is still the one-second floor its single hit earns.
    assert_eq!(snap["segments"][0]["startTs"], json!(1_000));
    assert_eq!(snap["segments"][0]["durationSec"], json!(1.0));
    assert_eq!(snap["segments"][0]["active"], json!(false));
    assert_eq!(snap["segments"][0]["total"], json!(500));
    assert!(
        snap.get("currentTarget").is_none(),
        "a fight that just closed reports no target"
    );
}

/// …and a mid-fold snapshot never does any of that. Same two lines, same instant, a `now` far
/// past every deadline: the fight stays open and the next hit lands in it. A replay whose fight
/// had been finalized by a poll would hand the rest of it to a fresh encounter.
#[test]
fn a_mid_fold_snapshot_sweeps_nothing_and_cannot_split_a_fight() {
    let mut e = fold(&[
        r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
        &hit(1, 1_000, 43_504),
    ]);
    // The host clock, weeks past every timestamp in the log.
    let snap = e.snapshot(1_800_000_000_000, &SnapshotOpts::full(), None);
    assert_eq!(snap["segments"][0]["kind"], json!("current"));

    let ev = Event::from_json(&hit(2, 2_000, 10_073)).expect("a JSON object");
    e.on_event(&ev, false, None);
    let after = e.snapshot(2_000, &SnapshotOpts::full(), None);
    assert_eq!(
        after["segments"][0]["total"],
        json!(53_577),
        "the poll split the fight: {after}"
    );
    assert_eq!(
        after["segments"]
            .as_array()
            .expect("segments")
            .iter()
            .filter(|s| s["kind"] != json!("zone"))
            .count(),
        1,
        "one fight, not two"
    );
}

/// An uncorroborated charm bind expires at the snapshot: the deadline belongs to whichever
/// reader reaches it first, and between two log lines that reader is the poll.
#[test]
fn a_live_snapshot_sweeps_a_charm_bind_whose_window_closed() {
    let lines = [
        r#"{"kind":"castBegin","seq":0,"ts":0,"raw":"c","spell":"Charm"}"#,
        r#"{"kind":"charm","seq":1,"ts":1000,"raw":"c","mob":"a rock golem"}"#,
    ];
    let horizon = 1_000 + crate::combat::spellfacts::provisional_window_ms("Charm");

    let e = fold_then_go_live(&lines);
    assert!(
        e.st.borrow().pet_names.contains("a rock golem"),
        "the broadcast resolved our own cast, so it bound"
    );
    e.snapshot(horizon - 1, &SnapshotOpts::full(), None);
    assert!(
        e.st.borrow().pet_names.contains("a rock golem"),
        "one ms early is early"
    );
    e.snapshot(horizon, &SnapshotOpts::full(), None);
    assert!(
        !e.st.borrow().pet_names.contains("a rock golem"),
        "the corroboration window closed and the bind is gone"
    );

    // …and the replay is untouched however late the poll.
    let e = fold(&lines);
    e.snapshot(horizon + 1_000_000, &SnapshotOpts::full(), None);
    assert!(e.st.borrow().pet_names.contains("a rock golem"));
}

/// The pet nudge is live-only, and this pins the gate rather than the model: the same two lines
/// arm nothing while replaying and raise a nudge once the tail is running.
#[test]
fn the_pet_nudge_arms_only_once_the_tail_is_running() {
    let summon =
        r#"{"kind":"castBegin","seq":0,"ts":1000,"raw":"c","spell":"Kintaz's Animation"}"#;

    let mut e = fold(&[]);
    e.set_live();
    let ev = Event::from_json(summon).expect("a JSON object");
    e.on_event(&ev, false, None);
    let shown = 1_000 + petnudge::NUDGE_GRACE_MS;
    assert_eq!(
        e.snapshot(shown, &SnapshotOpts::full(), None)["petNudge"],
        json!({ "summonedTs": 1_000, "expiresTs": 1_000 + petnudge::NUDGE_GRACE_MS + petnudge::NUDGE_SHOW_MS })
    );
    // Absent, never null, in every state but the one — inside the grace, and past the timeout.
    assert!(e
        .snapshot(1_000, &SnapshotOpts::full(), None)
        .get("petNudge")
        .is_none());
    let gone = 1_000 + petnudge::NUDGE_GRACE_MS + petnudge::NUDGE_SHOW_MS;
    assert!(e
        .snapshot(gone, &SnapshotOpts::full(), None)
        .get("petNudge")
        .is_none());

    // A historical fold arms nothing: the arm is gated on `!hydrating` at the cast.
    let e = fold(&[summon]);
    assert!(e
        .snapshot(shown, &SnapshotOpts::full(), None)
        .get("petNudge")
        .is_none());
}

/// `zone` is absent — never null — until the first `You have entered X.` line, because a session
/// that starts mid-zone genuinely cannot say where it is.
#[test]
fn the_zone_is_absent_until_a_zone_line_names_one() {
    let e = fold(&[r#"{"kind":"unknown","seq":0,"ts":1,"raw":"x"}"#]);
    let snap = e.snapshot(1, &SnapshotOpts::full(), None);
    assert!(snap.get("zone").is_none(), "{snap}");
    assert_eq!(snap["zoneSessions"][0]["zone"], json!("Session"));

    let e = fold(&[r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Najena"}"#]);
    let snap = e.snapshot(10, &SnapshotOpts::full(), None);
    assert_eq!(snap["zone"], json!("Najena"));
    assert_eq!(snap["segments"][0]["name"], json!("Najena - overall"));
}

/// Re-asserting the stance you are already in moves nothing: `stanceTs` is the ts of the last
/// change, not of the last line that mentioned one.
#[test]
fn re_asserting_the_same_stance_does_not_move_its_timestamp() {
    let e = fold(&[
        r#"{"kind":"stanceChange","seq":0,"ts":1000,"raw":"s","stance":"offensive"}"#,
        r#"{"kind":"stanceChange","seq":1,"ts":2000,"raw":"s","stance":"offensive"}"#,
        r#"{"kind":"invocationChange","seq":2,"ts":3000,"raw":"i","invocation":"inversion"}"#,
        r#"{"kind":"stanceChange","seq":3,"ts":4000,"raw":"s","stance":"defensive"}"#,
    ]);
    let snap = e.snapshot(4000, &SnapshotOpts::full(), None);
    assert_eq!(
        snap["stance"],
        json!({
            "stance": "defensive", "stanceTs": 4000,
            "invocation": "inversion", "invocationTs": 3000
        })
    );
}

/// The stance pair is session-scoped: it survives a zone line, because a stance is not tied to a
/// room. Only `reset()` clears it.
#[test]
fn the_standing_choices_survive_a_zone_line() {
    let e = fold(&[
        r#"{"kind":"stanceChange","seq":0,"ts":1000,"raw":"s","stance":"offensive"}"#,
        r#"{"kind":"zone","seq":1,"ts":2000,"raw":"z","zone":"The Plane of Sky"}"#,
    ]);
    let snap = e.snapshot(2000, &SnapshotOpts::full(), None);
    assert_eq!(snap["stance"]["stance"], json!("offensive"));
    assert_eq!(snap["stance"]["stanceTs"], json!(1000));
}

/// The live stay's floor: a stay with no finalized encounter behind it spans one second, not
/// zero — `Math.max(1, …)` is the definition, not a guard.
#[test]
fn an_unstarted_stay_reports_a_one_second_span() {
    let e = fold(&[r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Najena"}"#]);
    let snap = e.snapshot(10, &SnapshotOpts::full(), None);
    assert_eq!(snap["segments"][0]["durationSec"], json!(1.0));
    assert_eq!(snap["segments"][0]["dps"], json!(0.0));
    assert_eq!(snap["zoneSessions"].as_array().expect("live").len(), 1);
    assert_eq!(snap["zoneSessions"][0]["live"], json!(true));
    // Absent on the live entry, which has not ended at all.
    assert!(snap["zoneSessions"][0].get("closedBy").is_none());
}

/// With no landed sample every statistic is absent rather than 0.
#[test]
fn a_slow_rollup_with_no_samples_states_no_statistics() {
    let e = fold(&[]);
    let snap = e.snapshot(0, &SnapshotOpts::full(), None);
    assert_eq!(
        snap["poison"]["slow"],
        json!({ "pulls": 0, "landed": 0, "noLand": 0, "window": 25 })
    );
}

mod more;
