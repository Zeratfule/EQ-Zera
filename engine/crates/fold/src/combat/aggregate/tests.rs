//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::*;

fn hit(skill: &str, amount: i64, crit: bool) -> DamageEvent<'_> {
    DamageEvent {
        ts: 0,
        attacker: "You",
        target: "a bat",
        amount,
        dtype: "melee",
        dclass: None,
        skill: skill.into(),
        crit,
        category: "melee".into(),
        modifiers: &[],
        verb: None,
    }
}

fn you() -> SourceRef {
    SourceRef {
        id: "you".into(),
        name: "You".into(),
        kind: SourceKind::You,
    }
}

/// The per-lane minimum uses 0 as "nothing landed yet".
#[test]
fn the_lane_minimum_treats_zero_as_no_landed_hit_yet() {
    let mut a = Agg::new();
    a.add_out(&you(), &hit("Melee", 30, false), false);
    a.add_out(&you(), &hit("Melee", 12, false), false);
    let s = a.out.get("you").expect("row");
    assert_eq!(s.by_skill.get("Melee").expect("lane").min, 12);
    assert_eq!(s.by_skill.get("Melee").expect("lane").max, 30);
}

/// A miss creates a row, which is why the drop rule reads map size and not a total.
#[test]
fn an_encounter_of_pure_misses_is_not_empty() {
    let mut a = Agg::new();
    assert!(a.is_empty());
    a.add_out_miss(
        &you(),
        &MissFold {
            mtype: MissType::Dodge,
            skill: "Melee".into(),
            verb: None,
            lane_skill: None,
            modifiers: Vec::new(),
            target: "a bat".into(),
            ts: 0,
        },
    );
    assert!(!a.is_empty());
    assert_eq!(Agg::sum(&a.out), 0);
    let s = a.out.get("you").expect("row");
    assert_eq!(s.misses, 1);
    assert_eq!(s.miss[MissType::Dodge as usize], 1);
}

/// A resist moves no damage total and still opens the lane it was resisted on.
#[test]
fn a_resist_opens_a_lane_and_moves_no_total() {
    let mut a = Agg::new();
    a.add_out(&you(), &hit("Melee", 30, false), false);
    a.add_out_resist(&you(), "Cajoling Whispers", "spell");
    let s = a.out.get("you").expect("row");
    assert_eq!(s.total, 30);
    assert_eq!(s.resists, 1);
    assert_eq!(s.by_skill.get("Cajoling Whispers").expect("lane").hits, 0);
    assert_eq!(
        s.by_skill.get("Cajoling Whispers").expect("lane").resists,
        1
    );
}

/// The one legal kind transition is `Other` → `Member`, and it is one-way.
#[test]
fn a_recorded_row_upgrades_to_member_and_never_back() {
    let mut a = Agg::new();
    let other = SourceRef {
        id: "member:dranix".into(),
        name: "Dranix".into(),
        kind: SourceKind::Other,
    };
    let member = SourceRef {
        kind: SourceKind::Member,
        ..other.clone()
    };
    a.add_out(&other, &hit("Melee", 10, false), false);
    assert_eq!(
        a.out.get("member:dranix").expect("row").kind,
        SourceKind::Other
    );
    a.add_out(&member, &hit("Melee", 10, false), false);
    assert_eq!(
        a.out.get("member:dranix").expect("row").kind,
        SourceKind::Member
    );
    a.add_out(&other, &hit("Melee", 10, false), false);
    assert_eq!(
        a.out.get("member:dranix").expect("row").kind,
        SourceKind::Member
    );
    // …and the whole time it is one row, one id, one total.
    assert_eq!(a.out.len(), 1);
    assert_eq!(Agg::sum(&a.out), 30);
}

/// `inc_heal` is the one named-total map that counts as well as sums.
#[test]
fn only_the_incoming_heal_ledger_counts_its_lines() {
    let mut a = Agg::new();
    a.add_inc_heal("dranix", "Dranix", 100);
    a.add_inc_heal("dranix", "Dranix", 50);
    a.add_enemy_heal("a bat#1", "a bat", 20);
    assert_eq!(a.inc_heal.get("dranix").expect("row").count, 2);
    assert_eq!(a.inc_heal.get("dranix").expect("row").amount, 150);
    assert_eq!(a.enemy_heal.get("a bat#1").expect("row").count, 0);
    assert_eq!(Agg::sum_heal(&a.enemy_heal), 20);
}
