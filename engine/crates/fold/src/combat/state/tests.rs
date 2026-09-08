//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::*;

#[test]
fn an_instance_ids_name_key_is_everything_before_the_last_hash() {
    assert_eq!(name_key_of("a spite golem#12"), Some("a spite golem"));
    assert_eq!(name_key_of("you"), None);
    assert_eq!(name_key_of("#3"), None);
}

/// The three absolute refusals: a pet, a charmed name and something you have struck can never be
/// filed as a player, whatever a heal line says.
#[test]
fn a_pet_a_charm_and_a_mob_you_struck_can_never_become_players() {
    let mut st = EngineState::new();
    st.note_pet("vebarn");
    st.note_player(Some("vebarn"));
    assert!(!st.known_players.contains("vebarn"));

    let mut st = EngineState::new();
    st.charm.charm_broadcast("a rock golem", "a rock golem", 0);
    st.note_player(Some("a rock golem"));
    assert!(!st.known_players.contains("a rock golem"));

    let mut st = EngineState::new();
    st.note_struck("lord of loathing");
    st.note_player(Some("lord of loathing"));
    assert!(!st.known_players.contains("lord of loathing"));
}

/// …and the one that DOES file: a stranger who healed you, with none of the three against them.
#[test]
fn a_healer_with_no_refusal_against_them_is_filed_a_player() {
    let mut st = EngineState::new();
    st.note_player(Some("sonista"));
    assert!(st.is_known_player("sonista"));
}

/// A retired pet leaves the attribution set and stays in `ever_pet` — a retired pet is still a
/// pet, never a candidate player.
#[test]
fn syncing_pet_names_drops_the_retired_and_keeps_the_history() {
    let mut st = EngineState::new();
    st.world.claim("Jaber", 0);
    st.note_pet("jaber");
    st.world.claim("Gonekn", 1_000);
    st.note_pet("gonekn");
    let dropped = st.sync_pet_names();
    assert_eq!(dropped, vec!["jaber".to_string()]);
    assert!(!st.pet_names.contains("jaber"));
    assert!(st.ever_pet.contains("jaber"));
}
