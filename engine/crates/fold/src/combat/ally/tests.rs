//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::*;

fn cast<'a>(caster: &'a str, key: &'a str, spell: &'a str, ts: i64) -> AllyCastLine<'a> {
    AllyCastLine {
        caster,
        caster_key: key,
        spell,
        ts,
        allowed: true,
    }
}

/// A non-player-shaped caster never arms the join: the log holds `A fire giant warrior begins
/// singing Solon's Bewitching Bravura.`, which a rule without the name shape would file as a
/// charm.
#[test]
fn a_mob_shaped_caster_never_arms_the_join() {
    let mut a = AllyCharms::new();
    a.note_cast(&cast(
        "a fire giant warrior",
        "a fire giant warrior",
        "Allure",
        0,
    ));
    assert!(matches!(
        a.broadcast("a rock golem", "a rock golem", 1_000),
        AllyVerdict::None
    ));
}

#[test]
fn one_armed_player_caster_binds_the_broadcast_to_them() {
    let mut a = AllyCharms::new();
    a.note_cast(&cast("Scooba", "scooba", "Allure", 0));
    let AllyVerdict::Bind(b) = a.broadcast("a rock golem", "a rock golem", 3_000) else {
        panic!("expected a bind");
    };
    assert_eq!(b.charmer, "Scooba");
    assert_eq!(b.kind, AllyKind::Charm);
    assert!(a.is_friendly("scooba"));
}

/// Two casters armed over one broadcast is refused, and both arms are consumed so the next
/// broadcast cannot ride a spent cast in.
#[test]
fn a_two_caster_tie_is_refused_and_spends_both_arms() {
    let mut a = AllyCharms::new();
    a.note_cast(&cast("Paladrial", "paladrial", "Cajoling Whispers III", 0));
    a.note_cast(&cast("Satya", "satya", "Cajoling Whispers III", 0));
    assert!(matches!(
        a.broadcast("a lava duct crawler", "a lava duct crawler", 3_000),
        AllyVerdict::Refuse(_)
    ));
    assert!(matches!(
        a.broadcast("a lava duct crawler", "a lava duct crawler", 3_000),
        AllyVerdict::None
    ));
}

/// The bard's charm can never be the cast a broadcast resolved.
#[test]
fn a_bard_charm_does_not_arm_the_join() {
    let mut a = AllyCharms::new();
    a.note_cast(&cast("Enzee", "enzee", "Solon's Bewitching Bravura", 0));
    assert!(matches!(
        a.broadcast("a rock golem", "a rock golem", 1_000),
        AllyVerdict::None
    ));
    // …but the caster is still remembered as a friendly, the other half of `note_cast`.
    assert!(a.is_friendly("enzee"));
}

/// The hold slides on evidence: a pet still swinging keeps its row past the DB's figure.
#[test]
fn activity_slides_the_hold_and_silence_reaps_it() {
    let mut a = AllyCharms::new();
    a.note_cast(&cast("Scooba", "scooba", "Allure", 0));
    a.broadcast("a rock golem", "a rock golem", 3_000);
    let window = provisional_window_ms("Allure");
    a.note_activity("a rock golem", window);
    assert!(a.sweep(3_000 + window).is_empty());
    assert_eq!(a.sweep(window + window).len(), 1);
}

/// A `Summon` bind has no clock and no break rule; a `Charm` bind has both.
#[test]
fn a_summon_bind_is_exempt_from_the_clock_and_the_break() {
    let mut a = AllyCharms::new();
    a.note_cast(&cast("Wemby", "wemby", "Kintaz's Animation", 0));
    a.bind_by_leader(&AllyLeaderLine {
        pet_key: "gasarn",
        pet: "Gasarn",
        owner: "Wemby",
        owner_key: "wemby",
        ts: 1_000,
        ever_charmed: false,
    });
    assert_eq!(a.bind_of("gasarn").expect("bound").kind, AllyKind::Summon);
    assert!(a.soft_hostile("gasarn").is_none());
    assert!(a.sweep(i64::MAX - 1).is_empty());
}

/// Charm evidence for the pet outranks summon evidence for the owner.
#[test]
fn a_pet_a_broadcast_has_named_is_a_charm_bind_even_beside_a_summon_sighting() {
    let mut a = AllyCharms::new();
    a.note_cast(&cast("Wemby", "wemby", "Kintaz's Animation", 0));
    let b = a.bind_by_leader(&AllyLeaderLine {
        pet_key: "a rock golem",
        pet: "a rock golem",
        owner: "Wemby",
        owner_key: "wemby",
        ts: 1_000,
        ever_charmed: true,
    });
    assert_eq!(b.kind, AllyKind::Charm);
    assert!(a.soft_hostile("a rock golem").is_some());
}

/// A later broadcast contradicts a summon lifecycle, one direction only.
#[test]
fn a_broadcast_upgrades_a_summon_bind_to_the_charm_lifecycle() {
    let mut a = AllyCharms::new();
    a.note_cast(&cast("Wemby", "wemby", "Kintaz's Animation", 0));
    a.bind_by_leader(&AllyLeaderLine {
        pet_key: "a rock golem",
        pet: "a rock golem",
        owner: "Wemby",
        owner_key: "wemby",
        ts: 1_000,
        ever_charmed: false,
    });
    // No arm is live, so this resolves to nothing — and still moves the lifecycle.
    a.broadcast("a rock golem", "a rock golem", 2_000);
    assert_eq!(
        a.bind_of("a rock golem").expect("bound").kind,
        AllyKind::Charm
    );
}

/// The twin refusal is sticky, and a re-charm by the same charmer does not clear it.
#[test]
fn ambiguity_survives_a_recharm_by_the_same_charmer() {
    let mut a = AllyCharms::new();
    a.note_cast(&cast("Scooba", "scooba", "Allure", 0));
    a.broadcast("a rock golem", "a rock golem", 3_000);
    assert!(a.mark_ambiguous("a rock golem"));
    assert!(!a.mark_ambiguous("a rock golem"));
    assert!(a.creditable("a rock golem").is_none());
    a.note_cast(&cast("Scooba", "scooba", "Allure", 10_000));
    a.broadcast("a rock golem", "a rock golem", 13_000);
    assert!(a.creditable("a rock golem").is_none());
}
