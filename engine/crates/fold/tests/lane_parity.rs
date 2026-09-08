//! THE COMBAT LANE ANSWERS EXACTLY WHAT THE INLINE ENGINE ANSWERS (Z Engine, 2026-09-07).
//!
//! `lane.rs` folds the combat engine on its own thread beside a private roster. This holds that
//! arrangement to the one that was proven against the TypeScript goldens: every log fixture in the
//! repo is folded both ways and the full combat snapshot, the fight summaries, the scope walk and
//! every module snapshot must be byte-identical. Set `ZENGINE_LANE_LOG=<path>` to run the same
//! comparison over a whole real log (the owner's 142 MB log takes about half a minute).

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use fold::combat::{CombatEngine, SnapshotOpts};
use fold::{registered, ClusterDeps, Fold};
use serde_json::{json, Value};

const ZONE: &str = "America/Los_Angeles";
const CHARACTER: &str = "Primitive";

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("the crate is three levels below the repo root")
        .to_path_buf()
}

fn deps(parser: &eqlog::Parser, launch_ms: i64) -> ClusterDeps {
    let known: HashSet<String> = parser
        .spell_db()
        .map(|db| db.keys().map(str::to_string).collect())
        .unwrap_or_default();
    ClusterDeps {
        known_spell: known,
        spell_classes: parser
            .spell_db()
            .map(fold::modules::combo::evidence::spell_class_index)
            .unwrap_or_default(),
        launch_ms,
        construction_now_ms: launch_ms,
        facts: parser
            .spell_db()
            .map(fold::spell_facts::SpellFacts::project)
            .unwrap_or_default(),
        self_name: Some(CHARACTER.to_string()),
        ..ClusterDeps::default()
    }
}

fn engine() -> CombatEngine {
    let mut engine = CombatEngine::new();
    engine.reset();
    engine.set_player_name(CHARACTER);
    engine
}

/// Everything the engine can be asked, plus every module's published state, as one value.
fn answers(
    engine: &CombatEngine,
    roster: Option<&dyn fold::combat::RosterSource>,
    now: i64,
    modules: Value,
) -> Value {
    json!({
        "modules": modules,
        "combat": engine.snapshot(now, &SnapshotOpts::full(), roster),
        "fights": engine.fight_summaries(now),
        "scopes": engine.walk_scopes(now, roster),
    })
}

fn fold_both_ways(bytes: &[u8]) -> (Value, Value) {
    let tz = ZONE.parse::<eqlog::Tz>().expect("a known zone");
    let parser = eqlog::parser_for(CHARACTER, tz);
    let clock = eqlog::Clock::new(tz);
    let launch_ms = fold::epoch::launch_ms(&clock);

    // The inline fold is dropped before the lane's begins: a whole real log's fold is hundreds of
    // megabytes, and holding two at once is what got this test killed on a loaded machine.
    let (a, events, now) = {
        let mut inline =
            Fold::new(registered(deps(&parser, launch_ms)), launch_ms).with_combat(engine());
        inline.fold_bytes(&parser, bytes);
        let now = inline.last_ts();
        let modules = inline.registry.snapshots();
        let a = answers(
            inline.combat.as_ref().expect("inline engine"),
            inline.registry.roster(),
            now,
            modules,
        );
        (a, inline.events(), now)
    };

    let mut laned = Fold::new(registered(deps(&parser, launch_ms)), launch_ms)
        .with_combat_lane(engine(), Some(CHARACTER));
    laned.fold_bytes(&parser, bytes);
    assert_eq!(laned.events(), events, "the same events were counted");
    assert_eq!(laned.last_ts(), now, "the same clock was reached");
    let modules = laned.registry.snapshots();
    let b = laned
        .lane
        .as_ref()
        .expect("the lane")
        .with(|engine, roster| answers(engine, Some(roster), now, modules));
    (a, b)
}

fn assert_same(label: &str, a: &Value, b: &Value) {
    if a == b {
        return;
    }
    // Name the first differing top-level answer, so a red run says WHAT diverged.
    for key in ["modules", "combat", "fights", "scopes"] {
        if a[key] != b[key] {
            let sa = serde_json::to_string(&a[key]).unwrap_or_default();
            let sb = serde_json::to_string(&b[key]).unwrap_or_default();
            let at = sa
                .bytes()
                .zip(sb.bytes())
                .position(|(x, y)| x != y)
                .unwrap_or(sa.len().min(sb.len()));
            let lo = at.saturating_sub(120);
            panic!(
                "{label}: `{key}` differs at byte {at}\n inline: …{}…\n lane:   …{}…",
                &sa[lo..(at + 120).min(sa.len())],
                &sb[lo..(at + 120).min(sb.len())]
            );
        }
    }
    panic!("{label}: the two answers differ");
}

#[test]
fn every_fixture_folds_the_same_on_the_lane() {
    let dir = repo_root().join("tests").join("fixtures");
    let mut logs: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("tests/fixtures")
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "log"))
        .collect();
    logs.sort();
    assert!(!logs.is_empty(), "there are log fixtures to fold");
    for log in &logs {
        let bytes = fs::read(log).expect("a readable fixture");
        let (a, b) = fold_both_ways(&bytes);
        assert_same(&log.display().to_string(), &a, &b);
    }
}

#[test]
fn the_named_real_log_folds_the_same_on_the_lane() {
    let Ok(path) = std::env::var("ZENGINE_LANE_LOG") else {
        return;
    };
    let bytes = fs::read(&path).expect("ZENGINE_LANE_LOG names a readable log");
    let (a, b) = fold_both_ways(&bytes);
    assert_same(&path, &a, &b);
}

#[test]
fn a_reset_and_a_session_mark_reach_the_lane_in_order() {
    let tz = ZONE.parse::<eqlog::Tz>().expect("a known zone");
    let parser = eqlog::parser_for(CHARACTER, tz);
    let clock = eqlog::Clock::new(tz);
    let launch_ms = fold::epoch::launch_ms(&clock);
    let bytes = fs::read(repo_root().join("tests/fixtures/e2e-combat.log")).expect("fixture");
    let mut laned = Fold::new(registered(deps(&parser, launch_ms)), launch_ms)
        .with_combat_lane(engine(), Some(CHARACTER));
    laned.fold_bytes(&parser, &bytes);
    let lane = laned.lane.as_ref().expect("the lane");
    assert!(
        !lane.session_mark(laned.last_ts()),
        "a mark is refused while hydrating, exactly as the inline engine refuses it"
    );
    let before = lane.with(|e, r| e.snapshot(0, &SnapshotOpts::full(), Some(r)));
    assert_ne!(before["events"], json!(0), "the fold reached the engine");
    laned.reset();
    let after = laned
        .lane
        .as_ref()
        .expect("the lane")
        .with(|e, r| e.snapshot(0, &SnapshotOpts::full(), Some(r)));
    let fresh = engine().snapshot(0, &SnapshotOpts::full(), None);
    assert_eq!(after, fresh, "a reset on the lane is a reset of the engine");
}
