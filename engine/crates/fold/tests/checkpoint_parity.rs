//! A CHECKPOINT RESTORED AND CONTINUED IS THE WHOLE FOLD (Z Engine, 2026-09-07).
//!
//! For every log fixture, and for several cut points inside it: fold the whole log; fold up to the
//! cut, take the checkpoint, put it onto a FRESH fold, fold the rest; the two must answer
//! byte-identically - every module snapshot, the combat snapshot, the fights and the scopes.
//! That is the determinism law made into a test, and it is what makes a warm start honest.
//!
//! Until every module and the combat engine can serialize, `Fold::checkpoint` answers `None`. The
//! coverage test names what is missing; it passes while the list is non-empty unless
//! `ZENGINE_CHECKPOINT_STRICT` is set, which is how the program's last step turns the light red
//! for any module left behind.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use fold::combat::{CombatEngine, SnapshotOpts};
use fold::{registered, ClusterDeps, Fold};
use serde_json::{json, Value};

const ZONE: &str = "America/Los_Angeles";
const CHARACTER: &str = "Primitive";
/// Where to cut, as a share of the bytes; each is moved forward to the next line boundary.
const CUTS: [f64; 3] = [0.25, 0.5, 0.9];

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

fn fresh(parser: &eqlog::Parser, launch_ms: i64) -> Fold {
    Fold::new(registered(deps(parser, launch_ms)), launch_ms).with_combat(engine())
}

fn answers(f: &Fold) -> Value {
    let now = f.last_ts();
    let engine = f.combat.as_ref().expect("inline engine");
    let roster = f.registry.roster();
    json!({
        "modules": f.registry.snapshots(),
        "combat": engine.snapshot(now, &SnapshotOpts::full(), roster),
        "fights": engine.fight_summaries(now),
        "scopes": engine.walk_scopes(now, roster),
        "events": f.events(),
        "lastTs": now,
    })
}

/// The first line boundary at or after `at`.
fn line_boundary(bytes: &[u8], at: usize) -> usize {
    bytes[at..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(bytes.len(), |i| at + i + 1)
}

fn first_difference(a: &Value, b: &Value) -> String {
    for key in ["events", "lastTs", "modules", "combat", "fights", "scopes"] {
        if a.get(key).is_none() && b.get(key).is_none() {
            continue;
        }
        if a[key] != b[key] {
            let sa = serde_json::to_string(&a[key]).unwrap_or_default();
            let sb = serde_json::to_string(&b[key]).unwrap_or_default();
            let at = sa
                .bytes()
                .zip(sb.bytes())
                .position(|(x, y)| x != y)
                .unwrap_or(sa.len().min(sb.len()));
            let lo = at.saturating_sub(120);
            return format!(
                "`{key}` differs at byte {at}\n whole:    …{}…\n restored: …{}…",
                &sa[lo..(at + 120).min(sa.len())],
                &sb[lo..(at + 120).min(sb.len())]
            );
        }
    }
    "the two answers differ".to_owned()
}

/// `Some(problem)` when a cut failed; `None` when it matched, or when no checkpoint was possible.
fn check_cut(bytes: &[u8], cut: usize, whole: &Value) -> Option<String> {
    let tz = ZONE.parse::<eqlog::Tz>().expect("a known zone");
    let parser = eqlog::parser_for(CHARACTER, tz);
    let launch_ms = fold::epoch::launch_ms(&eqlog::Clock::new(tz));
    let ck = {
        let mut head = fresh(&parser, launch_ms);
        head.fold_bytes(&parser, &bytes[..cut]);
        head.checkpoint()?
    };
    let mut resumed = fresh(&parser, launch_ms);
    if let Err(e) = resumed.restore(&ck) {
        panic!("a checkpoint this build wrote is one it reads: {e}");
    }
    resumed.fold_bytes_from(&parser, &bytes[cut..]);
    let b = answers(&resumed);
    (&b != whole).then(|| first_difference(whole, &b))
}

fn fixtures() -> Vec<PathBuf> {
    let dir = repo_root().join("tests").join("fixtures");
    let mut logs: Vec<PathBuf> = fs::read_dir(&dir)
        .expect("tests/fixtures")
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "log"))
        .collect();
    logs.sort();
    logs
}

