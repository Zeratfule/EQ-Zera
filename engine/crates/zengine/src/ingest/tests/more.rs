//! The second half of the unit tests (split so each file stays under the factoring line).

use super::*;

#[test]
fn the_health_states_walk_starting_attaching_folding_live() {
    let scratch = Scratch::new("walk");
    let log = scratch.stage();
    let ledger = Arc::new(Ledger::default());
    let gate = Arc::new(Gate::default());

    // The walk's first step is observed from inside the attach, before the ingest thread can
    // possibly have run: the starter is called after the epoch's critical section and before
    // anything else exists.
    let observed_starting = Arc::new(Mutex::new(false));
    let seen = Arc::clone(&observed_starting);
    let held = Arc::clone(&gate);
    let world = World::with_ingest(Arc::new(move |world, generation, attach| {
        *seen
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            matches!(world.health().status, HealthResultStatus::Starting);
        let ledger = Arc::clone(&ledger);
        let held = Arc::clone(&held);
        super::super::start(
            world,
            generation,
            attach,
            Arc::new(move |_inputs| {
                Box::new(RecordingSink {
                    id: 0,
                    ledger: Arc::clone(&ledger),
                    gate: Some(Arc::clone(&held)),
                    report: SinkReport::default(),
                })
            }),
        );
    }));

    world.attach(&log.to_string_lossy(), None, eqlog::ZoneHint::default());
    assert!(
        *observed_starting
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        "an accepted attach is `starting` before its ingest exists"
    );

    // Attaching is the window in which the log is opened and the parse's inputs are built. It
    // is wide — the spell DB is the whole committed corpus and takes seconds to build in a
    // debug build — so a sampler looking every couple of milliseconds cannot miss it.
    settle("the ingest to report `attaching`", || {
        matches!(world.health().status, HealthResultStatus::Attaching)
    });
    // Folding is deterministic: the sink is holding the first event at the gate, so the scan
    // cannot finish until this test lets it.
    settle("the scan to start", || {
        matches!(world.health().status, HealthResultStatus::Folding)
    });
    gate.release();
    settle("the tail to take over", || {
        matches!(world.health().status, HealthResultStatus::Live)
    });
}

/// The scan never ticks, held still so the claim is a fact rather than a race.
///
/// The sink stops at the gate on its first event, so the fold is provably mid-scan and standing
/// there for as long as this test likes. `folding` is asserted first so that "no beats yet"
/// cannot pass by being taken before the ingest thread ever started.
#[test]
fn a_historical_scan_is_never_ticked() {
    let scratch = Scratch::new("noticks");
    let log = scratch.stage();
    let ledger = Arc::new(Ledger::default());
    let gate = Arc::new(Gate::default());
    let world = recording_world(&ledger, Some(Arc::clone(&gate)));

    world.attach(&log.to_string_lossy(), None, eqlog::ZoneHint::default());
    settle("the scan to reach its first event", || {
        !ledger.of(0).is_empty()
    });
    assert!(matches!(world.health().status, HealthResultStatus::Folding));
    // A whole tick interval and more, spent inside the scan. No cadence would have let a beat
    // through, because the tick loop lives past the tail handoff entirely.
    std::thread::sleep(super::super::TICK_EVERY + super::super::TICK_EVERY / 2);
    assert!(
        ledger.beats_of(0).is_empty(),
        "a scan was ticked: {:?}",
        ledger.beats_of(0)
    );
    gate.release();
}

/// A live world has already been aged by the time anybody can see it is live.
///
/// The ordering is the point, and it is why the go-live beat is taken before
/// `report_fold_landed`: `status: "live"` is the edge every client waits on, so a beat taken
/// after the publish would leave a window in which the engine served an unswept world.
#[test]
fn the_world_is_ticked_before_it_is_published_as_live() {
    let scratch = Scratch::new("golive");
    let log = scratch.stage();
    let expected = scan_oracle(&log);
    let ledger = Arc::new(Ledger::default());
    let world = recording_world(&ledger, None);

    world.attach(&log.to_string_lossy(), None, eqlog::ZoneHint::default());
    settle("the fold to land", || {
        matches!(world.health().status, HealthResultStatus::Live)
    });
    let beats = ledger.beats_of(0);
    assert!(
        !beats.is_empty(),
        "a client that saw `live` would have seen an unswept world"
    );
    // Every beat is past the whole scan — the gated test's claim from the other side: a beat
    // carrying a short count would be a tick inside the historical fold.
    for beat in &beats {
        assert_eq!(
            beat.events, expected,
            "a beat landed mid-scan: {beat:?} of {expected}"
        );
        // …and the number handed in is a wall clock, not a log timestamp: within a minute of
        // this test's own reading of it. Loose enough never to be flaky, tight enough that a
        // log's `ts` could not pass it.
        assert!(
            (beat.now_ms - super::super::wall_clock_ms()).abs() < 60_000,
            "{beat:?} is not this machine's clock"
        );
    }
}

