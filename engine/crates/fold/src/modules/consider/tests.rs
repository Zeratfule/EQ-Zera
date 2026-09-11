//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::{ConsiderModule, CONSIDER_BACKFILL};
use crate::event::Event;
use crate::knowledge::{Answer, Knowledge, Miss, OwnLoot, SeenDrop};
use crate::EqModule;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

/// A lookup that answers everything and remembers who asked. What it answers with does not
/// matter here; whether it was called at all is the claim.
#[derive(Default)]
struct Recorder {
    asked: Mutex<Vec<String>>,
}

impl Knowledge for Recorder {
    fn item(&self, name: &str) -> Answer {
        Answer {
            record: json!({ "name": name }),
            found: true,
        }
    }
    fn identity_keys(&self, mob: &str) -> Vec<String> {
        vec![super::mob_key(mob)]
    }
    fn mob(&self, name: &str, loot: &dyn OwnLoot) -> Answer {
        self.asked
            .lock()
            .expect("the recorder")
            .push(name.to_owned());
        let seen = loot.drops_across(&self.identity_keys(name));
        Answer {
            record: json!({ "name": name, "dropsSeen": seen.len() }),
            found: true,
        }
    }
    /// Stands in for a catalog, so it says yes — and the point is that nothing on this module's
    /// path asks. The con-card refusal that reads it lives one layer up (`zengine::concard`).
    fn known_mob(&self, _name: &str) -> bool {
        true
    }
    fn take_misses(&self) -> Vec<Miss> {
        Vec::new()
    }
}

fn ev(json: &str) -> Event<'static> {
    Event::from_json(json).expect("a JSON object")
}

fn con(seq: i64, mob: &str) -> String {
    format!(
        r#"{{"kind":"consider","mob":"{mob}","rare":false,"level":38,"faction":"dubious","difficulty":"Looks kind of dangerous.","seq":{seq},"ts":1787181707000,"raw":"x"}}"#
    )
}

fn rows(module: &ConsiderModule) -> Vec<Value> {
    module.snapshot()["state"]
        .as_array()
        .expect("an array")
        .clone()
}

#[test]
fn with_no_lookup_installed_knowledge_is_absent_from_every_row() {
    // The default construction has no lookup, so `knowledge` is missing from every row — never
    // an empty record meaning "we checked".
    let mut module = ConsiderModule::new();
    module.on_event(&ev(&con(1, "a sand giant")), false);
    module.on_event(&ev(&con(2, "a sand giant")), true);
    module.on_tick(1_787_181_708_000, &[]);
    for row in rows(&module) {
        assert_eq!(row.get("knowledge"), None, "{row}");
    }
}

#[test]
fn a_live_con_enriches_inside_the_same_fold_and_a_historical_one_does_not() {
    let recorder = Arc::new(Recorder::default());
    let mut module = ConsiderModule::new();
    module.install_knowledge(&(Arc::clone(&recorder) as Arc<dyn Knowledge>));

    module.on_event(&ev(&con(1, "a hill giant")), false);
    assert_eq!(
        rows(&module)[0].get("knowledge"),
        None,
        "a replay probes nothing"
    );
    assert!(recorder.asked.lock().expect("the recorder").is_empty());

    module.on_event(&ev(&con(2, "a sand giant")), true);
    let rows = rows(&module);
    assert_eq!(rows[1]["knowledge"]["name"], "a sand giant");
    assert_eq!(
        *recorder.asked.lock().expect("the recorder"),
        vec!["a sand giant".to_owned()],
        "asked with the row's DISPLAY name"
    );
}

#[test]
fn a_re_con_keeps_what_was_learned_and_asks_nothing_twice() {
    // Enrichment is per-MOB, not per-con: the row carries the previous knowledge forward and
    // `probe` returns early on a row that already has one.
    let recorder = Arc::new(Recorder::default());
    let mut module = ConsiderModule::new();
    module.install_knowledge(&(Arc::clone(&recorder) as Arc<dyn Knowledge>));
    module.on_event(&ev(&con(1, "a sand giant")), true);
    module.on_event(&ev(&con(2, "a sand giant")), true);
    let rows = rows(&module);
    assert_eq!(rows.len(), 1, "one row per mob");
    assert_eq!(rows[0]["cons"], 2);
    assert!(rows[0]["knowledge"].is_object());
    assert_eq!(recorder.asked.lock().expect("the recorder").len(), 1);
}

