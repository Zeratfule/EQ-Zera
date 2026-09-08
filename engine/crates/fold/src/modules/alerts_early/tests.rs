//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::*;
use crate::modules::buff_timer_rows::RowKind;

/// A countdown row on a mob — the shape an early warning is measured against.
fn debuff_row(spell: &str, target: &str, started: i64, duration: Option<i64>) -> BuffTimerRow {
    BuffTimerRow {
        id: format!("cc|{}|{}", target.to_lowercase(), timer_name_key(spell)),
        kind: RowKind::Debuff,
        name: spell.to_owned(),
        cast_name: None,
        candidates: None,
        ambiguous: false,
        group: RowGroup::Target,
        target: Some(target.to_owned()),
        target_key: Some(target.to_lowercase()),
        inferred_target: false,
        started_ts: started,
        calms_target: false,
        mode: if duration.is_some() {
            TimerMode::Countdown
        } else {
            TimerMode::Elapsed
        },
        duration_ms: duration,
        count: None,
        caster: None,
    }
}

/// The same, on YOU — `group: self`, no target.
fn self_row(spell: &str, started: i64, duration: Option<i64>) -> BuffTimerRow {
    BuffTimerRow {
        id: format!("self|self|{}", timer_name_key(spell)),
        group: RowGroup::Zelf,
        target: None,
        target_key: None,
        ..debuff_row(spell, "unused", started, duration)
    }
}

fn ev(line: &str) -> Event<'static> {
    Event::from_json(line).expect("a JSON object")
}

/// A scheduler with no break-family def watching — every landing-path test.
struct NoWatchers;
impl BreakWatchers for NoWatchers {
    fn break_watchers(&self) -> Vec<(String, i64)> {
        Vec::new()
    }
    fn has_break_watchers(&self) -> bool {
        false
    }
    fn probe_break(&self, _: &str, _: &BuffTimerRow, _: i64) -> Option<(ArmedFire, String)> {
        None
    }
}

fn armed_fire(id: &str) -> ArmedFire {
    ArmedFire {
        alert_id: id.to_owned(),
        rule: "Mez landed".to_owned(),
        sound: "classic/ding".to_owned(),
        message: "a turmoil toad has been mesmerized.".to_owned(),
        // This suite is about the SCHEDULE; a warning's words ride the arm without the scheduler
        // ever reading them, and are proven where they are decided, in `alerts_rules`.
        captures: None,
        spell: None,
    }
}

fn arm(id: &str, sec: i64, target: Option<&str>, names: &[&str], ts: i64) -> EarlyWarnArm {
    EarlyWarnArm {
        sec,
        cooldown_key: id.to_owned(),
        subject: EarlyWarnSubject {
            target_key: target.map(str::to_owned),
            spell_names: names.iter().map(|n| (*n).to_owned()).collect(),
        },
        ts,
        fired: armed_fire(id),
    }
}

#[test]
fn the_deadline_is_the_rows_stated_end_minus_the_offset() {
    let row = debuff_row("Dazzle", "a turmoil toad", 1_000, Some(48_000));
    assert_eq!(early_warn_fire_at(&row, 10), Some(1_000 + 48_000 - 10_000));
    // A count-up row states no end, so silence is the answer rather than an invented duration.
    let up = debuff_row("Dazzle", "a turmoil toad", 1_000, None);
    assert_eq!(early_warn_fire_at(&up, 10), None);
}

#[test]
fn a_landing_is_tracked_by_the_newest_row_on_its_own_entity() {
    let rows = [
        debuff_row("Dazzle", "a turmoil toad", 1_000, Some(48_000)),
        debuff_row("Dazzle", "a fire giant", 5_000, Some(48_000)),
        debuff_row("Languid Pace", "a turmoil toad", 3_000, Some(60_000)),
    ];
    // The mob the line named, and the most recent landing on it.
    let subject = EarlyWarnSubject {
        target_key: Some("a turmoil toad".to_owned()),
        spell_names: Vec::new(),
    };
    assert_eq!(
        early_warn_row_for(&rows, &subject).map(|r| r.name.as_str()),
        Some("Languid Pace")
    );
    // …and a named subject narrows to the rows that answer to that name, older or not.
    let named = EarlyWarnSubject {
        target_key: Some("a turmoil toad".to_owned()),
        spell_names: vec!["Dazzle".to_owned()],
    };
    assert_eq!(
        early_warn_row_for(&rows, &named).map(|r| r.name.as_str()),
        Some("Dazzle")
    );
}

/// A subject whose names match nothing falls back to all of them, never to nothing: a row the
/// model resolved from the player's own cast history beats a DB-derived candidate list.
#[test]
fn an_unmatched_name_falls_back_to_the_entitys_rows() {
    let rows = [debuff_row("Dazzle", "a turmoil toad", 1_000, Some(48_000))];
    let subject = EarlyWarnSubject {
        target_key: Some("a turmoil toad".to_owned()),
        spell_names: vec!["Something Else Entirely".to_owned()],
    };
    assert!(early_warn_row_for(&rows, &subject).is_some());
}

