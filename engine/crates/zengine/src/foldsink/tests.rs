//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::{folding_sinks, server_of, source_key, FoldSink};
use crate::ingest::{Event, EventSink, SinkInputs};
use std::path::{Path, PathBuf};

fn inputs<'a>(log: &'a Path, clock: &'a eqlog::Clock) -> SinkInputs<'a> {
    SinkInputs {
        log,
        character: Some("Primitive"),
        db: None,
        clock,
        attached_at_ms: 1_787_181_707_000,
        // No state directory, which is what makes these tests describe the same fold the
        // equivalence oracle describes: nothing read, nothing seeded, nothing written.
        state_dir: None,
    }
}

/// The same inputs, carrying a state directory — the attach the app makes.
fn inputs_with_state<'a>(
    log: &'a Path,
    clock: &'a eqlog::Clock,
    state_dir: &'a Path,
) -> SinkInputs<'a> {
    SinkInputs {
        state_dir: Some(state_dir),
        ..inputs(log, clock)
    }
}

/// A scratch profile directory of this test's own.
fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("zengine-foldsink-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a scratch profile");
    dir
}

/// One row, in the app's exact spelling, for a named mob under a named bucket.
fn ledger_of(buckets: &[(&str, &str)]) -> String {
    let sources: Vec<String> = buckets
        .iter()
        .map(|(key, mob)| {
            format!(
                r#"{{"key":"{key}","rows":[{{"mobKey":"{mob}","spellKey":"malosi","family":"cast","casterKind":"self","casterLevel":51,"mobLevel":20,"debuffs":"","rank":0,"overchannel":false,"week":"2026-W34","resist":4,"land":7,"dmg":{{"9":2}},"firstTs":1000,"lastTs":2000}}]}}"#
            )
        })
        .collect();
    format!(r#"{{"version":3,"sources":[{}]}}"#, sources.join(","))
}

fn overlay_of(buckets: &[&str]) -> String {
    let sources: Vec<String> = buckets
        .iter()
        .map(|key| {
            format!(
                r#"{{"key":"{key}","messages":[{{"text":"You feel much faster.","role":"landing","spells":[{{"spell":"Alacrity","count":3}}]}}]}}"#
            )
        })
        .collect();
    format!(
        r#"{{"version":2,"updatedAt":"2026-08-19T16:21:54.000Z","sources":[{}]}}"#,
        sources.join(",")
    )
}

/// How many pooled rows the resist module says it holds — its whole published surface.
fn resist_rows(sink: &FoldSink) -> i64 {
    sink.snapshot("resist").expect("the resist module").state["rows"]
        .as_i64()
        .expect("a row count")
}

#[test]
fn the_source_key_is_the_apps_own_character_id() {
    // `${name}_${server}`, lowercased. A different spelling would file the same character's
    // counts in a second bucket and the app would sum both.
    let clock = super::test_clock();
    let log = Path::new("C:/EQ/Logs/eqlog_Primitive_freeport.txt");
    assert_eq!(source_key(&inputs(log, &clock)), "primitive_freeport");
    // A log whose name states no character falls back to the module's constructed default.
    let nameless = SinkInputs {
        character: None,
        ..inputs(Path::new("C:/EQ/Logs/notalog.txt"), &clock)
    };
    assert_eq!(source_key(&nameless), "log");
}

#[test]
fn the_server_comes_off_the_products_own_file_name() {
    assert_eq!(
        server_of(Path::new("C:/EQ/Logs/eqlog_Primitive_freeport.txt")).as_deref(),
        Some("freeport")
    );
    // The oracle corpus's slice form goes through eqlog's own rule.
    assert_eq!(
        server_of(Path::new("eqlog_Primitive_freeport.patch-week.txt")).as_deref(),
        Some("freeport")
    );
    // A character name may hold an underscore; the server may not, so the last one splits.
    assert_eq!(
        server_of(Path::new("eqlog_Two_Names_freeport.txt")).as_deref(),
        Some("freeport")
    );
    assert!(server_of(Path::new("notalog.txt")).is_none());
    assert!(server_of(Path::new("eqlog_Primitive_.txt")).is_none());
}

#[test]
fn a_fresh_sink_folds_all_twenty_modules_and_skips_none() {
    // The no-silent-caps law, engine-side: an engine serving a registry with holes in it would
    // answer `notFound` for a module that exists.
    let clock = super::test_clock();
    let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
    let sink = FoldSink::new(&inputs(log, &clock));
    assert_eq!(sink.fold.registry.ids().len(), fold::WIRING_ORDER.len());
    assert!(
        sink.fold.registry.missing().is_empty(),
        "{:?}",
        sink.fold.registry.missing()
    );
    for id in fold::WIRING_ORDER {
        assert!(sink.snapshot(id).is_some(), "{id} answered nothing");
    }
}

#[test]
fn a_name_the_registry_does_not_carry_answers_nothing() {
    // `loot.ledger` is the trap worth pinning: it is a view source name, and a caller that
    // confuses the two must be told so rather than handed an empty state.
    let clock = super::test_clock();
    let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
    let sink = FoldSink::new(&inputs(log, &clock));
    assert!(sink.snapshot("loot.ledger").is_none());
    assert!(sink.snapshot("").is_none());
    assert!(sink.snapshot("combat").is_none(), "combat is not a module");
}

/// Feed one death you landed, stamped with `seq` — the event the `kills` module counts:
/// `death` is the kind, `bySelf` is the counted filter, `name` is what the map is keyed by.
///
/// Built through the parser's own writer rather than as a JSON literal, because the sink reads
/// the typed half and a hand-written string would drive a path production does not take.
///
/// The `seq` goes into the event as well as the envelope: a module's published `seq` comes off
/// the event's own field, and the two agree on a real scan by construction.
fn kill(sink: &mut dyn EventSink, seq: i64) {
    let mut ev = eqlog::event::Ev::new();
    ev.begin(eqlog::event::Kind::Death);
    ev.envelope(
        seq,
        1_787_181_707_000,
        "a sand giant has been slain by Primitive!",
    );
    ev.s(eqlog::event::Key::Name, "a sand giant");
    ev.b(eqlog::event::Key::BySelf, true);
    let (json, payload) = ev.done();
    sink.event(&Event {
        json,
        payload,
        seq,
        live: false,
    });
}

/// How many kills the `kills` module has recorded.
fn counted(sink: &dyn EventSink) -> usize {
    sink.snapshot("kills").expect("kills is registered").state["mobs"]
        .as_object()
        .map_or(0, serde_json::Map::len)
}

#[test]
fn the_snapshot_advances_with_the_fold_and_reads_between_events() {
    // The point of the seam: a snapshot taken between two events is the state after the first
    // and no part of the second.
    //
    // Two deaths, and the first one is supposed to vanish. The launch anchor resolves through
    // the parser's own clock, so the first event past it fires the `epoch` boundary — character
    // rebirth — and `kills` clears on it. That is what a real attach does, and pinning it here
    // makes a later change to the anchor announce itself as a behaviour change.
    let clock = super::test_clock();
    let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
    let mut sink = FoldSink::new(&inputs(log, &clock));
    assert_eq!(counted(&sink), 0);

    kill(&mut sink, 0);
    assert_eq!(counted(&sink), 0, "the epoch boundary cleared the map");
    kill(&mut sink, 1);
    assert_eq!(counted(&sink), 1, "and the next one is the new world's");

    let after = sink.snapshot("kills").expect("kills is registered");
    assert_eq!(after.seq, 1, "the module's own seq is the event it folded");
    assert_eq!(sink.report().events, 2);
}

#[test]
fn the_factory_builds_a_fresh_registry_per_attach() {
    // A new sink per attach is the ingest's structural guarantee that two folds never reach one
    // set of modules. The factory constructs; it never hands back something it is holding.
    let clock = super::test_clock();
    let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
    let factory = folding_sinks();
    let mut first = factory(&inputs(log, &clock));
    kill(&mut *first, 0);
    kill(&mut *first, 1);
    let second = factory(&inputs(log, &clock));
    assert_eq!(first.report().events, 2);
    assert_eq!(second.report().events, 0);
    assert_eq!(counted(&*first), 1);
    assert_eq!(counted(&*second), 0);
}

#[test]
fn an_attach_with_a_state_dir_seeds_both_artifacts_and_discards_its_own_bucket() {
    let dir = scratch("seed");
    // Two buckets on disk: this character's, and somebody else's. The design turns on their
    // being treated differently — one is about to be re-derived from the log, the other is
    // knowledge nothing can re-derive.
    std::fs::write(
        dir.join("resist-ledger.json"),
        ledger_of(&[
            ("primitive_freeport", "a rat"),
            ("other_bertox", "a bat"),
            // The shipped baseline's, which must be refused on read: it is re-seeded from the
            // bundle on every launch and counting it here would count it twice.
            ("baseline", "a gnoll"),
        ]),
    )
    .expect("the ledger is written");
    std::fs::write(
        dir.join("message-overlay.json"),
        overlay_of(&["primitive_freeport", "other_bertox"]),
    )
    .expect("the register is written");

    let clock = super::test_clock();
    let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
    let sink = FoldSink::new(&inputs_with_state(log, &clock, &dir));

    // One row, not three: `other_bertox` survived, `primitive_freeport` was discarded by
    // `begin_source` because its log is about to state its whole content again, and `baseline`
    // was never read at all.
    assert_eq!(resist_rows(&sink), 1);

    // The overlay is the same story through a different door. `other_bertox`'s bucket is still
    // in the register; this character's is empty and waiting for the fold.
    let register = sink
        .fold
        .registry
        .buffs()
        .expect("buffs is registered")
        .overlay_register();
    let mine = register
        .sources
        .iter()
        .find(|s| s.key == "primitive_freeport")
        .expect("this character's bucket exists, discarded");
    assert!(mine.messages.is_empty(), "discarded, not seeded");
    let theirs = register
        .sources
        .iter()
        .find(|s| s.key == "other_bertox")
        .expect("the other character's bucket survived");
    assert_eq!(theirs.messages.len(), 1);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_sixtieth_live_beat_writes_both_files_and_the_scan_writes_neither() {
    let dir = scratch("write");
    std::fs::write(
        dir.join("resist-ledger.json"),
        ledger_of(&[("other_bertox", "a bat")]),
    )
    .expect("the ledger is written");
    std::fs::write(
        dir.join("message-overlay.json"),
        overlay_of(&["other_bertox"]),
    )
    .expect("the register is written");

    let clock = super::test_clock();
    let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
    let mut sink = FoldSink::new(&inputs_with_state(log, &clock, &dir));

    // A historical scan writes nothing and cannot: it folds events and never ticks, and the
    // write lives in `tick` alone. Overwrite with junk and prove the scan leaves it there.
    std::fs::write(dir.join("resist-ledger.json"), "scan must not touch this")
        .expect("junk is written");
    for seq in 0..3 {
        kill(&mut sink, seq);
    }
    assert_eq!(
        std::fs::read_to_string(dir.join("resist-ledger.json")).expect("readable"),
        "scan must not touch this"
    );

    // The sixtieth beat writes and fifty-nine do not — the app's "every sixtieth tick" at 1 Hz.
    for _ in 0..(crate::state::WRITE_EVERY_BEATS - 1) {
        sink.tick(1_787_181_707_000);
    }
    assert_eq!(
        std::fs::read_to_string(dir.join("resist-ledger.json")).expect("readable"),
        "scan must not touch this",
        "fifty-nine beats is not a minute"
    );
    sink.tick(1_787_181_707_000);

    // What landed is the app's own format, and it carries the bucket nothing could re-derive.
    let text = std::fs::read_to_string(dir.join("resist-ledger.json")).expect("readable");
    assert!(
        text.starts_with(r#"{"version":3,"sources":[{"key":"other_bertox""#),
        "{text}"
    );
    assert!(text.contains(r#""mobKey":"a bat""#), "{text}");
    // …and it is readable by the app's own reader, proven through the shared parse.
    let back = fold::modules::resist::ledger_file::read_ledger(&text);
    assert_eq!(back.sources.len(), 1);
    assert_eq!(back.sources[0].rows.len(), 1);

    let overlay = std::fs::read_to_string(dir.join("message-overlay.json")).expect("readable");
    assert!(
        overlay.starts_with(r#"{"version":2,"updatedAt":"#),
        "{overlay}"
    );
    assert!(overlay.contains(r#""key":"other_bertox""#), "{overlay}");
    // The baseline is not in the file: it is compiled into the binary and merged at
    // construction, so a copy in userData would be 400 kB of staler duplicate.
    assert!(!overlay.contains(r#""key":"baseline""#), "{overlay}");
    // No scratch file left behind by either write.
    assert!(!dir.join("resist-ledger.json.tmp").exists());
    assert!(!dir.join("message-overlay.json.tmp").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn without_a_state_dir_nothing_is_read_and_nothing_is_written() {
    // The oracle's world: an attach that names no profile directory neither reads a file nor
    // writes one, so the fold is a pure function of its bytes. The directory here holds a file
    // the sink would certainly have read had it been told to.
    let dir = scratch("none");
    std::fs::write(
        dir.join("resist-ledger.json"),
        ledger_of(&[("other_bertox", "a bat")]),
    )
    .expect("the ledger is written");

    let clock = super::test_clock();
    let log = Path::new("C:/nowhere/eqlog_Primitive_freeport.txt");
    let mut sink = FoldSink::new(&inputs(log, &clock));
    assert_eq!(resist_rows(&sink), 0, "nothing was seeded");
    for _ in 0..(crate::state::WRITE_EVERY_BEATS * 2) {
        sink.tick(1_787_181_707_000);
    }
    // Untouched — byte for byte the file this test wrote.
    assert_eq!(
        std::fs::read_to_string(dir.join("resist-ledger.json")).expect("readable"),
        ledger_of(&[("other_bertox", "a bat")])
    );
    assert!(!dir.join("message-overlay.json").exists());
    let _ = std::fs::remove_dir_all(&dir);
}
