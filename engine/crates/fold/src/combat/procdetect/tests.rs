//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::*;

/// One cast explains one firing: a landing at a later instant is a proc, and every landing at
/// the same instant still joins the cast (the AoE / lifetap case).
#[test]
fn a_cast_record_explains_one_instant_and_no_later_one() {
    let mut r = RecentCasts::new();
    r.note("Anarchy", 1_000);
    assert_eq!(r.origin("Anarchy", 1_000), CastVerdict::Cast);
    assert_eq!(r.origin("Anarchy", 1_000), CastVerdict::Cast);
    assert_eq!(r.origin("Anarchy", 2_000), CastVerdict::Proc);
}

/// The window is closed at both ends: a future cast is no cast at all.
#[test]
fn a_cast_outside_the_window_explains_nothing() {
    let mut r = RecentCasts::new();
    r.note("Anarchy", 20_000);
    assert_eq!(
        r.origin("Anarchy", 20_000 + PROC_CAST_WINDOW_MS + 1),
        CastVerdict::Proc
    );
    assert_eq!(r.origin("Anarchy", 19_000), CastVerdict::Proc);
}

/// A fizzle drops its record; a recovered interrupt gets it back with its original cast ts.
#[test]
fn forget_drops_an_unclaimed_record_and_resume_restores_it() {
    let mut r = RecentCasts::new();
    r.note("Siphon Life", 1_000);
    r.forget("Siphon Life");
    r.resume();
    assert_eq!(
        r.origin("Siphon Life", 1_000 + PROC_CAST_WINDOW_MS),
        CastVerdict::Cast
    );
    // …and a record that already explained a firing is not dropped, so the rest of that
    // instant's lines can still join after a mid-burst resist.
    r.note("Earthquake", 5_000);
    assert_eq!(r.origin("Earthquake", 5_000), CastVerdict::Cast);
    r.forget("Earthquake");
    assert_eq!(r.origin("Earthquake", 5_000), CastVerdict::Cast);
}

/// Rank-normalized at the counting boundary: the cast prints the numeral, the landing does not.
#[test]
fn the_join_is_rank_blind() {
    let mut r = RecentCasts::new();
    r.note("Swift Like the Wind I", 1_000);
    assert_eq!(r.origin("Swift Like the Wind", 1_000), CastVerdict::Cast);
}

/// The rain gate refuses a wave outright, whatever the cast ledger says.
#[test]
fn a_rain_wave_is_never_eligible() {
    assert!(proc_eligible_damage("spell", "Anarchy"));
    assert!(!proc_eligible_damage("spell", "Rain of Fire"));
    assert!(!proc_eligible_damage("dot", "Anarchy"));
}

/// An empty held set is the identity function — no lane name moves without a dump.
#[test]
fn the_clicky_promotion_needs_the_dump() {
    let empty: HashSet<String> = HashSet::new();
    assert_eq!(
        castless_kind(CastVerdict::Proc, "Firestrike", &empty),
        SpellOrigin::Proc
    );
    let held: HashSet<String> = [spell_canon_key("Firestrike")].into_iter().collect();
    assert_eq!(
        castless_kind(CastVerdict::Proc, "Firestrike", &held),
        SpellOrigin::Click
    );
    // …and a cast is never promoted.
    assert_eq!(
        castless_kind(CastVerdict::Cast, "Firestrike", &held),
        SpellOrigin::Cast
    );
}

/// The lane count is `max`, never the sum — one tap firing prints two lines.
#[test]
fn a_tap_that_prints_both_sides_counts_each_firing_once() {
    let mut lanes: JsMap<SpellProcLane> = JsMap::new();
    let active: HashSet<String> = ["invocation:spellblade".to_string()].into_iter().collect();
    for _ in 0..12 {
        add_spell_proc(
            &mut lanes,
            &SpellProcFold {
                spell: "Lifetap Strike",
                side: ProcSide::Damage,
                amount: Some(10),
                active: &active,
                click: false,
            },
        );
        add_spell_proc(
            &mut lanes,
            &SpellProcFold {
                spell: "Lifetap Strike",
                side: ProcSide::Heal,
                amount: Some(9),
                active: &active,
                click: false,
            },
        );
    }
    let lane = lanes.values().next().expect("one lane");
    assert_eq!(lane_count(lane), 12);
    assert_eq!(lane.damage, 120);
    assert_eq!(lane.heal, 108);
    assert_eq!(sides_count(lane.by_state.get("invocation:spellblade")), 12);
}

/// A landing fold moves no amount — the count is the whole observation.
#[test]
fn a_landing_only_proc_carries_a_count_and_nothing_else() {
    let mut lanes: JsMap<SpellProcLane> = JsMap::new();
    let active: HashSet<String> = HashSet::new();
    add_spell_proc(
        &mut lanes,
        &SpellProcFold {
            spell: "Blessing of the Theurgist",
            side: ProcSide::Landing,
            amount: None,
            active: &active,
            click: false,
        },
    );
    let lane = lanes.values().next().expect("one lane");
    assert_eq!(lane_count(lane), 1);
    assert_eq!(lane.damage, 0);
    assert_eq!(lane.heal, 0);
}

/// The marker is display: both halves of a split key to one spell.
#[test]
fn the_lane_marker_is_stripped_at_every_join() {
    assert_eq!(
        lane_name_for("Puma Maw", SpellOrigin::Proc),
        "Puma Maw · proc"
    );
    assert_eq!(lane_name_for("Puma Maw", SpellOrigin::Cast), "Puma Maw");
    assert!(is_castless_lane_name("Puma Maw · click"));
    assert!(!is_castless_lane_name("Puma Maw"));
    assert_eq!(
        lane_canon_key("Puma Maw · proc"),
        spell_canon_key("Puma Maw")
    );
}

/// The two heal refusals: a HoT tick and a Quick Buff burst landing are never procs.
#[test]
fn the_heal_side_refuses_hot_ticks_and_quick_buff_bursts() {
    let mut r = RecentCasts::new();
    assert!(!is_castless_heal(
        &mut r,
        &HealProcInput {
            spell: "Ethereal Cleansing",
            ts: 1_000,
            over_time: true,
            quick_buff_ts: 0
        }
    ));
    assert!(!is_castless_heal(
        &mut r,
        &HealProcInput {
            spell: "Valor",
            ts: 4_000,
            over_time: false,
            quick_buff_ts: 1_000
        }
    ));
    assert!(is_castless_heal(
        &mut r,
        &HealProcInput {
            spell: "Lifetap Strike",
            ts: 9_000,
            over_time: false,
            quick_buff_ts: 1_000
        }
    ));
}

/// Unambiguous or nothing: a two-candidate list counts no firing.
#[test]
fn a_self_landing_proc_needs_a_one_element_candidate_list() {
    assert!(self_landing_proc_in(&["Blessing of the Theurgist".to_string()]).is_some());
    assert!(self_landing_proc_in(&[
        "Blessing of the Theurgist".to_string(),
        "Something Else".to_string()
    ])
    .is_none());
}
