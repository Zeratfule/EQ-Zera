//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::*;

#[test]
fn a_second_spawn_of_a_name_labels_itself_and_the_first_keeps_the_bare_name() {
    let mut w = WorldModel::new();
    let a = w.resolve("a spite golem", 1_000, false);
    assert_eq!(a.instance_id, "a spite golem#1");
    assert_eq!(a.label, "a spite golem");
    // Only a fresh spawn mints a gen — a second sighting inside the staleness window is the
    // same mob.
    let again = w.resolve("a spite golem", 2_000, false);
    assert_eq!(again.instance_id, "a spite golem#1");
    // …and past it, the slot is retired and the sighting spawns gen 2, which now labels itself.
    let b = w.resolve("a spite golem", 2_000 + INSTANCE_STALE_MS, false);
    assert_eq!(b.instance_id, "a spite golem#2");
    assert_eq!(b.label, "a spite golem (2)");
}

/// EQ's sentence-capitalization can never overwrite the spawn's true lowercase-article name.
#[test]
fn sentence_casing_never_overwrites_the_true_name() {
    let mut w = WorldModel::new();
    // First sighting is sentence-initial, so the spawn takes it verbatim…
    assert_eq!(
        w.resolve("A zol ghoul knight", 1, false).label,
        "A zol ghoul knight"
    );
    // …the first mid-sentence sighting flips it to canonical…
    assert_eq!(
        w.resolve("a zol ghoul knight", 2, false).label,
        "a zol ghoul knight"
    );
    // …and pins it there.
    assert_eq!(
        w.resolve("A zol ghoul knight", 3, false).label,
        "a zol ghoul knight"
    );
}

/// A pet is exempt from staleness — it is bound by explicit evidence and may stand quiet for
/// minutes; only death, uncharm and zone retire one.
#[test]
fn a_pet_never_ages_out_but_a_hostile_twin_does() {
    let mut w = WorldModel::new();
    let pet = w.charm("a fire giant warrior", 0);
    w.note_twin_evidence("a fire giant warrior", 0);
    let late = 10 * INSTANCE_STALE_MS;
    w.resolve("a fire giant warrior", late, false);
    assert!(w.is_live_pet(&pet.instance_id));
    // The silent twin was retired and the sighting spawned a fresh generation.
    assert!(w.is_retired("a fire giant warrior#2"));
}

/// The single-pet invariant: claiming a new summoned pet retires the one you had.
#[test]
fn a_new_summoned_pet_retires_the_prior_one() {
    let mut w = WorldModel::new();
    let first = w.claim("Jaber", 0);
    let second = w.claim("Gonekn", 1_000);
    assert!(w.is_retired(&first.instance_id));
    assert!(w.is_live_pet(&second.instance_id));
    // A charmed pet is untouched — the two kinds co-exist.
    let charmed = w.charm("a rock golem", 2_000);
    w.claim("Vebarn", 3_000);
    assert!(w.is_live_pet(&charmed.instance_id));
}

/// A repeat tell from the SAME pet converges on one entity and never reaches the succession.
#[test]
fn repeat_claims_from_one_pet_are_idempotent() {
    let mut w = WorldModel::new();
    let a = w.claim("Jaber", 0);
    let b = w.claim("Jaber", 5_000);
    assert_eq!(a.instance_id, b.instance_id);
    assert!(!w.is_retired(&a.instance_id));
}

/// The bias is always away from the pet: a foreign killer with no twin spawns and retires a
/// ghost slot rather than killing the pet.
#[test]
fn a_foreign_killer_with_no_twin_retires_a_ghost_and_keeps_the_pet() {
    let mut w = WorldModel::new();
    let pet = w.charm("a fire giant warrior", 0);
    let res = w.death("a fire giant warrior", 1_000, Some("a fire giant wizard"));
    assert!(!res.was_pet);
    assert!(res.ambiguous);
    assert!(w.is_live_pet(&pet.instance_id));
}

/// …and the one case where the pet really does die: the same-named killer with nothing else
/// live.
#[test]
fn a_same_named_death_with_only_the_pet_live_is_a_real_pet_death() {
    let mut w = WorldModel::new();
    let pet = w.charm("a fire giant warrior", 0);
    let res = w.death("a fire giant warrior", 1_000, Some("a fire giant warrior"));
    assert!(res.was_pet);
    assert!(res.ambiguous);
    assert!(w.is_retired(&pet.instance_id));
}

/// Only a summoned pet walks through the door with you.
#[test]
fn a_zone_keeps_the_summoned_pet_and_leaves_everything_else() {
    let mut w = WorldModel::new();
    let charmed = w.charm("a rock golem", 0);
    let summoned = w.claim("Vebarn", 0);
    let mob = w.resolve("a spite golem", 0, false);
    let survivors = w.zone(1_000);
    assert_eq!(survivors.len(), 1);
    assert_eq!(survivors[0].instance_id, summoned.instance_id);
    assert!(w.is_retired(&charmed.instance_id));
    assert!(w.is_retired(&mob.instance_id));
}

/// Every retirement path announces itself exactly once, through the one recorder.
#[test]
fn every_retirement_is_announced_once() {
    let mut w = WorldModel::new();
    w.resolve("a spite golem", 0, false);
    w.death("a spite golem", 10, None);
    assert_eq!(w.retired_ids, vec!["a spite golem#1".to_string()]);
    w.retired_ids.clear();
    w.resolve("a bat", 0, false);
    w.zone(20);
    assert_eq!(w.retired_ids, vec!["a bat#1".to_string()]);
}

/// An id nothing ever spawned is retired, not live — it cannot be a live engagement.
#[test]
fn an_unknown_instance_id_is_retired() {
    let w = WorldModel::new();
    assert!(w.is_retired("nobody#1"));
    assert!(!w.is_live_pet("nobody#1"));
}