#[test]
fn every_fixture_resumes_from_every_cut_to_the_whole_fold() {
    let tz = ZONE.parse::<eqlog::Tz>().expect("a known zone");
    let parser = eqlog::parser_for(CHARACTER, tz);
    let launch_ms = fold::epoch::launch_ms(&eqlog::Clock::new(tz));
    let mut checked = 0usize;
    for log in fixtures() {
        let bytes = fs::read(&log).expect("a readable fixture");
        let whole = {
            let mut f = fresh(&parser, launch_ms);
            f.fold_bytes(&parser, &bytes);
            answers(&f)
        };
        for share in CUTS {
            let cut = line_boundary(&bytes, (bytes.len() as f64 * share) as usize);
            if let Some(problem) = check_cut(&bytes, cut, &whole) {
                panic!("{}: cut at byte {cut}: {problem}", log.display());
            }
            checked += 1;
        }
    }
    let mut probe = fresh(&parser, launch_ms);
    probe.fold_bytes(&parser, b"");
    let missing = probe.registry.not_checkpointable();
    if probe.checkpoint().is_some() {
        assert!(checked > 0, "cuts were checked");
    } else if std::env::var_os("ZENGINE_CHECKPOINT_STRICT").is_some() {
        panic!("the checkpoint is not complete; modules missing: {missing:?}");
    } else {
        eprintln!("checkpoint not yet available; modules missing: {missing:?}");
    }
}

/// The twenty modules alone (no combat engine): what the module half of a checkpoint answers, held
/// to the whole fold at every cut, whatever the engine's own progress. Fails on any module that
/// still refuses, so a module cannot regress out of the checkpoint unnoticed.
#[test]
fn every_module_resumes_from_every_cut_to_the_whole_fold() {
    let tz = ZONE.parse::<eqlog::Tz>().expect("a known zone");
    let parser = eqlog::parser_for(CHARACTER, tz);
    let launch_ms = fold::epoch::launch_ms(&eqlog::Clock::new(tz));
    let modules_only = |bytes: &[u8]| {
        let mut f = Fold::new(registered(deps(&parser, launch_ms)), launch_ms);
        f.fold_bytes(&parser, bytes);
        f
    };
    for log in fixtures() {
        let bytes = fs::read(&log).expect("a readable fixture");
        let whole = modules_only(&bytes);
        let whole_answer = json!({ "modules": whole.registry.snapshots(), "events": whole.events(), "lastTs": whole.last_ts() });
        for share in CUTS {
            let cut = line_boundary(&bytes, (bytes.len() as f64 * share) as usize);
            let head = modules_only(&bytes[..cut]);
            let missing = head.registry.not_checkpointable();
            assert!(
                missing.is_empty(),
                "{}: modules that cannot checkpoint: {missing:?}",
                log.display()
            );
            let ck = head.checkpoint().expect("a module-only fold checkpoints");
            drop(head);
            let mut resumed = Fold::new(registered(deps(&parser, launch_ms)), launch_ms);
            if let Err(e) = resumed.restore(&ck) {
                panic!("{}: the checkpoint restores: {e}", log.display());
            }
            resumed.fold_bytes_from(&parser, &bytes[cut..]);
            let answer = json!({ "modules": resumed.registry.snapshots(), "events": resumed.events(), "lastTs": resumed.last_ts() });
            if answer != whole_answer {
                let problem = first_difference(&whole_answer, &answer);
                panic!("{}: cut at byte {cut}: {problem}", log.display());
            }
        }
    }
}

#[test]
fn the_named_real_log_resumes_to_the_whole_fold() {
    let Ok(path) = std::env::var("ZENGINE_LANE_LOG") else {
        return;
    };
    let tz = ZONE.parse::<eqlog::Tz>().expect("a known zone");
    let parser = eqlog::parser_for(CHARACTER, tz);
    let launch_ms = fold::epoch::launch_ms(&eqlog::Clock::new(tz));
    let bytes = fs::read(&path).expect("ZENGINE_LANE_LOG names a readable log");
    let whole = {
        let mut f = fresh(&parser, launch_ms);
        f.fold_bytes(&parser, &bytes);
        answers(&f)
    };
    let cut = line_boundary(&bytes, (bytes.len() as f64 * 0.95) as usize);
    if let Some(problem) = check_cut(&bytes, cut, &whole) {
        panic!("{path}: cut at byte {cut}: {problem}");
    }
}