/// …and it keeps beating, at the app's own interval, on a log nobody is writing to.
///
/// The heartbeat exists precisely for the idle log — a buff whose duration ran out while the
/// player stared at a quiet screen — so "it beats while nothing arrives" is the claim.
#[test]
fn a_live_world_keeps_beating_while_the_log_is_idle() {
    let scratch = Scratch::new("beating");
    let log = scratch.stage();
    let ledger = Arc::new(Ledger::default());
    let world = recording_world(&ledger, None);

    world.attach(&log.to_string_lossy(), None, eqlog::ZoneHint::default());
    settle("the fold to land", || {
        matches!(world.health().status, HealthResultStatus::Live)
    });
    settle("a second beat", || ledger.beats_of(0).len() >= 2);
    let beats = ledger.beats_of(0);
    assert!(
        beats.windows(2).all(|w| w[1].now_ms >= w[0].now_ms),
        "the clock went backwards: {beats:?}"
    );
    // The cadence is a ceiling, so the gap is at least the interval and never twice per turn.
    // Measured against the beats' own numbers rather than the test's wall clock.
    let gap = beats[1].now_ms - beats[0].now_ms;
    let interval = i64::try_from(super::super::TICK_EVERY.as_millis()).expect("an interval");
    assert!(
        gap >= interval - 50,
        "two beats {gap} ms apart, faster than the {interval} ms cadence"
    );
}

#[test]
fn a_line_appended_after_the_fold_lands_arrives_live_through_the_same_sink() {
    let scratch = Scratch::new("append");
    let log = scratch.stage();
    let scanned = scan_oracle(&log);
    let ledger = Arc::new(Ledger::default());
    let world = recording_world(&ledger, None);

    world.attach(&log.to_string_lossy(), None, eqlog::ZoneHint::default());
    settle("the fold to land", || {
        matches!(world.health().status, HealthResultStatus::Live)
    });
    let mark_before = world.mark().checkpoint;

    // The game writes a line. Two of them: one the parser types, one it files as `unknown` —
    // both are events, and the tail is a byte-level reader with no opinion about either.
    let appended = "[Wed Aug 19 16:21:54 2026] You gain experience! (3.288%)\n\
                    [Wed Aug 19 16:21:55 2026] You are not currently assigned to an adventure.\n";
    append(&log, appended);

    settle("the appended lines to arrive", || {
        world.mark().events == scanned + 2
    });
    let mark_after = world.mark().checkpoint;
    assert_eq!(
        mark_after - mark_before,
        u64::try_from(appended.len()).expect("a length"),
        "THE MARK advanced by exactly the bytes the game wrote"
    );

    let taken = ledger.of(0);
    assert!(
        is_one_unbroken_fold(&taken),
        "the seq continues across the seam"
    );
    let live: Vec<i64> = taken.iter().filter(|t| t.live).map(|t| t.seq).collect();
    assert_eq!(
        live,
        vec![scanned, scanned + 1],
        "the two live events follow the scan's last seq, through the same sink"
    );
}

#[test]
fn a_half_written_line_is_not_an_event_until_the_game_finishes_it() {
    let scratch = Scratch::new("partial");
    let log = scratch.stage();
    let scanned = scan_oracle(&log);
    let ledger = Arc::new(Ledger::default());
    let world = recording_world(&ledger, None);

    world.attach(&log.to_string_lossy(), None, eqlog::ZoneHint::default());
    settle("the fold to land", || {
        matches!(world.health().status, HealthResultStatus::Live)
    });
    let mark_before = world.mark().checkpoint;

    append(&log, "[Wed Aug 19 16:21:54 2026] You gain exp");
    // Nothing to settle on — this is an absence. Waiting out poll intervals of the tail is what
    // makes the claim mean something, and it is the one place in this suite that waits on a
    // clock.
    std::thread::sleep(super::super::DEFAULT_POLL_INTERVAL * 3);
    assert_eq!(world.mark().events, scanned, "half a line is not a line");
    assert_eq!(
        world.mark().checkpoint,
        mark_before,
        "and THE MARK waits with it"
    );

    append(&log, "erience! (3.288%)\n");
    settle("the finished line to arrive", || {
        world.mark().events == scanned + 1
    });
}

#[test]
fn an_attach_the_engine_cannot_open_leaves_the_world_idle_with_its_epoch_intact() {
    let scratch = Scratch::new("missing");
    let missing = scratch.0.join("eqlog_Nobody_freeport.txt");
    let ledger = Arc::new(Ledger::default());
    let world = recording_world(&ledger, None);

    let result = world.attach(&missing.to_string_lossy(), None, eqlog::ZoneHint::default());
    assert!(
        result.accepted,
        "an attach is accepted at the moment it wins, not when the file proves readable"
    );
    settle("the ingest to give up", || {
        matches!(world.health().status, HealthResultStatus::Idle)
    });
    assert_eq!(
        *world.health().epoch,
        2,
        "a fold that could not start bumps nothing back"
    );
    assert!(ledger.taken().is_empty());
}
