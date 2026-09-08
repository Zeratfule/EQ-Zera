//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::{character_of, starter, ts_of, CountingSink, Event, EventSink, SinkReport};
use crate::world::World;
use protocol::generated::{EngineMessage, EpochReason, HealthResultStatus};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[test]
fn the_character_comes_off_the_products_own_file_name() {
    assert_eq!(
        character_of(Path::new("C:/EQ/Logs/eqlog_Primitive_freeport.txt")).as_deref(),
        Some("Primitive")
    );
    // The oracle corpus's slice form goes through eqlog's own rule.
    assert_eq!(
        character_of(Path::new("eqlog_Primitive_freeport.patch-week.txt")).as_deref(),
        Some("Primitive")
    );
    // A character name may hold an underscore; the server may not, so the last one splits.
    assert_eq!(
        character_of(Path::new("eqlog_Two_Names_freeport.txt")).as_deref(),
        Some("Two_Names")
    );
}

#[test]
fn a_file_name_that_is_not_a_log_names_nobody() {
    for name in [
        "notalog.txt",
        "eqlog_freeport.txt",
        "eqlog__freeport.txt",
        "eqlog_Primitive_.txt",
        "eqlog_Primitive_freeport.log",
        "eqlog_Primitive_freeport",
        ".txt",
    ] {
        assert!(character_of(Path::new(name)).is_none(), "{name}");
    }
}

