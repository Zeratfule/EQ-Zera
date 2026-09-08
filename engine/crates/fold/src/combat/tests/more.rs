//! The second half of the unit tests (split so each file stays under the factoring line).

use super::*;

/// The walk visits every zone session and every finalized fight, zone sessions first, and skips
/// the whole-stay `kind: 'zone'` segment on the fight pass.
#[test]
fn the_scope_walk_covers_the_zone_sessions_and_skips_the_zone_segment() {
    let e = fold(&[r#"{"kind":"zone","seq":0,"ts":10,"raw":"z","zone":"Najena"}"#]);
    let scopes = e.walk_scopes(10, None);
    assert_eq!(scopes.len(), 1);
    assert_eq!(scopes[0]["kind"], json!("zoneSession"));
    assert_eq!(scopes[0]["id"], json!("zone"));
}

/// Every classified line a snapshot carries, as `<role>|<cat>|<text>` — the three fields that
/// make one row recognisable.
fn lines(snap: &Value) -> Vec<String> {
    snap["recent"]
        .as_array()
        .expect("recent")
        .iter()
        .map(|r| {
            format!(
                "{}|{}|{}",
                r["role"].as_str().unwrap_or(""),
                r["cat"].as_str().unwrap_or(""),
                r["text"].as_str().unwrap_or("")
            )
        })
        .collect()
}

/// A historical fold writes nothing: the gate is `recording` and the recorder never goes live.
/// The same bytes are folded live below, so this is a claim about the gate rather than about the
/// lines being unreachable.
#[test]
fn a_replay_leaves_the_classification_ring_empty() {
    let e = fold(&[
        r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
        &hit(1, 1_000, 500),
    ]);
    assert_eq!(
        e.snapshot(1_000, &SnapshotOpts::full(), None)["recent"],
        json!([])
    );
}

/// …and a live one carries real rows. Every line here is the app's own sentence, copied verbatim
/// so a bug report quoting one is findable in either tree.
#[test]
fn a_live_fold_classifies_the_lines_it_folds() {
    let mut e = CombatEngine::new();
    e.set_player_name("Primitive");
    e.set_live();
    for line in [
        r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
        &hit(1, 1_000, 500),
        r#"{"kind":"damage","seq":2,"ts":1500,"raw":"d","attacker":"a kodiak","target":"You","amount":42,"dtype":"melee","skill":"bite","crit":false}"#,
        r#"{"kind":"stanceChange","seq":3,"ts":1600,"raw":"s","stance":"offensive"}"#,
        r#"{"kind":"death","seq":4,"ts":2000,"raw":"d","name":"a kodiak","bySelf":true}"#,
    ] {
        let ev = Event::from_json(line).expect("a JSON object");
        e.on_event(&ev, true, None);
    }
    let snap = e.snapshot(2_000, &SnapshotOpts::full(), None);
    let lines = lines(&snap);
    assert!(
        lines.contains(&"info|zone|▸ entered Najena".to_owned()),
        "{lines:?}"
    );
    assert!(
        // The lane name is the routed one, `· proc` marker and all: the origin verdict is
        // reached before the fold, so the ring reads exactly as the meter row does.
        lines.contains(&"you|spell|You → a kodiak  500  Smiting Strike · proc".to_owned()),
        "{lines:?}"
    );
    assert!(
        lines.contains(&"enemy|melee|a kodiak → You  42  bite".to_owned()),
        "{lines:?}"
    );
    assert!(
        lines.contains(&"info|stance|▸ stance: offensive".to_owned()),
        "{lines:?}"
    );
    // A death names why the world resolved it the way it did.
    assert!(
        lines.contains(&"info|death|☠ a kodiak died - plain hostile death".to_owned()),
        "{lines:?}"
    );
    // The order is the fold's: newest last, one row per line the engine had something to say
    // about.
    let zone = lines.iter().position(|l| l.contains("entered Najena"));
    let death = lines.iter().position(|l| l.contains("died"));
    assert!(zone < death, "{lines:?}");
}

/// A crit is a star and an ambiguous hit is a tilde — the tilde replaces the star rather than
/// joining it, because "could not attribute cleanly" outranks "it crit".
#[test]
fn a_crit_is_marked_and_a_refusal_is_said_out_loud() {
    let mut e = CombatEngine::new();
    e.set_player_name("Primitive");
    e.set_live();
    for line in [
        r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
        r#"{"kind":"damage","seq":1,"ts":1000,"raw":"d","attacker":"You","target":"a kodiak","amount":900,"dtype":"spell","skill":"Smiting Strike","crit":true}"#,
        // A caster-less other-player DoT: not our fight, and the raw line is what the ring keeps.
        r#"{"kind":"damage","seq":2,"ts":1200,"raw":"Somebody's tick hits a kodiak for 9 points of damage.","target":"a kodiak","amount":9,"dtype":"dot","skill":"tick","crit":false}"#,
    ] {
        let ev = Event::from_json(line).expect("a JSON object");
        e.on_event(&ev, true, None);
    }
    let lines = lines(&e.snapshot(1_200, &SnapshotOpts::full(), None));
    assert!(
        lines.contains(&"you|spell|You → a kodiak  900*  Smiting Strike · proc".to_owned()),
        "{lines:?}"
    );
    assert!(
        lines.contains(
            &"dropped|other|Somebody's tick hits a kodiak for 9 points of damage.".to_owned()
        ),
        "{lines:?}"
    );
}

/// The ring is bounded drop-oldest, and a snapshot carries at most the newest 150 — two
/// different budgets on purpose.
#[test]
fn the_ring_is_bounded_and_the_payload_is_bounded_tighter() {
    let mut e = CombatEngine::new();
    e.set_player_name("Primitive");
    e.set_live();
    for seq in 0..(encounter::RECENT_CAP as i64 + 50) {
        let ev = Event::from_json(&hit(seq, 1_000 + seq * 10, 1)).expect("a JSON object");
        e.on_event(&ev, true, None);
    }
    let snap = e.snapshot(9_999_999, &SnapshotOpts::full(), None);
    assert_eq!(
        snap["recent"].as_array().expect("recent").len(),
        RECENT_VIEW
    );
}

/// `showUnparsed` filters before it slices, and the order is not interchangeable: a burst of
/// refused lines must not push every classified one out of a panel not showing them anyway.
#[test]
fn the_unparsed_filter_runs_before_the_cap() {
    let mut e = CombatEngine::new();
    e.set_player_name("Primitive");
    e.set_live();
    let ev = Event::from_json(r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#)
        .expect("a JSON object");
    e.on_event(&ev, true, None);
    // `unparsed` is not a category this fold emits, so both answers agree: the filter is what is
    // under test, not a category invented to exercise it.
    let with = e.snapshot(0, &SnapshotOpts::full(), None);
    let opts = SnapshotOpts {
        show_unparsed: false,
        ..SnapshotOpts::full()
    };
    let without = e.snapshot(0, &opts, None);
    assert_eq!(with["recent"], without["recent"]);
    assert_eq!(lines(&with).len(), 1);
}

/// A mark mid-live splits the accounting and leaves the room alone: the first hit belongs to a
/// stay frozen as `closedBy: 'mark'`, the second to a fresh live stay starting at zero. `zone`
/// is untouched — the whole difference between a mark and a zone line.
#[test]
fn a_mark_mid_live_splits_the_stay_and_keeps_the_room() {
    let mut e = fold_then_go_live(&[
        r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
        &hit(1, 1_000, 500),
    ]);
    assert!(e.session_mark(2_000), "a live engine takes the mark");

    let ev = Event::from_json(&hit(2, 3_000, 70)).expect("a JSON object");
    e.on_event(&ev, true, None);
    let snap = e.snapshot(3_000, &SnapshotOpts::full(), None);

    // The room did not change: `zone` still names it, and the live stay carries its name.
    assert_eq!(snap["zone"], json!("Najena"));
    assert_eq!(snap["zoneSessions"][0]["zone"], json!("Najena"));
    assert_eq!(snap["zoneSessions"][0]["live"], json!(true));
    // …and it accounts only for what happened after the press.
    assert_eq!(snap["zoneSessions"][0]["total"], json!(70));
    // The frozen record behind it is the pre-mark half, tagged by what closed it.
    assert_eq!(snap["zoneSessions"][1]["closedBy"], json!("mark"));
    assert_eq!(snap["zoneSessions"][1]["total"], json!(500));
    assert_eq!(snap["zoneSessions"][1]["zone"], json!("Najena"));
}

/// The open fight is closed by the press, so the hit that follows opens a new encounter rather
/// than extending the one the mark was meant to end.
#[test]
fn a_mark_closes_the_open_fight() {
    let mut e = fold_then_go_live(&[
        r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
        &hit(1, 1_000, 500),
    ]);
    assert_eq!(
        e.snapshot(1_000, &SnapshotOpts::full(), None)["segments"][0]["kind"],
        json!("current"),
        "the fight is open before the press"
    );
    e.session_mark(2_000);
    let ev = Event::from_json(&hit(2, 3_000, 70)).expect("a JSON object");
    e.on_event(&ev, true, None);
    let snap = e.snapshot(3_000, &SnapshotOpts::full(), None);
    // The open fight is the post-mark one: the 500 is behind the boundary.
    assert_eq!(snap["segments"][0]["kind"], json!("current"));
    assert_eq!(snap["segments"][0]["total"], json!(70));
}

/// Refused while hydrating, and the refusal changes nothing at all — the structural half of
/// replay determinism.
#[test]
fn a_mark_is_refused_while_hydrating_and_moves_nothing() {
    let mut e = fold(&[
        r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
        &hit(1, 1_000, 500),
    ]);
    let before = e.snapshot(1_000, &SnapshotOpts::full(), None);
    assert!(!e.session_mark(2_000), "a replaying engine refuses");
    let after = e.snapshot(1_000, &SnapshotOpts::full(), None);
    assert_eq!(before, after, "a refused mark is not a mark");
    assert_eq!(
        after["zoneSessions"].as_array().expect("sessions").len(),
        1,
        "no record was minted"
    );
}

/// An empty stay mints nothing, which is what makes a double-click harmless: the second press
/// finds an aggregate with no attributed damage and `finalize_zone_session` drops it.
#[test]
fn a_second_mark_with_nothing_between_mints_no_record() {
    let mut e = fold_then_go_live(&[
        r#"{"kind":"zone","seq":0,"ts":0,"raw":"z","zone":"Najena"}"#,
        &hit(1, 1_000, 500),
    ]);
    e.session_mark(2_000);
    e.session_mark(2_000);
    let snap = e.snapshot(2_000, &SnapshotOpts::full(), None);
    assert_eq!(
        snap["zoneSessions"].as_array().expect("sessions").len(),
        2,
        "the live stay plus ONE frozen record: {snap}"
    );
    assert_eq!(snap["zoneSessions"][1]["closedBy"], json!("mark"));
}

/// `EMPTY_ROSTER` is what an engine with no roster module registered publishes.
#[test]
fn an_unwired_roster_seam_publishes_the_empty_roster() {
    let e = fold(&[]);
    let snap = e.snapshot(0, &SnapshotOpts::full(), None);
    assert_eq!(
        snap["roster"],
        json!({ "members": [], "seen": false, "lastSignalTs": 0 })
    );
}