/// A self landing and a mob landing are exclusive: the projection's `group` is exactly that
/// distinction, and an absent `target_key` means the player.
#[test]
fn a_self_subject_never_matches_a_mobs_row() {
    let rows = [debuff_row("Dazzle", "a turmoil toad", 1_000, Some(48_000))];
    assert!(early_warn_row_for(&rows, &EarlyWarnSubject::default()).is_none());
    let mine = [self_row("Clarity", 1_000, Some(60_000))];
    assert!(early_warn_row_for(&mine, &EarlyWarnSubject::default()).is_some());
}

/// A row with no stated end is not a candidate at all — the honesty law, at the entry point.
#[test]
fn a_count_up_row_is_never_the_row_a_landing_is_tracked_by() {
    let rows = [debuff_row("Dazzle", "a turmoil toad", 1_000, None)];
    let subject = EarlyWarnSubject {
        target_key: Some("a turmoil toad".to_owned()),
        spell_names: Vec::new(),
    };
    assert!(early_warn_row_for(&rows, &subject).is_none());
}

#[test]
fn an_arm_resolves_on_the_next_tick_and_speaks_at_its_deadline() {
    let mut early = EarlyWarnings::default();
    early.arm(arm("a1", 10, Some("a turmoil toad"), &["Dazzle"], 1_000));
    let rows = [debuff_row("Dazzle", "a turmoil toad", 1_000, Some(48_000))];

    // The resolve tick: the row exists now, so the arm attaches — and says nothing, because the
    // deadline is 38 seconds away.
    assert!(early.tick(2_000, &rows, &NoWatchers).is_empty());
    assert!(!early.idle(), "the warning is armed and waiting");

    // …and one second before the deadline it is still silent.
    assert!(early.tick(38_000, &rows, &NoWatchers).is_empty());

    // At the deadline it speaks, exactly once, and the schedule is then empty.
    let due = early.tick(39_000, &rows, &NoWatchers);
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].fired.alert_id, "a1");
    assert_eq!(due[0].cooldown_key, "a1");
    assert!(early.idle(), "a warning that spoke is spent");
}

/// No row, no warning. Every ending removes the row, so this file needs no list of endings and
/// cannot drift from the model that has one.
#[test]
fn a_warning_whose_row_has_gone_is_cancelled_rather_than_fired() {
    let mut early = EarlyWarnings::default();
    early.arm(arm("a1", 10, Some("a turmoil toad"), &["Dazzle"], 1_000));
    let rows = [debuff_row("Dazzle", "a turmoil toad", 1_000, Some(48_000))];
    early.tick(2_000, &rows, &NoWatchers);
    assert!(!early.idle());
    // The row is gone. Long past the deadline, nothing speaks.
    assert!(early.tick(99_000, &[], &NoWatchers).is_empty());
    assert!(early.idle());
}

/// The deadline is re-read every tick, because both halves move: the learner can raise an
/// estimate mid-hold, and a re-land moves `started_ts`.
#[test]
fn a_re_stated_duration_moves_the_deadline_under_a_live_warning() {
    let mut early = EarlyWarnings::default();
    early.arm(arm("a1", 10, Some("a turmoil toad"), &["Dazzle"], 1_000));
    let short = [debuff_row("Dazzle", "a turmoil toad", 1_000, Some(48_000))];
    early.tick(2_000, &short, &NoWatchers);
    // The learner beats the floor: the same row now states 90 s, so the moment that WOULD have
    // been due passes in silence.
    let long = [debuff_row("Dazzle", "a turmoil toad", 1_000, Some(90_000))];
    assert!(early.tick(39_000, &long, &NoWatchers).is_empty());
    assert_eq!(early.tick(81_000, &long, &NoWatchers).len(), 1);
}

/// An offset longer than the debuff fires at once: as early as the spell allows, rather than
/// silently never arriving.
#[test]
fn an_overlong_offset_speaks_on_the_first_tick_it_can() {
    let mut early = EarlyWarnings::default();
    early.arm(arm("a1", 30, Some("a turmoil toad"), &["Dazzle"], 1_000));
    let rows = [debuff_row("Dazzle", "a turmoil toad", 1_000, Some(24_000))];
    assert_eq!(early.tick(2_000, &rows, &NoWatchers).len(), 1);
}

/// An arm that never finds a row is dropped: the model states no countdown for that landing,
/// so there is no honest end to count back from.
#[test]
fn an_arm_that_finds_no_row_is_dropped_at_the_window() {
    let mut early = EarlyWarnings::default();
    early.arm(arm("a1", 10, Some("a turmoil toad"), &["Dazzle"], 1_000));
    // Still looking, inside the window.
    early.tick(1_000 + ARM_RESOLVE_WINDOW_MS, &[], &NoWatchers);
    assert!(!early.idle());
    // Past it, forgotten.
    early.tick(1_000 + ARM_RESOLVE_WINDOW_MS + 1, &[], &NoWatchers);
    assert!(early.idle());
}

mod more;
