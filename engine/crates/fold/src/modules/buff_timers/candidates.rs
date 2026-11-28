//! Lifted out of the parent file unchanged (Z Engine, 2026-09-07) so it stays at its factoring line.

use super::*;

/// The three landing verbs whose hold ANY damage breaks — the holds a corpse cannot be about.
///
/// A mesmerized mob cannot be killed while mesmerized: the first point of damage wakes it and the
/// log says so before the corpse appears. So a mez that is killed is one whose break line already
/// closed the landing, and a death arriving while the hold stands is about another mob of that name.
///
/// `ensnared` is deliberately not a member: a snare does nothing to stop you killing what it is on,
/// so a corpse genuinely is that hold ending. Charm is the same from the other side and reaches this
/// module with no verb at all.
pub(super) fn damage_breaks(verb: &str) -> bool {
    matches!(verb, "mesmerized" | "enthralled" | "entranced")
}

/// The CC/charm broadcast's candidate shape, which carries no illusion flag.
pub(super) fn cc_candidates(ev: &Event) -> Vec<Candidate> {
    ev.candidates(Key::Candidates)
        .into_iter()
        .map(|(name, duration_ms, _)| Candidate {
            name,
            duration_ms,
            // Not the event's flag: this shape carries none.
            illusion: false,
        })
        .collect()
}

/// Candidate names, ordered by [`crate::modules::buff_landing::compare_names`].
pub(super) fn sorted_names(cands: &[Candidate]) -> Vec<String> {
    let mut names: Vec<String> = cands.iter().map(|c| c.name.clone()).collect();
    names.sort_by(|a, b| crate::modules::buff_landing::compare_names(a, b));
    names
}
