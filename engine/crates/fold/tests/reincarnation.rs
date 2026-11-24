//! Reincarnation through the whole fold: leveling publishes it, character states level 1, progression
//! dates the new bar, and combo refuses to call it a swap.
//!
//! SYNTHETIC lines: no real reincarnation has been logged yet, so the grant shape is the assumed one
//! (`modules/reincarnation.rs` header) — cost-0 AA lines naming the reincarnation AAs.

use fold::event::Event;
use fold::modules::combo::levels::slot_prior;
use fold::{registered, ClusterDeps, Fold};
use serde_json::Value;

const TRIO: [&str; 3] = ["PAL", "MNK", "ENC"];

fn fold_lines(lines: &[String]) -> Fold {
    let mut fold = Fold::new(registered(ClusterDeps::default()), i64::MAX);
    for (i, line) in lines.iter().enumerate() {
        let with_seq = line.replacen("\"seq\":1", &format!("\"seq\":{}", i + 1), 1);
        let ev = Event::from_json(&with_seq).expect("a JSON event");
        fold.on_primary(&ev, true);
    }
    fold
}

fn state(fold: &Fold, id: &str) -> Value {
    fold.registry.snapshot_of(id).expect("a registered module")["state"].clone()
}

fn ding(ts: i64, level: i64) -> String {
    format!(r#"{{"kind":"level","seq":1,"ts":{ts},"raw":"r","level":{level}}}"#)
}

fn who(ts: i64, level: i64, classes: &[&str]) -> String {
    let list: Vec<String> = classes.iter().map(|c| format!("\"{c}\"")).collect();
    format!(
        r#"{{"kind":"selfWho","seq":1,"ts":{ts},"raw":"r","level":{level},"classes":[{}]}}"#,
        list.join(",")
    )
}

fn grant(ts: i64, ability: &str) -> String {
    format!(r#"{{"kind":"aaSpend","seq":1,"ts":{ts},"raw":"r","ability":"{ability}","cost":0}}"#)
}

/// Life 1 capped, one reincarnation burst, then life 2 dings 2 and 3 and restates the same trio.
fn reincarnated() -> Vec<String> {
    vec![
        ding(1_000, 50),
        who(2_000, 50, &TRIO),
        grant(100_000, "Class Reincarnation: Paladin"),
        grant(100_000, "Class Reincarnation: Monk"),
        grant(101_000, "Class Reincarnation: Enchanter"),
        grant(101_000, "Race Reincarnation: Dark Elf"),
        ding(200_000, 2),
        ding(300_000, 3),
        who(400_000, 3, &TRIO),
    ]
}

#[test]
fn leveling_publishes_one_confirmed_reincarnation() {
    let fold = fold_lines(&reincarnated());
    let events = state(&fold, "leveling")["reincarnations"].clone();
    let list = events.as_array().expect("published");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["ts"], 100_000);
    assert_eq!(list[0]["inferred"], false);
    assert_eq!(list[0]["grants"].as_array().map(Vec::len), Some(4));
}

#[test]
fn a_character_without_one_publishes_no_field() {
    let fold = fold_lines(&[ding(1_000, 10), ding(2_000, 11)]);
    assert!(state(&fold, "leveling").get("reincarnations").is_none());
    assert!(state(&fold, "progression").get("rebirthTs").is_none());
}

#[test]
fn the_stated_level_is_one_at_the_reincarnation_instant() {
    let mut lines = reincarnated();
    lines.truncate(6);
    let fold = fold_lines(&lines);
    let level = state(&fold, "character")["level"].clone();
    assert_eq!(level["level"], 1);
    assert_eq!(level["ts"], 100_000);
    assert_eq!(level["source"], "reincarnation");
    assert_eq!(
        state(&fold, "progression")["rebirthTs"],
        serde_json::json!([100_000])
    );
}

#[test]
fn combo_cuts_no_swap_at_a_reincarnation() {
    let fold = fold_lines(&reincarnated());
    let intervals = state(&fold, "combo")["intervals"].clone();
    let list = intervals.as_array().expect("intervals");
    assert_eq!(list.len(), 1, "{intervals}");
    assert!(list.iter().all(|i| i["startReason"] != "levelDrop"));
    assert!(list[0].get("levelRegressed").is_none());
}

#[test]
fn combo_still_cuts_a_real_swap_after_the_cap() {
    // Same drop with no grant lines and a DIFFERENT trio after it: a swap, cut as one.
    let fold = fold_lines(&[
        ding(1_000, 50),
        who(2_000, 50, &TRIO),
        ding(200_000, 2),
        who(400_000, 2, &["PAL", "MNK", "WIZ"]),
    ]);
    let intervals = state(&fold, "combo")["intervals"].clone();
    let list = intervals.as_array().expect("intervals");
    assert!(list.len() >= 2, "{intervals}");
    assert!(state(&fold, "leveling").get("reincarnations").is_none());
}

#[test]
fn an_inferred_reincarnation_also_cuts_no_swap() {
    let fold = fold_lines(&[
        ding(1_000, 50),
        who(2_000, 50, &TRIO),
        ding(200_000, 2),
        who(400_000, 2, &TRIO),
    ]);
    let events = state(&fold, "leveling")["reincarnations"].clone();
    assert_eq!(events[0]["inferred"], true);
    assert_eq!(events[0]["source"], "levelDrop");
    let intervals = state(&fold, "combo")["intervals"].clone();
    assert_eq!(intervals.as_array().map(Vec::len), Some(1), "{intervals}");
    // The inferred one never states a level: no grant line was seen.
    assert_eq!(state(&fold, "character")["level"]["source"], "who");
}

#[test]
fn a_reincarnated_loadout_keeps_three_slots_at_every_level() {
    assert_eq!(slot_prior(Some(2), None, &[]), 2);
    assert_eq!(slot_prior(Some(2), None, &[100]), 3);
    // a reincarnation AFTER the span says nothing about it
    assert_eq!(slot_prior(Some(2), Some(50), &[100]), 2);
    assert_eq!(slot_prior(Some(30), None, &[]), 3);
}
