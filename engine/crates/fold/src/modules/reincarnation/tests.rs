//! SYNTHETIC lines throughout: no real reincarnation has been logged yet (see the module header).

use super::*;

fn ev(json: &str) -> Event<'static> {
    Event::from_json(json).expect("a JSON event")
}

fn gained(ts: i64, name: &str) -> String {
    format!(r#"{{"kind":"aaSpend","seq":1,"ts":{ts},"raw":"r","ability":"{name}","cost":0}}"#)
}

fn improved(ts: i64, name: &str, rank: i64) -> String {
    format!(
        r#"{{"kind":"aaSpend","seq":1,"ts":{ts},"raw":"r","ability":"{name} {rank}","cost":0,"rank":{rank}}}"#
    )
}

fn ding(ts: i64, level: i64) -> String {
    format!(r#"{{"kind":"level","seq":1,"ts":{ts},"raw":"r","level":{level}}}"#)
}

fn who(ts: i64, level: i64, classes: &[&str]) -> String {
    let list = classes
        .iter()
        .map(|c| format!("\"{c}\""))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        r#"{{"kind":"selfWho","seq":1,"ts":{ts},"raw":"r","level":{level},"classes":[{list}]}}"#
    )
}

fn fold(lines: &[String]) -> ReincarnationLog {
    let mut log = ReincarnationLog::default();
    for l in lines {
        log.on_event(&ev(l));
    }
    log
}

#[test]
fn grant_names_parse_in_both_shapes() {
    let g = parse_grant("Class Reincarnation: Shadow Knight", None).expect("a class grant");
    assert_eq!(
        (g.component, g.name.as_str(), g.rank),
        (Component::Class, "Shadow Knight", 1)
    );
    assert_eq!(g.code.as_deref(), Some("SHD"));
    let r = parse_grant("Race Reincarnation: Dark Elf 2", Some(2)).expect("a race grant");
    assert_eq!(
        (r.component, r.name.as_str(), r.rank),
        (Component::Race, "Dark Elf", 2)
    );
    let c = parse_grant("Reincarnation: Completionist 3", None).expect("completionist");
    assert_eq!((c.component, c.rank), (Component::Completionist, 3));
    assert!(parse_grant("Full Potential", None).is_none());
    assert!(parse_grant("Unbound Cascade 3", Some(3)).is_none());
}

#[test]
fn a_burst_of_four_grants_is_one_reincarnation() {
    let log = fold(&[
        ding(1_000, 50),
        gained(100_000, "Class Reincarnation: Paladin"),
        gained(100_000, "Class Reincarnation: Monk"),
        gained(101_000, "Class Reincarnation: Enchanter"),
        gained(101_000, "Race Reincarnation: Dark Elf"),
    ]);
    let events = log.events();
    assert_eq!(events.len(), 1);
    let e = &events[0];
    assert!(!e.inferred);
    assert_eq!(e.source, "aa");
    assert_eq!(e.ts, 100_000);
    assert_eq!(e.grants.len(), 4);
    assert_eq!(log.confirmed_ts(), vec![100_000]);
}

#[test]
fn a_second_life_is_a_second_event_and_a_reprint_is_nothing() {
    let log = fold(&[
        gained(100_000, "Class Reincarnation: Paladin"),
        gained(100_500, "Race Reincarnation: Dark Elf"),
        // a re-print of a rank already held, much later, is not a reincarnation
        gained(5_000_000, "Class Reincarnation: Paladin"),
        improved(9_000_000, "Class Reincarnation: Paladin", 2),
        improved(9_000_200, "Race Reincarnation: Dark Elf", 2),
        gained(9_000_300, "Reincarnation: Completionist"),
    ]);
    let events = log.events();
    assert_eq!(events.len(), 2);
    assert_eq!(events[1].ts, 9_000_000);
    assert_eq!(events[1].grants.len(), 3);
}

#[test]
fn a_cost_bearing_purchase_is_never_a_grant() {
    let line = r#"{"kind":"aaSpend","seq":1,"ts":5,"raw":"r","ability":"Class Reincarnation: Monk","cost":3}"#;
    assert!(fold(&[line.to_string()]).events().is_empty());
}

#[test]
fn a_cap_to_fresh_drop_with_the_same_trio_is_an_inferred_reincarnation() {
    let trio = ["PAL", "MNK", "ENC"];
    let log = fold(&[
        who(1_000, 50, &trio),
        ding(2_000_000, 2),
        who(2_100_000, 2, &["ENC", "PAL", "MNK"]),
    ]);
    let events = log.events();
    assert_eq!(events.len(), 1);
    let e = &events[0];
    assert!(e.inferred);
    assert_eq!(e.source, "levelDrop");
    assert_eq!((e.lo, e.hi, e.ts), (1_000, 2_000_000, 2_000_000));
    assert_eq!(e.who_classes, vec!["ENC", "MNK", "PAL"]);
    assert!(log.confirmed_ts().is_empty());
}

#[test]
fn a_drop_to_a_different_trio_is_a_swap_not_a_reincarnation() {
    let log = fold(&[
        who(1_000, 50, &["PAL", "MNK", "ENC"]),
        ding(2_000_000, 2),
        who(2_100_000, 2, &["PAL", "MNK", "WIZ"]),
    ]);
    assert!(log.events().is_empty());
}

#[test]
fn a_drop_the_grants_already_explain_is_not_inferred_twice() {
    let trio = ["PAL", "MNK", "ENC"];
    let log = fold(&[
        who(1_000, 50, &trio),
        gained(1_500_000, "Class Reincarnation: Paladin"),
        ding(2_000_000, 2),
        who(2_100_000, 2, &trio),
    ]);
    // the drop window [1_000, 2_000_000] holds the confirmed one
    let events = log.events();
    assert_eq!(events.len(), 1);
    assert!(!events[0].inferred);
}

#[test]
fn an_unclaimed_reincarnation_line_is_possible_and_chat_is_not() {
    let notice = r#"{"kind":"unknown","seq":1,"ts":10,"raw":"[x] You have been reincarnated!"}"#;
    let chat = r#"{"kind":"unknown","seq":1,"ts":20,"raw":"[x] Bob says, 'reincarnation soon'"}"#;
    let log = fold(&[notice.to_string(), chat.to_string()]);
    let events = log.events();
    assert_eq!(events.len(), 1);
    assert!(events[0].inferred);
    assert_eq!(events[0].source, "message");
    // …and a grant inside its window confirms it.
    let mut log = log;
    log.on_event(&ev(&gained(5_000, "Class Reincarnation: Monk")));
    let events = log.events();
    assert_eq!(events.len(), 1);
    assert!(!events[0].inferred);
    assert!(events[0].message.is_some());
}

#[test]
fn the_tracker_opens_once_per_burst() {
    let mut t = GrantTracker::default();
    let opens: Vec<bool> = [
        gained(100, "Class Reincarnation: Paladin"),
        gained(200, "Race Reincarnation: Dark Elf"),
        improved(90_000, "Class Reincarnation: Paladin", 2),
    ]
    .iter()
    .filter_map(|l| t.admit(&ev(l)))
    .map(|a| a.opens)
    .collect();
    assert_eq!(opens, vec![true, false, true]);
}
