//! The spell-lockout timers on the `buffTimers` snapshot: one per landing burst of YOUR spell, live
//! tail only, rank-blind, never from a resist, another caster or a quoted line.

use fold::event::Event;
use fold::{registered, ClusterDeps, Fold};
use serde_json::{json, Value};

const ZONE: &str = "[Fri Nov 27 18:30:00 2026] You have entered Kael Drakkel.";
const CAST: &str = "[Fri Nov 27 18:31:48 2026] You begin singing Denon's Desperate Dirge VII.";
const HIT_A: &str = "[Fri Nov 27 18:31:50 2026] You hit an ice giant for 1395 points of magic damage by Denon's Desperate Dirge VII.";
const HIT_B: &str = "[Fri Nov 27 18:31:50 2026] You hit an ice giant for 1395 points of magic damage by Denon's Desperate Dirge VII.";
const HIT_CRIT: &str = "[Fri Nov 27 18:31:50 2026] You hit an ice giant magus for 4129 points of magic damage by Denon's Desperate Dirge VII. (Critical)";
const HIT_NEXT_SECOND: &str = "[Fri Nov 27 18:31:51 2026] You hit a priest of Nagafen for 1395 points of magic damage by Denon's Desperate Dirge VII.";
const HIT_UNRANKED: &str = "[Fri Nov 27 18:32:15 2026] You hit an icy terror for 1395 points of magic damage by Denon's Desperate Dirge.";
const RESIST: &str =
    "[Fri Nov 27 18:31:50 2026] A spite golem resisted your Denon's Desperate Dirge VII!";
const OTHER_BARD: &str = "[Fri Nov 27 18:31:50 2026] Gwythain hit a spite golem for 1395 points of magic damage by Denon's Desperate Dirge.";
const SPOOF: &str = "[Fri Nov 27 18:31:50 2026] Gwythain tells you, 'You hit a spite golem for 1395 points of magic damage by Denon's Desperate Dirge.'";
const OTHER_SPELL: &str = "[Fri Nov 27 18:31:50 2026] You hit an ice giant for 900 points of fire damage by Chords of Dissonance.";

fn parser() -> eqlog::Parser {
    eqlog::Parser::new(
        eqlog::Clock::new(eqlog::host_timezone()),
        None,
        Some("Zeratfule".to_string()),
    )
}

fn fold() -> Fold {
    Fold::new(registered(ClusterDeps::default()), i64::MAX)
}

fn feed(f: &mut Fold, p: &eqlog::Parser, raw: &str, live: bool) {
    let mut ev = eqlog::event::Ev::new();
    assert!(p.parse_event(raw, 1, &mut ev), "not a log line: {raw}");
    let json = ev.finish().to_string();
    f.on_primary(&Event::from_json(&json).expect("a JSON event"), live);
}

fn lockouts(f: &Fold) -> Vec<Value> {
    let snap = f.registry.snapshot_of("buffTimers").expect("registered");
    snap["state"]["lockouts"]["active"]
        .as_array()
        .expect("an array")
        .clone()
}

#[test]
fn the_rule_table_is_published_even_before_anything_lands() {
    let f = fold();
    let snap = f.registry.snapshot_of("buffTimers").expect("registered");
    assert_eq!(
        snap["state"]["lockouts"]["rules"],
        json!([{"spell": "Denon's Desperate Dirge", "earliestMs": 12_000, "certainMs": 18_000}])
    );
    assert_eq!(snap["state"]["lockouts"]["active"], json!([]));
}

fn seq(f: &Fold) -> i64 {
    f.registry.snapshot_of("buffTimers").expect("registered")["seq"]
        .as_i64()
        .expect("a seq")
}

#[test]
fn one_burst_on_several_targets_is_one_timer() {
    let (p, mut f) = (parser(), fold());
    for line in [ZONE, CAST, HIT_A, HIT_B, HIT_CRIT, HIT_NEXT_SECOND] {
        feed(&mut f, &p, line, true);
    }
    let rows = lockouts(&f);
    assert_eq!(rows.len(), 1, "{rows:?}");
    let row = &rows[0];
    assert_eq!(row["spell"], json!("Denon's Desperate Dirge"));
    assert_eq!(row["castName"], json!("Denon's Desperate Dirge VII"));
    assert_eq!(row["earliestMs"], json!(12_000));
    assert_eq!(row["certainMs"], json!(18_000));
    assert_eq!(row["count"], json!(4));
    assert_eq!(
        row["targets"],
        json!([
            {"name": "an ice giant", "count": 2},
            {"name": "an ice giant magus", "count": 1},
            {"name": "a priest of Nagafen", "count": 1}
        ])
    );
    // The first landing line's stamp, not the cast line's and not the later straggler's.
    let mut ev = eqlog::event::Ev::new();
    p.parse_event(HIT_A, 1, &mut ev);
    let first = Event::from_json(ev.finish()).expect("json").ts();
    assert_eq!(row["startedTs"], json!(first));
}

