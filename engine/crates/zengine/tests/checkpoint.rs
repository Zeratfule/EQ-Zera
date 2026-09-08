//! THE WARM START, END TO END (Z Engine, 2026-09-07): an attach with a state directory writes the
//! fold checkpoint at its landing; the next attach restores it, scans only what was appended, and
//! answers exactly what a cold fold over the whole log answers.

mod harness;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use harness::{attach_with_state, health, module_snapshot, Client, Engine};
use protocol::generated::{EngineMessage, HealthResultStatus, ReplyResult};
use serde_json::{json, Value};

const FIXTURE: &str = "cw2-loadout-swap-aug2.log";
const PATIENCE: Duration = Duration::from_secs(120);
/// Modules whose published state is a function of the log alone (no wall-clock ageing), so two
/// live engines over the same bytes publish the same thing.
const STEADY_MODULES: [&str; 7] = [
    "loot",
    "kills",
    "leveling",
    "roster",
    "character",
    "itemTiers",
    "classUnlocks",
];

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("the crate is three levels below the repo root")
        .to_path_buf()
}

struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "zengine-checkpoint-{}-{}-{tag}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("a scratch dir");
        Self(dir)
    }

    fn fixture() -> Vec<u8> {
        let source = repo_root().join("tests").join("fixtures").join(FIXTURE);
        std::fs::read(&source)
            .unwrap_or_else(|e| panic!("the fixture at {} is readable: {e}", source.display()))
    }

    fn write_log(&self, bytes: &[u8]) -> PathBuf {
        let path = self.0.join("eqlog_Primitive_freeport.txt");
        let mut out = std::fs::File::create(&path).expect("the scratch log");
        out.write_all(bytes).expect("the scratch log takes bytes");
        out.flush().expect("flush");
        path
    }

    fn append_log(&self, bytes: &[u8]) {
        let path = self.0.join("eqlog_Primitive_freeport.txt");
        let mut out = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .expect("the scratch log reopens");
        out.write_all(bytes).expect("append");
        out.flush().expect("flush");
    }

    fn state_dir(&self, name: &str) -> PathBuf {
        let dir = self.0.join(name);
        std::fs::create_dir_all(&dir).expect("a scratch state dir");
        dir
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ignored = std::fs::remove_dir_all(&self.0);
    }
}

fn skip(message: &EngineMessage) {
    assert!(
        matches!(
            message,
            EngineMessage::Reply(_)
                | EngineMessage::ErrorReply(_)
                | EngineMessage::EpochMessage(_)
                | EngineMessage::ResetMessage(_)
                | EngineMessage::ModuleChangedMessage(_)
        ),
        "nothing else belongs on this stream: {message:?}"
    );
}

fn ask_health(client: &mut Client, id: i64) -> protocol::generated::HealthResult {
    client.send(&health(id));
    loop {
        match client.recv() {
            EngineMessage::Reply(reply) if *reply.id == id => {
                let ReplyResult::HealthResult(result) = reply.result else {
                    panic!("session.health answers with a HealthResult");
                };
                return result;
            }
            other => skip(&other),
        }
    }
}