#[test]
fn the_timestamp_is_read_back_out_of_the_serialized_event() {
    assert_eq!(
        ts_of(r#"{"kind":"unknown","seq":0,"ts":1787181707000,"raw":"[…]"}"#),
        Some(1_787_181_707_000)
    );
    // `group` is the one kind that writes a field ahead of the envelope.
    assert_eq!(
        ts_of(r#"{"kind":"group","change":"join","name":"Dranix","seq":3,"ts":17,"raw":"x"}"#),
        Some(17)
    );
    // A `raw` line that quotes the key cannot win: the envelope's copy comes first.
    assert_eq!(
        ts_of(r#"{"kind":"unknown","seq":0,"ts":5,"raw":"\"ts\":9999"}"#),
        Some(5)
    );
    assert_eq!(ts_of(r#"{"kind":"unknown"}"#), None);
}

#[test]
fn the_counting_sink_counts_events_and_remembers_the_logs_own_clock() {
    let mut sink = CountingSink::default();
    // The payload is not read here: a counting sink folds nothing and takes its clock off the
    // serialized half (`ts_of`). An empty payload is the honest stand-in.
    let empty = eqlog::event::Payload::default();
    for (seq, ts) in [(0, 100), (1, 200), (2, 300)] {
        sink.event(&Event {
            json: &format!(r#"{{"kind":"unknown","seq":{seq},"ts":{ts},"raw":"x"}}"#),
            payload: &empty,
            seq,
            live: false,
        });
    }
    let report = sink.report();
    assert_eq!(report.events, 3);
    assert_eq!(report.last_ts, Some(300));
}

#[test]
fn an_event_with_an_unreadable_stamp_still_counts() {
    let mut sink = CountingSink::default();
    let empty = eqlog::event::Payload::default();
    sink.event(&Event {
        json: r#"{"kind":"unknown","seq":0,"ts":7,"raw":"x"}"#,
        payload: &empty,
        seq: 0,
        live: false,
    });
    sink.event(&Event {
        json: r#"{"kind":"nonsense"}"#,
        payload: &empty,
        seq: 1,
        live: false,
    });
    assert_eq!(sink.report().events, 2);
    assert_eq!(
        sink.report().last_ts,
        Some(7),
        "the last stamp that could be read stands; a missing one is not a zero"
    );
}

// The ingest, over real bytes. The corpus is committed (`tests/fixtures/*.log`, scrubbed), so
// these run in CI, and every claim about what was folded is settled against
// `eqlog::scan::scan_bytes` over the same bytes rather than against a number typed here — the
// only way this suite is still right after a parser change.
//
// Nothing here waits for the clock: `settle` waits for a condition, and its deadline is a
// failure mechanism that turns a deadlock into a red test rather than a run that never returns.

/// How long any condition in this suite may take before the test is called hung.
const PATIENCE: Duration = Duration::from_secs(30);

/// The fixture these tests fold. A loadout-swap window: 459 KB of dense mixed traffic — combat,
/// casts, `/who`, zoning — which is what makes the event count worth comparing.
const FIXTURE: &str = "cw2-loadout-swap-aug2.log";

/// How many times the fixture is concatenated into the scratch log.
///
/// The properties under test only exist across read boundaries — a fold long enough to be
/// preempted mid-way, more than one progress cadence, a scan spanning several 1 MiB slices — so
/// the scratch copy is built big enough to have them. Repetition is sound because the parser
/// holds no state across lines: the oracle folds the same bytes.
const REPEATS: usize = 6;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("the crate is three levels below the repo root")
        .to_path_buf()
}

/// A scratch directory holding one log named the way the product names one, so the character
/// comes off the file name exactly as it does in the field.
struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Self {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "zengine-ingest-{}-{}-{tag}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("a scratch dir");
        Self(dir)
    }

    fn log(&self) -> PathBuf {
        self.0.join("eqlog_Primitive_freeport.txt")
    }

    /// Write the fixture into the scratch log, `REPEATS` times over.
    fn stage(&self) -> PathBuf {
        let source = repo_root().join("tests").join("fixtures").join(FIXTURE);
        let bytes = std::fs::read(&source)
            .unwrap_or_else(|e| panic!("the fixture at {} is readable: {e}", source.display()));
        let path = self.log();
        let mut out = std::fs::File::create(&path).expect("the scratch log");
        for _ in 0..REPEATS {
            out.write_all(&bytes).expect("the scratch log takes bytes");
        }
        out.flush().expect("flush");
        path
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ignored = std::fs::remove_dir_all(&self.0);
    }
}

/// Append one line the way EverQuest appends one: an open, a write, a flush.
fn append(path: &Path, line: &str) {
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .expect("the log takes an append");
    file.write_all(line.as_bytes()).expect("append");
    file.flush().expect("flush");
}

/// The oracle: what the proven scan finds in these exact bytes.
fn scan_oracle(path: &Path) -> i64 {
    let bytes = std::fs::read(path).expect("the log is readable");
    let character = character_of(path).expect("the scratch log names a character");
    let parser = eqlog::parser_for(&character, eqlog::host_timezone());
    i64::try_from(eqlog::scan::scan_bytes(
        &parser,
        &bytes,
        |_line, _payload| {},
    ))
    .expect("a count")
}

/// Wait for a condition, failing with `what` if it never holds.
///
/// It sleeps between looks rather than spinning: a spin takes a core away from the fold it is
/// waiting for, and under this suite's own parallelism that starved the tail thread past a
/// thirty-second deadline.
fn settle(what: &str, mut ready: impl FnMut() -> bool) {
    const LOOK_EVERY: Duration = Duration::from_millis(2);
    let deadline = Instant::now() + PATIENCE;
    while !ready() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(LOOK_EVERY);
    }
}

/// One event, as a test sink saw it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Taken {
    sink: usize,
    seq: i64,
    live: bool,
}

/// One heartbeat, as a test sink saw it. `events` is how many events that sink had folded when
/// the beat arrived, which is what makes "the scan never ticks" a checkable claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Beat {
    sink: usize,
    events: i64,
    now_ms: i64,
}

/// What every sink this factory builds writes into. One shared list, in the order events were
/// taken, so an interleaving would be visible rather than inferred.
#[derive(Default)]
struct Ledger {
    taken: Mutex<Vec<Taken>>,
    beats: Mutex<Vec<Beat>>,
    built: AtomicUsize,
}

impl Ledger {
    fn taken(&self) -> Vec<Taken> {
        self.taken
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    fn of(&self, sink: usize) -> Vec<Taken> {
        self.taken()
            .into_iter()
            .filter(|t| t.sink == sink)
            .collect()
    }

    fn beats_of(&self, sink: usize) -> Vec<Beat> {
        self.beats
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
            .copied()
            .filter(|b| b.sink == sink)
            .collect()
    }
}

/// A gate a sink stops at until a test opens it — the determinism trick of this suite: a fold
/// held at its first event is a fold a test can ask questions about without racing it.
#[derive(Default)]
struct Gate {
    open: Mutex<bool>,
    changed: Condvar,
}

impl Gate {
    fn wait(&self) {
        let mut open = self
            .open
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while !*open {
            open = self
                .changed
                .wait(open)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
    }

    fn release(&self) {
        *self
            .open
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
        self.changed.notify_all();
    }
}

/// A sink that records what it was handed, and optionally stops at a gate on its first event.
struct RecordingSink {
    id: usize,
    ledger: Arc<Ledger>,
    gate: Option<Arc<Gate>>,
    report: SinkReport,
}

impl EventSink for RecordingSink {
    fn event(&mut self, event: &Event<'_>) {
        self.report.events += 1;
        if event.live {
            self.report.live_events += 1;
        }
        self.report.last_seq = Some(event.seq);
        self.report.last_ts = ts_of(event.json);
        self.ledger
            .taken
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(Taken {
                sink: self.id,
                seq: event.seq,
                live: event.live,
            });
        // The gate is taken after the record, so a test can see that the fold reached its first
        // event and is now standing still.
        if let Some(gate) = self.gate.take() {
            gate.wait();
        }
    }

    /// Every beat, with the fold's own position beside it. Recording `events` is what turns
    /// "the historical scan never ticks" into an assertion: a beat taken mid-scan would carry a
    /// count short of the log's.
    fn tick(&mut self, now_ms: i64) {
        self.ledger
            .beats
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(Beat {
                sink: self.id,
                events: self.report.events,
                now_ms,
            });
    }

    fn report(&self) -> SinkReport {
        self.report
    }
}

/// A world whose attaches fold into recording sinks. The gate, when given, is handed to the
/// first sink only — the one whose fold a preemption test needs to hold still.
fn recording_world(ledger: &Arc<Ledger>, gate: Option<Arc<Gate>>) -> World {
    let ledger = Arc::clone(ledger);
    World::with_ingest(starter(Arc::new(move |_inputs| {
        let id = ledger.built.fetch_add(1, Ordering::SeqCst);
        Box::new(RecordingSink {
            id,
            ledger: Arc::clone(&ledger),
            gate: if id == 0 { gate.clone() } else { None },
            report: SinkReport::default(),
        })
    })))
}

/// Every seq a sink was handed, in order, starting at 0 and skipping nothing.
fn is_one_unbroken_fold(taken: &[Taken]) -> bool {
    taken
        .iter()
        .enumerate()
        .all(|(i, t)| t.seq == i64::try_from(i).expect("a seq"))
}

#[test]
fn an_attach_folds_the_whole_log_and_the_count_is_the_scans_own() {
    let scratch = Scratch::new("whole");
    let log = scratch.stage();
    let expected = scan_oracle(&log);
    let ledger = Arc::new(Ledger::default());
    let world = recording_world(&ledger, None);

    world.attach(&log.to_string_lossy(), None, eqlog::ZoneHint::default());
    settle("the fold to land", || {
        matches!(world.health().status, HealthResultStatus::Live)
    });

    let mark = world.mark();
    assert_eq!(
        mark.events, expected,
        "the ingest folds what the scan finds"
    );
    assert_eq!(
        mark.checkpoint,
        std::fs::metadata(&log).expect("the log").len(),
        "the fixture ends on a newline, so THE MARK reaches the last byte"
    );
    assert_eq!(mark.log.as_deref(), Some(log.as_path()));
    assert!(
        mark.last_ts.is_some(),
        "the log's own clock, not the host's"
    );

    let taken = ledger.of(0);
    assert_eq!(i64::try_from(taken.len()).expect("a count"), expected);
    assert!(is_one_unbroken_fold(&taken));
    assert!(
        taken.iter().all(|t| !t.live),
        "everything the scan folds is history"
    );
}

#[test]
fn a_second_attach_preempts_the_first_and_no_events_interleave() {
    let scratch = Scratch::new("preempt");
    let log = scratch.stage();
    let expected = scan_oracle(&log);
    let ledger = Arc::new(Ledger::default());
    let gate = Arc::new(Gate::default());
    let world = recording_world(&ledger, Some(Arc::clone(&gate)));
    let listener = world.join();
    // A real subscription over a registered source. The recording sink folds no modules, so
    // every window it cuts is empty — which is exactly the claim: one reset, naming the
    // generation that landed, whatever is (not) in it.
    world.open_subscription(
        listener.id,
        7,
        crate::views::validate(&protocol::generated::ViewDescriptor {
            source: "loot.ledger".to_owned(),
            filter: None,
            sort: Vec::new(),
            window: None,
        })
        .expect("loot.ledger is registered"),
    );

    // The first fold reaches its first event and stops there, holding the world.
    let first = world.attach(&log.to_string_lossy(), None, eqlog::ZoneHint::default());
    assert_eq!(*first.epoch, 2);
    settle("the first fold to reach its first event", || {
        !ledger.of(0).is_empty()
    });

    // The preemption. Last pick wins, and the pick that lost is still standing at the gate.
    let second = world.attach(&log.to_string_lossy(), None, eqlog::ZoneHint::default());
    assert_eq!(*second.epoch, 3, "the generation strictly increases");
    assert!(second.accepted);
    gate.release();

    settle("the winning fold to land", || {
        matches!(world.health().status, HealthResultStatus::Live) && world.mark().events == expected
    });

    let loser = ledger.of(0);
    let winner = ledger.of(1);
    assert!(
        !loser.is_empty() && i64::try_from(loser.len()).expect("a count") < expected,
        "the loser abandoned its fold: {} of {expected} events",
        loser.len()
    );
    assert!(
        is_one_unbroken_fold(&loser),
        "the loser's own stream is contiguous — no other fold reached its sink"
    );
    assert!(
        is_one_unbroken_fold(&winner),
        "the winner's own stream is contiguous — the loser's events reached no sink but its own"
    );
    assert_eq!(i64::try_from(winner.len()).expect("a count"), expected);

    // Exactly one fold-lands per winning attach: two bumps were announced, one reset arrived,
    // and it names the generation that landed.
    let mut bumps = Vec::new();
    let mut resets = Vec::new();
    while let Ok(message) = listener.inbox.try_recv() {
        match message {
            EngineMessage::EpochMessage(epoch) if matches!(epoch.reason, EpochReason::Attach) => {
                bumps.push(*epoch.epoch);
            }
            EngineMessage::ResetMessage(reset) => resets.push((*reset.id, *reset.epoch)),
            _ => {}
        }
    }
    assert_eq!(bumps, vec![2, 3]);
    assert_eq!(resets, vec![(7, 3)], "one reset, naming the winner");
}

mod more;