#[test]
fn a_landing_without_a_rank_suffix_counts_and_a_later_cast_is_a_second_timer() {
    let (p, mut f) = (parser(), fold());
    feed(&mut f, &p, HIT_A, true);
    feed(&mut f, &p, HIT_UNRANKED, true);
    let rows = lockouts(&f);
    assert_eq!(rows.len(), 2, "{rows:?}");
    assert_eq!(rows[1]["castName"], json!("Denon's Desperate Dirge"));
    assert_eq!(rows[1]["spell"], json!("Denon's Desperate Dirge"));
}

/// A killing blow prints the bare name and often lands first; the burst still learns the rank.
#[test]
fn an_unranked_killing_blow_first_in_a_burst_still_ends_up_ranked_and_counted() {
    let (p, mut f) = (parser(), fold());
    let kill = "[Fri Nov 27 18:31:50 2026] You hit an icy terror for 1395 points of magic damage by Denon's Desperate Dirge.";
    let slain = "[Fri Nov 27 18:31:50 2026] You have slain an icy terror!";
    for line in [kill, slain, HIT_A, HIT_CRIT] {
        feed(&mut f, &p, line, true);
    }
    let rows = lockouts(&f);
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert_eq!(rows[0]["castName"], json!("Denon's Desperate Dirge VII"));
    assert_eq!(rows[0]["count"], json!(3));
    assert_eq!(
        rows[0]["targets"][0],
        json!({"name": "an icy terror", "count": 1})
    );
}

/// A clock set back (DST fall-back) must not silence a new session until stamps pass the old max;
/// within a session the re-read guard still holds.
#[test]
fn a_new_session_on_a_clock_set_back_still_locks() {
    let (p, mut f) = (parser(), fold());
    feed(&mut f, &p, HIT_UNRANKED, true);
    let welcome = "[Fri Nov 27 17:40:00 2026] Welcome to EverQuest Legends!";
    feed(&mut f, &p, welcome, true);
    assert!(lockouts(&f).is_empty(), "a new session clears");
    let earlier = "[Fri Nov 27 17:40:05 2026] You hit an ice giant for 1395 points of magic damage by Denon's Desperate Dirge VII.";
    feed(&mut f, &p, earlier, true);
    assert_eq!(
        lockouts(&f).len(),
        1,
        "landed after the set-back clock's welcome"
    );
    // …and a re-read older than that session's newest line is still refused.
    let reread = "[Fri Nov 27 17:40:01 2026] You hit a priest of Nagafen for 1395 points of magic damage by Denon's Desperate Dirge VII.";
    feed(&mut f, &p, reread, true);
    assert_eq!(lockouts(&f).len(), 1);
    assert_eq!(lockouts(&f)[0]["count"], json!(1));
}

#[test]
fn a_resist_another_bard_a_quoted_line_and_another_spell_lock_nothing() {
    let (p, mut f) = (parser(), fold());
    feed(&mut f, &p, ZONE, true);
    let before = seq(&f);
    for line in [RESIST, OTHER_BARD, SPOOF, OTHER_SPELL] {
        feed(&mut f, &p, line, true);
    }
    assert!(lockouts(&f).is_empty(), "{:?}", lockouts(&f));
    assert_eq!(seq(&f), before, "nothing published moved");
}

#[test]
fn a_backfilled_landing_starts_nothing() {
    let (p, mut f) = (parser(), fold());
    for line in [ZONE, CAST, HIT_A, HIT_B] {
        feed(&mut f, &p, line, false);
    }
    assert!(lockouts(&f).is_empty());
    // A truncated log re-emits its survivors through the live tail; older than the newest line
    // folded, they are not now.
    feed(&mut f, &p, HIT_UNRANKED, false);
    feed(&mut f, &p, HIT_A, true);
    assert!(lockouts(&f).is_empty());
}

#[test]
fn a_zone_line_drops_every_timer_and_the_revision_moves_both_ways() {
    let (p, mut f) = (parser(), fold());
    feed(&mut f, &p, CAST, true);
    let before = seq(&f);
    feed(&mut f, &p, HIT_A, true);
    let landed = seq(&f);
    assert!(landed > before);
    feed(
        &mut f,
        &p,
        "[Fri Nov 27 18:31:55 2026] You have entered Kael Drakkel.",
        true,
    );
    assert!(lockouts(&f).is_empty());
    assert!(seq(&f) > landed);
}

#[test]
fn a_checkpoint_never_carries_a_timer() {
    let (p, mut f) = (parser(), fold());
    feed(&mut f, &p, HIT_A, true);
    assert_eq!(lockouts(&f).len(), 1);
    let ck = f.checkpoint().expect("a checkpoint");
    let mut g = fold();
    g.restore(&ck).expect("restores");
    assert!(lockouts(&g).is_empty());
}