fn settle_live(client: &mut Client, id: &mut i64) -> protocol::generated::HealthResult {
    let deadline = Instant::now() + PATIENCE;
    loop {
        *id += 1;
        let result = ask_health(client, *id);
        if matches!(result.status, HealthResultStatus::Live) {
            return result;
        }
        assert!(Instant::now() < deadline, "the fold never went live");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn snapshot_of(client: &mut Client, id: i64, module: &str) -> Value {
    client.send(&module_snapshot(id, module));
    loop {
        match client.recv() {
            EngineMessage::Reply(reply) if *reply.id == id => {
                let ReplyResult::ModuleSnapshotResult(result) = reply.result else {
                    panic!("module.snapshot answers with a ModuleSnapshotResult");
                };
                return json!({ "seq": result.seq, "state": result.state });
            }
            other => skip(&other),
        }
    }
}

/// What a live engine answers about the log alone: the steady modules and the event count.
fn answers(client: &mut Client, id: &mut i64) -> Value {
    let live = settle_live(client, id);
    let mut modules = serde_json::Map::new();
    for m in STEADY_MODULES {
        *id += 1;
        modules.insert(m.to_owned(), snapshot_of(client, *id, m));
    }
    json!({ "events": live.events, "modules": modules })
}

fn attach(engine: &Engine, log: &Path, state_dir: Option<&Path>) -> Client {
    let mut client = engine.connected();
    let dir = state_dir.map(|d| d.to_string_lossy().into_owned());
    client.send(&attach_with_state(
        1,
        &log.to_string_lossy(),
        dir.as_deref(),
    ));
    client
}

fn said(engine: &Engine, needle: &str) -> bool {
    engine.diagnostics().iter().any(|l| l.contains(needle))
}

/// The first line boundary at or after `at`.
fn line_boundary(bytes: &[u8], at: usize) -> usize {
    bytes[at..]
        .iter()
        .position(|&b| b == b'\n')
        .map_or(bytes.len(), |i| at + i + 1)
}

#[test]
fn the_second_attach_restores_the_first_ones_landing_and_answers_the_same() {
    let scratch = Scratch::new("same");
    let bytes = Scratch::fixture();
    let log = scratch.write_log(&bytes);
    let state = scratch.state_dir("profile");

    let mut first = Engine::watched();
    let mut client = attach(&first, &log, Some(&state));
    let mut id = 100;
    let cold = answers(&mut client, &mut id);
    assert!(
        said(&first, "checkpoint: written"),
        "the landing wrote a checkpoint: {:?}",
        first.diagnostics()
    );
    let file = state
        .join("checkpoints")
        .join("eqlog_Primitive_freeport.txt.zck");
    assert!(
        file.is_file(),
        "the checkpoint file exists at {}",
        file.display()
    );
    drop(client);
    first.close_stdin_and_wait();

    let second = Engine::watched();
    let mut client = attach(&second, &log, Some(&state));
    let mut id = 200;
    let warm = answers(&mut client, &mut id);
    assert!(
        said(&second, "checkpoint: restored"),
        "the second attach restored: {:?}",
        second.diagnostics()
    );
    assert_eq!(
        warm, cold,
        "a restored engine answers what the cold one answered"
    );
}

#[test]
fn a_restored_engine_folds_what_was_appended_and_matches_a_cold_fold_of_the_whole_log() {
    let scratch = Scratch::new("appended");
    let bytes = Scratch::fixture();
    let cut = line_boundary(&bytes, bytes.len() * 3 / 5);
    let log = scratch.write_log(&bytes[..cut]);
    let state = scratch.state_dir("profile");

    let mut first = Engine::watched();
    let mut client = attach(&first, &log, Some(&state));
    let mut id = 100;
    let _head = answers(&mut client, &mut id);
    assert!(said(&first, "checkpoint: written"));
    drop(client);
    first.close_stdin_and_wait();

    scratch.append_log(&bytes[cut..]);

    let warm_engine = Engine::watched();
    let mut client = attach(&warm_engine, &log, Some(&state));
    let mut id = 200;
    let warm = answers(&mut client, &mut id);
    assert!(
        said(&warm_engine, "checkpoint: restored"),
        "{:?}",
        warm_engine.diagnostics()
    );

    let cold_engine = Engine::start();
    let mut client = attach(&cold_engine, &log, None);
    let mut id = 300;
    let cold = answers(&mut client, &mut id);
    assert_eq!(
        warm["events"], cold["events"],
        "every appended event was folded"
    );
    assert_eq!(
        warm, cold,
        "restore-then-continue answers what the whole fold answers"
    );
}

#[test]
fn a_changed_log_prefix_is_a_cold_fold() {
    let scratch = Scratch::new("changed");
    let bytes = Scratch::fixture();
    let log = scratch.write_log(&bytes);
    let state = scratch.state_dir("profile");

    let mut first = Engine::watched();
    let mut client = attach(&first, &log, Some(&state));
    let mut id = 100;
    let _cold = answers(&mut client, &mut id);
    drop(client);
    first.close_stdin_and_wait();

    // The same length, different bytes: a rolled log under the same name.
    let mut other = bytes.clone();
    let first_nl = line_boundary(&other, 0);
    other[..first_nl.saturating_sub(2)].fill(b'x');
    scratch.write_log(&other);

    let second = Engine::watched();
    let mut client = attach(&second, &log, Some(&state));
    let mut id = 200;
    let _again = answers(&mut client, &mut id);
    assert!(
        said(&second, "not used"),
        "a changed prefix refuses the checkpoint: {:?}",
        second.diagnostics()
    );
    assert!(!said(&second, "checkpoint: restored"));
}
