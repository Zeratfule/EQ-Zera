//! The character module's `/loc` position: live-only, filed under the zone held at the time,
//! dropped by any zone line or new session, and never carried by a checkpoint.

use fold::event::Event;
use fold::{registered, ClusterDeps, Fold};
use serde_json::{json, Value};

const ZONE: &str =
    r#"{"kind":"zone","seq":1,"ts":1000,"raw":"r","zone":"Nektropos Castle 2 (Adaptive)"}"#;
const OTHER: &str = r#"{"kind":"zone","seq":1,"ts":5000,"raw":"r","zone":"East Freeport"}"#;
const LOC: &str = r#"{"kind":"loc","seq":1,"ts":2000,"raw":"r","ns":218.95,"ew":91.12,"z":17.9}"#;
const LOC2: &str = r#"{"kind":"loc","seq":1,"ts":3000,"raw":"r","ns":-10.5,"ew":-20,"z":-3.25}"#;
const WELCOME: &str = r#"{"kind":"sessionStart","seq":1,"ts":4000,"raw":"r"}"#;

fn fold() -> Fold {
    Fold::new(registered(ClusterDeps::default()), i64::MAX)
}

fn feed(f: &mut Fold, line: &str, live: bool) {
    f.on_primary(&Event::from_json(line).expect("a JSON event"), live);
}

fn loc_of(f: &Fold) -> Value {
    f.registry.snapshot_of("character").expect("registered")["state"]["loc"].clone()
}

#[test]
fn a_live_loc_is_filed_under_the_zone_it_was_read_in() {
    let mut f = fold();
    feed(&mut f, ZONE, false);
    feed(&mut f, LOC, true);
    assert_eq!(
        loc_of(&f),
        json!({"ns":218.95,"ew":91.12,"z":17.9,"ts":2000,"zone":"Nektropos Castle 2 (Adaptive)"})
    );
}

#[test]
fn each_new_loc_replaces_the_last() {
    let mut f = fold();
    feed(&mut f, ZONE, true);
    feed(&mut f, LOC, true);
    feed(&mut f, LOC2, true);
    assert_eq!(loc_of(&f)["ns"], json!(-10.5));
    assert_eq!(loc_of(&f)["ts"], json!(3000));
}

#[test]
fn a_replayed_loc_places_nothing() {
    let mut f = fold();
    feed(&mut f, ZONE, false);
    feed(&mut f, LOC, false);
    assert_eq!(loc_of(&f), Value::Null);
}

#[test]
fn a_loc_before_any_zone_line_places_nothing() {
    let mut f = fold();
    feed(&mut f, LOC, true);
    assert_eq!(loc_of(&f), Value::Null);
}

fn loc_at(ts: i64) -> String {
    format!(r#"{{"kind":"loc","seq":1,"ts":{ts},"raw":"r","ns":1.5,"ew":2.5,"z":3}}"#)
}

fn freeport_at(ts: i64) -> String {
    format!(r#"{{"kind":"zone","seq":1,"ts":{ts},"raw":"r","zone":"East Freeport"}}"#)
}

#[test]
fn any_zone_line_or_new_session_drops_it() {
    let mut f = fold();
    feed(&mut f, ZONE, true);
    feed(&mut f, LOC, true);
    feed(&mut f, OTHER, true);
    assert_eq!(loc_of(&f), Value::Null);

    feed(&mut f, &loc_at(6000), true);
    assert_eq!(loc_of(&f)["zone"], json!("East Freeport"));
    feed(&mut f, &freeport_at(7000), true);
    assert_eq!(
        loc_of(&f),
        Value::Null,
        "re-entering the same zone is still a move"
    );

    feed(&mut f, &loc_at(8000), true);
    let welcome = WELCOME.replace("4000", "9000");
    feed(&mut f, &welcome, true);
    assert_eq!(loc_of(&f), Value::Null);
}

/// A truncated or replaced log re-emits its surviving lines through the LIVE tail; a /loc among
/// them is older than what was already folded and is not where the character stands now.
#[test]
fn a_re_read_loc_older_than_the_newest_line_places_nothing() {
    let mut f = fold();
    feed(&mut f, ZONE, false);
    feed(&mut f, &loc_at(1500), false);
    feed(&mut f, &freeport_at(5000), false);
    // the shrink: survivors come back live, zone line and old /loc included
    feed(&mut f, ZONE, true);
    feed(&mut f, &loc_at(1500), true);
    assert_eq!(loc_of(&f), Value::Null);
    // a /loc typed now, at or after the newest stamp, still places
    feed(&mut f, &loc_at(5000), true);
    assert_eq!(loc_of(&f)["ts"], json!(5000));
}

#[test]
fn the_revision_moves_when_the_position_does() {
    let mut f = fold();
    feed(&mut f, ZONE, true);
    let before = f.registry.snapshot_of("character").unwrap()["seq"]
        .as_i64()
        .unwrap();
    feed(&mut f, LOC, true);
    let after = f.registry.snapshot_of("character").unwrap()["seq"]
        .as_i64()
        .unwrap();
    assert!(after > before, "{before} -> {after}");
}

#[test]
fn a_checkpoint_never_carries_a_position() {
    let mut f = fold();
    feed(&mut f, ZONE, true);
    feed(&mut f, LOC, true);
    let ck = f.checkpoint().expect("a checkpoint at a quiet boundary");
    let mut g = fold();
    g.restore(&ck).expect("the checkpoint restores");
    assert_eq!(loc_of(&g), Value::Null);
    let zone = &g.registry.snapshot_of("character").unwrap()["state"]["zone"];
    assert_eq!(zone, &json!("Nektropos Castle 2 (Adaptive)"));
}
