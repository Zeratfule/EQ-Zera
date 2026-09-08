//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::{RespawnModule, RespawnPrefs, RespawnRow, RespawnWatchPref};
use crate::event::Event;
use crate::EqModule;

/// The zone line the stay begins with. Every timestamp below is derived from this one, so the
/// arithmetic in the assertions reads instead of being a set of magic epochs.
const T_ZONE: i64 = 1_787_181_000_000;
/// The kill that starts the clock — a minute into the stay.
const T_DEATH: i64 = T_ZONE + 60_000;
/// The line that names the mob again, two minutes after it died. It moves no clock on its own.
const T_SEEN: i64 = T_DEATH + 120_000;
/// Ten seconds later — where the ordering clock stands while the assertions read rows.
const NOW: i64 = T_SEEN + 10_000;

/// The user's own number, so the estimate ladder answers `custom` and the countdown is a round
/// minute.
const CUSTOM_SEC: i64 = 60;

fn watching_the_knight() -> RespawnPrefs {
    RespawnPrefs {
        watches: vec![RespawnWatchPref {
            key: "a vis ghoul knight".to_owned(),
            display: "a vis ghoul knight".to_owned(),
            custom_sec: Some(CUSTOM_SEC),
        }],
    }
}

fn ev(json: &str) -> Event<'static> {
    Event::from_json(json).expect("a JSON object")
}

fn zone(ts: i64) -> String {
    format!(r#"{{"kind":"zone","seq":0,"ts":{ts},"raw":"z","zone":"The Ruins of Old Guk"}}"#)
}

fn death(seq: i64, ts: i64) -> String {
    format!(
        r#"{{"kind":"death","seq":{seq},"ts":{ts},"raw":"d","name":"a vis ghoul knight","bySelf":true}}"#
    )
}

/// `<Mob> hits YOU for N points of damage.` — the shape the e2e plays.
fn hits_you(seq: i64, ts: i64) -> String {
    format!(
        r#"{{"kind":"damage","seq":{seq},"ts":{ts},"raw":"h","attacker":"a vis ghoul knight","target":"You","amount":106}}"#
    )
}

/// A module standing in Old Guk, one kill deep, with the mob seen alive since.
fn seen_after_a_kill() -> RespawnModule {
    let mut m = RespawnModule::new(NOW, watching_the_knight());
    m.on_event(&ev(&zone(T_ZONE)), false);
    m.on_event(&ev(&death(1, T_DEATH)), false);
    m.on_event(&ev(&hits_you(2, T_SEEN)), true);
    m
}

fn only_row(m: &RespawnModule) -> RespawnRow {
    let mut rows = m.watch_rows(NOW);
    assert_eq!(rows.len(), 1, "the watch list has exactly one mob in it");
    rows.remove(0)
}

#[test]
fn confirming_a_sighting_re_bases_the_clock_and_says_that_is_what_happened() {
    // The app never does this by itself: the fixture lit the row with a combat line naming a
    // watched mob and the clock did not move, and this call is the person confirming it.
    let mut m = seen_after_a_kill();

    let before = only_row(&m);
    assert_eq!(before.basis, "death", "evidence alone touches no clock");
    assert_eq!(before.base_ts, T_DEATH);
    assert_eq!(before.seen_ts, Some(T_SEEN));
    let rev_before = m.revision();

    assert!(m.confirm_sighting(&before.id));

    let after = only_row(&m);
    assert!(
        m.revision() > rev_before,
        "a confirmation must advance the module revision too — it advances no log seq"
    );
    assert_eq!(
        after.base_ts, T_SEEN,
        "the clock now counts from the sighting"
    );
    assert_eq!(after.basis, "sighting");
    // The row leaves the seen state, because the evidence is now AT the base rather than after
    // it. Fresh evidence will mark it again, which is correct: it is up.
    assert_eq!(after.seen_ts, None);
    assert_eq!(after.seen_via, None);
    // A confirmation is not a death and never a gap sample, so the ladder learned nothing.
    assert_eq!(after.samples, 0);
    assert_eq!(after.kills, 1);
    assert_eq!(after.estimate_ms, Some(CUSTOM_SEC * 1000));
    assert_eq!(after.source, "custom");
}

#[test]
fn a_kill_of_the_seen_mob_resumes_the_normal_death_driven_clock() {
    // The later of (death, confirmation) wins by arithmetic, so the next kill takes the base
    // back with no code anywhere that undoes a confirmation.
    let mut m = seen_after_a_kill();
    let id = only_row(&m).id;
    assert!(m.confirm_sighting(&id));
    assert_eq!(only_row(&m).basis, "sighting");

    let t_second_death = T_DEATH + 420_000;
    m.on_event(&ev(&death(3, t_second_death)), true);

    let row = only_row(&m);
    assert_eq!(row.basis, "death");
    assert_eq!(row.base_ts, t_second_death);
    assert_eq!(row.kills, 2);
    assert_eq!(row.seen_ts, None);
    // The gap is measured between the two deaths, never from the confirmation.
    assert_eq!(row.samples, 1);
    assert_eq!(row.observed_ms, Some(420_000));
}

#[test]
fn a_confirmation_with_nothing_to_confirm_is_refused_rather_than_invented() {
    // Neither refusal may move a clock, and neither may move the revision — a push carrying no
    // change would make every dedupe downstream a lie.
    let mut m = RespawnModule::new(NOW, watching_the_knight());
    m.on_event(&ev(&zone(T_ZONE)), false);
    m.on_event(&ev(&death(1, T_DEATH)), false);

    let row = only_row(&m);
    let rev = m.revision();
    assert!(
        !m.confirm_sighting(&row.id),
        "the row is due, but nothing has been seen"
    );
    assert!(!m.confirm_sighting("no such row"));
    assert_eq!(m.revision(), rev, "a refusal publishes nothing");
    assert_eq!(only_row(&m).basis, "death");
}