#[test]
fn the_first_live_tick_backfills_the_newest_rows_and_only_the_newest() {
    // The replay is over, so enrich what the user is about to look at. Bounded at
    // CONSIDER_BACKFILL, and once — the second tick does nothing.
    let recorder = Arc::new(Recorder::default());
    let mut module = ConsiderModule::new();
    module.install_knowledge(&(Arc::clone(&recorder) as Arc<dyn Knowledge>));
    for seq in 0..(CONSIDER_BACKFILL as i64 + 5) {
        module.on_event(&ev(&con(seq, &format!("mob number {seq}"))), false);
    }
    assert!(recorder.asked.lock().expect("the recorder").is_empty());

    module.on_tick(1_787_181_708_000, &[]);
    assert_eq!(
        recorder.asked.lock().expect("the recorder").len(),
        CONSIDER_BACKFILL,
        "the newest handful, not the whole ring"
    );
    let rows = rows(&module);
    assert_eq!(
        rows[0].get("knowledge"),
        None,
        "the oldest rows resolve on demand"
    );
    assert!(rows[rows.len() - 1]["knowledge"].is_object());

    module.on_tick(1_787_181_709_000, &[]);
    assert_eq!(
        recorder.asked.lock().expect("the recorder").len(),
        CONSIDER_BACKFILL,
        "the edge is an edge"
    );
}

#[test]
fn the_own_loot_index_reads_back_what_it_folded_and_refuses_a_destroy() {
    let mut module = ConsiderModule::new();
    let loot = |seq: i64, item: &str, source: &str, count: i64, ts: i64| {
        format!(
            r#"{{"kind":"loot","item":"{item}","source":"{source}","sourceKind":"corpse","count":{count},"seq":{seq},"ts":{ts},"raw":"x"}}"#
        )
    };
    module.on_event(&ev(&loot(1, "Giant Toe", "a sand giant", 2, 100)), false);
    module.on_event(&ev(&loot(2, "giant toe", "A Sand Giant", 1, 300)), false);
    module.on_event(&ev(&loot(3, "Amber", "a sand giant", 1, 200)), false);
    // A destroy names no mob and is not a drop.
    module.on_event(
        &ev(
            r#"{"kind":"loot","item":"Bone Chips","disposition":"destroyed","count":38,"seq":4,"ts":400,"raw":"x"}"#,
        ),
        false,
    );

    let index = module.as_own_loot().expect("consider owns the index");
    let seen = index.drops_across(&["a sand giant".to_owned()]);
    assert_eq!(
        seen,
        vec![
            SeenDrop {
                item: "Giant Toe".into(),
                count: 3,
                last_ts: 300
            },
            SeenDrop {
                item: "Amber".into(),
                count: 1,
                last_ts: 200
            },
        ],
        "case-folded onto one key, counts added, newest ts kept, most-looted first"
    );
    assert!(index
        .drops_across(&["nothing at all".to_owned()])
        .is_empty());

    // A CHEST IS NOT A MOB: an instance reward chest hands you items it never dropped, so it
    // files nothing here. The row is still in the loot ledger — this index is the per-mob one.
    module.on_event(
        &ev(
            r#"{"kind":"loot","item":"Golem Metal Wand +4","source":"Reward Chest","sourceKind":"chest","seq":5,"ts":450,"raw":"x"}"#,
        ),
        false,
    );
    assert!(module
        .as_own_loot()
        .expect("the index")
        .drops_across(&["Reward Chest".to_owned()])
        .is_empty());

    // …and a character rebirth drops the history with the ring: it belonged to a dead
    // same-name character.
    module.on_event(&ev(r#"{"kind":"epoch","seq":6,"ts":500,"raw":"x"}"#), false);
    assert!(module
        .as_own_loot()
        .expect("the index")
        .drops_across(&["a sand giant".to_owned()])
        .is_empty());
}

#[test]
fn the_union_across_two_spellings_is_one_creatures_history() {
    // The index files a drop under the corpse's LOG name while a boss card asks with the ROSTER
    // name. Counts ADD and `lastTs` takes the later.
    let mut module = ConsiderModule::new();
    for (seq, source, ts) in [(1_i64, "Cazic-Thule", 100_i64), (2, "Cazic Thule", 400)] {
        module.on_event(
            &ev(&format!(
                r#"{{"kind":"loot","item":"Glowing Black Stone","source":"{source}","sourceKind":"corpse","seq":{seq},"ts":{ts},"raw":"x"}}"#
            )),
            false,
        );
    }
    let index = module.as_own_loot().expect("the index");
    let seen = index.drops_across(&["cazic thule".to_owned(), "cazic-thule".to_owned()]);
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].count, 2);
    assert_eq!(seen[0].last_ts, 400);
}
